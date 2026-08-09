import { Types } from 'mongoose';
import { ProviderConsumerLink, ProviderConsumerLinkDocument } from '../models/provider-consumer-link.model';
import { Tenant } from '../models/tenant.model';
import { Incident } from '../models/incident.model';
import { Ticket } from '../models/ticket.model';
import { ChangeRequest } from '../models/change-request.model';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';

export async function getLinkedConsumers(
  providerTenantId: Types.ObjectId,
  pagination: PaginationParams,
) {
  const baseFilter = { provider_tenant_id: providerTenantId, status: 'active' };
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const links = await ProviderConsumerLink.find(cursorFilter)
    .populate('consumer_tenant_id', 'slug name type status plan')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await ProviderConsumerLink.countDocuments(baseFilter);
  return paginateResults(links, paginationWithDefaults, total);
}

export async function getConsumerDetail(
  providerTenantId: Types.ObjectId,
  consumerTenantId: string,
) {
  const link = await ProviderConsumerLink.findOne({
    provider_tenant_id: providerTenantId,
    consumer_tenant_id: new Types.ObjectId(consumerTenantId),
    status: 'active',
  }).populate('consumer_tenant_id', 'slug name type status plan');

  if (!link) throw AppError.notFound('Consumer link');

  const openIncidents = await Incident.countDocuments({
    tenant_id: new Types.ObjectId(consumerTenantId),
    status: { $nin: ['resolved', 'closed'] },
  });

  return { link, open_incidents: openIncidents };
}

export async function getConsumerIncidents(
  providerTenantId: Types.ObjectId,
  consumerTenantId?: string,
  pagination?: PaginationParams,
) {
  const links = consumerTenantId
    ? [await ProviderConsumerLink.findOne({
        provider_tenant_id: providerTenantId,
        consumer_tenant_id: new Types.ObjectId(consumerTenantId),
        status: 'active',
      })]
    : await ProviderConsumerLink.find({
        provider_tenant_id: providerTenantId,
        status: 'active',
      });

  const validLinks = links.filter(Boolean);
  if (!validLinks.length) return { data: [], pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 20, total: 0 } };

  const consumerIds = validLinks.map((l) => l!.consumer_tenant_id);
  const pag = pagination || { limit: 20 };

  const incidents = await Incident.find({
    tenant_id: { $in: consumerIds },
    status: { $nin: ['resolved', 'closed'] },
  })
    .sort({ createdAt: -1 })
    .limit(pag.limit);

  const total = await Incident.countDocuments({
    tenant_id: { $in: consumerIds },
    status: { $nin: ['resolved', 'closed'] },
  });

  return {
    data: incidents,
    pagination: { next_cursor: null, prev_cursor: null, has_more: incidents.length >= pag.limit, limit: pag.limit, total },
  };
}

export async function getConsumerTickets(
  providerTenantId: Types.ObjectId,
  consumerTenantId?: string,
  pagination?: PaginationParams,
) {
  const links = consumerTenantId
    ? [await ProviderConsumerLink.findOne({
        provider_tenant_id: providerTenantId,
        consumer_tenant_id: new Types.ObjectId(consumerTenantId),
        status: 'active',
      })]
    : await ProviderConsumerLink.find({
        provider_tenant_id: providerTenantId,
        status: 'active',
      });

  const validLinks = links.filter(Boolean);
  if (!validLinks.length) return { data: [], pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 20, total: 0 } };

  const consumerIds = validLinks.map((l) => l!.consumer_tenant_id);
  const pag = pagination || { limit: 20 };

  const tickets = await Ticket.find({
    tenant_id: { $in: consumerIds },
    status: { $nin: ['done', 'cancelled'] },
  })
    .populate('tenant_id', 'name slug')
    .sort({ createdAt: -1 })
    .limit(pag.limit);

  const total = await Ticket.countDocuments({
    tenant_id: { $in: consumerIds },
    status: { $nin: ['done', 'cancelled'] },
  });

  return {
    data: tickets,
    pagination: { next_cursor: null, prev_cursor: null, has_more: tickets.length >= pag.limit, limit: pag.limit, total },
  };
}

export async function getConsumerChangeRequests(
  providerTenantId: Types.ObjectId,
  consumerTenantId?: string,
  pagination?: PaginationParams,
) {
  const links = consumerTenantId
    ? [await ProviderConsumerLink.findOne({
        provider_tenant_id: providerTenantId,
        consumer_tenant_id: new Types.ObjectId(consumerTenantId),
        status: 'active',
      })]
    : await ProviderConsumerLink.find({
        provider_tenant_id: providerTenantId,
        status: 'active',
      });

  const validLinks = links.filter(Boolean);
  if (!validLinks.length) return { data: [], pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 20, total: 0 } };

  const consumerIds = validLinks.map((l) => l!.consumer_tenant_id);
  const pag = pagination || { limit: 20 };

  const changes = await ChangeRequest.find({
    tenant_id: { $in: consumerIds },
    status: { $nin: ['completed', 'cancelled', 'rolled_back'] },
  })
    .sort({ createdAt: -1 })
    .limit(pag.limit);

  const total = await ChangeRequest.countDocuments({
    tenant_id: { $in: consumerIds },
    status: { $nin: ['completed', 'cancelled', 'rolled_back'] },
  });

  return {
    data: changes,
    pagination: { next_cursor: null, prev_cursor: null, has_more: changes.length >= pag.limit, limit: pag.limit, total },
  };
}

export async function updateConsumerScope(
  providerTenantId: Types.ObjectId,
  consumerTenantId: string,
  scope: string[],
): Promise<ProviderConsumerLinkDocument> {
  const link = await ProviderConsumerLink.findOneAndUpdate(
    {
      provider_tenant_id: providerTenantId,
      consumer_tenant_id: new Types.ObjectId(consumerTenantId),
      status: { $in: ['active', 'pending'] },
    },
    { $set: { scope } },
    { new: true },
  ).populate('consumer_tenant_id', 'slug name');

  if (!link) throw AppError.notFound('Consumer link');
  return link;
}
