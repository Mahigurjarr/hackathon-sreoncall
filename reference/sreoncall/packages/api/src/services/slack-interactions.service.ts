/**
 * Slack Shortcuts & Interaction Handlers
 * Handles global shortcuts, message shortcuts, and modal submissions.
 */

import { Types } from 'mongoose';
import { SlackInstallation } from '../models/slack-installation.model';
import { Incident } from '../models/incident.model';
import { AlertRule } from '../models/alert-rule.model';
import { User } from '../models/user.model';
import { decryptToken } from '../utils/encryption';
import { logger } from '../utils/logger';
import * as slackService from './slack.service';
import * as incidentService from './incident.service';
import { acceptSuggestion, dismissSuggestion, buildNotetakerSlackBlocks } from './notetaker.service';
import { NotetakerSession } from '../models/notetaker-session.model';
import { getOnCallUsersForSchedule } from './oncall.service';
import { OnCallSchedule } from '../models/oncall-schedule.model';

// ─── Tenant + User resolution from Slack context ───────────────────────

interface SlackContext {
  token: string;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId | null;
}

async function resolveSlackContext(teamId: string, slackUserId: string): Promise<SlackContext | null> {
  const installation = await SlackInstallation.findOne({
    team_id: teamId,
    is_active: true,
    deleted_at: null,
  });
  if (!installation) return null;

  const token = decryptToken(installation.bot_token_encrypted);
  const tenantId = new Types.ObjectId(installation.consumer_tenant_id.toString());

  // Resolve SREonCall user from Slack user's email
  let userId: Types.ObjectId | null = null;
  try {
    const email = await slackService.getUserEmail(token, slackUserId);
    if (email) {
      const user = await User.findOne({ email, tenant_id: tenantId }).select('_id').lean();
      if (user) userId = new Types.ObjectId(user._id.toString());
    }
  } catch { /* non-critical */ }

  return { token, tenantId, userId };
}

// ─── Modal Builders ────────────────────────────────────────────────────

function createIncidentModal(input?: {
  title?: string;
  description?: string;
  severity?: string;
  type?: string;
  privateMetadata?: Record<string, unknown>;
}): Record<string, any> {
  const severity = input?.severity || '3';
  const type = input?.type || 'other';
  return {
    type: 'modal',
    callback_id: 'create_incident_submit',
    title: { type: 'plain_text', text: 'Create Incident' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    ...(input?.privateMetadata ? { private_metadata: JSON.stringify(input.privateMetadata) } : {}),
    blocks: [
      {
        type: 'input',
        block_id: 'title_block',
        label: { type: 'plain_text', text: 'Title' },
        element: {
          type: 'plain_text_input',
          action_id: 'title',
          ...(input?.title ? { initial_value: input.title } : {}),
          placeholder: { type: 'plain_text', text: 'Brief description of the incident' },
        },
      },
      {
        type: 'input',
        block_id: 'description_block',
        label: { type: 'plain_text', text: 'Description' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'description',
          multiline: true,
          initial_value: input?.description || '',
          placeholder: { type: 'plain_text', text: 'Detailed description...' },
        },
      },
      {
        type: 'input',
        block_id: 'severity_block',
        label: { type: 'plain_text', text: 'Severity' },
        element: {
          type: 'static_select',
          action_id: 'severity',
          initial_option:
            severity === '1'
              ? { text: { type: 'plain_text', text: 'SEV-1 Critical' }, value: '1' }
              : severity === '2'
                ? { text: { type: 'plain_text', text: 'SEV-2 High' }, value: '2' }
                : severity === '4'
                  ? { text: { type: 'plain_text', text: 'SEV-4 Low' }, value: '4' }
                  : severity === '5'
                    ? { text: { type: 'plain_text', text: 'SEV-5 Info' }, value: '5' }
                    : { text: { type: 'plain_text', text: 'SEV-3 Medium' }, value: '3' },
          options: [
            { text: { type: 'plain_text', text: 'SEV-1 Critical' }, value: '1' },
            { text: { type: 'plain_text', text: 'SEV-2 High' }, value: '2' },
            { text: { type: 'plain_text', text: 'SEV-3 Medium' }, value: '3' },
            { text: { type: 'plain_text', text: 'SEV-4 Low' }, value: '4' },
            { text: { type: 'plain_text', text: 'SEV-5 Info' }, value: '5' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'type_block',
        label: { type: 'plain_text', text: 'Type' },
        element: {
          type: 'static_select',
          action_id: 'type',
          initial_option:
            type === 'reliability'
              ? { text: { type: 'plain_text', text: 'Reliability' }, value: 'reliability' }
              : type === 'performance'
                ? { text: { type: 'plain_text', text: 'Performance' }, value: 'performance' }
                : type === 'security'
                  ? { text: { type: 'plain_text', text: 'Security' }, value: 'security' }
                  : type === 'availability'
                    ? { text: { type: 'plain_text', text: 'Availability' }, value: 'availability' }
                    : { text: { type: 'plain_text', text: 'Other' }, value: 'other' },
          options: [
            { text: { type: 'plain_text', text: 'Reliability' }, value: 'reliability' },
            { text: { type: 'plain_text', text: 'Performance' }, value: 'performance' },
            { text: { type: 'plain_text', text: 'Security' }, value: 'security' },
            { text: { type: 'plain_text', text: 'Availability' }, value: 'availability' },
            { text: { type: 'plain_text', text: 'Other' }, value: 'other' },
          ],
        },
      },
    ],
  };
}

function addToTimelineModal(incidents: { id: string; label: string }[], messageText?: string): Record<string, any> {
  return {
    type: 'modal',
    callback_id: 'add_to_timeline_submit',
    title: { type: 'plain_text', text: 'Add to Timeline' },
    submit: { type: 'plain_text', text: 'Add' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'incident_block',
        label: { type: 'plain_text', text: 'Incident' },
        element: {
          type: 'static_select',
          action_id: 'incident_id',
          placeholder: { type: 'plain_text', text: 'Select an incident' },
          options: incidents.map(i => ({
            text: { type: 'plain_text', text: i.label },
            value: i.id,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'note_block',
        label: { type: 'plain_text', text: 'Note' },
        element: {
          type: 'plain_text_input',
          action_id: 'note',
          multiline: true,
          initial_value: messageText || '',
          placeholder: { type: 'plain_text', text: 'Additional context...' },
        },
      },
    ],
  };
}

function escalateModal(incidents: { id: string; label: string }[]): Record<string, any> {
  return {
    type: 'modal',
    callback_id: 'escalate_submit',
    title: { type: 'plain_text', text: 'Escalate Incident' },
    submit: { type: 'plain_text', text: 'Escalate' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'incident_block',
        label: { type: 'plain_text', text: 'Incident' },
        element: {
          type: 'static_select',
          action_id: 'incident_id',
          placeholder: { type: 'plain_text', text: 'Select an incident' },
          options: incidents.map(i => ({
            text: { type: 'plain_text', text: i.label },
            value: i.id,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'reason_block',
        label: { type: 'plain_text', text: 'Reason' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'reason',
          placeholder: { type: 'plain_text', text: 'Why is this being escalated?' },
        },
      },
    ],
  };
}

// ─── Shortcut Handlers ─────────────────────────────────────────────────

export async function handleGlobalShortcut(payload: any): Promise<void> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  const callbackId = payload.callback_id;

  const ctx = await resolveSlackContext(teamId, slackUserId);
  if (!ctx) {
    logger.warn('Slack shortcut: no installation found', { teamId, callbackId });
    return;
  }

  switch (callbackId) {
    case 'create_incident': {
      await slackService.openView(ctx.token, triggerId, createIncidentModal());
      break;
    }

    case 'whos_oncall': {
      const schedules = await OnCallSchedule.find({ tenant_id: ctx.tenantId, enabled: true }).lean();
      const blocks: any[] = [
        { type: 'header', text: { type: 'plain_text', text: 'Current On-Call', emoji: false } },
      ];

      if (schedules.length === 0) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'No active on-call schedules found.' } });
      } else {
        for (const schedule of schedules) {
          const userIds = await getOnCallUsersForSchedule(schedule._id, ctx.tenantId);
          const users = await User.find({ _id: { $in: userIds }, tenant_id: ctx.tenantId }).select('name email').lean();
          const userList = users.length > 0
            ? users.map(u => `*${(u as any).name}* (${(u as any).email})`).join('\n')
            : '_No one currently on-call_';
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*${(schedule as any).name}*\n${userList}` },
          });
          blocks.push({ type: 'divider' });
        }
      }

      await slackService.openView(ctx.token, triggerId, {
        type: 'modal',
        title: { type: 'plain_text', text: 'On-Call Schedule' },
        close: { type: 'plain_text', text: 'Close' },
        blocks,
      });
      break;
    }

    case 'my_incidents': {
      let blocks: any[] = [
        { type: 'header', text: { type: 'plain_text', text: 'My Open Incidents', emoji: false } },
      ];

      if (!ctx.userId) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: 'Could not match your Slack account to a SREonCall user. Ensure your Slack email matches your SREonCall email.' },
        });
      } else {
        const incidents = await Incident.find({
          tenant_id: ctx.tenantId,
          status: { $nin: ['resolved', 'closed'] },
          $or: [
            { commander_id: ctx.userId },
            { created_by: ctx.userId },
            { 'responders.user_id': ctx.userId },
          ],
        }).sort({ createdAt: -1 }).limit(20).lean();

        if (incidents.length === 0) {
          blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'No open incidents assigned to you.' } });
        } else {
          const sevLabels: Record<number, string> = { 1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW', 5: 'INFO' };
          for (const inc of incidents) {
            const incAny = inc as any;
            const label = `INC-${String(incAny.number).padStart(4, '0')}`;
            const sev = sevLabels[incAny.severity] || 'UNKNOWN';
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${label}*  |  SEV-${incAny.severity} ${sev}  |  ${incAny.status}\n${incAny.title}`,
              },
            });
          }
        }
      }

      await slackService.openView(ctx.token, triggerId, {
        type: 'modal',
        title: { type: 'plain_text', text: 'My Incidents' },
        close: { type: 'plain_text', text: 'Close' },
        blocks,
      });
      break;
    }

    default:
      logger.warn('Unknown global shortcut', { callbackId });
  }
}

export async function handleMessageShortcut(payload: any): Promise<void> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  const callbackId = payload.callback_id;
  const messageText = payload.message?.text || '';

  const ctx = await resolveSlackContext(teamId, slackUserId);
  if (!ctx) {
    logger.warn('Slack message shortcut: no installation found', { teamId, callbackId });
    return;
  }

  switch (callbackId) {
    case 'create_incident_from_message': {
      await slackService.openView(ctx.token, triggerId, createIncidentModal({ description: messageText }));
      break;
    }

    case 'add_to_timeline': {
      const incidents = await Incident.find({
        tenant_id: ctx.tenantId,
        status: { $nin: ['resolved', 'closed'] },
      }).sort({ createdAt: -1 }).limit(50).select('number title').lean();

      const options = incidents.map((inc: any) => ({
        id: inc._id.toString(),
        label: `INC-${String(inc.number).padStart(4, '0')} — ${inc.title.slice(0, 60)}`,
      }));

      if (options.length === 0) {
        await slackService.openView(ctx.token, triggerId, {
          type: 'modal',
          title: { type: 'plain_text', text: 'Add to Timeline' },
          close: { type: 'plain_text', text: 'Close' },
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'No open incidents found.' } }],
        });
      } else {
        await slackService.openView(ctx.token, triggerId, addToTimelineModal(options, messageText));
      }
      break;
    }

    case 'escalate_incident': {
      const incidents = await Incident.find({
        tenant_id: ctx.tenantId,
        status: { $nin: ['resolved', 'closed'] },
      }).sort({ createdAt: -1 }).limit(50).select('number title').lean();

      const options = incidents.map((inc: any) => ({
        id: inc._id.toString(),
        label: `INC-${String(inc.number).padStart(4, '0')} — ${inc.title.slice(0, 60)}`,
      }));

      if (options.length === 0) {
        await slackService.openView(ctx.token, triggerId, {
          type: 'modal',
          title: { type: 'plain_text', text: 'Escalate Incident' },
          close: { type: 'plain_text', text: 'Close' },
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'No open incidents found.' } }],
        });
      } else {
        await slackService.openView(ctx.token, triggerId, escalateModal(options));
      }
      break;
    }

    default:
      logger.warn('Unknown message shortcut', { callbackId });
  }
}

export async function handleBlockAction(payload: any): Promise<void> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  const actions = Array.isArray(payload.actions) ? payload.actions : [];

  const ctx = await resolveSlackContext(teamId, slackUserId);
  if (!ctx) {
    logger.warn('Slack block action: no installation found', { teamId });
    return;
  }

  for (const action of actions) {
    if (action.action_id !== 'incident_create_from_alert') continue;

    let actionData: any = {};
    try {
      actionData = JSON.parse(action.value || '{}');
    } catch {
      logger.warn('Slack block action: invalid action payload JSON', { teamId });
      return;
    }

    const expectedTenantId = actionData.tenant_id;
    const sourceAlertId = actionData.source_alert_id as string | undefined;
    const currentValue = typeof actionData.current_value === 'number' ? actionData.current_value : null;
    const dedupCount = typeof actionData.dedup_count === 'number' ? actionData.dedup_count : null;

    if (!expectedTenantId || expectedTenantId !== ctx.tenantId.toString()) {
      logger.warn('Slack block action tenant mismatch', {
        teamId,
        expectedTenantId,
        resolvedTenantId: ctx.tenantId.toString(),
      });
      return;
    }

    let prefillTitle = 'New incident';
    let prefillDescription = '';
    let prefillSeverity = '3';
    let prefillType = 'other';
    let alertRuleServiceId: string | null = null;

    if (sourceAlertId) {
      const alertRule = await AlertRule.findOne({
        _id: sourceAlertId,
        tenant_id: ctx.tenantId,
      }).select('name description severity condition service_id').lean();

      if (!alertRule) {
        logger.warn('Slack block action alert rule not found for tenant', {
          teamId,
          sourceAlertId,
          tenantId: ctx.tenantId.toString(),
        });
        return;
      }

      const severityMap: Record<string, string> = {
        critical: '1',
        high: '2',
        medium: '3',
        low: '4',
        info: '5',
      };

      prefillTitle = String(alertRule.name || 'Alert-triggered incident');
      prefillSeverity = severityMap[String((alertRule as any).severity || 'medium')] || '3';
      alertRuleServiceId = (alertRule as any).service_id?.toString?.() || null;
      prefillType = 'reliability';
      prefillDescription = [
        `Created from Slack alert action for rule "${alertRule.name}".`,
        currentValue !== null ? `Current value at click time: ${currentValue}` : '',
        dedupCount && dedupCount > 1 ? `Alert fired ${dedupCount} times in the recent dedup window.` : '',
        alertRule.description ? `\n${alertRule.description}` : '',
        (alertRule as any).condition?.metric
          ? `\nCondition: ${(alertRule as any).condition.metric} ${(alertRule as any).condition.operator || ''} ${(alertRule as any).condition.threshold ?? ''}`.trim()
          : '',
      ].filter(Boolean).join('\n');
    }

    await slackService.openView(ctx.token, triggerId, createIncidentModal({
      title: prefillTitle,
      description: prefillDescription,
      severity: prefillSeverity,
      type: prefillType,
      privateMetadata: {
        tenant_id: ctx.tenantId.toString(),
        source_alert_id: sourceAlertId || null,
        service_id: alertRuleServiceId,
        source: 'alert',
      },
    }));
    return;
  }
}

// ─── Modal Submission Handlers ─────────────────────────────────────────

export async function handleViewSubmission(payload: any): Promise<{ response_action?: string; errors?: Record<string, string> } | null> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const callbackId = payload.view?.callback_id;
  const values = payload.view?.state?.values;
  let privateMetadata: Record<string, any> = {};
  try {
    privateMetadata = payload.view?.private_metadata ? JSON.parse(payload.view.private_metadata) : {};
  } catch {
    privateMetadata = {};
  }

  const ctx = await resolveSlackContext(teamId, slackUserId);
  if (!ctx) return null;

  const actorId = ctx.userId || new Types.ObjectId('000000000000000000000000');

  switch (callbackId) {
    case 'create_incident_submit': {
      const title = values?.title_block?.title?.value;
      const description = values?.description_block?.description?.value || '';
      const severity = parseInt(values?.severity_block?.severity?.selected_option?.value || '3', 10);
      const type = values?.type_block?.type?.selected_option?.value || 'other';

      if (!title) {
        return { response_action: 'errors', errors: { title_block: 'Title is required' } };
      }

      const sourceAlertId = typeof privateMetadata.source_alert_id === 'string' ? privateMetadata.source_alert_id : null;
      const serviceId = typeof privateMetadata.service_id === 'string' ? privateMetadata.service_id : null;
      const source = typeof privateMetadata.source === 'string' ? privateMetadata.source : 'manual';

      if (privateMetadata.tenant_id && privateMetadata.tenant_id !== ctx.tenantId.toString()) {
        logger.warn('Slack create incident submission tenant mismatch', {
          viewTenantId: privateMetadata.tenant_id,
          resolvedTenantId: ctx.tenantId.toString(),
        });
        return { response_action: 'errors', errors: { title_block: 'Tenant mismatch. Please try again from Slack.' } };
      }

      if (sourceAlertId) {
        const existingOpen = await Incident.findOne({
          tenant_id: ctx.tenantId,
          source_alert_id: new Types.ObjectId(sourceAlertId),
          status: { $nin: ['resolved', 'closed'] },
        }).select('_id');
        if (existingOpen) {
          return { response_action: 'errors', errors: { title_block: 'An open incident already exists for this alert.' } };
        }
      }

      try {
        await incidentService.createIncident({
          tenant_id: ctx.tenantId,
          created_by: actorId,
          title,
          description,
          severity,
          type,
          source,
          ...(sourceAlertId ? { source_alert_id: sourceAlertId } : {}),
          ...(serviceId ? { affected_service_ids: [serviceId] } : {}),
        });
      } catch (err: any) {
        logger.error('Failed to create incident from Slack', { error: err.message });
      }
      return null; // close modal
    }

    case 'add_to_timeline_submit': {
      const incidentId = values?.incident_block?.incident_id?.selected_option?.value;
      const note = values?.note_block?.note?.value || '';

      if (!incidentId) return null;

      try {
        const inc = await Incident.findOne({ _id: incidentId, tenant_id: ctx.tenantId });
        if (inc) {
          inc.timeline.push({
            _id: new Types.ObjectId(),
            type: 'note',
            actor_id: actorId,
            message: note || 'Added from Slack',
            metadata: { source: 'slack' },
            timestamp: new Date(),
          });
          await inc.save();
        }
      } catch (err: any) {
        logger.error('Failed to add timeline entry from Slack', { error: err.message });
      }
      return null;
    }

    case 'escalate_submit': {
      const incidentId = values?.incident_block?.incident_id?.selected_option?.value;
      const reason = values?.reason_block?.reason?.value || 'Escalated via Slack';

      if (!incidentId) return null;

      try {
        await incidentService.escalateIncident(ctx.tenantId, incidentId, actorId, reason);
      } catch (err: any) {
        logger.error('Failed to escalate incident from Slack', { error: err.message });
      }
      return null;
    }

    default:
      logger.warn('Unknown view submission', { callbackId });
      return null;
  }
}

/**
 * Handle Accept/Dismiss button clicks on an AI Notetaker summary message:
 * resolve the Slack user → our user, apply accept/dismiss, then re-render the
 * Slack message in place so it reflects the new suggestion states.
 */
export async function handleNotetakerSuggestionAction(payload: any): Promise<void> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id || payload.container?.channel_id;
  const messageTs = payload.message?.ts || payload.container?.message_ts;
  if (!teamId || !slackUserId) return;

  const ctx = await resolveSlackContext(teamId, slackUserId);
  if (!ctx) {
    logger.warn('Notetaker Slack action: no Slack context for team', { teamId });
    return;
  }
  const actorId = ctx.userId || new Types.ObjectId('000000000000000000000000');

  let sessionId: string | null = null;
  for (const action of payload.actions || []) {
    if (action.action_id !== 'notetaker_suggestion_accept' && action.action_id !== 'notetaker_suggestion_dismiss') continue;
    let data: any = {};
    try { data = JSON.parse(action.value || '{}'); } catch { continue; }
    const { session_id, suggestion_id, tenant_id } = data;
    if (!session_id || !suggestion_id) continue;
    // Tenant guard: action must belong to the resolved Slack tenant.
    if (tenant_id && tenant_id !== ctx.tenantId.toString()) {
      logger.warn('Notetaker Slack action tenant mismatch', { tenant_id });
      continue;
    }
    sessionId = session_id;
    try {
      if (action.action_id === 'notetaker_suggestion_accept') {
        await acceptSuggestion(ctx.tenantId, session_id, suggestion_id, actorId);
        logger.info('Notetaker suggestion accepted via Slack', { suggestion_id });
      } else {
        await dismissSuggestion(ctx.tenantId, session_id, suggestion_id, actorId);
        logger.info('Notetaker suggestion dismissed via Slack', { suggestion_id });
      }
    } catch (err: any) {
      // Already-decided or not-found — still re-render below to reflect truth.
      logger.warn('Notetaker Slack action could not apply', { action_id: action.action_id, error: err.message });
    }
  }

  // Re-render the message to reflect updated suggestion states.
  if (sessionId && channelId && messageTs) {
    try {
      const session = await NotetakerSession.findOne({ _id: sessionId, tenant_id: ctx.tenantId });
      if (session) {
        await slackService.updateMessage(
          ctx.token,
          channelId,
          messageTs,
          buildNotetakerSlackBlocks(session),
          `AI Notetaker summary — ${session.title}`,
        );
      }
    } catch (err: any) {
      logger.error('Failed to update Slack notetaker message', { error: err.message });
    }
  }
}
