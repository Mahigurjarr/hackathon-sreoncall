/**
 * Tier dispatch: pages on-call + notifies the right side once a tier has been
 * flipped on the IncidentSLAState. Called from:
 *   - sla-timer.worker.autoEscalateTier   (after timeout-driven escalation)
 *   - bridge.routes "POST /escalate-tier" (after manual escalation)
 *
 * The escalateTier call (in managed-support.service) is what actually flips
 * state.current_tier and updates tier_history. This service handles the
 * downstream side effects: schedule pages, in-app notifications, emails,
 * Slack messages, and timeline entries.
 */

import { Types } from 'mongoose';
import { IncidentSLAStateDocument } from '../models/incident-sla-state.model';
import { Incident } from '../models/incident.model';
import { User } from '../models/user.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { SupportContract } from '../models/support-contract.model';
import { startSchedulePage, cancelSchedulePagesForIncident } from './schedule-page.service';
import { createBulkNotifications } from './notification.service';
import { sendNotificationEmail } from './email-notification.service';
import { notifyIncidentSlack } from './incident-slack.service';
import { logger } from '../utils/logger';

export async function dispatchTierPaging(
  state: IncidentSLAStateDocument,
  previousTier: number,
  nextTierScheduleIds: Types.ObjectId[],
  reasonLabel: string,
  now: Date = new Date(),
): Promise<{ pagedUserCount: number; pagedTenantId: Types.ObjectId; handedOffToConsumer: boolean }> {
  // Close out any active schedule pages from the previous tier.
  await cancelSchedulePagesForIncident(state.provider_incident_id, 'canceled', {
    tierLevel: previousTier as 1 | 2 | 3,
  }, now);

  // Determine which tenant owns the next tier's schedules.
  const nextTierSchedules = await OnCallSchedule.find({ _id: { $in: nextTierScheduleIds } })
    .select('tenant_id')
    .lean();
  const scheduleTenantIds = new Set(nextTierSchedules.map((s) => s.tenant_id.toString()));
  const pagedTenantId =
    scheduleTenantIds.size === 1 && !scheduleTenantIds.has(state.provider_tenant_id.toString())
      ? new Types.ObjectId(Array.from(scheduleTenantIds)[0]!)
      : state.provider_tenant_id;
  const handedOffToConsumer = pagedTenantId.toString() === state.consumer_tenant_id.toString();

  // Start sequential schedule pages on the right tenant.
  const seen = new Set<string>();
  const newOnCall: Types.ObjectId[] = [];
  for (const sid of nextTierScheduleIds) {
    const result = await startSchedulePage(
      sid,
      handedOffToConsumer ? state.consumer_incident_id : state.provider_incident_id,
      pagedTenantId,
      { tierLevel: state.current_tier as 1 | 2 | 3 },
      now,
    );
    if (result.user_id) {
      const k = result.user_id.toString();
      if (!seen.has(k)) {
        seen.add(k);
        newOnCall.push(result.user_id);
      }
    }
  }

  const providerIncident = await Incident.findById(state.provider_incident_id);
  if (!providerIncident) return { pagedUserCount: 0, pagedTenantId, handedOffToConsumer };

  const tierLabel = `L${state.current_tier}`;

  // Update the consumer's provider_handover so the consumer-side UI reflects
  // which tier (label) and which actual on-call person (current_user) is
  // handling the incident. Consumer's UI prefers showing the person; provider
  // sees the tier name in its Managed Support panel.
  try {
    const contract = await SupportContract.findById(state.contract_id);
    const tier = contract?.tiers.find((t) => t.level === state.current_tier);
    const tierName = tier?.name || `L${state.current_tier}`;

    const setOps: Record<string, unknown> = {
      'provider_handover.tier': state.current_tier,
      'provider_handover.label': tierName,
    };
    // Only expose the on-call engineer's name on the consumer side when the
    // tier's schedule belongs to the CONSUMER's tenant (their own team).
    // Provider-side tiers keep current_user null so the consumer doesn't see
    // the provider's individual engineer names rotating through their UI.
    if (handedOffToConsumer && newOnCall.length > 0) {
      const firstUser = await User.findById(newOnCall[0]).select('name').lean();
      if (firstUser) {
        setOps['provider_handover.current_user_id'] = newOnCall[0];
        setOps['provider_handover.current_user_name'] = (firstUser as any).name || 'On-call user';
      }
    } else {
      // Tier moved back to provider — clear any consumer-side user that was
      // populated when a previous tier was on the consumer.
      setOps['provider_handover.current_user_id'] = null;
      setOps['provider_handover.current_user_name'] = null;
    }
    await Incident.updateOne({ _id: state.consumer_incident_id }, { $set: setOps });
  } catch (err) {
    logger.warn('Failed to update consumer provider_handover on tier escalation', {
      state_id: state._id.toString(),
      error: (err as Error).message,
    });
  }

  // Slack: post to the newly active tenant's channels even if no users were
  // found (the message itself is still useful context for the channel).
  notifyIncidentSlack(pagedTenantId, handedOffToConsumer
    ? (await Incident.findById(state.consumer_incident_id)) ?? providerIncident
    : providerIncident, 'status_changed', {
    prevStatus: previousTier ? `L${previousTier}` : 'pending',
    newStatus: `${tierLabel} on-call (${reasonLabel})`,
  }).catch((err) => logger.warn('Tier dispatch Slack notification failed', { error: err.message, tenantId: pagedTenantId.toString() }));

  if (handedOffToConsumer) {
    notifyIncidentSlack(state.provider_tenant_id, providerIncident, 'status_changed', {
      prevStatus: `L${previousTier}`,
      newStatus: `Handed off to ${tierLabel} (${reasonLabel})`,
    }).catch((err) => logger.warn('Provider handoff Slack notification failed', { error: err.message }));
  }

  if (newOnCall.length === 0) {
    logger.warn('Tier dispatch: no on-call primary across target schedules', {
      state_id: state._id.toString(),
      tier: state.current_tier,
      schedule_ids: nextTierScheduleIds.map((id) => id.toString()),
    });
    return { pagedUserCount: 0, pagedTenantId, handedOffToConsumer };
  }

  const sev = providerIncident.severity;
  const sevLabel = `SEV-${sev}`;
  const sevName = ({ 1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW', 5: 'INFO' } as Record<number, string>)[sev] || '';
  const incidentNumber = `INC-${String(providerIncident.number).padStart(4, '0')}`;
  // Fetch the customer name from the consumer tenant so the message identifies
  // whose incident this is on the consumer-tier side.
  const consumerName = await Incident.findById(state.consumer_incident_id)
    .populate({ path: 'tenant_id', select: 'name' })
    .lean()
    .then((c: any) => c?.tenant_id?.name as string | undefined)
    .catch(() => undefined);
  const customer = consumerName || 'managed customer';

  const title = `[${sevLabel} ${sevName}] Escalated to ${tierLabel} for ${customer}: ${providerIncident.title}`;
  const body = [
    `A ${sevLabel} (${sevName}) incident from ${customer} has been escalated to ${tierLabel} (${reasonLabel}).`,
    `${incidentNumber} — ${providerIncident.title}`,
    `You are now the responsible tier. Please acknowledge and resolve, or escalate to the next tier if needed.`,
  ].join('\n\n');
  const priority = sev <= 2 ? 'critical' : sev <= 3 ? 'warning' : 'info';

  const pagedIncident = handedOffToConsumer
    ? (await Incident.findById(state.consumer_incident_id)) ?? providerIncident
    : providerIncident;

  await createBulkNotifications(
    newOnCall.map((userId) => ({
      tenant_id: pagedTenantId,
      user_id: userId,
      type: 'incident',
      priority: priority as 'critical' | 'warning' | 'info',
      title,
      body,
      resource_type: 'incident',
      resource_id: pagedIncident._id.toString(),
    })),
  );

  User.find({ _id: { $in: newOnCall } })
    .then((users) => {
      for (const u of users) {
        if (!u.email) continue;
        sendNotificationEmail(
          u.email,
          title,
          body,
          `/incidents/${pagedIncident._id}`,
          pagedTenantId.toString(),
        ).catch((e) =>
          logger.error('Tier dispatch email failed', { error: e.message }),
        );
      }
    })
    .catch((err) => logger.error('Failed to fetch users for tier dispatch email', { error: err.message }));

  return { pagedUserCount: newOnCall.length, pagedTenantId, handedOffToConsumer };
}
