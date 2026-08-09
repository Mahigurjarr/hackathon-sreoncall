import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';
import type { DiscoveredAsset, DiscoveredService, CloudDiscoveryResult } from './cloud-discovery.service';

const DO_API = 'https://api.digitalocean.com/v2';

interface DOCreds {
  api_token?: string;
  spaces_key?: string;
  spaces_secret?: string;
  spaces_region?: string;
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

async function doFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`${DO_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`DigitalOcean API ${path} returned ${res.status}`);
  }
  return res.json();
}

export async function discoverDigitalOceanReal(credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  const creds = credentials as DOCreds;
  const token = creds.api_token || '';

  if (!token) {
    throw new Error('DigitalOcean api_token is required');
  }

  // Verify credentials and get account ID
  let accountId = '';
  let accountEmail = '';
  try {
    const data = await doFetch('/account', token);
    accountId = data?.account?.uuid || '';
    accountEmail = data?.account?.email || '';
  } catch (err: any) {
    logger.warn('Failed to verify DigitalOcean account', { error: err.message });
    throw new Error('Invalid DigitalOcean API token');
  }

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  const results = await Promise.allSettled([
    discoverDroplets(token, accountId, assets, services),
    discoverKubernetes(token, accountId, assets, services),
    discoverDatabases(token, accountId, assets, services),
    discoverLoadBalancers(token, accountId, assets, services),
    discoverApps(token, accountId, assets, services),
    discoverFunctions(token, accountId, assets, services),
    discoverSpaces(creds, accountId, assets, services),
  ]);

  for (const r of results) {
    if (r.status === 'rejected') {
      logger.warn('DigitalOcean discovery sub-task failed', { error: r.reason?.message });
    }
  }

  return {
    provider: 'digitalocean',
    services,
    assets,
    recommended_alerts: [
      'Droplet CPU utilization > 80%',
      'Managed database connections > 90% of max',
      'Kubernetes pod restart count > 5 in 10m',
      'Load balancer 5xx error rate > 1%',
      'App Platform deployment failure',
      'Redis memory utilization > 85%',
    ],
    recommended_dashboards: [
      'DigitalOcean Infrastructure Overview',
      'Droplets Fleet Health',
      'Managed Databases Performance',
      'Kubernetes (DOKS) Health',
      'App Platform & Functions',
      'Load Balancer Traffic',
    ],
  };
}

async function discoverDroplets(
  token: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await doFetch('/droplets?per_page=200', token);
  const droplets: any[] = data?.droplets || [];
  const active = droplets.filter((d: any) => d.status === 'active');

  if (active.length === 0) return;

  services.push({
    service_type: 'droplet',
    display_name: 'Droplets',
    count: active.length,
    details: `${active.length} active droplet${active.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: active.length > 20,
  });

  if (active.length > 10) {
    assets.push(makeAsset({
      name: `${active.length} Droplets`,
      provider: 'digitalocean', category: 'compute', resource_type: 'droplet',
      region: 'multi-region', cloud_id: `aggregate:droplet:${accountId}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: active.length,
    }));
  } else {
    for (const d of active) {
      const publicIp = d.networks?.v4?.find((n: any) => n.type === 'public')?.ip_address;
      assets.push(makeAsset({
        name: d.name || String(d.id),
        provider: 'digitalocean', category: 'compute', resource_type: 'droplet',
        region: d.region?.slug || '', cloud_id: String(d.id), cloud_account_id: accountId,
        metadata: {
          size_slug: d.size_slug,
          vcpus: d.vcpus,
          memory_mb: d.memory,
          disk_gb: d.disk,
          image: d.image?.name,
          public_ip: publicIp,
          tags: d.tags,
        },
        status: d.status === 'active' ? 'healthy' : 'degraded',
      }));
    }
  }
}

async function discoverKubernetes(
  token: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await doFetch('/kubernetes/clusters?per_page=200', token);
  const clusters: any[] = data?.kubernetes_clusters || [];

  if (clusters.length === 0) return;

  services.push({
    service_type: 'doks',
    display_name: 'Kubernetes (DOKS)',
    count: clusters.length,
    details: `${clusters.length} cluster${clusters.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const c of clusters) {
    const state = c.status?.state;
    const status = state === 'running' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: c.name || c.id,
      provider: 'digitalocean', category: 'kubernetes', resource_type: 'doks',
      region: c.region || '', cloud_id: c.id, cloud_account_id: accountId,
      metadata: {
        version: c.version,
        node_pools: c.node_pools?.length,
        endpoint: c.endpoint,
        tags: c.tags,
      },
      status,
      status_reason: status !== 'healthy' ? `State: ${state}` : null,
    }));
  }
}

async function discoverDatabases(
  token: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await doFetch('/databases?per_page=200', token);
  const dbs: any[] = data?.databases || [];

  if (dbs.length === 0) return;

  // Group by engine for service summary
  const engineGroups: Record<string, any[]> = {};
  for (const db of dbs) {
    const engine = db.engine || 'unknown';
    if (!engineGroups[engine]) engineGroups[engine] = [];
    engineGroups[engine].push(db);
  }

  const engineLabels: Record<string, { display: string; category: 'database' | 'cache' | 'queue' }> = {
    pg:         { display: 'PostgreSQL',  category: 'database' },
    mysql:      { display: 'MySQL',       category: 'database' },
    mongodb:    { display: 'MongoDB',     category: 'database' },
    redis:      { display: 'Redis',       category: 'cache' },
    valkey:     { display: 'Valkey',      category: 'cache' },
    kafka:      { display: 'Kafka',       category: 'queue' },
    opensearch: { display: 'OpenSearch',  category: 'database' },
  };

  for (const [engine, items] of Object.entries(engineGroups)) {
    const meta = engineLabels[engine] || { display: engine, category: 'database' as const };
    services.push({
      service_type: `do_db_${engine}`,
      display_name: `Managed ${meta.display}`,
      count: items.length,
      details: `${items.length} ${meta.display} cluster${items.length !== 1 ? 's' : ''}`,
      recommended: true,
      high_cardinality: false,
    });

    for (const db of items) {
      const status = db.status === 'online' ? 'healthy' : 'degraded';
      assets.push(makeAsset({
        name: db.name || db.id,
        provider: 'digitalocean', category: meta.category, resource_type: `do_db_${engine}`,
        region: db.region || '', cloud_id: db.id, cloud_account_id: accountId,
        metadata: {
          engine: `${meta.display} ${db.version || ''}`.trim(),
          size: db.size,
          num_nodes: db.num_nodes,
        },
        status,
        status_reason: status !== 'healthy' ? `Status: ${db.status}` : null,
      }));
    }
  }
}

async function discoverLoadBalancers(
  token: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await doFetch('/load_balancers?per_page=200', token);
  const lbs: any[] = data?.load_balancers || [];

  if (lbs.length === 0) return;

  services.push({
    service_type: 'do_lb',
    display_name: 'Load Balancers',
    count: lbs.length,
    details: `${lbs.length} load balancer${lbs.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const lb of lbs) {
    const status = lb.status === 'active' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: lb.name || lb.id,
      provider: 'digitalocean', category: 'networking', resource_type: 'do_lb',
      region: lb.region?.slug || '', cloud_id: lb.id, cloud_account_id: accountId,
      metadata: {
        ip: lb.ip,
        algorithm: lb.algorithm,
        droplet_count: lb.droplet_ids?.length,
        forwarding_rules: lb.forwarding_rules?.length,
      },
      status,
      status_reason: status !== 'healthy' ? `Status: ${lb.status}` : null,
    }));
  }
}

async function discoverApps(
  token: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await doFetch('/apps?per_page=200', token);
  const apps: any[] = data?.apps || [];

  if (apps.length === 0) return;

  services.push({
    service_type: 'do_app',
    display_name: 'App Platform',
    count: apps.length,
    details: `${apps.length} app${apps.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: apps.length > 10,
  });

  if (apps.length > 10) {
    assets.push(makeAsset({
      name: `${apps.length} App Platform apps`,
      provider: 'digitalocean', category: 'app_platform', resource_type: 'do_app',
      region: 'multi-region', cloud_id: `aggregate:do_app:${accountId}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: apps.length,
    }));
  } else {
    for (const app of apps) {
      const phase = app.active_deployment?.phase;
      const status = phase === 'ACTIVE' ? 'healthy' : phase === 'ERROR' ? 'unhealthy' : 'degraded';
      assets.push(makeAsset({
        name: app.spec?.name || app.id,
        provider: 'digitalocean', category: 'app_platform', resource_type: 'do_app',
        region: app.region?.slug || '', cloud_id: app.id, cloud_account_id: accountId,
        metadata: {
          live_url: app.live_url,
          tier: app.tier_slug,
          phase,
        },
        status,
        status_reason: status !== 'healthy' ? `Phase: ${phase}` : null,
      }));
    }
  }
}

async function discoverFunctions(
  token: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const data = await doFetch('/functions/namespaces?per_page=200', token);
  const namespaces: any[] = data?.namespaces || [];

  if (namespaces.length === 0) return;

  // Count total functions across all namespaces
  let totalFunctions = 0;
  await Promise.allSettled(
    namespaces.map(async (ns: any) => {
      try {
        const fnData = await doFetch(`/functions/namespaces/${ns.namespace}/functions?per_page=200`, token);
        totalFunctions += (fnData?.functions || []).length;
      } catch {
        // Non-fatal
      }
    }),
  );

  const count = totalFunctions || namespaces.length;

  services.push({
    service_type: 'do_functions',
    display_name: 'Serverless Functions',
    count,
    details: `${count} function${count !== 1 ? 's' : ''} (${namespaces.length} namespace${namespaces.length !== 1 ? 's' : ''})`,
    recommended: true,
    high_cardinality: count > 10,
  });

  assets.push(makeAsset({
    name: `${count} Serverless Function${count !== 1 ? 's' : ''}`,
    provider: 'digitalocean', category: 'serverless', resource_type: 'do_functions',
    region: namespaces[0]?.region || '', cloud_id: `aggregate:do_functions:${accountId}`, cloud_account_id: accountId,
    is_aggregate: true, aggregate_count: count,
  }));
}

async function discoverSpaces(
  creds: DOCreds, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  // Spaces uses S3-compatible API; requires separate Spaces access key/secret
  if (!creds.spaces_key || !creds.spaces_secret) return;

  const region = creds.spaces_region || 'nyc3';

  try {
    const s3 = new S3Client({
      endpoint: `https://${region}.digitaloceanspaces.com`,
      region: 'us-east-1', // Required by AWS SDK for DO Spaces
      credentials: {
        accessKeyId: creds.spaces_key,
        secretAccessKey: creds.spaces_secret,
      },
    });
    const resp = await s3.send(new ListBucketsCommand({}));
    const buckets = resp.Buckets || [];

    if (buckets.length === 0) return;

    services.push({
      service_type: 'do_spaces',
      display_name: 'Spaces (Object Storage)',
      count: buckets.length,
      details: `${buckets.length} bucket${buckets.length !== 1 ? 's' : ''} (${region})`,
      recommended: false,
      high_cardinality: true,
    });

    assets.push(makeAsset({
      name: `${buckets.length} Spaces bucket${buckets.length !== 1 ? 's' : ''}`,
      provider: 'digitalocean', category: 'storage', resource_type: 'do_spaces',
      region, cloud_id: `aggregate:do_spaces:${accountId}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: buckets.length,
    }));
  } catch (err: any) {
    logger.warn('DigitalOcean Spaces discovery failed', { error: err.message });
  }
}
