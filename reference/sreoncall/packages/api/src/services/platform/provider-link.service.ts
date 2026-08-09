import { Types } from 'mongoose';
import { ProviderConsumerLink, ProviderConsumerLinkDocument } from '../../models/provider-consumer-link.model';
import { Tenant } from '../../models/tenant.model';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../../utils/pagination';
import { AppError } from '../../middleware/errorHandler.middleware';

interface LinkFilter {
  provider_tenant_id?: string;
  consumer_tenant_id?: string;
  status?: string;
}

export async function listLinks(
  filter: LinkFilter,
  pagination: PaginationParams,
): Promise<PaginatedResult<ProviderConsumerLinkDocument>> {
  const baseFilter: Record<string, any> = {};
  if (filter.provider_tenant_id) baseFilter.provider_tenant_id = new Types.ObjectId(filter.provider_tenant_id);
  if (filter.consumer_tenant_id) baseFilter.consumer_tenant_id = new Types.ObjectId(filter.consumer_tenant_id);
  if (filter.status) baseFilter.status = filter.status;

  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await ProviderConsumerLink.find(cursorFilter)
    .populate('provider_tenant_id', 'slug name type')
    .populate('consumer_tenant_id', 'slug name type')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await ProviderConsumerLink.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function createLink(
  providerTenantId: string,
  consumerTenantId: string,
  scope: string[],
  createdBy: Types.ObjectId,
): Promise<ProviderConsumerLinkDocument> {
  const [provider, consumer] = await Promise.all([
    Tenant.findById(providerTenantId),
    Tenant.findById(consumerTenantId),
  ]);

  if (!provider) throw AppError.notFound('Provider tenant');
  if (!consumer) throw AppError.notFound('Consumer tenant');
  if (provider.type !== 'provider') throw AppError.badRequest('Tenant is not a provider');
  if (consumer.type !== 'consumer') throw AppError.badRequest('Tenant is not a consumer');

  const existing = await ProviderConsumerLink.findOne({
    consumer_tenant_id: new Types.ObjectId(consumerTenantId),
  });
  if (existing) throw AppError.conflict('Consumer already linked to a provider');

  return ProviderConsumerLink.create({
    provider_tenant_id: new Types.ObjectId(providerTenantId),
    consumer_tenant_id: new Types.ObjectId(consumerTenantId),
    status: 'active',
    scope,
    created_by: createdBy,
  });
}

export async function updateLink(
  linkId: string,
  update: Partial<{ status: string; scope: string[] }>,
): Promise<ProviderConsumerLinkDocument> {
  const link = await ProviderConsumerLink.findById(linkId);
  if (!link) throw AppError.notFound('Provider-consumer link');

  if (update.status !== undefined) link.status = update.status as any;
  if (update.scope !== undefined) link.scope = update.scope;

  await link.save();
  return link;
}

export async function deleteLink(linkId: string): Promise<void> {
  const result = await ProviderConsumerLink.deleteOne({ _id: linkId });
  if (result.deletedCount === 0) throw AppError.notFound('Provider-consumer link');
}
