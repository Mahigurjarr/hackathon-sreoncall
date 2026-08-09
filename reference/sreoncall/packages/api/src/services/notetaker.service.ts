import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { getJetStream, getNatsConnection } from '../config/nats';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler.middleware';
import {
  NotetakerSession,
  NotetakerSessionDocument,
  NotetakerSource,
  NotetakerPlatform,
  NotetakerStatus,
  INotetakerSuggestion,
} from '../models/notetaker-session.model';
import { TranscriptSegment } from '../models/transcript-segment.model';
import { Message } from '../models/channel.model';
import { Channel } from '../models/channel.model';
import { Incident } from '../models/incident.model';
import { Runbook } from '../models/runbook.model';
import { Project } from '../models/project.model';
import { UsageRecord } from '../models/billing.model';
import { Tenant } from '../models/tenant.model';
import { generateUploadUrl } from './storage.service';
import { createTicket } from './ticket.service';
import { createBot, isRecallConfigured } from './recall.service';
import { getConfig } from '../config/index';
import { ProviderSegment } from './notetaker/stt/types';
import { TenantIntegration } from '../models/tenant-integration.model';
import { decryptToken } from '../utils/encryption';
import * as slackService from './slack.service';
import * as teamsService from './teams.service';

const sc = StringCodec();

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Publish a job onto the NOTETAKER JetStream stream (best-effort). */
async function enqueue(subject: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(subject, sc.encode(JSON.stringify(payload)));
  } catch (err: any) {
    logger.error('Failed to publish notetaker job', { subject, error: err.message });
  }
}

export async function enqueueTranscribe(sessionId: string): Promise<void> {
  await enqueue('notetaker.transcribe', { session_id: sessionId });
}

export async function enqueueSummarize(sessionId: string): Promise<void> {
  await enqueue('notetaker.summarize', { session_id: sessionId });
}

export async function enqueueRecallDone(sessionId: string): Promise<void> {
  await enqueue('notetaker.recall_done', { session_id: sessionId });
}

export async function enqueueCalendarSync(calendarId: string, since?: string): Promise<void> {
  await enqueue('notetaker.calendar_sync', { calendar_id: calendarId, since: since || null });
}

/**
 * Throw HTTP 402 if the tenant has already used its monthly notetaker minutes.
 * (0 = feature off — handled by the route's plan-feature gate; -1 = unlimited.)
 */
export async function assertNotetakerMinutesAvailable(tenantId: Types.ObjectId): Promise<void> {
  const tenant = await Tenant.findById(tenantId).select('plan_limits').lean();
  const limit: number = (tenant?.plan_limits as any)?.max_notetaker_minutes_per_month ?? 0;
  if (limit === -1) return; // unlimited
  if (limit === 0) {
    throw AppError.paymentRequired('AI Notetaker is not available on your current plan. Upgrade to enable it.');
  }
  const record = await UsageRecord.findOne({ tenant_id: tenantId, period: currentPeriod() })
    .select('notetaker_minutes_used')
    .lean();
  const used = (record as any)?.notetaker_minutes_used || 0;
  if (used >= limit) {
    throw AppError.paymentRequired(
      `Monthly AI Notetaker minutes exhausted (${used} / ${limit}). Upgrade or wait for next month.`
    );
  }
}

/** Record consumed minutes once a session completes (idempotent via `metered`). */
export async function meterMinutes(session: NotetakerSessionDocument): Promise<void> {
  if (session.metered) return;
  const minutes = Math.max(1, Math.ceil((session.duration_seconds || 0) / 60));
  await UsageRecord.findOneAndUpdate(
    { tenant_id: session.tenant_id, period: currentPeriod() },
    { $inc: { notetaker_minutes_used: minutes } },
    { upsert: true }
  );
  session.metered = true;
  await session.save();
}

export interface StartSessionInput {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  title: string;
  source: NotetakerSource;
  platform: NotetakerPlatform;
  channel_id?: string;
  incident_id?: string;
  meeting_url?: string;
  // For uploads — needed to mint a presigned PUT URL.
  upload?: { original_name: string; mime_type: string; size_bytes: number };
}

export interface StartSessionResult {
  session: NotetakerSessionDocument;
  upload?: { upload_url: string; file_id: string; expires_in: number };
}

export async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
  await assertNotetakerMinutesAvailable(input.tenant_id);

  const session = await NotetakerSession.create({
    tenant_id: input.tenant_id,
    created_by: input.created_by,
    title: input.title,
    source: input.source,
    platform: input.platform,
    channel_id: input.channel_id ? new Types.ObjectId(input.channel_id) : null,
    incident_id: input.incident_id ? new Types.ObjectId(input.incident_id) : null,
    meeting_url: input.meeting_url || null,
    status: input.source === 'recall_bot' ? 'scheduled' : 'processing',
    stt_provider: getConfig().STT_PROVIDER,
    started_at: new Date(),
  });

  // Upload path — mint a presigned PUT URL into the recordings bucket.
  if (input.source === 'upload') {
    if (!input.upload) throw AppError.badRequest('upload metadata (original_name, mime_type, size_bytes) is required for upload sessions.');
    const presigned = await generateUploadUrl({
      tenant_id: input.tenant_id,
      original_name: input.upload.original_name,
      mime_type: input.upload.mime_type,
      size_bytes: input.upload.size_bytes,
      uploaded_by: input.created_by,
      resource_type: 'notetaker_recording',
      resource_id: session._id.toString(),
      bucket: 'recordings',
    });
    session.audio_file_id = new Types.ObjectId(presigned.file_id);
    await session.save();
    return {
      session,
      upload: { upload_url: presigned.upload_url, file_id: presigned.file_id, expires_in: presigned.expires_in },
    };
  }

  // Recall meeting-bot path — dispatch a bot into the meeting.
  if (!isRecallConfigured()) {
    session.status = 'failed';
    session.error = 'Recall.ai is not configured (RECALL_API_KEY unset).';
    await session.save();
    throw AppError.badRequest('Online meeting capture is not configured on this deployment.');
  }
  if (!input.meeting_url) throw AppError.badRequest('meeting_url is required for online meeting capture.');

  const base = getConfig().NOTETAKER_PUBLIC_BASE_URL;
  const webhookUrl = base ? `${base.replace(/\/$/, '')}/api/v1/webhooks/recall/transcript` : undefined;
  try {
    const bot = await createBot({
      meeting_url: input.meeting_url,
      bot_name: 'SREonCall Notetaker',
      webhook_url: webhookUrl,
      realtime: !!webhookUrl,
    });
    session.recall_bot_id = bot.id;
    session.status = 'joining';
    await session.save();
  } catch (err: any) {
    session.status = 'failed';
    session.error = err.message;
    await session.save();
    throw AppError.badRequest(`Failed to start meeting bot: ${err.message}`);
  }

  return { session };
}

/** Mark an uploaded recording as ready and kick off transcription. */
export async function finalizeUpload(tenantId: Types.ObjectId, sessionId: string): Promise<NotetakerSessionDocument> {
  const session = await NotetakerSession.findOne({ _id: sessionId, tenant_id: tenantId });
  if (!session) throw AppError.notFound('Notetaker session');
  if (session.source !== 'upload') throw AppError.badRequest('Only upload sessions can be finalized.');
  if (!session.audio_file_id) throw AppError.badRequest('No recording associated with this session.');

  session.status = 'transcribing';
  await session.save();
  await enqueueTranscribe(session._id.toString());
  return session;
}

/**
 * Store a live transcript segment and fan it out over the WebSocket gateway so
 * the war room shows the transcript as the call happens.
 */
export async function appendLiveSegment(
  session: NotetakerSessionDocument,
  segment: ProviderSegment,
  isFinal = true
): Promise<void> {
  await TranscriptSegment.create({
    tenant_id: session.tenant_id,
    session_id: session._id,
    speaker: segment.speaker,
    text: segment.text,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    is_final: isFinal,
  });

  if (session.status === 'joining' || session.status === 'scheduled') {
    session.status = 'recording';
    await session.save();
  }

  // Fan out over CORE NATS on an off-stream subject (notetaker-live.*), so live
  // segments are ephemeral and never enter the durable NOTETAKER JetStream.
  try {
    const nc = getNatsConnection();
    nc.publish(
      `notetaker-live.${session.tenant_id.toString()}`,
      sc.encode(
        JSON.stringify({
          tenant_id: session.tenant_id.toString(),
          session_id: session._id.toString(),
          channel_id: session.channel_id?.toString() || null,
          speaker: segment.speaker,
          text: segment.text,
          start_ms: segment.start_ms,
          is_final: isFinal,
        })
      )
    );
  } catch (err: any) {
    logger.debug('Failed to publish live transcript segment', { error: err.message });
  }
}

// ─── Suggestion review (suggest-then-approve) ────────────────────────────────

export async function dismissSuggestion(
  tenantId: Types.ObjectId,
  sessionId: string,
  suggestionId: string,
  userId: Types.ObjectId
): Promise<INotetakerSuggestion> {
  const session = await NotetakerSession.findOne({ _id: sessionId, tenant_id: tenantId });
  if (!session) throw AppError.notFound('Notetaker session');
  const suggestion = (session.suggestions as any).id(suggestionId) as INotetakerSuggestion | null;
  if (!suggestion) throw AppError.notFound('Suggestion');
  if (suggestion.status !== 'suggested') throw AppError.badRequest(`Suggestion already ${suggestion.status}.`);

  suggestion.status = 'dismissed';
  suggestion.decided_by = userId;
  suggestion.decided_at = new Date();
  await session.save();
  return suggestion;
}

export interface AcceptSuggestionOptions {
  /** For ticket suggestions — which project the ticket lands in. */
  project_id?: string;
}

/**
 * Accept a suggestion: create the real resource (ticket / runbook / incident
 * timeline entry) and record the link back on the suggestion.
 */
export async function acceptSuggestion(
  tenantId: Types.ObjectId,
  sessionId: string,
  suggestionId: string,
  userId: Types.ObjectId,
  opts: AcceptSuggestionOptions = {}
): Promise<{ suggestion: INotetakerSuggestion; resource_type: string; resource_id: string }> {
  const session = await NotetakerSession.findOne({ _id: sessionId, tenant_id: tenantId });
  if (!session) throw AppError.notFound('Notetaker session');
  const suggestion = (session.suggestions as any).id(suggestionId) as INotetakerSuggestion | null;
  if (!suggestion) throw AppError.notFound('Suggestion');
  if (suggestion.status !== 'suggested') throw AppError.badRequest(`Suggestion already ${suggestion.status}.`);

  const payload = suggestion.payload as any;
  let resourceType: string;
  let resourceId: string;

  if (suggestion.type === 'ticket') {
    const projectId = opts.project_id || (await defaultProjectId(tenantId));
    if (!projectId) throw AppError.badRequest('No project available — specify project_id to create the ticket.');
    const ticket = await createTicket({
      tenant_id: tenantId,
      project_id: projectId,
      type: payload.type === 'bug' ? 'bug' : 'task',
      title: String(payload.title || 'Follow-up from call').slice(0, 300),
      description: buildTicketDescription(payload, session),
      priority: ['high', 'medium', 'low'].includes(payload.priority) ? payload.priority : 'medium',
      reporter_id: userId,
      labels: ['ai-notetaker'],
    });
    resourceType = 'ticket';
    resourceId = ticket._id.toString();
    if (session.incident_id) {
      await Incident.updateOne({ _id: session.incident_id, tenant_id: tenantId }, { $addToSet: { linked_ticket_ids: ticket._id } });
    }
  } else if (suggestion.type === 'runbook') {
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const runbook = await Runbook.create({
      tenant_id: tenantId,
      title: String(payload.title || 'Runbook from call').slice(0, 300),
      description: String(payload.description || `Generated from notetaker session: ${session.title}`),
      content: buildRunbookMarkdown(payload),
      category: 'incident-response',
      status: 'draft',
      steps: steps.map((s: any, i: number) => ({
        order: i,
        title: typeof s === 'string' ? `Step ${i + 1}` : String(s.title || `Step ${i + 1}`),
        instructions: typeof s === 'string' ? s : String(s.instructions || s.title || ''),
        type: 'manual',
        requires_approval: false,
        approval_roles: [],
        timeout_seconds: 300,
        working_directory: '',
        environment_vars: {},
        api_method: 'GET',
        api_url: '',
        api_headers: {},
        api_body: '',
        attachments: [],
      })),
      tags: ['ai-notetaker', 'auto-generated'],
      service_ids: [],
      author_id: userId,
      created_by: userId,
      ai_generated: true,
    });
    resourceType = 'runbook';
    resourceId = runbook._id.toString();
  } else if (suggestion.type === 'incident_timeline') {
    if (!session.incident_id) throw AppError.badRequest('This session is not linked to an incident.');
    const note = String(payload.note || payload.text || '').trim();
    if (!note) throw AppError.badRequest('Empty timeline note.');
    await Incident.updateOne(
      { _id: session.incident_id, tenant_id: tenantId },
      {
        $push: {
          timeline: {
            timestamp: new Date(),
            type: 'note',
            actor_id: userId,
            message: note,
            metadata: { source: 'ai_notetaker', notetaker_session_id: session._id.toString() },
          },
        },
      }
    );
    resourceType = 'incident_timeline';
    resourceId = session.incident_id.toString();
  } else {
    throw AppError.badRequest(`Unknown suggestion type: ${suggestion.type}`);
  }

  suggestion.status = 'accepted';
  suggestion.created_resource_type = resourceType;
  suggestion.created_resource_id = new Types.ObjectId(resourceId);
  suggestion.decided_by = userId;
  suggestion.decided_at = new Date();
  await session.save();

  return { suggestion, resource_type: resourceType, resource_id: resourceId };
}

async function defaultProjectId(tenantId: Types.ObjectId): Promise<string | null> {
  const project = await Project.findOne({ tenant_id: tenantId }).sort({ created_at: 1 }).select('_id').lean();
  return project ? (project as any)._id.toString() : null;
}

function buildTicketDescription(payload: any, session: NotetakerSessionDocument): string {
  const parts = [String(payload.description || '').trim()];
  parts.push('', `_Suggested by AI Notetaker from session "${session.title}"._`);
  return parts.join('\n');
}

function buildRunbookMarkdown(payload: any): string {
  const lines = [`# ${payload.title || 'Runbook'}`, ''];
  if (payload.description) lines.push(String(payload.description), '');
  lines.push('## Steps', '');
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  steps.forEach((s: any, i: number) => {
    const text = typeof s === 'string' ? s : s.instructions || s.title || '';
    lines.push(`${i + 1}. ${text}`);
  });
  lines.push('', '_Generated by SREonCall AI Notetaker._');
  return lines.join('\n');
}

/**
 * Post the AI summary as a bot message into the linked war room so responders
 * see it in-context without leaving the channel.
 */
export async function postSummaryToWarRoom(session: NotetakerSessionDocument): Promise<void> {
  if (!session.channel_id) return;
  const channel = await Channel.findOne({ _id: session.channel_id, tenant_id: session.tenant_id });
  if (!channel) return;

  const lines = [`🤖 *AI Notetaker summary — ${session.title}*`, ''];
  if (session.summary) lines.push(session.summary, '');
  if (session.decisions.length) {
    lines.push('*Decisions:*');
    session.decisions.forEach((d) => lines.push(`• ${d}`));
    lines.push('');
  }
  const pending = session.suggestions.filter((s) => s.status === 'suggested');
  if (pending.length) {
    lines.push(`*${pending.length} suggested follow-up${pending.length === 1 ? '' : 's'}* awaiting review in the Notetaker panel.`);
  }

  const body = lines.join('\n').slice(0, 10000);
  await Message.create({
    tenant_id: session.tenant_id,
    channel_id: session.channel_id,
    body,
    author_id: session.created_by,
    sender_type: 'bot',
  });
  channel.last_message_at = new Date();
  await channel.save();

  // Relay the summary to the war room's linked external comms (Slack/Teams),
  // best-effort — never block or fail the session on a relay error.
  await relaySummaryToExternalComms(session, channel, body).catch((err) =>
    logger.error('Failed to relay notetaker summary to external comms', { error: err.message })
  );
}

/**
 * Build the interactive Slack Block Kit message for a session summary: header,
 * summary, decisions, and per pending suggestion an Accept/Dismiss action row.
 * Reused both for the initial post and for in-place updates after an action.
 */
export function buildNotetakerSlackBlocks(session: NotetakerSessionDocument): any[] {
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `🤖 AI Notetaker — ${session.title}`.slice(0, 150), emoji: true } },
  ];
  if (session.summary) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: session.summary.slice(0, 2900) } });
  }
  if (session.decisions.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Decisions:*\n${session.decisions.map((d) => `• ${d}`).join('\n')}`.slice(0, 2900) } });
  }

  const sid = session._id.toString();
  const tid = session.tenant_id.toString();
  for (const sg of session.suggestions) {
    const p = sg.payload as any;
    const label = (p.title || p.note || p.text || sg.type) as string;
    const typeTag = sg.type.replace('_', ' ');
    if (sg.status === 'suggested') {
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${label}*  _(${typeTag})_${p.description ? `\n${String(p.description)}` : ''}`.slice(0, 2900) } });
      const value = JSON.stringify({ session_id: sid, suggestion_id: (sg as any)._id.toString(), tenant_id: tid });
      blocks.push({
        type: 'actions',
        elements: [
          { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Accept', emoji: true }, action_id: 'notetaker_suggestion_accept', value },
          { type: 'button', text: { type: 'plain_text', text: 'Dismiss', emoji: true }, action_id: 'notetaker_suggestion_dismiss', value },
        ],
      });
    } else {
      const mark = sg.status === 'accepted' ? '✅ Accepted' : '🚫 Dismissed';
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `${mark}: *${label}* _(${typeTag})_` }] });
    }
  }
  return blocks;
}

/**
 * Relay a summary to the Slack/Teams channel linked to a war room, when the
 * tenant has an active integration. Each leg is independent and best-effort.
 * Slack gets an interactive Block Kit message (Accept/Dismiss); Teams gets text.
 */
async function relaySummaryToExternalComms(
  session: NotetakerSessionDocument,
  channel: any,
  text: string
): Promise<void> {
  const tenantId = session.tenant_id;
  // Slack — interactive Block Kit with Accept/Dismiss buttons
  if (channel.slack_integration?.channel_id) {
    try {
      const integ = await TenantIntegration.findOne({ tenant_id: tenantId, platform: 'slack', is_active: true });
      if (integ?.bot_token_encrypted) {
        const token = decryptToken(integ.bot_token_encrypted);
        const ts = await slackService.postBlockMessage(token, channel.slack_integration.channel_id, buildNotetakerSlackBlocks(session), text);
        if (ts) {
          session.slack_message_ts = ts;
          session.slack_channel_id = channel.slack_integration.channel_id;
          await session.save();
        }
      }
    } catch (err: any) {
      logger.error('Notetaker Slack relay failed', { error: err.message });
    }
  }

  // Teams
  if (channel.teams_integration?.team_id && channel.teams_integration?.channel_id) {
    try {
      const integ = await TenantIntegration.findOne({ tenant_id: tenantId, platform: 'teams', is_active: true });
      if (integ?.bot_token_encrypted) {
        const token = decryptToken(integ.bot_token_encrypted);
        await teamsService.postMessage(
          token,
          channel.teams_integration.team_id,
          channel.teams_integration.channel_id,
          text
        );
      }
    } catch (err: any) {
      logger.error('Notetaker Teams relay failed', { error: err.message });
    }
  }
}
