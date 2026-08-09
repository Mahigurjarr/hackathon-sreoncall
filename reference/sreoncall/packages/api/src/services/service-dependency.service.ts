import { Types } from 'mongoose';
import { ServiceDependency, IServiceDependency } from '../models/service-dependency.model';
import { ServiceMapVersion } from '../models/service-map-version.model';
import { DependencyDiscoveryJob, DiscoverySource } from '../models/dependency-discovery-job.model';
import { Service } from '../models/service.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { logger } from '../utils/logger';
import { wouldCreateCycle, buildApprovedAdjacency, hasPath, addEdge } from './service-dependency-graph.util';
import { getSettings as getTopologySettings } from './service-topology-settings.service';
import { createAuditLog } from './audit.service';

const sc = StringCodec();

export interface ListDependenciesFilter {
  status?: string;
  source_service_id?: string;
  target_service_id?: string;
  discovery_method?: string;
  criticality?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateDependencyInput {
  source_service_id: string;
  target_service_id: string;
  dependency_type: IServiceDependency['dependency_type'];
  criticality?: IServiceDependency['criticality'];
  protocol_details?: Partial<IServiceDependency['protocol_details']>;
  notes?: string;
  labels?: Record<string, string>;
}

export interface UpdateDependencyInput {
  notes?: string;
  criticality?: IServiceDependency['criticality'];
  protocol_details?: Partial<IServiceDependency['protocol_details']>;
  labels?: Record<string, string>;
}

export async function list(tenantId: string, filter: ListDependenciesFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };

  if (filter.status) query.status = filter.status;
  if (filter.source_service_id) query.source_service_id = filter.source_service_id;
  if (filter.target_service_id) query.target_service_id = filter.target_service_id;
  if (filter.discovery_method) query.discovery_method = filter.discovery_method;
  if (filter.criticality) query.criticality = filter.criticality;
  if (filter.cursor) {
    query._id = { $gt: filter.cursor };
  }

  const docs = await ServiceDependency.find(query)
    .populate('source_service_id', 'name type')
    .populate('target_service_id', 'name type')
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await ServiceDependency.countDocuments({ tenant_id: tenantId }),
    },
  };
}

export async function getById(tenantId: string, id: string) {
  const doc = await ServiceDependency.findOne({ _id: id, tenant_id: tenantId }).lean();
  if (!doc) throw AppError.notFound('Service dependency not found');
  return doc;
}

export async function create(tenantId: string, data: CreateDependencyInput, userId: string) {
  if (data.source_service_id === data.target_service_id) {
    throw AppError.badRequest('Source and target service cannot be the same');
  }

  const doc = await ServiceDependency.create({
    tenant_id: tenantId,
    source_service_id: data.source_service_id,
    target_service_id: data.target_service_id,
    dependency_type: data.dependency_type,
    criticality: data.criticality ?? 'medium',
    protocol_details: data.protocol_details ?? {},
    discovery_method: 'manual',
    status: 'approved',
    notes: data.notes ?? null,
    labels: data.labels ?? {},
    created_by: userId,
    first_seen_at: new Date(),
    last_seen_at: new Date(),
    version: 1,
  });

  return doc.toObject();
}

export async function update(tenantId: string, id: string, data: UpdateDependencyInput) {
  const updateFields: any = {};

  if (data.notes !== undefined) updateFields.notes = data.notes;
  if (data.criticality !== undefined) updateFields.criticality = data.criticality;
  if (data.protocol_details !== undefined) updateFields.protocol_details = data.protocol_details;
  if (data.labels !== undefined) updateFields.labels = data.labels;

  const doc = await ServiceDependency.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: updateFields, $inc: { version: 1 } },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Service dependency not found');
  return doc;
}

export async function remove(tenantId: string, id: string) {
  const doc = await ServiceDependency.findOneAndDelete({ _id: id, tenant_id: tenantId });
  if (!doc) throw AppError.notFound('Service dependency not found');
}

export async function approve(tenantId: string, id: string, userId: string) {
  const existing = await ServiceDependency.findOne({ _id: id, tenant_id: tenantId }).lean();
  if (!existing) throw AppError.notFound('Service dependency not found');

  if (existing.status !== 'approved') {
    const cycle = await wouldCreateCycle(
      tenantId,
      existing.source_service_id.toString(),
      existing.target_service_id.toString(),
    );
    if (cycle) {
      throw AppError.badRequest('Approving this dependency would create a cycle in the service topology');
    }
  }

  const doc = await ServiceDependency.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    {
      $set: {
        status: 'approved',
        approved_by: userId,
        approved_at: new Date(),
        rejected_reason: null,
      },
    },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Service dependency not found');
  return doc;
}

export async function reject(tenantId: string, id: string, reason: string, userId: string) {
  const doc = await ServiceDependency.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    {
      $set: {
        status: 'rejected',
        rejected_reason: reason,
        approved_by: null,
        approved_at: null,
      },
    },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Service dependency not found');
  return doc;
}

export async function bulkApprove(tenantId: string, ids: string[], userId: string) {
  const targets = await ServiceDependency.find(
    { _id: { $in: ids }, tenant_id: tenantId },
    { source_service_id: 1, target_service_id: 1, status: 1 },
  ).lean();

  const adjacency = await buildApprovedAdjacency(tenantId);

  let modified = 0;
  const skippedCycle: string[] = [];

  for (const target of targets) {
    const id = target._id.toString();
    const source = target.source_service_id.toString();
    const dest = target.target_service_id.toString();

    // Two edges within this same batch can combine into a cycle even if neither
    // alone would, so check against the adjacency map as it grows across iterations.
    if (target.status !== 'approved' && hasPath(adjacency, dest, source)) {
      skippedCycle.push(id);
      continue;
    }

    await ServiceDependency.updateOne(
      { _id: id, tenant_id: tenantId },
      {
        $set: {
          status: 'approved',
          approved_by: userId,
          approved_at: new Date(),
          rejected_reason: null,
        },
      },
    );
    modified++;
    addEdge(adjacency, source, dest);
  }

  return { modified, skipped_cycle: skippedCycle };
}

export async function bulkReject(tenantId: string, ids: string[], reason: string, userId: string) {
  const result = await ServiceDependency.updateMany(
    { _id: { $in: ids }, tenant_id: tenantId },
    {
      $set: {
        status: 'rejected',
        rejected_reason: reason,
        approved_by: null,
        approved_at: null,
      },
    },
  );
  return { modified: result.modifiedCount };
}

export async function getFullTopology(tenantId: string) {
  const edges = await ServiceDependency.find({
    tenant_id: tenantId,
    status: 'approved',
  }).lean();

  // Collect unique service IDs from edges
  const serviceIdSet = new Set<string>();
  for (const edge of edges) {
    serviceIdSet.add(edge.source_service_id.toString());
    serviceIdSet.add(edge.target_service_id.toString());
  }

  const serviceIds = Array.from(serviceIdSet);
  const services = await Service.find({
    _id: { $in: serviceIds },
    tenant_id: tenantId,
    deleted_at: null,
  })
    .select('_id name type current_status')
    .lean();

  const nodes = services.map((s: any) => ({
    id: s._id.toString(),
    name: s.name,
    type: s.type ?? 'web',
    current_status: s.current_status ?? 'operational',
  }));

  const serializedEdges = edges.map((e: any) => ({
    id: e._id.toString(),
    source_service_id: e.source_service_id.toString(),
    target_service_id: e.target_service_id.toString(),
    dependency_type: e.dependency_type,
    criticality: e.criticality,
    protocol_details: e.protocol_details,
    traffic_metadata: e.traffic_metadata,
    labels: e.labels,
    notes: e.notes,
  }));

  return { nodes, edges: serializedEdges };
}

export async function getTopologyVersions(tenantId: string) {
  const docs = await ServiceMapVersion.find({ tenant_id: tenantId })
    .sort({ version: -1 })
    .limit(50)
    .lean();
  return docs;
}

export async function createSnapshot(
  tenantId: string,
  userId: string,
  changeSummary: string | null,
  incidentId?: string,
) {
  // Get current approved edges with service names
  const edges = await ServiceDependency.find({
    tenant_id: tenantId,
    status: 'approved',
  }).lean();

  // Collect unique service IDs
  const serviceIdSet = new Set<string>();
  for (const edge of edges) {
    serviceIdSet.add(edge.source_service_id.toString());
    serviceIdSet.add(edge.target_service_id.toString());
  }

  const services = await Service.find({
    _id: { $in: Array.from(serviceIdSet) },
    tenant_id: tenantId,
  })
    .select('_id name')
    .lean();

  const serviceNameMap = new Map<string, string>();
  for (const s of services) {
    serviceNameMap.set(s._id.toString(), s.name);
  }

  // Determine next version number
  const lastVersion = await ServiceMapVersion.findOne({ tenant_id: tenantId })
    .sort({ version: -1 })
    .select('version')
    .lean();
  const nextVersion = (lastVersion?.version ?? 0) + 1;

  const snapshot = edges.map((e: any) => ({
    source_service_id: e.source_service_id,
    source_service_name: serviceNameMap.get(e.source_service_id.toString()) ?? 'Unknown',
    target_service_id: e.target_service_id,
    target_service_name: serviceNameMap.get(e.target_service_id.toString()) ?? 'Unknown',
    dependency_type: e.dependency_type,
    criticality: e.criticality,
  }));

  const doc = await ServiceMapVersion.create({
    tenant_id: tenantId,
    version: nextVersion,
    snapshot,
    created_by: userId,
    change_summary: changeSummary ?? null,
    incident_id: incidentId ?? null,
  });

  return doc.toObject();
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export async function triggerDiscovery(
  tenantId: string,
  type: 'otel_trace_scan' | 'document_upload' | 'network_scan',
  userId: string | null,
  source?: Partial<DiscoverySource>,
) {
  const job = await DependencyDiscoveryJob.create({
    tenant_id: tenantId,
    type,
    status: 'pending',
    triggered_by: userId,
    source: source ?? {},
  });
  return job.toObject();
}

/**
 * Publishes the `icc.discovery.trigger` NATS message that
 * `dependency-discovery.worker.ts` consumes. Shared by the manual "Run Now"
 * route and the scheduler worker so both producers stay in sync with what the
 * consumer expects.
 */
export async function publishDiscoveryTriggerEvent(
  tenantId: string,
  jobId: string,
  type: 'otel_trace_scan' | 'document_upload' | 'network_scan',
  triggeredBy: string | null,
): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      'icc.discovery.trigger',
      sc.encode(
        JSON.stringify({
          job_id: jobId,
          tenant_id: tenantId,
          type,
          triggered_by: triggeredBy,
        }),
      ),
    );
  } catch (err: any) {
    logger.error('Failed to publish discovery trigger', { error: err.message });
  }
}

export async function uploadDocument(
  tenantId: string,
  fileId: string | null,
  filename: string,
  userId: string,
) {
  const job = await DependencyDiscoveryJob.create({
    tenant_id: tenantId,
    type: 'document_upload',
    status: 'pending',
    triggered_by: userId,
    source: {
      document_file_id: fileId,
      document_filename: filename,
    },
  });
  return job.toObject();
}

export async function listDiscoveryJobs(
  tenantId: string,
  filters: { status?: string; type?: string } = {},
) {
  // Auto-fail jobs stuck in pending/running for more than 5 minutes
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  await DependencyDiscoveryJob.updateMany(
    {
      tenant_id: tenantId,
      status: { $in: ['pending', 'running'] },
      createdAt: { $lt: staleThreshold },
    },
    {
      $set: {
        status: 'failed',
        error_message: 'Job timed out after 5 minutes. Please try again.',
        completed_at: new Date(),
      },
    },
  );

  const query: any = { tenant_id: tenantId };
  if (filters.status) query.status = filters.status;
  if (filters.type) query.type = filters.type;

  return DependencyDiscoveryJob.find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

export async function getDiscoveryJob(tenantId: string, jobId: string) {
  const job = await DependencyDiscoveryJob.findOne({ _id: jobId, tenant_id: tenantId }).lean();
  if (!job) throw AppError.notFound('Discovery job not found');
  return job;
}

// ─── Confidence-based auto-approval ────────────────────────────────────────────

const AUTO_APPROVAL_DISCOVERY_METHODS = ['auto_otel', 'auto_network', 'ai_parsed', 'document_upload'] as const;
type AutoApprovalDiscoveryMethod = (typeof AUTO_APPROVAL_DISCOVERY_METHODS)[number];

function isAutoApprovalEligibleMethod(method: string): method is AutoApprovalDiscoveryMethod {
  return (AUTO_APPROVAL_DISCOVERY_METHODS as readonly string[]).includes(method);
}

/**
 * Attempts to auto-approve a proposed dependency edge once it has been
 * observed enough times, scaled by how much trust its discovery method and
 * criticality demand. No-ops (returns false) unless every gate passes:
 * tenant opt-in, per-method opt-in, observation threshold, and the same
 * write-time cycle check the human approval path uses (hard block, no
 * warn-and-allow — there's no human here to heed a warning).
 */
export async function tryAutoApprove(
  tenantId: string,
  dependencyId: string,
  actorLabel: string,
): Promise<boolean> {
  const doc = await ServiceDependency.findOne({ _id: dependencyId, tenant_id: tenantId });
  if (!doc || doc.status !== 'proposed') return false;
  if (!isAutoApprovalEligibleMethod(doc.discovery_method)) return false;

  const settings = await getTopologySettings(new Types.ObjectId(tenantId));
  if (!settings.auto_approval.enabled) return false;

  const methodConfig = settings.auto_approval.thresholds[doc.discovery_method as AutoApprovalDiscoveryMethod];
  if (!methodConfig?.enabled) return false;

  const multiplier = settings.auto_approval.criticality_multiplier[doc.criticality];
  const required = Math.max(1, Math.ceil(methodConfig.base_observation_threshold * multiplier));
  if (doc.observation_count < required) return false;

  const cycle = await wouldCreateCycle(
    tenantId,
    doc.source_service_id.toString(),
    doc.target_service_id.toString(),
  );
  if (cycle) {
    logger.warn('Auto-approval skipped: would create a cycle', { tenantId, dependencyId });
    return false;
  }

  const result = await ServiceDependency.updateOne(
    { _id: dependencyId, tenant_id: tenantId, status: 'proposed' },
    { $set: { status: 'approved', approved_at: new Date(), auto_approved: true } },
  );
  if (result.modifiedCount === 0) return false; // lost the race to a concurrent approve/reject

  await createAuditLog({
    tenant_id: new Types.ObjectId(tenantId),
    actor: { type: 'system', ip: 'unknown', user_agent: actorLabel },
    action: 'service_dependency.auto_approved',
    resource_type: 'service_dependency',
    resource_id: dependencyId,
    changes: [{ field: 'status', old_value: 'proposed', new_value: 'approved' }],
    result: 'success',
  });

  return true;
}
