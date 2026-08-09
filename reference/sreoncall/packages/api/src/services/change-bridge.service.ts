import { Types } from 'mongoose';
import { ChangeRequestBridge, ChangeRequestBridgeDocument } from '../models/change-request-bridge.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Tenant } from '../models/tenant.model';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import * as changeService from './change.service';

const sc = StringCodec();

export async function createChangeBridge(
  consumerTenantId: Types.ObjectId,
  consumerChangeId: Types.ObjectId,
  providerTenantId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<ChangeRequestBridgeDocument> {
  // Verify the link exists and is active
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: consumerTenantId,
    provider_tenant_id: providerTenantId,
    status: 'active',
  });
  if (!link) throw AppError.badRequest('No active provider-consumer link found');
  if (!link.scope.includes('changes')) {
    throw AppError.badRequest('Changes not in scope for this link');
  }

  // Get the consumer change request
  const consumerChange = await changeService.getChangeById(consumerTenantId, consumerChangeId.toString());
  if (!consumerChange) throw AppError.notFound('Consumer change request');

  // Check if bridge already exists
  const existingBridge = await ChangeRequestBridge.findOne({ consumer_change_id: consumerChangeId });
  if (existingBridge) throw AppError.conflict('Bridge already exists for this change request');

  // Get consumer tenant name
  const consumerTenant = await Tenant.findById(consumerTenantId);

  // Create mirrored change request in provider tenant
  const providerChange = await changeService.createChange({
    tenant_id: providerTenantId,
    title: `[Escalated] ${consumerChange.title}`,
    description: `Escalated from consumer tenant: ${consumerTenant?.name || 'unknown'}\n\n${consumerChange.description || ''}`,
    justification: consumerChange.justification || '',
    rollback_plan: consumerChange.rollback_plan || '',
    type: consumerChange.type,
    labels: ['escalated', 'consumer-bridge'],
    created_by: userId,
  });

  // Create the bridge record
  const bridge = await ChangeRequestBridge.create({
    consumer_tenant_id: consumerTenantId,
    consumer_change_id: consumerChangeId,
    provider_tenant_id: providerTenantId,
    provider_change_id: providerChange._id,
    status: 'open',
    escalated_at: new Date(),
  });

  // Publish bridge creation event
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.created',
      sc.encode(JSON.stringify({
        bridge_id: bridge._id.toString(),
        bridge_type: 'change',
        consumer_tenant_id: consumerTenantId.toString(),
        consumer_change_id: consumerChangeId.toString(),
        provider_tenant_id: providerTenantId.toString(),
        provider_change_id: providerChange._id.toString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish change bridge creation event', { error: (err as Error).message });
  }

  return bridge;
}

export async function syncChangeToProvider(bridgeId: string, action: string, data?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.sync.to_provider',
      sc.encode(JSON.stringify({
        bridge_id: bridgeId,
        bridge_type: 'change',
        action,
        data,
        event_id: new Types.ObjectId().toString(),
        timestamp: new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish change bridge sync to provider', { error: (err as Error).message });
  }
}

export async function syncChangeToConsumer(bridgeId: string, action: string, data?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.sync.to_consumer',
      sc.encode(JSON.stringify({
        bridge_id: bridgeId,
        bridge_type: 'change',
        action,
        data,
        event_id: new Types.ObjectId().toString(),
        timestamp: new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish change bridge sync to consumer', { error: (err as Error).message });
  }
}

export async function resolveChangeBridge(bridgeId: string): Promise<ChangeRequestBridgeDocument> {
  const bridge = await ChangeRequestBridge.findById(bridgeId);
  if (!bridge) throw AppError.notFound('Change request bridge');

  bridge.status = 'resolved';
  bridge.resolved_at = new Date();
  await bridge.save();

  return bridge;
}

export async function getBridgeByConsumerChange(changeId: string): Promise<ChangeRequestBridgeDocument | null> {
  return ChangeRequestBridge.findOne({ consumer_change_id: new Types.ObjectId(changeId) });
}

export async function getBridgeByProviderChange(changeId: string): Promise<ChangeRequestBridgeDocument | null> {
  return ChangeRequestBridge.findOne({ provider_change_id: new Types.ObjectId(changeId) });
}

export async function listChangeBridgesForTenant(
  tenantId: Types.ObjectId,
  pagination: PaginationParams,
): Promise<PaginatedResult<ChangeRequestBridgeDocument>> {
  const baseFilter = {
    $or: [
      { consumer_tenant_id: tenantId },
      { provider_tenant_id: tenantId },
    ],
  };
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await ChangeRequestBridge.find(cursorFilter)
    .populate('consumer_change_id', 'number title type status')
    .populate('provider_change_id', 'number title type status')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await ChangeRequestBridge.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}
