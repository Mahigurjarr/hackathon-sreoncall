import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';
import type { DiscoveredAsset, DiscoveredService, CloudDiscoveryResult } from './cloud-discovery.service';

const SCW_API = 'https://api.scaleway.com';

interface ScalewayCreds {
  secret_key?: string;
  project_id?: string;
  region?: string;
}

function makeAsset(
  overrides: Partial<DiscoveredAsset> &
    Pick<DiscoveredAsset, 'name' | 'provider' | 'category' | 'resource_type' | 'cloud_id'>,
): DiscoveredAsset {
  return {
    region: '',
    cloud_account_id: '',
    metadata: {},
    status: 'healthy',
    status_reason: null,
    parent_cloud_id: null,
    k8s_namespace: null,
    k8s_kind: null,
    k8s_replicas_desired: null,
    k8s_replicas_ready: null,
    k8s_pod_issues: [],
    is_aggregate: false,
    aggregate_count: null,
    ...overrides,
  };
}

async function scwFetch(path: string, secretKey: string): Promise<any> {
  const res = await fetch(`${SCW_API}${path}`, {
    headers: { 'X-Auth-Token': secretKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Scaleway API ${path} returned ${res.status}`);
  }
  return res.json();
}

function zonesForRegion(region: string): string[] {
  const zoneMap: Record<string, string[]> = {
    'fr-par': ['fr-par-1', 'fr-par-2', 'fr-par-3'],
    'nl-ams': ['nl-ams-1', 'nl-ams-2', 'nl-ams-3'],
    'pl-waw': ['pl-waw-1', 'pl-waw-2', 'pl-waw-3'],
  };
  return zoneMap[region] ?? [`${region}-1`];
}

export async function discoverScalewayReal(credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  const creds = credentials as ScalewayCreds;
  const secretKey = creds.secret_key || '';
  const projectId = creds.project_id || '';
  const region = creds.region || 'fr-par';

  if (!secretKey) {
    throw new Error('Scaleway secret_key is required');
  }

  // Verify credentials and get organization/project info
  let orgId = '';
  try {
    const data = await scwFetch(`/account/v3/projects/${projectId}`, secretKey);
    orgId = data?.project?.organization_id || data?.organization_id || '';
  } catch (err: any) {
    logger.warn('Failed to verify Scaleway project', { error: err.message });
  }

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  const zones = zonesForRegion(region);

  // Discover in parallel with error tolerance
  const results = await Promise.allSettled([
    discoverInstances(secretKey, projectId, region, zones, assets, services),
    discoverKubernetes(secretKey, projectId, region, assets, services),
    discoverDatabases(secretKey, projectId, region, assets, services),
    discoverRedis(secretKey, projectId, region, zones, assets, services),
    discoverFunctions(secretKey, projectId, region, assets, services),
    discoverContainers(secretKey, projectId, region, assets, services),
    discoverLoadBalancers(secretKey, projectId, region, zones, assets, services),
    discoverMessaging(secretKey, projectId, region, assets, services),
    discoverObjectStorage(secretKey, projectId, region, assets, services),
  ]);

  for (const r of results) {
    if (r.status === 'rejected') {
      logger.warn('Scaleway discovery sub-task failed', { error: r.reason?.message });
    }
  }

  return {
    provider: 'scaleway',
    services,
    assets,
    recommended_alerts: [
      'Instance CPU utilization > 80%',
      'Managed database connections > 90% of max',
      'Kubernetes pod restart count > 5 in 10m',
      'Serverless function error rate > 5%',
      'Load balancer 5xx error rate > 1%',
      'Redis memory utilization > 85%',
      'SQS queue depth > 1000 messages',
    ],
    recommended_dashboards: [
      'Scaleway Infrastructure Overview',
      'Instances Fleet Health',
      'Managed Databases Performance',
      'Kubernetes Kapsule Health',
      'Serverless Functions & Containers',
      'Load Balancer Traffic & Latency',
    ],
  };
}

async function discoverInstances(
  secretKey: string, projectId: string, region: string, zones: string[],
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  let total = 0;
  const allServers: any[] = [];

  await Promise.allSettled(
    zones.map(async (zone) => {
      try {
        const data = await scwFetch(
          `/instance/v1/zones/${zone}/servers?project=${projectId}&per_page=100`,
          secretKey,
        );
        const servers = (data?.servers || []).filter((s: any) => s.state === 'running');
        allServers.push(...servers.map((s: any) => ({ ...s, zone })));
        total += servers.length;
      } catch {
        // Zone may not be available
      }
    }),
  );

  if (total === 0) return;

  services.push({
    service_type: 'scw_instance',
    display_name: 'Scaleway Instances',
    count: total,
    details: `${total} running instance${total !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: total > 20,
  });

  if (allServers.length > 10) {
    assets.push(makeAsset({
      name: `${allServers.length} Instances`,
      provider: 'scaleway', category: 'compute', resource_type: 'scw_instance',
      region, cloud_id: `aggregate:scw_instance:${projectId}:${region}`, cloud_account_id: projectId,
      is_aggregate: true, aggregate_count: allServers.length,
    }));
  } else {
    for (const s of allServers) {
      assets.push(makeAsset({
        name: s.name || s.id,
        provider: 'scaleway', category: 'compute', resource_type: 'scw_instance',
        region: s.zone || region, cloud_id: s.id, cloud_account_id: projectId,
        metadata: {
          commercial_type: s.commercial_type,
          zone: s.zone,
          public_ip: s.public_ip?.address,
          private_ip: s.private_ip,
          image: s.image?.name,
        },
        status: s.state === 'running' ? 'healthy' : 'degraded',
      }));
    }
  }
}

async function discoverKubernetes(
  secretKey: string, projectId: string, region: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await scwFetch(
    `/k8s/v1/regions/${region}/clusters?project_id=${projectId}&per_page=100`,
    secretKey,
  );
  const clusters = data?.clusters || [];

  if (clusters.length === 0) return;

  services.push({
    service_type: 'kapsule',
    display_name: 'Kubernetes Kapsule',
    count: clusters.length,
    details: `${clusters.length} cluster${clusters.length !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: false,
  });

  for (const c of clusters) {
    const status = c.status === 'ready' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: c.name || c.id,
      provider: 'scaleway', category: 'kubernetes', resource_type: 'kapsule',
      region, cloud_id: c.id, cloud_account_id: projectId,
      metadata: {
        version: c.version,
        cni: c.cni,
        type: c.type,
        node_count: c.autoscaler_config?.estimator,
      },
      status,
      status_reason: status !== 'healthy' ? `Status: ${c.status}` : null,
    }));
  }
}

async function discoverDatabases(
  secretKey: string, projectId: string, region: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await scwFetch(
    `/rdb/v1/regions/${region}/instances?project_id=${projectId}&per_page=100`,
    secretKey,
  );
  const instances = data?.instances || [];

  if (instances.length === 0) return;

  services.push({
    service_type: 'rdb',
    display_name: 'Managed Databases (PostgreSQL/MySQL)',
    count: instances.length,
    details: `${instances.length} database${instances.length !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: false,
  });

  for (const db of instances) {
    const status = db.status === 'ready' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: db.name || db.id,
      provider: 'scaleway', category: 'database', resource_type: 'rdb',
      region, cloud_id: db.id, cloud_account_id: projectId,
      metadata: {
        engine: db.engine,
        node_type: db.node_type,
        is_ha_cluster: db.is_ha_cluster,
        volume_size_gb: db.volume ? Math.round((db.volume.size || 0) / 1e9) : null,
      },
      status,
      status_reason: status !== 'healthy' ? `Status: ${db.status}` : null,
    }));
  }
}

async function discoverRedis(
  secretKey: string, projectId: string, region: string, zones: string[],
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const allClusters: any[] = [];

  await Promise.allSettled(
    zones.map(async (zone) => {
      try {
        const data = await scwFetch(
          `/redis/v1/zones/${zone}/clusters?project_id=${projectId}&per_page=100`,
          secretKey,
        );
        const clusters = data?.clusters || [];
        allClusters.push(...clusters.map((c: any) => ({ ...c, zone })));
      } catch {
        // Zone may not have Redis
      }
    }),
  );

  if (allClusters.length === 0) return;

  services.push({
    service_type: 'scw_redis',
    display_name: 'Managed Redis',
    count: allClusters.length,
    details: `${allClusters.length} cluster${allClusters.length !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: false,
  });

  for (const c of allClusters) {
    const status = c.status === 'ready' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: c.name || c.id,
      provider: 'scaleway', category: 'cache', resource_type: 'scw_redis',
      region: c.zone || region, cloud_id: c.id, cloud_account_id: projectId,
      metadata: {
        version: c.version,
        node_type: c.node_type,
        cluster_size: c.cluster_size,
        zone: c.zone,
      },
      status,
      status_reason: status !== 'healthy' ? `Status: ${c.status}` : null,
    }));
  }
}

async function discoverFunctions(
  secretKey: string, projectId: string, region: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  // Get all namespaces first, then list functions under each
  const nsData = await scwFetch(
    `/functions/v1beta1/regions/${region}/namespaces?project_id=${projectId}&per_page=100`,
    secretKey,
  );
  const namespaces = nsData?.namespaces || [];

  let totalFunctions = 0;
  await Promise.allSettled(
    namespaces.map(async (ns: any) => {
      try {
        const fnData = await scwFetch(
          `/functions/v1beta1/regions/${region}/functions?namespace_id=${ns.id}&per_page=100`,
          secretKey,
        );
        totalFunctions += (fnData?.functions || []).length;
      } catch {
        // Non-fatal
      }
    }),
  );

  if (totalFunctions === 0 && namespaces.length === 0) return;
  const count = totalFunctions || namespaces.length;

  services.push({
    service_type: 'scw_functions',
    display_name: 'Serverless Functions',
    count,
    details: `${count} function${count !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: count > 10,
  });

  if (count > 0) {
    assets.push(makeAsset({
      name: `${count} Serverless Function${count !== 1 ? 's' : ''}`,
      provider: 'scaleway', category: 'serverless', resource_type: 'scw_functions',
      region, cloud_id: `aggregate:scw_functions:${projectId}:${region}`, cloud_account_id: projectId,
      is_aggregate: true, aggregate_count: count,
    }));
  }
}

async function discoverContainers(
  secretKey: string, projectId: string, region: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const nsData = await scwFetch(
    `/containers/v1beta1/regions/${region}/namespaces?project_id=${projectId}&per_page=100`,
    secretKey,
  );
  const namespaces = nsData?.namespaces || [];

  let total = 0;
  await Promise.allSettled(
    namespaces.map(async (ns: any) => {
      try {
        const cData = await scwFetch(
          `/containers/v1beta1/regions/${region}/containers?namespace_id=${ns.id}&per_page=100`,
          secretKey,
        );
        total += (cData?.containers || []).length;
      } catch {
        // Non-fatal
      }
    }),
  );

  if (total === 0 && namespaces.length === 0) return;
  const count = total || namespaces.length;

  services.push({
    service_type: 'scw_containers',
    display_name: 'Serverless Containers',
    count,
    details: `${count} container${count !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: count > 10,
  });

  if (count > 0) {
    assets.push(makeAsset({
      name: `${count} Serverless Container${count !== 1 ? 's' : ''}`,
      provider: 'scaleway', category: 'serverless', resource_type: 'scw_containers',
      region, cloud_id: `aggregate:scw_containers:${projectId}:${region}`, cloud_account_id: projectId,
      is_aggregate: true, aggregate_count: count,
    }));
  }
}

async function discoverLoadBalancers(
  secretKey: string, projectId: string, region: string, zones: string[],
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const allLbs: any[] = [];

  await Promise.allSettled(
    zones.map(async (zone) => {
      try {
        const data = await scwFetch(
          `/lb/v1/zones/${zone}/lbs?project_id=${projectId}&per_page=100`,
          secretKey,
        );
        const lbs = data?.lbs || [];
        allLbs.push(...lbs.map((lb: any) => ({ ...lb, zone })));
      } catch {
        // Zone may not have LBs
      }
    }),
  );

  if (allLbs.length === 0) return;

  services.push({
    service_type: 'scw_lb',
    display_name: 'Load Balancers',
    count: allLbs.length,
    details: `${allLbs.length} load balancer${allLbs.length !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: false,
  });

  for (const lb of allLbs) {
    const status = lb.status === 'ready' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: lb.name || lb.id,
      provider: 'scaleway', category: 'networking', resource_type: 'scw_lb',
      region: lb.zone || region, cloud_id: lb.id, cloud_account_id: projectId,
      metadata: {
        type: lb.type,
        zone: lb.zone,
        ip_count: lb.ip?.length,
      },
      status,
      status_reason: status !== 'healthy' ? `Status: ${lb.status}` : null,
    }));
  }
}

async function discoverMessaging(
  secretKey: string, projectId: string, region: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  // NATS accounts
  try {
    const natsData = await scwFetch(
      `/mnq/v1beta1/regions/${region}/nats-accounts?project_id=${projectId}&per_page=100`,
      secretKey,
    );
    const natsAccounts = natsData?.nats_accounts || [];

    if (natsAccounts.length > 0) {
      services.push({
        service_type: 'scw_nats',
        display_name: 'NATS (Messaging)',
        count: natsAccounts.length,
        details: `${natsAccounts.length} NATS account${natsAccounts.length !== 1 ? 's' : ''} (${region})`,
        recommended: true,
        high_cardinality: false,
      });

      for (const account of natsAccounts) {
        assets.push(makeAsset({
          name: account.name || account.id,
          provider: 'scaleway', category: 'queue', resource_type: 'scw_nats',
          region, cloud_id: account.id, cloud_account_id: projectId,
          metadata: { endpoint: account.endpoint },
        }));
      }
    }
  } catch {
    // MNQ may not be enabled
  }

  // SQS queues info
  try {
    const sqsData = await scwFetch(
      `/mnq/v1beta1/regions/${region}/sqs-info?project_id=${projectId}`,
      secretKey,
    );
    const sqsInfo = sqsData?.sqs_info || [];
    const active = sqsInfo.filter((s: any) => s.status === 'enabled');

    if (active.length > 0) {
      services.push({
        service_type: 'scw_sqs',
        display_name: 'Scaleway Queues (SQS)',
        count: active.length,
        details: `${active.length} SQS project${active.length !== 1 ? 's' : ''} enabled (${region})`,
        recommended: true,
        high_cardinality: false,
      });

      assets.push(makeAsset({
        name: `Scaleway Queues (${region})`,
        provider: 'scaleway', category: 'queue', resource_type: 'scw_sqs',
        region, cloud_id: `scw_sqs:${projectId}:${region}`, cloud_account_id: projectId,
        is_aggregate: true, aggregate_count: active.length,
      }));
    }
  } catch {
    // Non-fatal
  }
}

async function discoverObjectStorage(
  secretKey: string, projectId: string, region: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  // Scaleway Object Storage is S3-compatible; use @aws-sdk/client-s3 with custom endpoint
  try {
    const s3 = new S3Client({
      endpoint: `https://s3.${region}.scw.cloud`,
      region,
      credentials: {
        // For S3-compatible auth, access key = project ID, secret = secret key
        accessKeyId: projectId || 'scw',
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
    const resp = await s3.send(new ListBucketsCommand({}));
    const buckets = resp.Buckets || [];

    if (buckets.length === 0) return;

    services.push({
      service_type: 'scw_object_storage',
      display_name: 'Object Storage Buckets',
      count: buckets.length,
      details: `${buckets.length} bucket${buckets.length !== 1 ? 's' : ''} (${region})`,
      recommended: false,
      high_cardinality: true,
    });

    assets.push(makeAsset({
      name: `${buckets.length} Object Storage bucket${buckets.length !== 1 ? 's' : ''}`,
      provider: 'scaleway', category: 'storage', resource_type: 'scw_object_storage',
      region, cloud_id: `aggregate:scw_object_storage:${projectId}:${region}`, cloud_account_id: projectId,
      is_aggregate: true, aggregate_count: buckets.length,
    }));
  } catch {
    // S3-compatible auth may require a dedicated S3 access key — non-fatal
  }
}
