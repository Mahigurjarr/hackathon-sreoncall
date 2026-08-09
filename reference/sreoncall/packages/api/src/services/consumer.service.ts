import { Types } from 'mongoose';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { AppError } from '../middleware/errorHandler.middleware';

export async function getMyProvider(consumerTenantId: Types.ObjectId) {
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: consumerTenantId,
    status: { $in: ['active', 'pending'] },
  }).populate('provider_tenant_id', 'slug name type status');

  if (!link) throw AppError.notFound('No provider linked to this tenant');

  return {
    link,
    provider: link.provider_tenant_id,
    scope: link.scope,
    status: link.status,
  };
}
