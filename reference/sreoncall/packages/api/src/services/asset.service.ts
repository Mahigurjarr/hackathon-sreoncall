import mongoose from 'mongoose';
import { Asset, IAsset } from '../models/asset.model';
import { Service } from '../models/service.model';
import { Project } from '../models/project.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { DiscoveredAsset } from './cloud-discovery.service';
import { classifyAsset, inferServiceType } from './service-classifier.service';
import { ServiceNameIndex, buildServiceNameIndex, resolveServiceByName, registerServiceInIndex } from './service-identity.util';
import { logger } from '../utils/logger';

const WORKLOAD_RESOURCE_TYPES = new Set([
  'k8s_deployment', 'k8s_statefulset', 'k8s_daemonset',
  'docker_container', 'systemd_service', 'vm',
  'ecs_service', 'cloud_run_service', 'app_service', 'application_service',
  'heroku_app',
  'supabase_project',
  'vercel_project',
]);

async function getDefaultProject(tenantId: string): Promise<string> {
  // Prefer the tenant's "Default" project
  const defaultProj = await Project.findOne({ tenant_id: tenantId, name: 'Default', deleted_at: null }).select('_id').lean();
  if (defaultProj) return defaultProj._id.toString();

  // Fallback: any existing project
  const anyProj = await Project.findOne({ tenant_id: tenantId, deleted_at: null }).select('_id').lean();
  if (anyProj) return anyProj._id.toString();

  // Last resort: create one
  const created = await Project.create({
    tenant_id: tenantId,
    name: 'Default',
    description: 'Default project for auto-discovered services.',
  });
  return created._id.toString();
}

async function maybeCreateServiceForAsset(
  tenantId: string,
  asset: any,
  projectId: string,
  cloudProvider: string | undefined,
  nameIndex: ServiceNameIndex,
): Promise<string | null> {
  if (!WORKLOAD_RESOURCE_TYPES.has(asset.resource_type)) return null;
  if (asset.service_id) return null;

  // Don't create duplicates — exact name/alias match, then normalized
  // (generic-suffix-stripped) match against services already known this run.
  const existing = await resolveServiceByName(nameIndex, asset.name);
  if (existing) {
    // Link the asset to the existing service
    await Asset.updateOne({ _id: asset._id }, { $set: { service_id: existing.serviceId } });
    return null;
  }

  const classification = classifyAsset({
    name: asset.name,
    k8s_namespace: asset.k8s_namespace,
    k8s_kind: asset.k8s_kind,
    resource_type: asset.resource_type,
    category: asset.category,
  });

  const serviceType = inferServiceType({
    name: asset.name,
    k8s_namespace: asset.k8s_namespace,
    k8s_kind: asset.k8s_kind,
    resource_type: asset.resource_type,
    category: asset.category,
  });

  const svc = await Service.create({
    tenant_id: tenantId,
    project_id: projectId,
    name: asset.name,
    type: serviceType,
    classification,
    auto_discovered: true,
    source_asset_id: asset._id,
    current_status: asset.status === 'healthy' ? 'operational' : 'unknown',
    cloud_metadata: {
      provider: cloudProvider || asset.provider,
      resource_type: asset.resource_type,
      cloud_id: asset.cloud_id,
      region: asset.region,
      cluster: null,
      namespace: asset.k8s_namespace,
    },
  });

  // Link asset to the new service
  await Asset.updateOne({ _id: asset._id }, { $set: { service_id: svc._id } });
  registerServiceInIndex(nameIndex, { _id: svc._id as any, name: svc.name });

  return svc._id.toString();
}

export interface ListAssetsFilter {
  provider?: string;
  category?: string;
  status?: string;
  parent_id?: string;
  connection_id?: string;
  resource_type?: string;
  cluster_id?: string;
  tree?: boolean;
  limit?: number;
  cursor?: string;
}

export async function listAssets(tenantId: string, filter: ListAssetsFilter = {}) {
  const limit = Math.min(filter.limit ?? 100, 500);
  const query: any = { tenant_id: tenantId };

  if (filter.provider) query.provider = filter.provider;
  if (filter.category) query.category = filter.category;
  if (filter.status) query.status = filter.status;
  if (filter.connection_id) query.connection_id = filter.connection_id;
  if (filter.resource_type) query.resource_type = filter.resource_type;

  if (filter.cluster_id) {
    query.$or = [
      { cloud_id: filter.cluster_id },
      { parent_cloud_id: filter.cluster_id },
    ];
  }

  if (filter.parent_id) {
    query.parent_asset_id = filter.parent_id;
  } else if (!filter.tree && !filter.cluster_id) {
    // Default: return top-level assets only (no parent)
    query.parent_asset_id = null;
  }

  if (filter.cursor) {
    query._id = { $gt: filter.cursor };
  }

  const docs = await Asset.find(query).sort({ category: 1, name: 1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await Asset.countDocuments({ tenant_id: tenantId, ...(filter.provider ? { provider: filter.provider } : {}) }),
    },
  };
}

export async function getAssetById(tenantId: string, id: string) {
  const doc = await Asset.findOne({ _id: id, tenant_id: tenantId }).lean();
  if (!doc) throw AppError.notFound('Asset not found');
  return doc;
}

export async function getAssetTree(tenantId: string, clusterId: string) {
  const cluster = await Asset.findOne({ _id: clusterId, tenant_id: tenantId, category: 'kubernetes' }).lean();
  if (!cluster) throw AppError.notFound('Cluster asset not found');

  const children = await Asset.find({
    tenant_id: tenantId,
    parent_asset_id: clusterId,
  }).sort({ k8s_namespace: 1, k8s_kind: 1, name: 1 }).lean();

  return { cluster, children };
}

export async function getAssetsSummary(tenantId: string) {
  const pipeline = [
    { $match: { tenant_id: new mongoose.Types.ObjectId(tenantId) } },
    {
      $group: {
        _id: { provider: '$provider', category: '$category', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ];

  const results = await Asset.aggregate(pipeline);

  const summary: Record<string, Record<string, Record<string, number>>> = {};
  let totalAssets = 0;
  let healthyAssets = 0;

  for (const r of results) {
    const { provider, category, status } = r._id;
    if (!summary[provider]) summary[provider] = {};
    if (!summary[provider][category]) summary[provider][category] = {};
    summary[provider][category][status] = r.count;
    totalAssets += r.count;
    if (status === 'healthy') healthyAssets += r.count;
  }

  const providerCounts: Record<string, number> = {};
  for (const [provider, cats] of Object.entries(summary)) {
    providerCounts[provider] = Object.values(cats).reduce(
      (sum, statuses) => sum + Object.values(statuses).reduce((s, c) => s + c, 0),
      0,
    );
  }

  return {
    total: totalAssets,
    healthy: healthyAssets,
    by_provider: summary,
    provider_counts: providerCounts,
  };
}

export async function linkAssetToService(tenantId: string, assetId: string, serviceId: string) {
  const doc = await Asset.findOneAndUpdate(
    { _id: assetId, tenant_id: tenantId },
    { $set: { service_id: serviceId } },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Asset not found');

  // Sync cloud_metadata on the linked service
  await Service.findOneAndUpdate(
    { _id: serviceId, tenant_id: tenantId },
    {
      $set: {
        'cloud_metadata.provider': doc.provider,
        'cloud_metadata.resource_type': doc.resource_type,
        'cloud_metadata.cloud_id': doc.cloud_id,
        'cloud_metadata.region': doc.region,
        'cloud_metadata.cluster': doc.parent_asset_id ? doc.name : null,
        'cloud_metadata.namespace': doc.k8s_namespace,
      },
    },
  );

  return doc;
}

export async function unlinkAssetFromService(tenantId: string, assetId: string) {
  // Get the old doc first to know which service to clear
  const old = await Asset.findOne({ _id: assetId, tenant_id: tenantId }).lean();
  if (!old) throw AppError.notFound('Asset not found');

  const doc = await Asset.findOneAndUpdate(
    { _id: assetId, tenant_id: tenantId },
    { $set: { service_id: null } },
    { new: true, lean: true },
  );

  // Clear cloud_metadata on the previously linked service
  if (old.service_id) {
    await Service.findOneAndUpdate(
      { _id: old.service_id, tenant_id: tenantId },
      { $set: { cloud_metadata: null } },
    );
  }

  return doc!;
}

/**
 * Upsert discovered assets into the Asset collection.
 * Idempotent by tenant_id + cloud_id. Resolves parent_cloud_id → parent_asset_id.
 */
export async function upsertDiscoveredAssets(
  tenantId: string,
  connectionId: string,
  discoveredAssets: DiscoveredAsset[],
  cloudProvider?: string,
): Promise<{ upserted: number; services_created: number }> {
  let upserted = 0;
  const allUpsertedDocs: any[] = [];

  // Phase 1: Upsert top-level assets (no parent)
  const topLevel = discoveredAssets.filter((a) => !a.parent_cloud_id);
  const children = discoveredAssets.filter((a) => !!a.parent_cloud_id);

  for (const asset of topLevel) {
    const result = await Asset.findOneAndUpdate(
      { tenant_id: tenantId, cloud_id: asset.cloud_id },
      {
        $set: {
          tenant_id: tenantId,
          name: asset.name,
          provider: asset.provider,
          category: asset.category,
          resource_type: asset.resource_type,
          region: asset.region,
          cloud_id: asset.cloud_id,
          cloud_account_id: asset.cloud_account_id,
          metadata: asset.metadata,
          parent_asset_id: null,
          k8s_namespace: asset.k8s_namespace,
          k8s_kind: asset.k8s_kind,
          k8s_replicas_desired: asset.k8s_replicas_desired,
          k8s_replicas_ready: asset.k8s_replicas_ready,
          k8s_pod_issues: asset.k8s_pod_issues,
          status: asset.status,
          status_reason: asset.status_reason,
          last_seen_at: new Date(),
          connection_id: connectionId,
          is_aggregate: asset.is_aggregate,
          aggregate_count: asset.aggregate_count,
        },
      },
      { upsert: true, new: true, lean: true },
    );
    if (result) {
      upserted++;
      allUpsertedDocs.push(result);
    }
  }

  // Phase 2: Upsert child assets, resolving parent_cloud_id → parent_asset_id
  for (const asset of children) {
    const parent = await Asset.findOne({
      tenant_id: tenantId,
      cloud_id: asset.parent_cloud_id,
    }).select('_id').lean();

    const parentId = parent?._id ?? null;

    const result = await Asset.findOneAndUpdate(
      { tenant_id: tenantId, cloud_id: asset.cloud_id },
      {
        $set: {
          tenant_id: tenantId,
          name: asset.name,
          provider: asset.provider,
          category: asset.category,
          resource_type: asset.resource_type,
          region: asset.region,
          cloud_id: asset.cloud_id,
          cloud_account_id: asset.cloud_account_id,
          metadata: asset.metadata,
          parent_asset_id: parentId,
          k8s_namespace: asset.k8s_namespace,
          k8s_kind: asset.k8s_kind,
          k8s_replicas_desired: asset.k8s_replicas_desired,
          k8s_replicas_ready: asset.k8s_replicas_ready,
          k8s_pod_issues: asset.k8s_pod_issues,
          status: asset.status,
          status_reason: asset.status_reason,
          last_seen_at: new Date(),
          connection_id: connectionId,
          is_aggregate: asset.is_aggregate,
          aggregate_count: asset.aggregate_count,
        },
      },
      { upsert: true, new: true, lean: true },
    );
    if (result) {
      upserted++;
      allUpsertedDocs.push(result);
    }
  }

  // Phase 3: Auto-create services for workload-level assets
  let servicesCreated = 0;
  const workloadDocs = allUpsertedDocs.filter((d) => WORKLOAD_RESOURCE_TYPES.has(d.resource_type));

  if (workloadDocs.length > 0) {
    let projectId: string | null = null;
    const nameIndex = await buildServiceNameIndex(tenantId);
    for (const doc of workloadDocs) {
      try {
        if (!projectId) projectId = await getDefaultProject(tenantId);
        const svcId = await maybeCreateServiceForAsset(tenantId, doc, projectId, cloudProvider, nameIndex);
        if (svcId) servicesCreated++;
      } catch (err: any) {
        logger.warn('Auto-service creation failed for asset', { name: doc.name, error: err.message });
      }
    }
  }

  logger.info('Asset upsert complete', {
    tenantId, connectionId,
    total: discoveredAssets.length, upserted, servicesCreated,
  });

  return { upserted, services_created: servicesCreated };
}

/**
 * Remove assets that were not seen in the latest discovery run (stale cleanup).
 */
export async function removeStaleAssets(tenantId: string, connectionId: string, seenCloudIds: string[]) {
  const result = await Asset.deleteMany({
    tenant_id: tenantId,
    connection_id: connectionId,
    cloud_id: { $nin: seenCloudIds },
  });
  if (result.deletedCount > 0) {
    logger.info('Removed stale assets', { tenantId, connectionId, deleted: result.deletedCount });
  }
  return result.deletedCount;
}
