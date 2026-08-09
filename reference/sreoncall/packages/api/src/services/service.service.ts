import { Service, IService } from '../models/service.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { parsePaginationParams } from '../utils/pagination';
import { logger } from '../utils/logger';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';

const sc = StringCodec();

export type ServiceStatus = IService['current_status'];
export type ServiceType = IService['type'];

export interface CreateServiceInput {
  name: string;
  description?: string;
  type?: ServiceType;
  classification?: IService['classification'];
  project_id: string;
  escalation_policy_id?: string | null;
  oncall_schedule_id?: string | null;
  owner_id?: string | null;
  enabled?: boolean;
  tags?: string[];
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  type?: ServiceType;
  classification?: IService['classification'];
  project_id?: string;
  escalation_policy_id?: string | null;
  oncall_schedule_id?: string | null;
  owner_id?: string | null;
  current_status?: ServiceStatus;
  tags?: string[];
}

export interface ListServicesFilter {
  status?: string;
  type?: string;
  classification?: string;
  auto_discovered?: boolean;
  project_id?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export async function listServices(tenantId: string, filter: ListServicesFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId, deleted_at: null };

  if (filter.status) query.current_status = filter.status;
  if (filter.type) query.type = filter.type;
  if (filter.classification) query.classification = filter.classification;
  if (filter.auto_discovered !== undefined) query.auto_discovered = filter.auto_discovered;
  if (filter.project_id) query.project_id = filter.project_id;
  if (filter.search) {
    query.$or = [
      { name: { $regex: filter.search, $options: 'i' } },
      { description: { $regex: filter.search, $options: 'i' } },
    ];
  }
  if (filter.cursor) {
    query._id = { $gt: filter.cursor };
  }

  const docs = await Service.find(query).sort({ name: 1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await Service.countDocuments({ tenant_id: tenantId, deleted_at: null }),
    },
  };
}

export async function getServiceById(tenantId: string, id: string) {
  const doc = await Service.findOne({ _id: id, tenant_id: tenantId, deleted_at: null }).lean();
  if (!doc) throw AppError.notFound('Service not found');
  return doc;
}

export async function createService(tenantId: string, userId: string, input: CreateServiceInput) {
  const doc = await Service.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    description: input.description ?? '',
    type: input.type ?? 'web',
    classification: input.classification ?? 'app',
    project_id: input.project_id,
    escalation_policy_id: input.escalation_policy_id || null,
    oncall_schedule_id: input.oncall_schedule_id || null,
    owner_id: input.owner_id || null,
    current_status: 'operational',
    enabled: input.enabled ?? true,
    tags: input.tags ?? [],
  });
  return doc.toObject();
}

export async function updateService(tenantId: string, id: string, input: UpdateServiceInput) {
  const updateFields: any = { ...input };
  // Convert nullable string refs to ObjectId or null
  if ('escalation_policy_id' in input) {
    updateFields.escalation_policy_id = input.escalation_policy_id || null;
  }
  if ('oncall_schedule_id' in input) {
    updateFields.oncall_schedule_id = input.oncall_schedule_id || null;
  }
  if ('owner_id' in input) {
    updateFields.owner_id = input.owner_id || null;
  }
  const doc = await Service.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: updateFields },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Service not found');
  return doc;
}

export async function deleteService(tenantId: string, id: string) {
  const doc = await Service.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: { deleted_at: new Date() } },
    { new: true },
  );
  if (!doc) throw AppError.notFound('Service not found');
}

export async function bulkUpdateClassification(
  tenantId: string,
  serviceIds: string[],
  classification: string,
): Promise<number> {
  const result = await Service.updateMany(
    { _id: { $in: serviceIds }, tenant_id: tenantId, deleted_at: null },
    { $set: { classification } },
  );
  return result.modifiedCount;
}

export async function updateServiceStatus(
  tenantId: string,
  id: string,
  status: ServiceStatus,
  source: 'manual' | 'cascaded' | 'alert' = 'manual',
  incidentId?: string,
) {
  const doc = await Service.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: { current_status: status, status_source: source, status_updated_at: new Date() } },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Service not found');

  try {
    const js = getJetStream();
    await js.publish(
      'icc.status.changed',
      sc.encode(
        JSON.stringify({
          tenant_id: tenantId,
          service_id: id,
          new_status: status,
          status_source: source,
          incident_id: incidentId ?? null,
          changed_at: new Date().toISOString(),
        }),
      ),
    );
  } catch (err: any) {
    logger.error('Failed to publish icc.status.changed', { error: err.message, serviceId: id });
  }

  return doc;
}

/**
 * Shared entry point for anything alert-like (alert rules, synthetic checks,
 * external webhook ingestion) setting a service's status. Hardcodes
 * `source: 'alert'` — the trust boundary the cascade engine won't silently
 * overwrite or auto-clear — and swallows errors so a failed status write
 * never breaks the caller's incident-creation/check-recording flow.
 */
export async function applyAlertStatusToService(
  tenantId: string,
  serviceId: string,
  status: ServiceStatus,
  incidentId?: string,
): Promise<void> {
  try {
    await updateServiceStatus(tenantId, serviceId, status, 'alert', incidentId);
  } catch (err: any) {
    logger.error('Failed to apply alert-driven service status', { error: err.message, serviceId });
  }
}
