import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { NotetakerSession, NotetakerSessionDocument } from '../models/notetaker-session.model';
import { TranscriptSegment } from '../models/transcript-segment.model';
import { createAuditLog } from '../services/audit.service';
import {
  startSession,
  finalizeUpload,
  acceptSuggestion,
  dismissSuggestion,
  enqueueSummarize,
  enqueueRecallDone,
} from '../services/notetaker.service';
import { stopBot, isRecallConfigured, getBot } from '../services/recall.service';
import { getConfig } from '../config/index';

const router = Router();

function auditActor(req: Request) {
  return {
    type: (req.isImpersonating ? 'impersonated' : 'user') as 'impersonated' | 'user',
    id: req.userId,
    email: req.user?.email,
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    user_agent: req.headers['user-agent'] || 'unknown',
    impersonated_by: req.impersonatedBy,
  };
}

function serializeSession(s: NotetakerSessionDocument) {
  return {
    id: s._id.toString(),
    title: s.title,
    source: s.source,
    platform: s.platform,
    status: s.status,
    error: s.error || null,
    channel_id: s.channel_id?.toString() || null,
    incident_id: s.incident_id?.toString() || null,
    meeting_url: s.meeting_url || null,
    stt_provider: s.stt_provider,
    duration_seconds: s.duration_seconds,
    summary: s.summary || null,
    key_points: s.key_points,
    decisions: s.decisions,
    participants: s.participants,
    suggestions: s.suggestions.map((sg) => ({
      id: (sg as any)._id.toString(),
      type: sg.type,
      status: sg.status,
      payload: sg.payload,
      created_resource_type: sg.created_resource_type || null,
      created_resource_id: sg.created_resource_id?.toString() || null,
      decided_at: sg.decided_at || null,
    })),
    pending_suggestions: s.suggestions.filter((sg) => sg.status === 'suggested').length,
    created_at: s.created_at,
    started_at: s.started_at || null,
    ended_at: s.ended_at || null,
  };
}

const RECALL_STATUS_MAP: Record<string, NotetakerSessionDocument['status']> = {
  joining_call: 'joining',
  in_waiting_room: 'joining',
  in_call_not_recording: 'recording',
  in_call_recording: 'recording',
  recording_permission_allowed: 'recording',
  call_ended: 'processing',
  done: 'processing',
  fatal: 'failed',
};

async function refreshRecallSessionStatus(session: NotetakerSessionDocument): Promise<NotetakerSessionDocument> {
  if (
    session.source !== 'recall_bot' ||
    !session.recall_bot_id ||
    !['scheduled', 'joining', 'recording'].includes(session.status) ||
    !isRecallConfigured()
  ) {
    return session;
  }

  try {
    const bot = await getBot(session.recall_bot_id);
    const statusCode = bot.status || '';
    const mapped = RECALL_STATUS_MAP[statusCode];
    if (!mapped) return session;

    let changed = false;

    if (mapped === 'recording' && !session.started_at) {
      session.started_at = new Date();
      changed = true;
    }

    if (session.status !== mapped && session.status !== 'completed') {
      session.status = mapped;
      changed = true;
    }

    if (mapped === 'failed' && !session.error) {
      session.error = 'Recall reported a fatal error';
      changed = true;
    }

    if (changed) {
      await session.save();
    }

    if (mapped === 'processing') {
      await enqueueRecallDone(session._id.toString());
    }
  } catch {
    // Best-effort fallback only. If Recall cannot be reached here, keep the
    // existing session state and let webhooks or a later poll update it.
  }

  return session;
}

// ─── POST /notetaker/sessions — start a capture session ──────────────────────

const startSchema = z.object({
  source: z.enum(['recall_bot', 'upload']),
  platform: z.enum(['zoom', 'meet', 'teams', 'slack_huddle', 'upload']).optional(),
  title: z.string().min(1).max(300),
  channel_id: z.string().optional(),
  incident_id: z.string().optional(),
  meeting_url: z.string().url().max(2048).optional(),
  upload: z
    .object({
      original_name: z.string().min(1).max(500),
      mime_type: z.string().min(1).max(200),
      size_bytes: z.number().int().positive(),
    })
    .optional(),
});

router.post('/sessions', rbac('notetaker:create'), async (req: Request, res: Response) => {
  const body = startSchema.parse(req.body);

  const platform: any =
    body.platform || (body.source === 'upload' ? 'upload' : inferPlatform(body.meeting_url));

  const result = await startSession({
    tenant_id: req.tenantId,
    created_by: req.userId,
    title: body.title,
    source: body.source,
    platform,
    channel_id: body.channel_id,
    incident_id: body.incident_id,
    meeting_url: body.meeting_url,
    upload: body.upload,
  });

  createAuditLog({
    tenant_id: req.tenantId,
    actor: auditActor(req),
    action: 'notetaker.session.started',
    resource_type: 'notetaker_session',
    resource_id: result.session._id.toString(),
    result: 'success',
    request_id: req.requestId,
  }).catch(() => {});

  res.status(201).json({
    session: serializeSession(result.session),
    upload: result.upload || null,
  });
});

function inferPlatform(url?: string): string {
  if (!url) return 'zoom';
  const u = url.toLowerCase();
  if (u.includes('zoom.')) return 'zoom';
  if (u.includes('meet.google')) return 'meet';
  if (u.includes('teams.microsoft') || u.includes('teams.live')) return 'teams';
  if (u.includes('slack.com')) return 'slack_huddle';
  return 'zoom';
}

// ─── POST /notetaker/sessions/:id/finalize-upload ────────────────────────────

router.post('/sessions/:id/finalize-upload', rbac('notetaker:create'), async (req: Request, res: Response) => {
  const session = await finalizeUpload(req.tenantId, req.params['id'] as string);
  res.json({ session: serializeSession(session) });
});

// ─── GET /notetaker/sessions ─────────────────────────────────────────────────

router.get('/sessions', rbac('notetaker:read'), async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { tenant_id: req.tenantId };
  if (req.query.channel_id) filter.channel_id = new Types.ObjectId(req.query.channel_id as string);
  if (req.query.incident_id) filter.incident_id = new Types.ObjectId(req.query.incident_id as string);
  if (req.query.status) filter.status = req.query.status;

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const sessions = await NotetakerSession.find(filter).sort({ created_at: -1 }).limit(limit);
  await Promise.all(
    sessions.map((session) => refreshRecallSessionStatus(session))
  );
  res.json({ data: sessions.map(serializeSession) });
});

// ─── GET /notetaker/sessions/:id ─────────────────────────────────────────────

router.get('/sessions/:id', rbac('notetaker:read'), async (req: Request, res: Response) => {
  const session = await NotetakerSession.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
  if (!session) throw AppError.notFound('Notetaker session');
  await refreshRecallSessionStatus(session);
  res.json({ session: serializeSession(session) });
});

// ─── GET /notetaker/sessions/:id/transcript ──────────────────────────────────

router.get('/sessions/:id/transcript', rbac('notetaker:read'), async (req: Request, res: Response) => {
  const session = await NotetakerSession.findOne({ _id: req.params['id'], tenant_id: req.tenantId }).select('_id');
  if (!session) throw AppError.notFound('Notetaker session');

  const limit = Math.min(Number(req.query.limit) || 1000, 5000);
  const segments = await TranscriptSegment.find({ session_id: session._id })
    .sort({ start_ms: 1 })
    .limit(limit)
    .lean();

  res.json({
    data: segments.map((s) => ({
      id: s._id.toString(),
      speaker: s.speaker,
      text: s.text,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      is_final: s.is_final,
    })),
  });
});

// ─── POST /notetaker/sessions/:id/stop — stop a meeting bot ──────────────────

router.post('/sessions/:id/stop', rbac('notetaker:manage'), async (req: Request, res: Response) => {
  const session = await NotetakerSession.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
  if (!session) throw AppError.notFound('Notetaker session');
  if (session.source !== 'recall_bot' || !session.recall_bot_id) {
    throw AppError.badRequest('This session is not an online meeting capture.');
  }
  if (!isRecallConfigured()) throw AppError.badRequest('Recall.ai is not configured.');

  await stopBot(session.recall_bot_id);
  session.status = 'processing';
  await session.save();

  createAuditLog({
    tenant_id: req.tenantId,
    actor: auditActor(req),
    action: 'notetaker.session.stopped',
    resource_type: 'notetaker_session',
    resource_id: session._id.toString(),
    result: 'success',
    request_id: req.requestId,
  }).catch(() => {});

  // When no public webhook URL is configured, Recall can't notify us of
  // completion — fall back to pulling the transcript ourselves shortly after.
  if (!getConfig().NOTETAKER_PUBLIC_BASE_URL) {
    await enqueueRecallDone(session._id.toString());
  }

  res.json({ session: serializeSession(session) });
});

// ─── Suggestion review ───────────────────────────────────────────────────────

const acceptSchema = z.object({ project_id: z.string().optional() });

router.post('/sessions/:id/suggestions/:sid/accept', rbac('notetaker:manage'), async (req: Request, res: Response) => {
  const body = acceptSchema.parse(req.body || {});
  const result = await acceptSuggestion(
    req.tenantId,
    req.params['id'] as string,
    req.params['sid'] as string,
    req.userId,
    { project_id: body.project_id }
  );

  createAuditLog({
    tenant_id: req.tenantId,
    actor: auditActor(req),
    action: 'notetaker.suggestion.accepted',
    resource_type: result.resource_type,
    resource_id: result.resource_id,
    result: 'success',
    request_id: req.requestId,
  }).catch(() => {});

  res.json({
    resource_type: result.resource_type,
    resource_id: result.resource_id,
    suggestion: {
      id: (result.suggestion as any)._id.toString(),
      status: result.suggestion.status,
      created_resource_type: result.suggestion.created_resource_type,
      created_resource_id: result.suggestion.created_resource_id?.toString(),
    },
  });
});

router.post('/sessions/:id/suggestions/:sid/dismiss', rbac('notetaker:manage'), async (req: Request, res: Response) => {
  const suggestion = await dismissSuggestion(
    req.tenantId,
    req.params['id'] as string,
    req.params['sid'] as string,
    req.userId
  );

  createAuditLog({
    tenant_id: req.tenantId,
    actor: auditActor(req),
    action: 'notetaker.suggestion.dismissed',
    resource_type: 'notetaker_session',
    resource_id: req.params['id'] as string,
    result: 'success',
    request_id: req.requestId,
  }).catch(() => {});

  res.json({ suggestion: { id: (suggestion as any)._id.toString(), status: suggestion.status } });
});

// ─── POST /notetaker/sessions/:id/regenerate-summary ─────────────────────────

router.post('/sessions/:id/regenerate-summary', rbac('notetaker:manage'), async (req: Request, res: Response) => {
  const session = await NotetakerSession.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
  if (!session) throw AppError.notFound('Notetaker session');
  if (!session.transcript_text) throw AppError.badRequest('Session has no transcript yet.');

  session.status = 'summarizing';
  await session.save();
  await enqueueSummarize(session._id.toString());
  res.json({ session: serializeSession(session) });
});

export default router;
