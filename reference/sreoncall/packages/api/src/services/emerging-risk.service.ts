import { EmergingRisk } from '../models/emerging-risk.model';
import { AppError } from '../middleware/errorHandler.middleware';

export interface ListEmergingRiskFilter {
  service_id?: string;
  risk_type?: string;
  severity?: string;
  active_only?: boolean;
  limit?: number;
  cursor?: string;
}

export async function list(tenantId: string, filter: ListEmergingRiskFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };

  // By default only show active (non-cleared) risks
  if (filter.active_only !== false) {
    query.cleared_at = null;
  }
  if (filter.service_id) query.service_id = filter.service_id;
  if (filter.risk_type) query.risk_type = filter.risk_type;
  if (filter.severity) query.severity = filter.severity;
  if (filter.cursor) query._id = { $gt: filter.cursor };

  const docs = await EmergingRisk.find(query)
    .populate('service_id', 'name')
    .sort({ created_at: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
    },
  };
}

export async function getById(tenantId: string, id: string) {
  const doc = await EmergingRisk.findOne({ _id: id, tenant_id: tenantId })
    .populate('service_id', 'name')
    .lean();
  if (!doc) throw AppError.notFound('Emerging risk');
  return doc;
}

export async function dismiss(tenantId: string, id: string, reason: string) {
  const doc = await EmergingRisk.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, cleared_at: null },
    {
      $set: {
        cleared_at: new Date(),
        dismissed_reason: reason,
      },
    },
    { new: true },
  );
  if (!doc) throw AppError.notFound('Emerging risk');
  return doc;
}
