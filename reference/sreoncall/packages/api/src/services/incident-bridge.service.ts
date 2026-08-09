import { Types } from 'mongoose';
import { IncidentBridge, IncidentBridgeDocument } from '../models/incident-bridge.model';
import { Incident, IncidentDocument } from '../models/incident.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Tenant } from '../models/tenant.model';
import { SupportContractDocument } from '../models/support-contract.model';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { getCurrentOnCallUsers, getOnCallUsersForSchedules } from './oncall.service';
import { createSlaStateForBridge } from './managed-support.service';
import { createBulkNotifications } from './notification.service';
import { sendNotificationEmail } from './email-notification.service';
import { sendSms } from './sms.service';
import { makeVoiceCall, sendWhatsApp } from './plivo.service';
import * as slackService from './slack.service';
import { notifyIncidentSlack } from './incident-slack.service';
import { TenantIntegration } from '../models/tenant-integration.model';
import { decryptToken } from '../utils/encryption';
import { User } from '../models/user.model';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';

const sc = StringCodec();

export interface CreateBridgeOptions {
  contract?: SupportContractDocument;
}

export async function createBridge(
  consumerTenantId: Types.ObjectId,
  consumerIncidentId: Types.ObjectId,
  providerTenantId: Types.ObjectId,
  options: CreateBridgeOptions = {},
): Promise<IncidentBridgeDocument> {
  // Verify the link exists and is active
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: consumerTenantId,
    provider_tenant_id: providerTenantId,
    status: 'active',
  });
  if (!link) throw AppError.badRequest('No active provider-consumer link found');
  if (!link.scope.includes('escalations')) {
    throw AppError.badRequest('Escalations not in scope for this link');
  }

  // Get the consumer incident
  const consumerIncident = await Incident.findOne({
    _id: consumerIncidentId,
    tenant_id: consumerTenantId,
  });
  if (!consumerIncident) throw AppError.notFound('Consumer incident');

  // Check if bridge already exists
  const existingBridge = await IncidentBridge.findOne({ consumer_incident_id: consumerIncidentId });
  if (existingBridge) throw AppError.conflict('Bridge already exists for this incident');

  // Get consumer tenant name for the provider incident
  const consumerTenant = await Tenant.findById(consumerTenantId);

  // Get the next incident number for the provider tenant
  const lastProviderIncident = await Incident.findOne({ tenant_id: providerTenantId })
    .sort({ number: -1 })
    .select('number');
  const nextNumber = (lastProviderIncident?.number ?? 0) + 1;

  // Create a mirrored incident in provider tenant
  const providerIncident = await Incident.create({
    tenant_id: providerTenantId,
    number: nextNumber,
    title: `[Escalated] ${consumerIncident.title}`,
    description: `Escalated from consumer tenant: ${consumerTenant?.name || 'unknown'}\n\n${consumerIncident.description}`,
    severity: consumerIncident.severity,
    status: 'open',
    source: 'webhook',
    labels: [
      'escalated',
      'consumer-bridge',
      ...(consumerIncident.labels || []).filter((l: string) => l.includes(':')),
    ],
    created_by: consumerIncident.created_by,
    source_consumer_tenant_id: consumerTenantId,
    timeline: [{
      _id: new Types.ObjectId(),
      timestamp: new Date(),
      type: 'provider_escalation',
      actor_id: null,
      message: `Incident escalated from consumer tenant "${consumerTenant?.name || 'unknown'}"`,
      metadata: {
        source_tenant_id: consumerTenantId.toString(),
        source_tenant_name: consumerTenant?.name,
        source_incident_id: consumerIncidentId.toString(),
      },
    }],
  });

  // Page the provider's on-call engineer.
  // With a managed-support contract, page the L1 tier's configured schedule.
  // Without one, use the provider's tenant-wide on-call (legacy behavior).
  // Best-effort: failures are logged but don't block bridge creation.
  try {
    const contract = options.contract;
    const firstTier = contract?.tiers.find((t) => t.level === 1) ?? contract?.tiers[0];
    const firstTierAny = firstTier as any;
    const allFirstTierScheduleIds: import('mongoose').Types.ObjectId[] =
      Array.isArray(firstTierAny?.schedule_ids) && firstTierAny.schedule_ids.length
        ? firstTierAny.schedule_ids
        : firstTier?.schedule_id ? [firstTier.schedule_id] : [];
    const firstTierChannels: string[] = firstTier?.notify_channels ?? ['in_app', 'email'];
    const providerOnCall = allFirstTierScheduleIds.length
      ? await getOnCallUsersForSchedules(allFirstTierScheduleIds, providerTenantId)
      : await getCurrentOnCallUsers(providerTenantId);
    if (providerOnCall.length > 0) {
      // Auto-assign the provider's L1 on-call as commander on the provider incident
      // and mirror it to the consumer incident — so both sides show the same person
      // handling the incident. The consumer commander updates as tiers escalate.
      const providerCommander = new Types.ObjectId(providerOnCall[0].toString());
      providerIncident.commander_id = providerCommander;
      await providerIncident.save();

      // Mark consumer incident as provider-escalated so the UI shows a
      // generic label instead of the provider's internal on-call name.
      // Use findByIdAndUpdate + $set so concurrent saves (e.g. escalation worker)
      // cannot overwrite these fields by saving a stale document copy.
      await Promise.all([
        Incident.findByIdAndUpdate(consumerIncidentId, {
          $set: {
            'custom_fields.provider_escalated': 'true',
            'custom_fields.provider_support_label': 'SReonCall Support',
            'custom_fields.managed_tier': 'L1',
          },
        }),
        Incident.findByIdAndUpdate(providerIncident._id, {
          $set: { 'custom_fields.managed_tier': 'L1' },
        }),
      ]);

      const sevLabel = `SEV${providerIncident.severity}`;
      const incidentNumber = `INC-${String(providerIncident.number).padStart(4, '0')}`;
      const tierLabel = contract ? ' (L1)' : '';
      const notifTitle = `${sevLabel} Escalated from ${consumerTenant?.name || 'consumer'}${tierLabel}: ${consumerIncident.title}`;
      const notifBody = `${incidentNumber} escalated from consumer tenant. You are on-call.`;
      const priority = providerIncident.severity <= 2 ? 'critical' : providerIncident.severity <= 3 ? 'warning' : 'info';

      if (firstTierChannels.includes('in_app')) {
        await createBulkNotifications(
          providerOnCall.map((userId) => ({
            tenant_id: providerTenantId,
            user_id: userId,
            type: 'incident',
            priority: priority as 'critical' | 'warning' | 'info',
            title: notifTitle,
            body: notifBody,
            resource_type: 'incident',
            resource_id: providerIncident._id.toString(),
          })),
        );
      }

      // Outbound channels — driven by L1 tier notify_channels, best-effort
      User.find({ _id: { $in: providerOnCall } }).then(async (users) => {
        for (const user of users) {
          const phone = (user as any).phone_number;
          if (firstTierChannels.includes('email') && user.email) {
            sendNotificationEmail(user.email, notifTitle, notifBody, `/incidents/${providerIncident._id}`, providerTenantId.toString())
              .catch((e) => logger.error('Provider escalation email failed', { error: e.message }));
          }
          if (firstTierChannels.includes('sms') && phone) {
            sendSms(phone, `${notifTitle}\n${notifBody}`)
              .catch((e) => logger.error('Provider escalation SMS failed', { error: e.message }));
          }
          if (firstTierChannels.includes('voice') && phone) {
            makeVoiceCall(phone, `${notifTitle}. ${notifBody}`, {
              incidentId: providerIncident._id.toString(),
              tenantId: providerTenantId.toString(),
              userId: user._id.toString(),
            }).catch((e) => logger.error('Provider escalation voice call failed', { error: e.message }));
          }
          if (firstTierChannels.includes('whatsapp') && phone) {
            sendWhatsApp(phone, `${notifTitle}\n${notifBody}`)
              .catch((e) => logger.error('Provider escalation WhatsApp failed', { error: e.message }));
          }
          if (firstTierChannels.includes('slack') && user.email) {
            try {
              const slackInt = await TenantIntegration.findOne({ tenant_id: providerTenantId, platform: 'slack', is_active: true });
              if (slackInt) {
                const token = decryptToken(slackInt.bot_token_encrypted);
                slackService.sendDirectMessage(token, user.email, `*${notifTitle}*\n${notifBody}`)
                  .catch((e) => logger.error('Provider escalation Slack DM failed', { error: e.message }));
              }
            } catch (e: any) { logger.error('Slack integration lookup failed', { error: e.message }); }
          }
        }
      }).catch((err) => logger.error('Failed to fetch provider on-call users for outbound', { error: err.message }));
    } else {
      logger.warn('Provider has no on-call users for escalated incident', {
        provider_tenant_id: providerTenantId.toString(),
        provider_incident_id: providerIncident._id.toString(),
      });
    }
  } catch (err: any) {
    logger.error('Failed to notify provider on-call users', { error: err.message });
  }

  // Add escalation timeline entry to consumer incident.
  // Use $push so this save cannot overwrite the custom_fields we just wrote
  // via findByIdAndUpdate above (consumerIncident is a stale in-memory copy).
  const contract = options.contract;
  const providerName = await Tenant.findById(providerTenantId, 'name').then((t) => t?.name || 'provider');
  const escalationMessage = contract
    ? `Incident escalated to ${providerName} L1 Support`
    : 'Incident escalated to provider';
  await Incident.findByIdAndUpdate(consumerIncidentId, {
    $push: {
      timeline: {
        _id: new Types.ObjectId(),
        timestamp: new Date(),
        type: 'provider_escalation',
        actor_id: null,
        message: escalationMessage,
        metadata: {
          bridge_id: null,
          provider_tenant_id: providerTenantId.toString(),
          contract_id: contract?._id.toString() || null,
          tier: contract ? 1 : null,
        },
      },
    },
  });

  // Create the bridge record
  const bridge = await IncidentBridge.create({
    consumer_tenant_id: consumerTenantId,
    consumer_incident_id: consumerIncidentId,
    provider_tenant_id: providerTenantId,
    provider_incident_id: providerIncident._id,
    status: 'active',
    escalated_at: new Date(),
  });

  // For managed-support contracts, seed the SLA state so the timer worker
  // can track response/resolution deadlines and tier escalation timeouts.
  if (contract) {
    try {
      await createSlaStateForBridge({
        contract,
        bridgeId: bridge._id,
        consumerIncidentId,
        providerIncidentId: providerIncident._id,
        consumerTenantId,
        providerTenantId,
        severity: consumerIncident.severity,
        startedAt: bridge.escalated_at,
      });
    } catch (err) {
      logger.error('Failed to create IncidentSLAState for managed-support bridge', {
        error: (err as Error).message,
        contract_id: contract._id.toString(),
        bridge_id: bridge._id.toString(),
      });
    }
  }

  // Notify the provider's Slack channel about the new escalated incident
  notifyIncidentSlack(providerTenantId, providerIncident, 'created').catch((err) =>
    logger.error('Failed to notify provider Slack channel for bridge incident', { error: err.message }),
  );

  // Publish bridge creation event
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.created',
      sc.encode(JSON.stringify({
        bridge_id: bridge._id.toString(),
        consumer_tenant_id: consumerTenantId.toString(),
        consumer_incident_id: consumerIncidentId.toString(),
        provider_tenant_id: providerTenantId.toString(),
        provider_incident_id: providerIncident._id.toString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish bridge creation event', { error: (err as Error).message });
  }

  return bridge;
}

export async function syncToProvider(bridgeId: string, action: string, data?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.sync.to_provider',
      sc.encode(JSON.stringify({
        bridge_id: bridgeId,
        action,
        data,
        event_id: new Types.ObjectId().toString(),
        timestamp: new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish bridge sync to provider', { error: (err as Error).message });
  }
}

export async function syncToConsumer(bridgeId: string, action: string, data?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.sync.to_consumer',
      sc.encode(JSON.stringify({
        bridge_id: bridgeId,
        action,
        data,
        event_id: new Types.ObjectId().toString(),
        timestamp: new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish bridge sync to consumer', { error: (err as Error).message });
  }
}

export async function resolveBridge(bridgeId: string): Promise<IncidentBridgeDocument> {
  const bridge = await IncidentBridge.findById(bridgeId);
  if (!bridge) throw AppError.notFound('Incident bridge');

  bridge.status = 'resolved';
  bridge.resolved_at = new Date();
  await bridge.save();

  return bridge;
}

export async function getBridgeByConsumerIncident(incidentId: string): Promise<IncidentBridgeDocument | null> {
  return IncidentBridge.findOne({ consumer_incident_id: new Types.ObjectId(incidentId) });
}

export async function getBridgeByProviderIncident(incidentId: string): Promise<IncidentBridgeDocument | null> {
  return IncidentBridge.findOne({ provider_incident_id: new Types.ObjectId(incidentId) });
}

export async function listBridgesForProvider(
  providerTenantId: Types.ObjectId,
  pagination: PaginationParams,
): Promise<PaginatedResult<IncidentBridgeDocument>> {
  const baseFilter = { provider_tenant_id: providerTenantId };
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await IncidentBridge.find(cursorFilter)
    .populate('consumer_incident_id', 'number title severity status')
    .populate('provider_incident_id', 'number title severity status')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await IncidentBridge.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function listBridgesForTenant(
  tenantId: Types.ObjectId,
  pagination: PaginationParams,
): Promise<PaginatedResult<IncidentBridgeDocument>> {
  const baseFilter = {
    $or: [
      { consumer_tenant_id: tenantId },
      { provider_tenant_id: tenantId },
    ],
  };
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await IncidentBridge.find(cursorFilter)
    .populate('consumer_incident_id', 'number title severity status')
    .populate('provider_incident_id', 'number title severity status')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await IncidentBridge.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}
