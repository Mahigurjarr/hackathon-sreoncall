/**
 * SLA Timer Worker
 *
 * Polls active IncidentSLAState documents every 30s. For each one:
 *  - If the current tier's escalation timeout passed and the incident
 *    isn't resolved, auto-escalate to the next tier and page its schedule.
 *  - If the response or resolution SLA deadline passed, mark breached
 *    and notify consumer admins.
 *
 * Mirrors escalation.worker.ts bootstrap pattern.
 */

import { Types } from 'mongoose';
import { IncidentSLAState, IncidentSLAStateDocument } from '../models/incident-sla-state.model';
import { Incident } from '../models/incident.model';
import { User } from '../models/user.model';
import { Tenant } from '../models/tenant.model';
import { escalateTier } from '../services/managed-support.service';
import { getOnCallUsersForSchedules } from '../services/oncall.service';
import { createBulkNotifications } from '../services/notification.service';
import { sendNotificationEmail } from '../services/email-notification.service';
import { makeVoiceCall, sendWhatsApp } from '../services/plivo.service';
import * as slackService from '../services/slack.service';
import { TenantIntegration } from '../models/tenant-integration.model';
import { decryptToken } from '../utils/encryption';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 30_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Avoid duplicate breach notifications across poll cycles.
const notifiedResponseBreach = new Set<string>();
const notifiedResolutionBreach = new Set<string>();

export function startSlaTimerWorker(): void {
  if (intervalHandle) return;
  logger.info('SLA timer worker starting');
  intervalHandle = setInterval(runSlaCycle, POLL_INTERVAL_MS);
  runSlaCycle().catch((err) =>
    logger.error('SLA timer cycle error (initial)', { error: err.message }),
  );
}

export function stopSlaTimerWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  notifiedResponseBreach.clear();
  notifiedResolutionBreach.clear();
  logger.info('SLA timer worker stopped');
}

async function runSlaCycle(): Promise<void> {
  try {
    const states = await IncidentSLAState.find({ status: 'active' });
    const now = new Date();
    for (const state of states) {
      try {
        await processState(state, now);
      } catch (err: any) {
        logger.error('Failed to process SLA state', {
          state_id: state._id.toString(),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('SLA timer cycle failed', { error: err.message });
  }
}

async function processState(state: IncidentSLAStateDocument, now: Date): Promise<void> {
  // Short-circuit if the consumer incident is already resolved/closed.
  const consumerIncident = await Incident.findById(state.consumer_incident_id);
  if (!consumerIncident || ['resolved', 'closed'].includes(consumerIncident.status)) {
    state.status = 'resolved';
    await state.save();
    return;
  }

  // 1. Tier timeout → auto-escalate
  if (state.tier_deadline && state.tier_deadline <= now) {
    await autoEscalateTier(state, now);
  }

  // 2. Response SLA breach
  if (
    !state.response_sla.met_at
    && !state.response_sla.breached
    && state.response_sla.deadline_at <= now
  ) {
    state.response_sla.breached = true;
    await state.save();
    await notifyBreach(state, 'response');
  }

  // 3. Resolution SLA breach
  if (
    !state.resolution_sla.met_at
    && !state.resolution_sla.breached
    && state.resolution_sla.deadline_at <= now
  ) {
    state.resolution_sla.breached = true;
    state.status = 'breached';
    await state.save();
    await notifyBreach(state, 'resolution');
  }
}

async function autoEscalateTier(state: IncidentSLAStateDocument, now: Date): Promise<void> {
  const { state: updatedState, nextTierScheduleIds, nextTierScheduleTenantId, nextTierChannels, nextTierType } = await escalateTier(state, 'escalation_timeout', now);
  if (!nextTierScheduleIds.length) return;

  // Page the new tier's on-call — union across all configured schedules
  const newOnCall = await getOnCallUsersForSchedules(nextTierScheduleIds, nextTierScheduleTenantId);
  if (newOnCall.length === 0) {
    logger.warn('Tier escalation: no on-call users for target schedule', {
      state_id: state._id.toString(),
      tier: updatedState.current_tier,
      schedule_ids: nextTierScheduleIds.map((id) => id.toString()),
    });
    return;
  }

  const providerIncident = await Incident.findById(updatedState.provider_incident_id);
  if (!providerIncident) return;

  // Update managed_tier on both incidents so UI shows current tier
  const managedTierLabel = `L${updatedState.current_tier}`;
  await Incident.findByIdAndUpdate(updatedState.provider_incident_id, { $set: { 'custom_fields.managed_tier': managedTierLabel } });
  await Incident.findByIdAndUpdate(updatedState.consumer_incident_id, { $set: { 'custom_fields.managed_tier': managedTierLabel } });

  // Update commanders based on tier type:
  // - Provider tier: update provider incident commander; consumer stays generic
  // - Consumer tier (L3+): update consumer incident commander to the actual consumer on-call person
  const newCommander = newOnCall[0];
  if (newCommander) {
    if (nextTierType === 'consumer') {
      // Consumer's own tier is now handling it — assign actual person as consumer commander
      Incident.findByIdAndUpdate(updatedState.consumer_incident_id, {
        commander_id: newCommander,
      }).catch((e) => logger.error('Failed to set consumer commander on consumer tier escalation', { error: e.message }));
    } else {
      // Provider tier — update provider incident commander only; consumer stays as "Provider Support"
      providerIncident.commander_id = newCommander;
    }
  }

  const tierLabel = `L${updatedState.current_tier}`;
  const sevLabel = `SEV${providerIncident.severity}`;
  const incidentNumber = `INC-${String(providerIncident.number).padStart(4, '0')}`;
  const title = `${sevLabel} Tier auto-escalation (${tierLabel}): ${providerIncident.title}`;
  const body = `${incidentNumber} auto-escalated to ${tierLabel} after previous tier timeout.`;
  const priority = providerIncident.severity <= 2 ? 'critical' : providerIncident.severity <= 3 ? 'warning' : 'info';

  const notifTenantId = nextTierType === 'consumer' ? updatedState.consumer_tenant_id : updatedState.provider_tenant_id;

  if (nextTierChannels.includes('in_app')) {
    await createBulkNotifications(
      newOnCall.map((userId) => ({
        tenant_id: notifTenantId,
        user_id: userId,
        type: 'incident',
        priority: priority as 'critical' | 'warning' | 'info',
        title,
        body,
        resource_type: 'incident',
        resource_id: providerIncident._id.toString(),
      })),
    );
  }

  // Outbound channels — driven by tier notify_channels, best-effort
  User.find({ _id: { $in: newOnCall } })
    .then(async (users) => {
      for (const u of users) {
        const phone = (u as any).phone_number;
        if (nextTierChannels.includes('email') && u.email) {
          sendNotificationEmail(u.email, title, body, `/incidents/${providerIncident._id}`, updatedState.provider_tenant_id.toString())
            .catch((e) => logger.error('Tier escalation email failed', { error: e.message }));
        }
        if (nextTierChannels.includes('voice') && phone) {
          makeVoiceCall(phone, `${title}. ${body}`, {
            incidentId: providerIncident._id.toString(),
            tenantId: updatedState.provider_tenant_id.toString(),
            userId: u._id.toString(),
          }).catch((e) => logger.error('Tier escalation voice call failed', { error: e.message }));
        }
        if (nextTierChannels.includes('whatsapp') && phone) {
          sendWhatsApp(phone, `${title}\n${body}`)
            .catch((e) => logger.error('Tier escalation WhatsApp failed', { error: e.message }));
        }
        if (nextTierChannels.includes('slack') && u.email) {
          try {
            const slackInt = await TenantIntegration.findOne({ tenant_id: notifTenantId, platform: 'slack', status: 'active' });
            if (slackInt) {
              const token = decryptToken(slackInt.bot_token_encrypted);
              slackService.sendDirectMessage(token, u.email, `*${title}*\n${body}`)
                .catch((e) => logger.error('Tier escalation Slack DM failed', { error: e.message }));
            }
          } catch (e: any) { logger.error('Slack integration lookup failed (tier escalation)', { error: e.message }); }
        }
      }
    })
    .catch((err) => logger.error('Failed to fetch users for tier escalation outbound', { error: err.message }));

  // Add timeline entry for both sides.
  const timelineMsg = `Auto-escalated to ${tierLabel} — previous tier timeout`;
  const consumerIncident = await Incident.findById(updatedState.consumer_incident_id);
  if (consumerIncident) {
    consumerIncident.timeline.push({
      _id: new Types.ObjectId(),
      type: 'provider_escalation' as any,
      actor_id: null,
      message: timelineMsg,
      metadata: { tier: updatedState.current_tier, reason: 'escalation_timeout' },
      timestamp: now,
    } as any);
    await consumerIncident.save();
  }
  providerIncident.timeline.push({
    _id: new Types.ObjectId(),
    type: 'provider_escalation' as any,
    actor_id: null,
    message: timelineMsg,
    metadata: { tier: updatedState.current_tier, reason: 'escalation_timeout' },
    timestamp: now,
  } as any);
  await providerIncident.save();

  logger.info('Tier auto-escalated', {
    state_id: state._id.toString(),
    new_tier: updatedState.current_tier,
  });
}

async function notifyBreach(
  state: IncidentSLAStateDocument,
  kind: 'response' | 'resolution',
): Promise<void> {
  const dedupeKey = `${state._id.toString()}:${kind}`;
  const dedupeSet = kind === 'response' ? notifiedResponseBreach : notifiedResolutionBreach;
  if (dedupeSet.has(dedupeKey)) return;
  dedupeSet.add(dedupeKey);

  const incident = await Incident.findById(state.consumer_incident_id);
  if (!incident) return;

  const consumerTenant = await Tenant.findById(state.consumer_tenant_id).lean();
  const consumerName = (consumerTenant as any)?.name || 'consumer';

  const admins = await User.find(
    { tenant_id: state.consumer_tenant_id, roles: { $in: ['admin', 'owner'] } },
    '_id email name',
  ).lean();

  const title = `SLA breach: ${kind === 'response' ? 'Response' : 'Resolution'} time exceeded`;
  const body = `Managed-support incident "${incident.title}" has breached the ${kind} SLA (${consumerName}).`;

  if (admins.length > 0) {
    await createBulkNotifications(
      admins.map((u: any) => ({
        tenant_id: state.consumer_tenant_id,
        user_id: u._id,
        type: 'incident',
        priority: 'critical' as const,
        title,
        body,
        resource_type: 'incident',
        resource_id: incident._id.toString(),
      })),
    );
    for (const u of admins) {
      if (!(u as any).email) continue;
      sendNotificationEmail(
        (u as any).email,
        title,
        body,
        `/incidents/${incident._id}`,
        state.consumer_tenant_id.toString(),
      ).catch((e) => logger.error('SLA breach email failed', { error: e.message }));
    }
  }

  incident.timeline.push({
    _id: new Types.ObjectId(),
    type: 'provider_escalation' as any,
    actor_id: null,
    message: title,
    metadata: { kind, breach: true, state_id: state._id.toString() },
    timestamp: new Date(),
  } as any);
  await incident.save();

  logger.info('SLA breach notified', { state_id: state._id.toString(), kind });
}

// Periodic cleanup of resolved states from dedupe sets.
setInterval(() => {
  if (notifiedResponseBreach.size > 1000) notifiedResponseBreach.clear();
  if (notifiedResolutionBreach.size > 1000) notifiedResolutionBreach.clear();
}, 10 * 60_000);
