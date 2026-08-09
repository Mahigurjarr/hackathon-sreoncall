import { Types } from 'mongoose';
import { AuditLog, AuditLogDocument, AuditActor, AuditChange } from '../models/audit-log.model';
import { Tenant } from '../models/tenant.model';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { anonymizeIp } from '../utils/ip-anonymize';

interface CreateAuditLogInput {
  tenant_id: Types.ObjectId;
  actor: AuditActor;
  action: string;
  resource_type: string;
  resource_id?: string;
  changes?: AuditChange[];
  result: 'success' | 'failure';
  request_id?: string;
}

interface AuditLogFilter {
  tenant_id: Types.ObjectId;
  resource_type?: string;
  resource_id?: string;
  action?: string;
  actor_id?: string;
  from_date?: Date;
  to_date?: Date;
}

export async function createAuditLog(input: CreateAuditLogInput): Promise<AuditLogDocument> {
  // Anonymize IP address for GDPR compliance
  const actor = { ...input.actor };
  if (actor.ip) {
    actor.ip = anonymizeIp(actor.ip);
  }

  // Compute expires_at based on tenant's audit_log_retention_days
  let expires_at: Date | undefined;
  try {
    const tenant = await Tenant.findById(input.tenant_id).select('plan_limits').lean();
    const retentionDays = (tenant as any)?.plan_limits?.audit_log_retention_days || 90;
    expires_at = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
  } catch {
    // Default 90 days if tenant lookup fails
    expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  }

  return AuditLog.create({
    tenant_id: input.tenant_id,
    timestamp: new Date(),
    actor,
    action: input.action,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    changes: input.changes || [],
    result: input.result,
    request_id: input.request_id,
    expires_at,
  });
}

export async function queryAuditLogs(
  filter: AuditLogFilter,
  pagination: PaginationParams
): Promise<PaginatedResult<AuditLogDocument>> {
  const baseFilter: Record<string, any> = { tenant_id: filter.tenant_id };

  if (filter.resource_type) baseFilter.resource_type = filter.resource_type;
  if (filter.resource_id) baseFilter.resource_id = filter.resource_id;
  if (filter.action) baseFilter.action = filter.action;
  if (filter.actor_id) baseFilter['actor.id'] = new Types.ObjectId(filter.actor_id);

  if (filter.from_date || filter.to_date) {
    baseFilter.timestamp = {};
    if (filter.from_date) baseFilter.timestamp.$gte = filter.from_date;
    if (filter.to_date) baseFilter.timestamp.$lte = filter.to_date;
  }

  // For audit logs, default sort by timestamp descending
  const paginationWithDefaults: PaginationParams = {
    ...pagination,
    sort_by: pagination.sort_by || 'timestamp',
    sort_order: pagination.sort_order || 'desc',
  };

  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await AuditLog.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await AuditLog.countDocuments(baseFilter);

  return paginateResults(results, paginationWithDefaults, total);
}

export async function getAuditLogsByResource(
  tenantId: Types.ObjectId,
  resourceType: string,
  resourceId: string,
  limit = 50
): Promise<AuditLogDocument[]> {
  return AuditLog.find({
    tenant_id: tenantId,
    resource_type: resourceType,
    resource_id: resourceId,
  })
    .sort({ timestamp: -1 })
    .limit(limit);
}
