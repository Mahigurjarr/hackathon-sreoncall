import { google } from 'googleapis';
import { logger } from '../utils/logger';
import type {
  DiscoveredAsset,
  DiscoveredService,
  CloudDiscoveryResult,
} from './cloud-discovery.service';

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

interface ParsedServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

/**
 * Accept any of:
 *   { service_account_key: "<json string>" }
 *   { service_account_json: "<json string>" }  (frontend field name)
 *   { project_id, client_email, private_key }
 *   { project_id, service_account_json }
 */
export function parseGCPCredentials(
  credentials: Record<string, string>,
): ParsedServiceAccount {
  const rawJson =
    credentials.service_account_key || credentials.service_account_json || '';

  if (rawJson) {
    let parsed: any;
    try {
      parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    } catch (err: any) {
      throw new Error(
        `GCP service_account_json is not valid JSON: ${err.message}`,
      );
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        'GCP service account JSON is missing required fields (client_email, private_key).',
      );
    }
    const project_id =
      parsed.project_id || credentials.project_id || '';
    if (!project_id) {
      throw new Error('GCP project_id is required (not found in service account JSON or credentials).');
    }
    return {
      ...parsed,
      project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  if (credentials.project_id && credentials.client_email && credentials.private_key) {
    return {
      project_id: credentials.project_id,
      client_email: credentials.client_email,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
    };
  }

  throw new Error(
    'GCP credentials required: provide either service_account_json (JSON string) or (project_id + client_email + private_key).',
  );
}

function wrapGCPError(operation: string, err: any): Error {
  const code = err?.code || err?.response?.status;
  const msg = err?.message || String(err);
  if (code === 401 || /UNAUTHENTICATED|invalid_grant|Invalid JWT/i.test(msg)) {
    return new Error(`GCP authentication failed during ${operation}: ${msg}`);
  }
  if (code === 403 || /PERMISSION_DENIED|forbidden/i.test(msg)) {
    return new Error(
      `GCP permission denied during ${operation}: ${msg}. Ensure the service account has the required IAM roles.`,
    );
  }
  if (/SERVICE_DISABLED|has not been used|API .* disabled/i.test(msg)) {
    return new Error(
      `GCP API not enabled for ${operation}: ${msg}. Enable the required API in the GCP console.`,
    );
  }
  return new Error(`GCP ${operation} failed: ${msg}`);
}

export async function discoverGCPReal(
  credentials: Record<string, string>,
): Promise<CloudDiscoveryResult> {
  const creds = parseGCPCredentials(credentials);
  const projectId = creds.project_id;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    } as any,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  // Force credential validation up-front — this throws on bad creds.
  try {
    const client = await auth.getClient();
    await (client as any).getAccessToken();
  } catch (err: any) {
    throw wrapGCPError('authentication', err);
  }

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  const results = await Promise.allSettled([
    discoverGCE(auth, projectId, assets, services),
    discoverGKE(auth, projectId, assets, services),
    discoverCloudSQL(auth, projectId, assets, services),
    discoverCloudRun(auth, projectId, assets, services),
    discoverGCS(auth, projectId, assets, services),
  ]);

  let anySucceeded = false;
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      anySucceeded = true;
    } else {
      errors.push(r.reason?.message || String(r.reason));
      logger.warn('GCP discovery sub-task failed', { error: r.reason?.message });
    }
  }

  // If everything failed, propagate the first error rather than returning empty.
  if (!anySucceeded && errors.length > 0) {
    throw new Error(`GCP discovery failed: ${errors[0]}`);
  }

  return {
    provider: 'gcp',
    services,
    assets,
    recommended_alerts: [
      'Compute Engine CPU utilization > 80%',
      'Cloud SQL connection count > 90% of max',
      'GKE pod restart count > 5 in 10m',
      'Cloud Run request latency p99 > 2s',
      'Cloud Run 5xx error rate > 1%',
      'GCS bucket error rate > 1%',
    ],
    recommended_dashboards: [
      'GCP Infrastructure Overview',
      'Compute Engine Fleet Health',
      'Cloud SQL Performance',
      'GKE Cluster Health',
      'Cloud Run Services',
    ],
  };
}

async function discoverGCE(
  auth: any,
  projectId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const compute = google.compute('v1');
  let resp;
  try {
    resp = await compute.instances.aggregatedList({ auth, project: projectId, maxResults: 500 });
  } catch (err: any) {
    throw wrapGCPError('Compute Engine instances.aggregatedList', err);
  }

  const items = (resp.data.items || {}) as Record<string, any>;
  const instances: any[] = [];
  for (const [zoneKey, zoneData] of Object.entries(items)) {
    if (zoneData?.instances?.length) {
      for (const inst of zoneData.instances) {
        instances.push({ ...inst, _zone: zoneKey.replace('zones/', '') });
      }
    }
  }

  const running = instances.filter((i) => i.status === 'RUNNING');

  services.push({
    service_type: 'compute_engine',
    display_name: 'Compute Engine Instances',
    count: running.length,
    details: `${running.length} running instances`,
    recommended: true,
    high_cardinality: running.length > 20,
  });

  if (running.length > 10) {
    assets.push(
      makeAsset({
        name: `${running.length} Compute Engine instances`,
        provider: 'gcp',
        category: 'compute',
        resource_type: 'compute_engine',
        region: '',
        cloud_id: `aggregate:compute_engine:${projectId}`,
        cloud_account_id: projectId,
        is_aggregate: true,
        aggregate_count: running.length,
      }),
    );
  } else {
    for (const inst of running) {
      const zone = inst._zone || '';
      const region = zone.replace(/-[a-z]$/, '');
      assets.push(
        makeAsset({
          name: inst.name || 'unnamed',
          provider: 'gcp',
          category: 'compute',
          resource_type: 'compute_engine',
          region,
          cloud_id: `projects/${projectId}/zones/${zone}/instances/${inst.name}`,
          cloud_account_id: projectId,
          metadata: {
            machine_type: (inst.machineType || '').split('/').pop(),
            zone,
            network_ip: inst.networkInterfaces?.[0]?.networkIP,
            creation_timestamp: inst.creationTimestamp,
          },
          status: 'healthy',
        }),
      );
    }
  }
}

async function discoverGKE(
  auth: any,
  projectId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const container = google.container('v1');
  let resp;
  try {
    resp = await container.projects.locations.clusters.list({
      auth,
      parent: `projects/${projectId}/locations/-`,
    });
  } catch (err: any) {
    throw wrapGCPError('GKE clusters.list', err);
  }

  const clusters = resp.data.clusters || [];

  services.push({
    service_type: 'gke',
    display_name: 'GKE Clusters',
    count: clusters.length,
    details: `${clusters.length} cluster${clusters.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const c of clusters) {
    const status = c.status === 'RUNNING' ? 'healthy' : 'degraded';
    assets.push(
      makeAsset({
        name: c.name || 'unnamed',
        provider: 'gcp',
        category: 'kubernetes',
        resource_type: 'gke',
        region: c.location || '',
        cloud_id: `projects/${projectId}/locations/${c.location}/clusters/${c.name}`,
        cloud_account_id: projectId,
        metadata: {
          version: c.currentMasterVersion,
          node_count: c.currentNodeCount,
          endpoint: c.endpoint,
          network: c.network,
        },
        status,
        status_reason: status !== 'healthy' ? `Status: ${c.status}` : null,
      }),
    );
  }
}

async function discoverCloudSQL(
  auth: any,
  projectId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const sqladmin = google.sqladmin('v1');
  let resp;
  try {
    resp = await sqladmin.instances.list({ auth, project: projectId });
  } catch (err: any) {
    throw wrapGCPError('Cloud SQL instances.list', err);
  }

  const dbs = resp.data.items || [];

  services.push({
    service_type: 'cloud_sql',
    display_name: 'Cloud SQL Databases',
    count: dbs.length,
    details: `${dbs.length} instance${dbs.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const db of dbs) {
    const status = db.state === 'RUNNABLE' ? 'healthy' : 'degraded';
    assets.push(
      makeAsset({
        name: db.name || 'unnamed',
        provider: 'gcp',
        category: 'database',
        resource_type: 'cloud_sql',
        region: db.region || '',
        cloud_id: `projects/${projectId}/instances/${db.name}`,
        cloud_account_id: projectId,
        metadata: {
          engine: db.databaseVersion,
          tier: db.settings?.tier,
          availability_type: db.settings?.availabilityType,
        },
        status,
        status_reason: status !== 'healthy' ? `State: ${db.state}` : null,
      }),
    );
  }
}

async function discoverCloudRun(
  auth: any,
  projectId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const run = google.run('v2');
  let resp;
  try {
    resp = await run.projects.locations.services.list({
      auth,
      parent: `projects/${projectId}/locations/-`,
    });
  } catch (err: any) {
    throw wrapGCPError('Cloud Run services.list', err);
  }

  const svcs = resp.data.services || [];

  services.push({
    service_type: 'cloud_run',
    display_name: 'Cloud Run Services',
    count: svcs.length,
    details: `${svcs.length} service${svcs.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: svcs.length > 20,
  });

  for (const s of svcs) {
    // name is projects/p/locations/l/services/svc
    const parts = (s.name || '').split('/');
    const serviceName = parts[parts.length - 1] || 'unnamed';
    const region = parts[3] || '';
    assets.push(
      makeAsset({
        name: serviceName,
        provider: 'gcp',
        category: 'serverless',
        resource_type: 'cloud_run',
        region,
        cloud_id: s.name || '',
        cloud_account_id: projectId,
        metadata: {
          uri: s.uri,
          latest_ready_revision: s.latestReadyRevision,
          create_time: s.createTime,
        },
      }),
    );
  }
}

async function discoverGCS(
  auth: any,
  projectId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const storage = google.storage('v1');
  let resp;
  try {
    resp = await storage.buckets.list({ auth, project: projectId });
  } catch (err: any) {
    throw wrapGCPError('Cloud Storage buckets.list', err);
  }

  const buckets = resp.data.items || [];
  if (buckets.length === 0) return;

  services.push({
    service_type: 'cloud_storage',
    display_name: 'Cloud Storage Buckets',
    count: buckets.length,
    details: `${buckets.length} bucket${buckets.length !== 1 ? 's' : ''}`,
    recommended: false,
    high_cardinality: true,
  });

  assets.push(
    makeAsset({
      name: `${buckets.length} Cloud Storage buckets`,
      provider: 'gcp',
      category: 'storage',
      resource_type: 'cloud_storage',
      region: 'global',
      cloud_id: `aggregate:cloud_storage:${projectId}`,
      cloud_account_id: projectId,
      is_aggregate: true,
      aggregate_count: buckets.length,
    }),
  );
}
