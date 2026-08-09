import { Types } from 'mongoose';
import { TenantIntegration } from '../models/tenant-integration.model';
import { SlackInstallation } from '../models/slack-installation.model';
import { CommunicationChannel } from '../models/communication-channel.model';
import { Incident, IncidentDocument } from '../models/incident.model';
import { AlertRule } from '../models/alert-rule.model';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { decryptToken } from '../utils/encryption';
import * as slackService from './slack.service';
import { logger } from '../utils/logger';

interface SlackTarget {
  token: string;
  channelId: string;
}

export const SEV_COLOR: Record<number, string> = {
  1: '#DC2626',
  2: '#F97316',
  3: '#EAB308',
  4: '#3B82F6',
  5: '#6B7280',
};

export const SEV_LABEL: Record<number, string> = {
  1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW', 5: 'INFO',
};

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open', acknowledged: 'Acknowledged', investigating: 'Investigating',
  monitoring: 'Monitoring', resolved: 'Resolved', closed: 'Closed',
};

// Decide whether a channel should receive a given incident based on the channel's
// source_consumer_tenant_ids filter. Empty filter = receive all. When populated,
// the incident's source_consumer_tenant_id (or its own tenant_id for native
// non-bridged incidents) must be in the filter list.
function channelMatchesIncident(channel: any, incident?: IncidentDocument): boolean {
  const filter: Types.ObjectId[] = channel.source_consumer_tenant_ids || [];
  if (filter.length === 0) return true;
  if (!incident) return true;
  const incidentSource = incident.source_consumer_tenant_id
    ? incident.source_consumer_tenant_id.toString()
    : incident.tenant_id.toString();
  return filter.some((id) => id.toString() === incidentSource);
}

// Returns all active Slack targets (token + channel) for a tenant.
// Checks both TenantIntegration (direct bot) and SlackInstallation (OAuth)
// paths, deduplicating by channel ID. When `incident` is passed, channels
// are filtered by their source_consumer_tenant_ids routing rules.
export async function resolveAllSlackTargets(
  tenantId: Types.ObjectId,
  incident?: IncidentDocument,
): Promise<SlackTarget[]> {
  const targets: SlackTarget[] = [];
  const seenChannels = new Set<string>();

  const integration = await TenantIntegration.findOne({
    tenant_id: tenantId,
    platform: 'slack',
    is_active: true,
  });

  if (integration) {
    const token = decryptToken(integration.bot_token_encrypted);
    const channels = await CommunicationChannel.find({
      consumer_tenant_id: tenantId,
      platform: 'slack',
      is_active: true,
      deleted_at: null,
    }).lean();
    for (const ch of channels) {
      if (!channelMatchesIncident(ch, incident)) continue;
      if (!seenChannels.has(ch.external_channel_id)) {
        seenChannels.add(ch.external_channel_id);
        targets.push({ token, channelId: ch.external_channel_id });
      }
    }
  }

  const installations = await SlackInstallation.find({
    consumer_tenant_id: tenantId,
    is_active: true,
    deleted_at: null,
  }).lean();

  for (const install of installations) {
    const token = decryptToken(install.bot_token_encrypted);
    const channels = await CommunicationChannel.find({
      consumer_tenant_id: tenantId,
      installation_id: install._id,
      platform: 'slack',
      is_active: true,
      deleted_at: null,
    }).lean();
    for (const ch of channels) {
      if (!channelMatchesIncident(ch, incident)) continue;
      if (!seenChannels.has(ch.external_channel_id)) {
        seenChannels.add(ch.external_channel_id);
        targets.push({ token, channelId: ch.external_channel_id });
      }
    }
  }

  return targets;
}

// Kept as alias so existing code that imports resolveSlackTarget still works.
export async function resolveSlackTarget(tenantId: Types.ObjectId): Promise<SlackTarget | null> {
  const installation = await SlackInstallation.findOne({
    consumer_tenant_id: tenantId,
    is_active: true,
    deleted_at: null,
  }).lean();

  if (installation) {
    const notifyOnlyChannel = await CommunicationChannel.findOne({
      consumer_tenant_id: tenantId,
      installation_id: installation._id,
      platform: 'slack',
      channel_role: 'notify_only',
      is_active: true,
      deleted_at: null,
    }).lean();

    if (notifyOnlyChannel?.external_channel_id) {
      return {
        token: decryptToken(installation.bot_token_encrypted),
        channelId: notifyOnlyChannel.external_channel_id,
      };
    }
  }

  const all = await resolveAllSlackTargets(tenantId);
  return all[0] ?? null;
}

export function buildIncidentBlocks(
  incident: IncidentDocument,
  event: string,
  extra?: {
    newStatus?: string; commanderName?: string; prevStatus?: string;
    incidentUrl?: string; tenantSlug?: string; resource?: string;
    assignedTo?: string[];
  },
): { blocks: any[]; attachments: any[]; text: string } {
  const incLabel = `INC-${String(incident.number).padStart(4, '0')}`;
  const sevLabel = SEV_LABEL[incident.severity] || 'UNKNOWN';
  const statusLabel = STATUS_LABEL[incident.status] || incident.status;
  const color = SEV_COLOR[incident.severity] || '#6B7280';

  let headerText: string;
  switch (event) {
    case 'created':        headerText = `New Incident  ${incLabel}`; break;
    case 'acknowledged':   headerText = `${incLabel}  Acknowledged`; break;
    case 'status_changed': {
      const from = STATUS_LABEL[extra?.prevStatus || ''] || extra?.prevStatus || 'Status';
      const to   = STATUS_LABEL[extra?.newStatus  || ''] || extra?.newStatus  || incident.status;
      headerText = `${incLabel}  ${from} → ${to}`;
      break;
    }
    case 'resolved':           headerText = `${incLabel}  Resolved`; break;
    case 'closed':             headerText = `${incLabel}  Closed`; break;
    case 'commander_assigned': headerText = `${incLabel}  Commander Assigned`; break;
    default:                   headerText = `${incLabel}  Updated`;
  }

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: headerText, emoji: false } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Title*\n${incident.title}` },
        { type: 'mrkdwn', text: `*Severity*\nSEV-${incident.severity} ${sevLabel}` },
        { type: 'mrkdwn', text: `*Status*\n${statusLabel}` },
        { type: 'mrkdwn', text: `*Type*\n${(incident.type || 'other').charAt(0).toUpperCase() + (incident.type || 'other').slice(1)}` },
      ],
    },
  ];

  const infoFields: any[] = [];
  if (extra?.resource)    infoFields.push({ type: 'mrkdwn', text: `*Resource*\n${extra.resource}` });
  if (extra?.tenantSlug)  infoFields.push({ type: 'mrkdwn', text: `*Organization*\n${extra.tenantSlug}` });
  if (infoFields.length > 0) blocks.push({ type: 'section', fields: infoFields });

  if (incident.description && event === 'created') {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${incident.description.slice(0, 300)}` } });
  }
  if (event === 'commander_assigned' && extra?.commanderName) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Commander*\n${extra.commanderName}` } });
  }
  if (extra?.assignedTo && extra.assignedTo.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Assigned To*\n${extra.assignedTo.join(', ')}` } });
  }
  if (event === 'resolved' && incident.metrics?.mttr_seconds) {
    const mins = Math.round(incident.metrics.mttr_seconds / 60);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Time to Resolve*\n${mins} min` } });
  }
  if (extra?.incidentUrl) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `<${extra.incidentUrl}|View ${incLabel} in SREonCall>` } });
  }

  const isActive = !['resolved', 'closed'].includes(incident.status);
  if (isActive) {
    const actionValue = JSON.stringify({
      incident_id: incident._id.toString(),
      tenant_id: incident.tenant_id.toString(),
    });
    const actions: any[] = [];
    if (incident.status === 'open') {
      actions.push({
        type: 'button', text: { type: 'plain_text', text: 'Acknowledge', emoji: false },
        style: 'primary', action_id: 'incident_acknowledge', value: actionValue,
      });
    }
    actions.push({
      type: 'button', text: { type: 'plain_text', text: 'Resolve', emoji: false },
      style: 'primary', action_id: 'incident_resolve', value: actionValue,
    });
    actions.push({
      type: 'button', text: { type: 'plain_text', text: 'Escalate', emoji: false },
      style: 'danger', action_id: 'incident_escalate', value: actionValue,
    });
    blocks.push({ type: 'actions', elements: actions });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `SREonCall  |  ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC` }],
  });

  return { blocks, attachments: [{ color, blocks: [] as any[] }], text: `${headerText} — ${incident.title}` };
}

async function buildNotificationContext(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
): Promise<{ tenantSlug: string; incidentUrl: string; resource: string; assignedTo: string[] }> {
  let tenantSlug = '';
  let incidentUrl = '';
  let resource = '';
  const assignedTo: string[] = [];

  try {
    // For bridged incidents, always show the consumer org name so the recipient
    // (whether on provider or consumer side) knows whose problem this is.
    const orgTenantId = incident.source_consumer_tenant_id ?? tenantId;
    const orgTenant = await Tenant.findById(orgTenantId).select('slug name').lean();
    if (orgTenant) {
      tenantSlug = (orgTenant as any).name || orgTenant.slug;
    }

    // The incident URL must still link to the tenant whose Slack is receiving
    // the message — that's the one whose users can actually open the incident.
    const linkTenant = await Tenant.findById(tenantId).select('slug').lean();
    if (linkTenant?.slug) {
      incidentUrl = `https://${linkTenant.slug}.sreoncall.com/incidents/${incident._id.toString()}`;
    }
  } catch { /* non-critical */ }

  if (incident.source_alert_id) {
    try {
      const alert = await AlertRule.findById(incident.source_alert_id).select('last_firing_labels name').lean();
      if (alert) {
        const labels = (alert as any).last_firing_labels as Record<string, string> | null;
        resource = labels?.instance || labels?.job || labels?.container || labels?.pod || (alert as any).name || '';
      }
    } catch { /* non-critical */ }
  }

  try {
    const roleIds: { id: Types.ObjectId; role: string }[] = [];
    if (incident.commander_id)       roleIds.push({ id: incident.commander_id, role: 'Commander' });
    if (incident.comms_lead_id)      roleIds.push({ id: incident.comms_lead_id, role: 'Comms Lead' });
    if (incident.operations_lead_id) roleIds.push({ id: incident.operations_lead_id, role: 'Ops Lead' });
    if (roleIds.length > 0) {
      const users = await User.find({ _id: { $in: roleIds.map((r) => r.id) } }).select('name').lean();
      const nameMap = new Map(users.map((u: any) => [u._id.toString(), u.name]));
      for (const r of roleIds) {
        assignedTo.push(`${nameMap.get(r.id.toString()) || 'Unknown'} (${r.role})`);
      }
    }
  } catch { /* non-critical */ }

  return { tenantSlug, incidentUrl, resource, assignedTo };
}

// Post or update an incident notification to every configured Slack channel
// for the given tenant (and the consumer tenant if this is a bridged incident).
// New channels receive a fresh Block Kit message with ts stored in
// slack_notifications[]. Existing channels receive an in-place update.
export async function notifyIncidentSlack(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
  event: 'created' | 'acknowledged' | 'status_changed' | 'resolved' | 'closed' | 'commander_assigned',
  extra?: { newStatus?: string; commanderName?: string; prevStatus?: string },
): Promise<void> {
  // Incident originated from a Slack alert — suppress to avoid a notification loop.
  if ((incident.custom_fields as any)?.slack_alert) return;

  // Suppress consumer-side Slack while a provider tier is handling the
  // incident. Consumers don't want their Slack channel pinged for incidents
  // they've handed off — only when the tier escalates back to a schedule on
  // their own tenant. We detect "provider handling" by checking whether the
  // current responder (provider_handover.current_user_id) belongs to the
  // tenant we're about to notify. If not, this is the consumer side of a
  // bridge while provider is responsible — skip.
  if (incident.provider_handover && incident.tenant_id.toString() === tenantId.toString()) {
    const handoverUserId = incident.provider_handover.current_user_id;
    if (handoverUserId) {
      try {
        const user = await User.findById(handoverUserId).select('tenant_id').lean();
        if (user && (user as any).tenant_id?.toString() !== tenantId.toString()) {
          logger.debug('Skipping consumer Slack — provider tier responsible', {
            tenantId: tenantId.toString(), incidentId: incident._id.toString(), event,
          });
          return;
        }
      } catch { /* fall through and notify */ }
    } else if (incident.provider_handover.provider_tenant_id?.toString() !== tenantId.toString()) {
      // No current_user_id but a handover exists pointing to a different
      // provider tenant — be conservative and skip.
      logger.debug('Skipping consumer Slack — handover active, no current user', {
        tenantId: tenantId.toString(), incidentId: incident._id.toString(), event,
      });
      return;
    }
  }

  // Only notify the explicit tenant. For managed-support bridges, the caller
  // (createBridge, tier escalation handler) is responsible for deciding which
  // side to ping — we no longer auto-fan-out to the consumer here.
  const tenantIdsToNotify = new Map<string, Types.ObjectId>();
  tenantIdsToNotify.set(tenantId.toString(), tenantId);

  for (const [, tid] of tenantIdsToNotify) {
    try {
      const targets = await resolveAllSlackTargets(tid, incident);
      if (targets.length === 0) continue;

      const ctx = await buildNotificationContext(tid, incident);
      const { blocks, attachments, text } = buildIncidentBlocks(incident, event, { ...extra, ...ctx });

      const existingNotifs: Array<{ channel_id: string; ts: string }> =
        incident.slack_notifications || [];

      for (const target of targets) {
        const existing = existingNotifs.find((n) => n.channel_id === target.channelId);

        if (existing) {
          await slackService.updateMessage(target.token, existing.channel_id, existing.ts, blocks, text, attachments);
          logger.debug('Slack incident message updated', { event, incidentId: incident._id, channelId: target.channelId });
        } else {
          const ts = await slackService.postBlockMessage(target.token, target.channelId, blocks, text, attachments);
          if (ts) {
            const entry = { channel_id: target.channelId, ts };
            const updateOp: any = { $push: { slack_notifications: entry } };
            if (!incident.slack_message_ts) {
              updateOp.$set = { slack_message_ts: ts, slack_channel_id: target.channelId };
            }
            await Incident.updateOne({ _id: incident._id }, updateOp);
            existingNotifs.push(entry);
            incident.slack_notifications = existingNotifs;
            if (!incident.slack_message_ts) {
              incident.slack_message_ts = ts;
              incident.slack_channel_id = target.channelId;
            }
            logger.debug('Slack incident message posted', { event, incidentId: incident._id, channelId: target.channelId, ts });
          }
        }
      }
    } catch (err: any) {
      logger.error('Failed to notify Slack', {
        tenantId: tid.toString(), event, incidentId: incident._id, error: err.message,
      });
    }
  }
}
