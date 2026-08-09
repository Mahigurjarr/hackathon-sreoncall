import { Types } from 'mongoose';
import { TicketBridge, TicketBridgeDocument } from '../models/ticket-bridge.model';
import { Ticket } from '../models/ticket.model';
import { Project } from '../models/project.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Tenant } from '../models/tenant.model';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { WorkLog } from '../models/work-log.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import * as ticketService from './ticket.service';

const sc = StringCodec();

export async function createTicketBridge(
  consumerTenantId: Types.ObjectId,
  consumerTicketId: Types.ObjectId,
  providerTenantId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<TicketBridgeDocument> {
  // Verify the link exists and is active
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: consumerTenantId,
    provider_tenant_id: providerTenantId,
    status: 'active',
  });
  if (!link) throw AppError.badRequest('No active provider-consumer link found');
  if (!link.scope.includes('tickets')) {
    throw AppError.badRequest('Tickets not in scope for this link');
  }

  // Get the consumer ticket
  const consumerTicket = await ticketService.getTicketById(consumerTenantId, consumerTicketId.toString());
  if (!consumerTicket) throw AppError.notFound('Consumer ticket');

  // Check if bridge already exists
  const existingBridge = await TicketBridge.findOne({ consumer_ticket_id: consumerTicketId });
  if (existingBridge) throw AppError.conflict('Bridge already exists for this ticket');

  // Get consumer tenant name
  const consumerTenant = await Tenant.findById(consumerTenantId);

  // Find provider's Default Project
  const defaultProject = await Project.findOne({
    tenant_id: providerTenantId,
    name: 'Default',
    deleted_at: null,
  });
  if (!defaultProject) throw AppError.badRequest('Provider tenant has no Default project');

  // Create mirrored ticket in provider tenant
  const providerTicket = await ticketService.createTicket({
    tenant_id: providerTenantId,
    project_id: defaultProject._id.toString(),
    type: consumerTicket.type,
    title: `[Escalated] ${consumerTicket.title}`,
    description: `Escalated from consumer tenant: ${consumerTenant?.name || 'unknown'}\n\nOriginal description:\n${consumerTicket.description || 'N/A'}`,
    priority: consumerTicket.priority,
    reporter_id: userId,
    labels: ['escalated', 'consumer-bridge'],
    custom_fields: { escalated_from: consumerTenant?.name || 'unknown' },
  });

  // Create the bridge record
  const bridge = await TicketBridge.create({
    consumer_tenant_id: consumerTenantId,
    consumer_ticket_id: consumerTicketId,
    provider_tenant_id: providerTenantId,
    provider_ticket_id: providerTicket._id,
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
        bridge_type: 'ticket',
        consumer_tenant_id: consumerTenantId.toString(),
        consumer_ticket_id: consumerTicketId.toString(),
        provider_tenant_id: providerTenantId.toString(),
        provider_ticket_id: providerTicket._id.toString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish ticket bridge creation event', { error: (err as Error).message });
  }

  return bridge;
}

export async function linkProviderTicketToConsumer(
  providerTenantId: Types.ObjectId,
  providerTicketId: Types.ObjectId,
  consumerTenantId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<TicketBridgeDocument> {
  // Verify the link exists and is active
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: consumerTenantId,
    provider_tenant_id: providerTenantId,
    status: 'active',
  });
  if (!link) throw AppError.badRequest('No active provider-consumer link found');
  if (!link.scope.includes('tickets')) {
    throw AppError.badRequest('Tickets not in scope for this link');
  }

  // Get the provider ticket
  const providerTicket = await ticketService.getTicketById(providerTenantId, providerTicketId.toString());
  if (!providerTicket) throw AppError.notFound('Provider ticket');

  // Check if bridge already exists for this provider ticket
  const existingBridge = await TicketBridge.findOne({ provider_ticket_id: providerTicketId });
  if (existingBridge) throw AppError.conflict('Bridge already exists for this ticket');

  // Get provider tenant name
  const providerTenant = await Tenant.findById(providerTenantId);

  // Find consumer's first project
  const consumerProject = await Project.findOne({
    tenant_id: consumerTenantId,
    deleted_at: null,
  }).sort({ createdAt: 1 });
  if (!consumerProject) throw AppError.badRequest('Consumer tenant has no projects configured');

  // Create mirrored ticket in consumer tenant
  const consumerTicket = await ticketService.createTicket({
    tenant_id: consumerTenantId,
    project_id: consumerProject._id.toString(),
    type: providerTicket.type,
    title: providerTicket.title,
    description: providerTicket.description || '',
    priority: providerTicket.priority,
    reporter_id: userId,
    labels: [...(providerTicket.labels || []), 'provider-linked'],
    custom_fields: { created_by_provider: providerTenant?.name || 'unknown' },
  });

  // Create the bridge record
  const bridge = await TicketBridge.create({
    consumer_tenant_id: consumerTenantId,
    consumer_ticket_id: consumerTicket._id,
    provider_tenant_id: providerTenantId,
    provider_ticket_id: providerTicketId,
    status: 'open',
    escalated_at: new Date(),
  });

  // Copy existing work logs from provider ticket to consumer ticket
  try {
    const providerWorkLogs = await WorkLog.find({
      tenant_id: providerTenantId,
      entity_type: 'ticket',
      entity_id: providerTicketId,
    });

    if (providerWorkLogs.length > 0) {
      const { User } = await import('../models/user.model');
      const embeddedLogs: Array<{ _id: Types.ObjectId; user_id: Types.ObjectId; minutes: number; description: string; logged_at: Date }> = [];

      for (const wl of providerWorkLogs) {
        const user = await User.findById(wl.user_id, 'name');
        const userName = (user as any)?.name || 'Provider User';

        const consumerLog = await WorkLog.create({
          tenant_id: consumerTenantId,
          entity_type: 'ticket',
          entity_id: consumerTicket._id,
          user_id: new Types.ObjectId('000000000000000000000000'),
          duration_minutes: wl.duration_minutes,
          description: wl.description || '',
          logged_at: wl.logged_at,
          status: wl.status,
          source: 'provider',
          source_tenant_id: providerTenantId,
          source_work_log_id: wl._id,
          source_user_name: userName,
          billable: wl.billable,
        });

        embeddedLogs.push({
          _id: consumerLog._id,
          user_id: consumerLog.user_id,
          minutes: wl.duration_minutes,
          description: wl.description || '',
          logged_at: wl.logged_at,
        });
      }

      // Update consumer ticket's embedded work_logs and time_spent_minutes
      const totalMinutes = providerWorkLogs.reduce((sum, wl) => sum + wl.duration_minutes, 0);
      await Ticket.findOneAndUpdate(
        { _id: consumerTicket._id, tenant_id: consumerTenantId },
        {
          $push: { work_logs: { $each: embeddedLogs } },
          $inc: { time_spent_minutes: totalMinutes },
        },
      );
    }
  } catch (err) {
    logger.warn('Failed to copy work logs to consumer ticket', { error: (err as Error).message });
  }

  // Publish bridge creation event
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.created',
      sc.encode(JSON.stringify({
        bridge_id: bridge._id.toString(),
        bridge_type: 'ticket',
        consumer_tenant_id: consumerTenantId.toString(),
        consumer_ticket_id: consumerTicket._id.toString(),
        provider_tenant_id: providerTenantId.toString(),
        provider_ticket_id: providerTicketId.toString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish ticket bridge creation event (link-to-consumer)', { error: (err as Error).message });
  }

  return bridge;
}

export async function syncTicketToProvider(bridgeId: string, action: string, data?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.sync.to_provider',
      sc.encode(JSON.stringify({
        bridge_id: bridgeId,
        bridge_type: 'ticket',
        action,
        data,
        event_id: new Types.ObjectId().toString(),
        timestamp: new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish ticket bridge sync to provider', { error: (err as Error).message });
  }
}

export async function syncTicketToConsumer(bridgeId: string, action: string, data?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'bridges.sync.to_consumer',
      sc.encode(JSON.stringify({
        bridge_id: bridgeId,
        bridge_type: 'ticket',
        action,
        data,
        event_id: new Types.ObjectId().toString(),
        timestamp: new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn('Failed to publish ticket bridge sync to consumer', { error: (err as Error).message });
  }
}

export async function resolveTicketBridge(bridgeId: string): Promise<TicketBridgeDocument> {
  const bridge = await TicketBridge.findById(bridgeId);
  if (!bridge) throw AppError.notFound('Ticket bridge');

  bridge.status = 'resolved';
  bridge.resolved_at = new Date();
  await bridge.save();

  return bridge;
}

export async function getBridgeByConsumerTicket(ticketId: string): Promise<TicketBridgeDocument | null> {
  return TicketBridge.findOne({ consumer_ticket_id: new Types.ObjectId(ticketId) });
}

export async function getBridgeByProviderTicket(ticketId: string): Promise<TicketBridgeDocument | null> {
  return TicketBridge.findOne({ provider_ticket_id: new Types.ObjectId(ticketId) });
}

export async function listTicketBridgesForTenant(
  tenantId: Types.ObjectId,
  pagination: PaginationParams,
): Promise<PaginatedResult<TicketBridgeDocument>> {
  const baseFilter = {
    $or: [
      { consumer_tenant_id: tenantId },
      { provider_tenant_id: tenantId },
    ],
  };
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await TicketBridge.find(cursorFilter)
    .populate('consumer_ticket_id', 'number title type status priority')
    .populate('provider_ticket_id', 'number title type status priority')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await TicketBridge.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}
