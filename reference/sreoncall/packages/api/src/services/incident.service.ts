import { Types } from 'mongoose';
import { Incident, IncidentDocument } from '../models/incident.model';
import { Channel } from '../models/channel.model';
import { TenantIntegration } from  '../models/tenant-integration.model';
import { SlackInstallation } from '../models/slack-installation.model';
import { CommunicationChannel } from '../models/communication-channel.model';
import { getNextSequence } from '../models/counter.model';
import { PaginationParams, PaginatedResult, buildCursorFilter, paginateResults } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { getCurrentOnCallUsers, getCurrentOnCallUsersForServices } from './oncall.service';
import { createBulkNotifications, checkAndIncrementNotificationCount, checkAndIncrementMonthlyCounter } from './notification.service';
import { publishAgentTrigger } from './agent-trigger.service';
import { sendNotificationEmail } from './email-notification.service';
import { sendSms } from './sms.service';
import { makeVoiceCall, sendWhatsApp } from './plivo.service';
import { decryptToken } from '../utils/encryption';
import * as slackService from './slack.service';
import { Service } from '../models/service.model';
import {
  notifyIncidentSlack,
  resolveSlackTarget,
  buildIncidentBlocks,
} from './incident-slack.service';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { AlertRule } from '../models/alert-rule.model';
import { IncidentSLAState } from '../models/incident-sla-state.model';
import { escalateTier } from './managed-support.service';
import { getOnCallUsersForSchedule } from './oncall.service';
import { executeProviderEscalation } from './escalation-policy.service';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { invalidateIccCache } from './command-center.service';
import { getOnCallUsersForSchedules } from './oncall.service';
import { getRedis } from '../config/redis';

const MS_LINK_CACHE_TTL = 60; // seconds — matches tenant cache TTL

async function isManagedSupportConsumer(tenantId: Types.ObjectId): Promise<boolean> {
  const key = `ms_link:${tenantId.toString()}`;
  try {
    const cached = await getRedis().get(key);
    if (cached !== null) return cached === '1';
  } catch { /* Redis unavailable — fall through to DB */ }

  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: tenantId,
    status: 'active',
    scope: 'managed_support',
  });

  const result = !!link;
  try {
    await getRedis().setex(key, MS_LINK_CACHE_TTL, result ? '1' : '0');
  } catch { /* best-effort cache write */ }
  return result;
}

async function resolveUserName(userId: Types.ObjectId | string | null | undefined): Promise<string> {
  if (!userId) return 'System';
  try {
    const user = await User.findById(userId, 'name').lean();
    return user?.name || 'Unknown user';
  } catch {
    return 'Unknown user';
  }
}

/**
 * Dispatch outbound notifications (email, SMS, voice) for an incident to
 * the on-call users. Best-effort — failures are logged but don't throw.
 * For SEV1/2 incidents, voice calls are made; otherwise just email/SMS.
 */
async function dispatchOutboundIncidentNotifications(
  tenantId: Types.ObjectId,
  userIds: Types.ObjectId[],
  title: string,
  body: string,
  incidentId: string,
  severity: number,
): Promise<void> {
  if (userIds.length === 0) return;

  // Tenant-level daily cap
  const allowed = await checkAndIncrementNotificationCount(tenantId).catch(() => true);
  if (!allowed) {
    logger.warn('Outbound incident notifications suppressed: daily cap reached', { tenantId: tenantId.toString() });
    return;
  }

  // Tenant-level channel allowlist + voice/whatsapp feature flag.
  // These previously caused the dispatcher to silently drop SMS/voice on
  // tenants that had only ['email'] in notification_channels, without
  // surfacing the reason on the incident.
  const tenantDoc = await Tenant.findById(tenantId).select('plan_limits notification_channels voice_whatsapp_enabled notification_overrides').lean();
  const pl = (tenantDoc as any)?.plan_limits || {};
  const allowedChannels: string[] = pl.notification_channels || (tenantDoc as any)?.notification_channels || ['email'];
  const voiceEnabled: boolean = !!(pl.voice_whatsapp_enabled ?? (tenantDoc as any)?.voice_whatsapp_enabled);
  const smsAllowed = allowedChannels.includes('sms');
  const voiceAllowed = allowedChannels.includes('voice') && voiceEnabled;
  const overrides = (tenantDoc as any)?.notification_overrides || {};
  const forceVoice: boolean = !!overrides.force_voice;
  const forceSms: boolean = !!overrides.force_sms;
  const blockedChannels: string[] = [];

  const users = await User.find({ _id: { $in: userIds } }).lean();
  const isCritical = severity <= 2;

  for (const user of users) {
    const prefs = (user as any).notification_preferences || {};
    const phone = (user as any).phone_number;
    const wantsSms = prefs.sms || forceSms;
    const wantsVoice = prefs.voice || forceVoice;

    // Email
    if (prefs.email !== false && user.email) {
      sendNotificationEmail(user.email, title, body, `/incidents/${incidentId}`, tenantId.toString())
        .catch((err) => logger.error('Failed to send incident email', { error: err.message, email: user.email }));
    }

    // SMS — only for SEV1/2/3 by default, only if tenant plan allows
    if (wantsSms && phone && severity <= 3) {
      if (!smsAllowed) {
        if (!blockedChannels.includes('sms')) blockedChannels.push('sms');
      } else {
        checkAndIncrementMonthlyCounter(tenantId, 'sms_sent', 'max_sms_per_month').then(({ allowed }) => {
          if (!allowed) {
            logger.warn('SMS monthly limit reached for incident notification', { tenantId: tenantId.toString() });
            return;
          }
          sendSms(phone, `${title}\n${body}`)
            .catch((err) => logger.error('Failed to send incident SMS', { error: err.message }));
        }).catch(() => {});
      }
    }

    // Voice call — only for SEV1/2 (critical), only if tenant plan allows
    if (wantsVoice && phone && isCritical) {
      if (!voiceAllowed) {
        if (!blockedChannels.includes('voice')) blockedChannels.push('voice');
      } else {
        checkAndIncrementMonthlyCounter(tenantId, 'voice_calls', 'max_voice_per_month').then(({ allowed }) => {
          if (!allowed) {
            logger.warn('Voice monthly limit reached for incident notification', { tenantId: tenantId.toString() });
            return;
          }
          makeVoiceCall(phone, `${title}. ${body}`, {
            incidentId,
            tenantId: tenantId.toString(),
            userId: user._id.toString(),
          }).catch((err) => logger.error('Failed to make incident voice call', { error: err.message }));
        }).catch(() => {});
      }
    }
  }

  // Surface plan-blocked channels on the incident timeline so operators
  // know notifications they expected (voice/SMS) didn't go out and why.
  if (blockedChannels.length > 0) {
    logger.warn('Outbound notifications blocked by tenant plan', {
      tenantId: tenantId.toString(),
      incidentId,
      blockedChannels,
    });
    Incident.updateOne(
      { _id: incidentId },
      {
        $push: {
          timeline: {
            type: 'system',
            message: `Notifications via ${blockedChannels.join(' & ')} were not sent — disabled on this tenant's plan. Upgrade or enable in tenant settings to receive these alerts.`,
            metadata: { blocked_channels: blockedChannels },
            created_at: new Date(),
          },
        },
      },
    ).catch((err) => logger.error('Failed to record blocked-channel timeline entry', { error: err.message }));
  }

  logger.info('Outbound incident notifications dispatched', {
    incidentId,
    userCount: users.length,
    severity,
  });
}

const sc = StringCodec();

// Re-export for interaction handler (no change to public API)
export { resolveSlackTarget, buildIncidentBlocks };

const notifySlack = notifyIncidentSlack;

async function publishIncidentEvent(
  eventType: string,
  incident: IncidentDocument,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const js = getJetStream();
    const payload = {
      event: eventType,
      tenant_id: incident.tenant_id.toString(),
      incident_id: incident._id.toString(),
      severity: incident.severity,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    await js.publish(`incidents.${eventType}`, sc.encode(JSON.stringify(payload)));
  } catch (err: any) {
    logger.error('Failed to publish incident event', { eventType, error: err.message });
  }
}

function serializePopulated(doc: IncidentDocument): IncidentDocument {
  return doc;
}

// ─── List ────────────────────────────────────────────────────────────────────

export interface IncidentFilter {
  tenant_id: Types.ObjectId;
  status?: string;
  severity?: number;
  labels?: string[];
  search?: string;
  source_consumer_tenant_id?: string;
}

export async function listIncidents(
  filter: IncidentFilter,
  pagination: PaginationParams
): Promise<PaginatedResult<IncidentDocument>> {
  const baseFilter: Record<string, unknown> = { tenant_id: filter.tenant_id };
  if (filter.status) baseFilter.status = filter.status;
  if (filter.severity) baseFilter.severity = filter.severity;
  if (filter.labels?.length) baseFilter.labels = { $in: filter.labels };
  if (filter.source_consumer_tenant_id) {
    baseFilter.source_consumer_tenant_id = new Types.ObjectId(filter.source_consumer_tenant_id);
  }
  if (filter.search) {
    const escaped = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escaped, $options: 'i' };
    // Check if searching by incident number (e.g. "INC-0038" or just "38")
    const numMatch = filter.search.replace(/^INC-?/i, '');
    const asNum = Number(numMatch);
    if (!isNaN(asNum) && asNum > 0) {
      baseFilter.$or = [{ title: searchRegex }, { number: asNum }];
    } else {
      baseFilter.$or = [
        { title: searchRegex },
        { 'labels': searchRegex },
        { description: searchRegex },
      ];
    }
  }

  const pag = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(pag, baseFilter);

  const results = await Incident.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1)
    .populate('commander_id', 'name email avatar_url')
    .populate('created_by', 'name email avatar_url')
    .populate('affected_service_ids', 'name type current_status cloud_metadata')
    .populate('source_alert_id', 'name severity source_type query alert_state last_firing_labels');

  const total = await Incident.countDocuments(baseFilter);
  return paginateResults(results, pag, total);
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getIncidentById(
  tenantId: Types.ObjectId,
  id: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId })
    .populate('commander_id', 'name email avatar_url')
    .populate('comms_lead_id', 'name email avatar_url')
    .populate('operations_lead_id', 'name email avatar_url')
    .populate('responders.user_id', 'name email avatar_url')
    .populate('created_by', 'name email avatar_url')
    .populate('affected_service_ids', 'name type current_status cloud_metadata')
    .populate('source_alert_id', 'name severity source_type query alert_state last_firing_labels')
    .populate('source_synthetic_check_id', 'name check_type http_check tcp_check dns_check last_status');
  if (!inc) throw AppError.notFound('Incident');
  return inc;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createIncident(input: {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  title: string;
  description?: string;
  severity?: number;
  type?: string;
  source?: string;
  labels?: string[];
  escalation_policy_id?: string;
  affected_service_ids?: string[];
  source_alert_id?: string;
  source_synthetic_check_id?: string;
  custom_fields?: Record<string, unknown>;
}): Promise<IncidentDocument> {
  const number = await getNextSequence(input.tenant_id, 'incident');
  const severity = input.severity ?? 3;

  // Auto-derive escalation_policy_id from service if not explicitly provided
  let escalationPolicyId: Types.ObjectId | null = input.escalation_policy_id
    ? new Types.ObjectId(input.escalation_policy_id)
    : null;
  const serviceIds = (input.affected_service_ids || []).map(id => new Types.ObjectId(id));
  if (!escalationPolicyId && serviceIds.length > 0) {
    const svc = await Service.findOne({ _id: serviceIds[0], tenant_id: input.tenant_id });
    if (svc?.escalation_policy_id) {
      escalationPolicyId = new Types.ObjectId(svc.escalation_policy_id.toString());
    }
  }

  // If the resolved policy's first step routes to the provider (managed
  // support), don't auto-assign a consumer-side commander. The provider
  // bridge sets `provider_handover` on the consumer incident and the
  // de-facto owner is the provider's on-call engineer.
  let policyDelegatesToProvider = false;
  if (escalationPolicyId) {
    const { EscalationPolicy } = await import('../models/escalation-policy.model');
    const pol = await EscalationPolicy.findById(escalationPolicyId).select('steps');
    policyDelegatesToProvider = !!pol?.steps?.some((s: any) => s.target_type === 'provider_escalation');
  }

  const creatorName = await resolveUserName(input.created_by);

  const inc = await Incident.create({
    tenant_id: input.tenant_id,
    number,
    title: input.title,
    description: input.description || '',
    severity,
    type: input.type || 'other',
    status: 'open',
    source: input.source || 'manual',
    labels: input.labels || [],
    custom_fields: input.custom_fields || {},
    created_by: input.created_by,
    watcher_ids: [input.created_by],
    escalation_policy_id: escalationPolicyId,
    affected_service_ids: serviceIds,
    source_alert_id: input.source_alert_id ? new Types.ObjectId(input.source_alert_id) : null,
    source_synthetic_check_id: input.source_synthetic_check_id ? new Types.ObjectId(input.source_synthetic_check_id) : null,
    metrics: {},
    timeline: [
      {
        type: 'declaration',
        actor_id: input.created_by,
        message: `Incident declared by ${creatorName}`,
        metadata: { severity },
      },
    ],
  });

  // Auto-create war room channel
  try {
    const channel = await Channel.create({
      tenant_id: input.tenant_id,
      name: `INC-${String(number).padStart(4, '0')} War Room`,
      type: 'incident_war_room',
      description: `War room for incident: ${input.title}`,
      incident_id: inc._id,
      members: [{ user_id: input.created_by, role: 'owner', joined_at: new Date() }],
      created_by: input.created_by,
    });
    inc.war_room_channel_id = channel._id;
    await inc.save();
    logger.info('War room channel created', { channelId: channel._id, incidentId: inc._id });

    // Auto-link Slack channel to war room if tenant has Slack integration
    try {
      const slackIntegration = await TenantIntegration.findOne({
        tenant_id: input.tenant_id,
        platform: 'slack',
        is_active: true,
      });
      if (slackIntegration) {
        const token = decryptToken(slackIntegration.bot_token_encrypted);
        const slackChannel = await slackService.createChannel(token, `inc-${String(number).padStart(4, '0')}`);
        if (slackChannel) {
          channel.slack_integration = {
            workspace_id: slackIntegration.workspace_id || '',
            channel_id: slackChannel.id,
            channel_name: slackChannel.name,
          };
          await channel.save();
          logger.info('Slack channel linked to war room', { slackChannelId: slackChannel.id, channelId: channel._id });
        }
      }
    } catch (slackErr: any) {
      logger.debug('Slack auto-link skipped', { error: slackErr.message });
    }
  } catch (err: any) {
    logger.error('Failed to create war room channel', { incidentId: inc._id, error: err.message });
  }

  // Auto-assign commander to first on-call user and notify on-call users.
  // Skip commander assignment when the policy delegates to a provider — the
  // bridge creation will set the consumer incident commander to match the
  // provider's active on-call (L1), keeping both sides in sync.
  try {
    const onCallUsers = await getCurrentOnCallUsersForServices(input.tenant_id, serviceIds);
    if (onCallUsers.length > 0) {
      if (!inc.commander_id && !policyDelegatesToProvider) {
        inc.commander_id = new Types.ObjectId(onCallUsers[0].toString());
        const commanderName = await resolveUserName(onCallUsers[0]);
        inc.timeline.push({
          type: 'role_assigned' as any,
          actor_id: null as any,
          message: `Commander auto-assigned to ${commanderName}`,
          metadata: { user_id: onCallUsers[0].toString(), role: 'commander', auto: true },
        } as any);
        await inc.save();
        logger.info('Commander auto-assigned to on-call user', { incidentId: inc._id, userId: onCallUsers[0] });
      }

      const sevLabel = `SEV${severity}`;
      const incidentNumber = `INC-${String(number).padStart(4, '0')}`;
      const notifTitle = `${sevLabel} Incident: ${input.title}`;
      const notifBody = `${incidentNumber} has been declared. You are on-call.`;

      const notifications = onCallUsers.map((userId) => ({
        tenant_id: input.tenant_id,
        user_id: userId,
        type: 'incident',
        priority: (severity <= 2 ? 'critical' : severity <= 3 ? 'warning' : 'info') as 'critical' | 'warning' | 'info',
        title: notifTitle,
        body: notifBody,
        resource_type: 'incident',
        resource_id: inc._id.toString(),
      }));
      await createBulkNotifications(notifications);
      logger.info('On-call users notified (in-app)', { incidentId: inc._id, userCount: onCallUsers.length });

      // Dispatch outbound notifications (email/SMS/voice) for SEV1/2 — don't await
      // (best-effort, won't block incident creation)
      dispatchOutboundIncidentNotifications(
        input.tenant_id,
        onCallUsers as any,
        notifTitle,
        notifBody,
        inc._id.toString(),
        severity,
      ).catch((err) => {
        logger.error('Outbound incident dispatch failed', { incidentId: inc._id, error: err.message });
      });
    }
  } catch (err: any) {
    logger.error('Failed to notify/auto-assign on-call users', { incidentId: inc._id, error: err.message });
  }

  logger.info('Incident created', { incidentId: inc._id, number: inc.number, severity });
  publishIncidentEvent('created', inc).catch(() => {});

  // Recurrence detection — fire-and-forget, must not block incident creation response
  (async () => {
    try {
      const similar = await findSimilar(new Types.ObjectId(input.tenant_id.toString()), inc._id.toString());
      if (similar.length > 0) {
        const first = similar[0] as any;
        inc.timeline.push({
          _id: new Types.ObjectId(),
          type: 'ai_insight',
          actor_id: null as any,
          message: `Possible recurring incident: matches ${similar.length} previous incident${similar.length !== 1 ? 's' : ''}, including INC-${String(first.number).padStart(4, '0')} "${first.title}". Review open post-mortem action items.`,
          metadata: {
            similar_incident_ids: similar.map((s: any) => s._id.toString()),
            similar_count: similar.length,
          },
          timestamp: new Date(),
        });
        await inc.save();
        logger.info('Recurrence detected on incident creation', {
          incidentId: inc._id.toString(),
          similarCount: similar.length,
        });
      }
    } catch (err: any) {
      logger.warn('Recurrence detection failed silently', { incidentId: inc._id.toString(), error: err.message });
    }
  })();

  // Notify Slack channel — but skip the consumer side when the escalation
  // policy will immediately bridge to a provider. The provider's channel
  // will be notified by createBridge, and the consumer doesn't want their
  // Slack pinged for incidents they've handed off. The tier-escalation
  // handler will re-notify the consumer's channel if/when the tier escalates
  // back to a schedule on the consumer's own tenant.
  if (!policyDelegatesToProvider) {
    notifySlack(input.tenant_id, inc, 'created').catch(() => {});

    // If this consumer tenant has an active managed-support link but their
    // escalation policy has no provider_escalation step (e.g. TPK), auto-bridge
    // to the provider immediately so the L1 team gets paged.
    // Result is cached in Redis (60s TTL) — no DB hit on subsequent incidents.
    isManagedSupportConsumer(new Types.ObjectId(input.tenant_id.toString()))
      .then((isMs) => {
        if (isMs) {
          executeProviderEscalation(new Types.ObjectId(input.tenant_id.toString()), inc._id)
            .catch((err) => logger.error('Auto managed-support bridge failed on incident creation', {
              error: err.message,
              incident_id: inc._id.toString(),
            }));
        }
      })
      .catch(() => {});
  } else {
    logger.debug('Skipping consumer Slack notify — policy delegates to provider', { incidentId: inc._id });
  }

  // Trigger AI agents on incident creation
  const tId = input.tenant_id.toString();
  const iId = inc._id.toString();
  publishAgentTrigger('incident-triage', { type: 'event', event_type: 'incident.created', source_id: iId }, tId).catch(() => {});
  publishAgentTrigger('runbook-automation', { type: 'event', event_type: 'incident.created', source_id: iId }, tId).catch(() => {});
  publishAgentTrigger('knowledge-agent', { type: 'event', event_type: 'incident.created', source_id: iId }, tId).catch(() => {});
  // Commander only for SEV-1/2
  if (severity <= 2) {
    publishAgentTrigger('incident-commander', { type: 'event', event_type: 'incident.created', source_id: iId }, tId).catch(() => {});
    publishAgentTrigger('comms-agent', { type: 'event', event_type: 'incident.created', source_id: iId }, tId).catch(() => {});
  }

  return inc;
}

// ─── Update (general patch) ───────────────────────────────────────────────────

export async function updateIncident(
  tenantId: Types.ObjectId,
  id: string,
  update: {
    title?: string;
    description?: string;
    labels?: string[];
    commander_id?: string | null;
    comms_lead_id?: string | null;
    operations_lead_id?: string | null;
    escalation_policy_id?: string | null;
    affected_service_ids?: string[];
  }
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  if (update.title !== undefined) inc.title = update.title;
  if (update.description !== undefined) inc.description = update.description;
  if (update.labels !== undefined) inc.labels = update.labels;
  if (update.commander_id !== undefined)
    inc.commander_id = update.commander_id ? new Types.ObjectId(update.commander_id) : null;
  if (update.comms_lead_id !== undefined)
    inc.comms_lead_id = update.comms_lead_id ? new Types.ObjectId(update.comms_lead_id) : null;
  if (update.operations_lead_id !== undefined)
    inc.operations_lead_id = update.operations_lead_id
      ? new Types.ObjectId(update.operations_lead_id)
      : null;
  if (update.escalation_policy_id !== undefined)
    inc.escalation_policy_id = update.escalation_policy_id
      ? new Types.ObjectId(update.escalation_policy_id)
      : null;
  if (update.affected_service_ids !== undefined)
    inc.affected_service_ids = update.affected_service_ids.map((id) => new Types.ObjectId(id));

  await inc.save();
  logger.info('Incident updated', { incidentId: id });

  // Notify Slack on commander assignment
  if (update.commander_id) {
    try {
      const { User } = await import('../models/user.model');
      const commander = await User.findById(update.commander_id).select('name').lean();
      notifySlack(tenantId, inc, 'commander_assigned', { commanderName: (commander as any)?.name || 'Unknown' }).catch(() => {});
    } catch { /* ignore */ }
  }

  return inc;
}

// ─── Acknowledge ──────────────────────────────────────────────────────────────

export async function acknowledgeIncident(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');
  if (inc.status !== 'open')
    throw AppError.badRequest(`Cannot acknowledge an incident with status '${inc.status}'`);

  const now = new Date();
  inc.status = 'acknowledged';
  inc.metrics.ack_at = now;
  inc.metrics.mtta_seconds = Math.floor((now.getTime() - inc.createdAt.getTime()) / 1000);

  const ackUserName = await resolveUserName(actorId);
  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'acknowledgment',
    actor_id: actorId,
    message: `Incident acknowledged by ${ackUserName}`,
    metadata: { mtta_seconds: inc.metrics.mtta_seconds },
    timestamp: now,
  });

  await inc.save();
  logger.info('Incident acknowledged', { incidentId: id, mtta_seconds: inc.metrics.mtta_seconds });
  publishIncidentEvent('ack', inc, { ack_by: actorId.toString() }).catch(() => {});
  invalidateIccCache(inc.tenant_id.toString(), inc._id.toString()).catch(() => {});
  notifySlack(tenantId, inc, 'acknowledged').catch(() => {});

  // Propagate acknowledge to the other side of any active bridge
  // so the consumer sees the incident as acknowledged when the provider acks it
  try {
    const { getBridgeByConsumerIncident, getBridgeByProviderIncident, syncToProvider, syncToConsumer } = await import('./incident-bridge.service');
    const [consumerBridge, providerBridge] = await Promise.all([
      getBridgeByConsumerIncident(id),
      getBridgeByProviderIncident(id),
    ]);
    if (consumerBridge?.status === 'active') {
      syncToProvider(consumerBridge._id.toString(), 'acknowledge').catch((err) =>
        logger.error('Failed to sync acknowledge to provider bridge', { error: err.message }),
      );
    }
    if (providerBridge?.status === 'active') {
      syncToConsumer(providerBridge._id.toString(), 'acknowledge').catch((err) =>
        logger.error('Failed to sync acknowledge to consumer bridge', { error: err.message }),
      );
    }
  } catch (err: any) {
    logger.error('Failed to look up bridge for acknowledge sync', { incidentId: id, error: err.message });
  }

  return inc;
}

// ─── Status change (investigating / monitoring) ───────────────────────────────

export async function changeIncidentStatus(
  tenantId: Types.ObjectId,
  id: string,
  newStatus: 'investigating' | 'monitoring',
  actorId: Types.ObjectId,
  message?: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  const prevStatus = inc.status;
  inc.status = newStatus;
  const statusUserName = await resolveUserName(actorId);
  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'status_change',
    actor_id: actorId,
    message: message || `Status changed from ${prevStatus} to ${newStatus} by ${statusUserName}`,
    metadata: { from: prevStatus, to: newStatus },
    timestamp: new Date(),
  });

  await inc.save();
  publishIncidentEvent('updated', inc, { changes: { status: newStatus } }).catch(() => {});
  invalidateIccCache(inc.tenant_id.toString(), inc._id.toString()).catch(() => {});
  notifySlack(tenantId, inc, 'status_changed', { newStatus, prevStatus }).catch(() => {});

  // Trigger comms agent on status transitions
  publishAgentTrigger('comms-agent', {
    type: 'event', event_type: 'incident.status_changed', source_id: inc._id.toString(),
  }, tenantId.toString()).catch(() => {});

  return inc;
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

export async function resolveIncident(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  message?: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');
  if (inc.status === 'resolved' || inc.status === 'closed')
    throw AppError.badRequest(`Incident is already ${inc.status}`);

  const now = new Date();
  inc.status = 'resolved';
  inc.resolved_at = now;
  inc.metrics.resolved_at = now;
  inc.metrics.mttr_seconds = Math.floor((now.getTime() - inc.createdAt.getTime()) / 1000);

  const resolverName = await resolveUserName(actorId);
  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'resolution',
    actor_id: actorId,
    message: message || `Incident resolved by ${resolverName}`,
    metadata: { mttr_seconds: inc.metrics.mttr_seconds },
    timestamp: now,
  });

  await inc.save();
  logger.info('Incident resolved', { incidentId: id, mttr_seconds: inc.metrics.mttr_seconds });
  publishIncidentEvent('resolved', inc, { mttr_seconds: inc.metrics.mttr_seconds }).catch(() => {});
  invalidateIccCache(inc.tenant_id.toString(), inc._id.toString()).catch(() => {});
  notifySlack(tenantId, inc, 'resolved').catch(() => {});

  // Propagate resolve to the other side of any active bridge
  try {
    const { getBridgeByConsumerIncident, getBridgeByProviderIncident, syncToProvider, syncToConsumer } = await import('./incident-bridge.service');
    const [consumerBridge, providerBridge] = await Promise.all([
      getBridgeByConsumerIncident(id),
      getBridgeByProviderIncident(id),
    ]);
    if (consumerBridge?.status === 'active') {
      syncToProvider(consumerBridge._id.toString(), 'resolve').catch((err) =>
        logger.error('Failed to sync resolve to provider bridge', { error: err.message, bridgeId: consumerBridge._id }),
      );
    }
    if (providerBridge?.status === 'active') {
      syncToConsumer(providerBridge._id.toString(), 'resolve').catch((err) =>
        logger.error('Failed to sync resolve to consumer bridge', { error: err.message, bridgeId: providerBridge._id }),
      );
    }
  } catch (err: any) {
    logger.error('Failed to look up bridge for resolve sync', { incidentId: id, error: err.message });
  }

  // Trigger AI agents on incident resolution
  const resolvedTenantId = tenantId.toString();
  const resolvedIncId = inc._id.toString();
  publishAgentTrigger('rca-agent', { type: 'event', event_type: 'incident.resolved', source_id: resolvedIncId }, resolvedTenantId).catch(() => {});
  publishAgentTrigger('comms-agent', { type: 'event', event_type: 'incident.resolved', source_id: resolvedIncId }, resolvedTenantId).catch(() => {});
  publishAgentTrigger('oncall-wellness', { type: 'event', event_type: 'incident.resolved', source_id: resolvedIncId }, resolvedTenantId).catch(() => {});
  publishAgentTrigger('security-compliance', { type: 'event', event_type: 'incident.resolved', source_id: resolvedIncId }, resolvedTenantId).catch(() => {});

  return inc;
}

// ─── Close ────────────────────────────────────────────────────────────────────

export async function closeIncident(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');
  if (inc.status === 'closed') throw AppError.badRequest('Incident is already closed');
  if (inc.status !== 'resolved')
    throw AppError.badRequest('Incident must be resolved before closing');

  const now = new Date();
  inc.status = 'closed';
  inc.closed_at = now;
  inc.metrics.closed_at = now;

  const closerName = await resolveUserName(actorId);
  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'status_change',
    actor_id: actorId,
    message: `Incident closed by ${closerName}`,
    metadata: { to: 'closed' },
    timestamp: now,
  });

  await inc.save();
  logger.info('Incident closed', { incidentId: id });
  notifySlack(tenantId, inc, 'closed').catch(() => {});
  return inc;
}

// ─── Severity change ──────────────────────────────────────────────────────────

export async function changeSeverity(
  tenantId: Types.ObjectId,
  id: string,
  newSeverity: number,
  actorId: Types.ObjectId,
  reason?: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  const oldSeverity = inc.severity;
  inc.severity = newSeverity as 1 | 2 | 3 | 4 | 5;
  const sevChangerName = await resolveUserName(actorId);

  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'severity_change',
    actor_id: actorId,
    message: reason || `Severity changed from SEV${oldSeverity} to SEV${newSeverity} by ${sevChangerName}`,
    metadata: { from: oldSeverity, to: newSeverity },
    timestamp: new Date(),
  });

  await inc.save();
  logger.info('Incident severity changed', { incidentId: id, from: oldSeverity, to: newSeverity });
  publishIncidentEvent('updated', inc, { changes: { severity: newSeverity } }).catch(() => {});
  invalidateIccCache(inc.tenant_id.toString(), inc._id.toString()).catch(() => {});
  return inc;
}

// ─── Escalate ─────────────────────────────────────────────────────────────────

export async function escalateIncident(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  reason?: string,
  escalation_policy_id?: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  // Attach escalation policy if provided and incident doesn't have one
  if (escalation_policy_id && !inc.escalation_policy_id) {
    inc.escalation_policy_id = new Types.ObjectId(escalation_policy_id);
  }

  // If still no policy, try to derive from affected services
  if (!inc.escalation_policy_id && inc.affected_service_ids.length > 0) {
    const svc = await Service.findOne({ _id: inc.affected_service_ids[0], tenant_id: tenantId });
    if (svc?.escalation_policy_id) {
      inc.escalation_policy_id = new Types.ObjectId(svc.escalation_policy_id.toString());
    }
  }

  const escalatorName = await resolveUserName(actorId);
  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'escalation',
    actor_id: actorId,
    message: reason || `Incident escalated by ${escalatorName}`,
    metadata: { escalation_policy_id: inc.escalation_policy_id?.toString() || null },
    timestamp: new Date(),
  });

  await inc.save();
  logger.info('Incident escalated', { incidentId: id, hasPolicy: !!inc.escalation_policy_id });
  publishIncidentEvent('escalated', inc, { reason }).catch(() => {});
  invalidateIccCache(inc.tenant_id.toString(), inc._id.toString()).catch(() => {});

  // For managed-support incidents: trigger immediate tier escalation.
  // Uses static imports to avoid dynamic import hanging issues.
  try {
    logger.info('[tier-escalate] querying SLA state', { incidentId: id });
    const slaState = await IncidentSLAState.findOne({
      $or: [{ provider_incident_id: inc._id }, { consumer_incident_id: inc._id }],
    });
    logger.info('[tier-escalate] SLA state result', { incidentId: id, found: !!slaState, status: (slaState as any)?.status });

    if (!slaState) {
      logger.info('No SLA state found for manual escalation — not a managed-support incident', { incidentId: id });
    } else if (slaState.status === 'resolved' || slaState.status === 'breached') {
      logger.info('SLA state already resolved/breached — skipping manual tier escalation', { incidentId: id, slaStatus: slaState.status });
    }

    if (slaState && slaState.status !== 'resolved' && slaState.status !== 'breached') {
      logger.info('[tier-escalate] calling escalateTier', { incidentId: id, currentTier: slaState.current_tier });
      const { state: updated, nextTierScheduleIds, nextTierScheduleTenantId, nextTierChannels, nextTierType } =
        await escalateTier(slaState, 'manual_escalation');
      logger.info('[tier-escalate] escalateTier done', { incidentId: id, scheduleCount: nextTierScheduleIds.length, nextTier: updated.current_tier });

      if (nextTierScheduleIds.length > 0) {
        const tierLabel = `L${updated.current_tier}`;
        // Always update tier badge on both incidents, even if nobody is on-call
        await Incident.findByIdAndUpdate(slaState.provider_incident_id, { $set: { 'custom_fields.managed_tier': tierLabel } });
        await Incident.findByIdAndUpdate(slaState.consumer_incident_id, { $set: { 'custom_fields.managed_tier': tierLabel } });

        const newOnCall = await getOnCallUsersForSchedules(nextTierScheduleIds, nextTierScheduleTenantId);
        logger.info('[tier-escalate] on-call resolved', { incidentId: id, count: newOnCall.length, tier: tierLabel });
        // Resolve who is being notified for timeline display
        const onCallNames = newOnCall.length > 0
          ? (await Promise.all(newOnCall.slice(0, 3).map((uid) => resolveUserName(uid)))).join(', ')
          : null;
        const notifiedDisplay = nextTierType === 'consumer'
          ? (onCallNames || 'No one on-call at this tier')
          : 'SReonCall Support';

        // Add timeline entries now (always, regardless of on-call count)
        const providerTimeline = await Incident.findById(slaState.provider_incident_id);
        if (providerTimeline) {
          const notifiedFor = nextTierType === 'consumer'
            ? (onCallNames ? `${onCallNames} notified` : 'No one on-call at this tier')
            : (onCallNames ? `${onCallNames} notified` : 'No one on-call at this tier');
          providerTimeline.timeline.push({
            _id: new Types.ObjectId(), timestamp: new Date(), type: 'provider_escalation' as any,
            actor_id: actorId as any,
            message: `Escalated to ${tierLabel} by ${escalatorName} — ${notifiedFor}`,
            metadata: { tier: updated.current_tier, reason: 'manual_escalation', notified: onCallNames },
          } as any);
          if (newOnCall[0]) providerTimeline.commander_id = newOnCall[0];
          await providerTimeline.save();
        }

        const consumerTimeline = await Incident.findById(slaState.consumer_incident_id);
        if (consumerTimeline) {
          const consumerMsg = nextTierType === 'consumer'
            ? `Escalated to ${tierLabel} — ${onCallNames ? `${onCallNames} notified` : 'No one on-call at this tier'}`
            : `Escalated to ${tierLabel} — ${notifiedDisplay} handling`;
          consumerTimeline.timeline.push({
            _id: new Types.ObjectId(), timestamp: new Date(), type: 'bridge_sync' as any,
            actor_id: null as any,
            message: consumerMsg,
            metadata: { tier: updated.current_tier, reason: 'manual_escalation', source: nextTierType },
          } as any);
          if (nextTierType === 'consumer' && newOnCall[0]) consumerTimeline.commander_id = newOnCall[0];
          await consumerTimeline.save();
        }

        if (newOnCall.length > 0) {
          const sevLabel = `SEV${inc.severity}`;
          const title = `${sevLabel} Escalated to ${tierLabel}: ${inc.title}`;
          const body = `Incident manually escalated to ${tierLabel} by ${escalatorName}. You are now on-call for this incident.`;
          const notifTenantId = nextTierType === 'consumer' ? slaState.consumer_tenant_id : slaState.provider_tenant_id;
          const priority = (inc.severity <= 2 ? 'critical' : 'warning') as 'critical' | 'warning';

          // In-app notifications
          if (nextTierChannels.includes('in_app')) {
            await createBulkNotifications(newOnCall.map((userId) => ({
              tenant_id: notifTenantId, user_id: userId, type: 'escalation' as string,
              priority, title, body, resource_type: 'incident', resource_id: id,
            })));
          }

          // Outbound channels — Voice, WhatsApp, SMS, Email, Slack
          const onCallUsers = await User.find({ _id: { $in: newOnCall } });
          for (const u of onCallUsers) {
            const phone = (u as any).phone_number;
            if (nextTierChannels.includes('email') && u.email) {
              sendNotificationEmail(u.email, title, body, `/incidents/${id}`, notifTenantId.toString()).catch(() => {});
            }
            if (nextTierChannels.includes('sms') && phone) {
              sendSms(phone, `${title}\n${body}`).catch(() => {});
            }
            if (nextTierChannels.includes('voice') && phone) {
              makeVoiceCall(phone, `${title}. ${body}`, { incidentId: id, tenantId: notifTenantId.toString(), userId: u._id.toString() }).catch(() => {});
            }
            if (nextTierChannels.includes('whatsapp') && phone) {
              sendWhatsApp(phone, `${title}\n${body}`).catch(() => {});
            }
            if (nextTierChannels.includes('slack') && u.email) {
              try {
                const slackInt = await TenantIntegration.findOne({ tenant_id: notifTenantId, platform: 'slack', status: 'active' });
                if (slackInt) {
                  const token = decryptToken(slackInt.bot_token_encrypted);
                  slackService.sendDirectMessage(token, u.email, `*${title}*\n${body}`).catch(() => {});
                }
              } catch { /* best-effort */ }
            }
          }

          logger.info('Manual tier escalation executed', { incidentId: id, tier: updated.current_tier, channels: nextTierChannels, notified: onCallNames });
        }
      }
    }
  } catch (err: any) {
    logger.warn('Manual tier escalation failed (non-critical)', { incidentId: id, error: err.message });
  }

  return inc;
}

// ─── Responders ───────────────────────────────────────────────────────────────

export async function addResponder(
  tenantId: Types.ObjectId,
  id: string,
  userId: string,
  role: string,
  actorId: Types.ObjectId
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  const userOid = new Types.ObjectId(userId);
  const existing = inc.responders.find((r) => r.user_id.equals(userOid) && !r.left_at);
  if (existing) throw AppError.badRequest('User is already an active responder');

  inc.responders.push({ user_id: userOid, role, joined_at: new Date(), left_at: null });

  const [responderName, adderName] = await Promise.all([
    resolveUserName(userId),
    resolveUserName(actorId),
  ]);
  inc.timeline.push({
    _id: new Types.ObjectId(),
    type: 'role_assigned',
    actor_id: actorId,
    message: `${responderName} added as ${role} by ${adderName}`,
    metadata: { user_id: userId, role },
    timestamp: new Date(),
  });

  await inc.save();
  return inc;
}

export async function removeResponder(
  tenantId: Types.ObjectId,
  id: string,
  userId: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  const userOid = new Types.ObjectId(userId);
  const responder = inc.responders.find((r) => r.user_id.equals(userOid) && !r.left_at);
  if (!responder) throw AppError.notFound('Active responder');

  responder.left_at = new Date();
  await inc.save();
  return inc;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export async function getTimeline(
  tenantId: Types.ObjectId,
  id: string
): Promise<IncidentDocument['timeline']> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');
  return inc.timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export async function addTimelineEntry(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  message: string,
  type: IncidentDocument['timeline'][0]['type'] = 'note',
  metadata?: Record<string, unknown>
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  inc.timeline.push({
    _id: new Types.ObjectId(),
    type,
    actor_id: actorId,
    message,
    metadata: metadata || {},
    timestamp: new Date(),
  });

  await inc.save();
  return inc;
}

// ─── Postmortem link ──────────────────────────────────────────────────────────

export async function linkPostmortem(
  tenantId: Types.ObjectId,
  id: string,
  postmortemId: string
): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: id, tenant_id: tenantId });
  if (!inc) throw AppError.notFound('Incident');

  inc.postmortem_id = new Types.ObjectId(postmortemId);
  await inc.save();
  return inc;
}

// ─── Similar incidents ────────────────────────────────────────────────────────

export async function findSimilar(
  tenantId: Types.ObjectId,
  incidentId: string,
): Promise<IncidentDocument[]> {
  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId }).lean();
  if (!incident) throw AppError.notFound('Incident');

  const orConditions: any[] = [];

  // Match on same affected services
  if (incident.affected_service_ids?.length) {
    orConditions.push({ affected_service_ids: { $in: incident.affected_service_ids } });
  }

  // Match on same source alert rule
  if (incident.source_alert_id) {
    orConditions.push({ source_alert_id: incident.source_alert_id });
  }

  // Match on similar title keywords (extract significant words >= 4 chars)
  const titleWords = (incident.title || '')
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w: string) => w.length >= 4)
    .slice(0, 5);
  if (titleWords.length > 0) {
    const titleRegex = titleWords.map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    orConditions.push({ title: { $regex: titleRegex, $options: 'i' } });
  }

  if (orConditions.length === 0) return [];

  const similar = await Incident.find({
    _id: { $ne: incidentId },
    tenant_id: tenantId,
    $or: orConditions,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('commander_id', 'name email avatar_url')
    .populate('created_by', 'name email avatar_url')
    .populate('affected_service_ids', 'name type current_status cloud_metadata')
    .populate('source_alert_id', 'name severity source_type query alert_state last_firing_labels');

  return similar;
}
