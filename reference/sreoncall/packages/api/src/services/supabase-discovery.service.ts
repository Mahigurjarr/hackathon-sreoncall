import { logger } from '../utils/logger';
import type { DiscoveredAsset, DiscoveredService, CloudDiscoveryResult } from './cloud-discovery.service';

const SUPABASE_API = 'https://api.supabase.com/v1';

function makeAsset(
  overrides: Partial<DiscoveredAsset> &
    Pick<DiscoveredAsset, 'name' | 'provider' | 'category' | 'resource_type' | 'cloud_id'>,
): DiscoveredAsset {
  return {
    region: '', cloud_account_id: '', metadata: {}, status: 'healthy', status_reason: null,
    parent_cloud_id: null, k8s_namespace: null, k8s_kind: null, k8s_replicas_desired: null,
    k8s_replicas_ready: null, k8s_pod_issues: [], is_aggregate: false, aggregate_count: null,
    ...overrides,
  };
}

async function supabaseFetch(path: string, accessToken: string): Promise<any> {
  const res = await fetch(`${SUPABASE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Supabase API ${path} returned ${res.status}`);
  return res.json();
}

export async function discoverSupabaseReal(credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  const accessToken = credentials.access_token || '';
  if (!accessToken) throw new Error('Supabase access_token is required');

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  // Discover projects
  const projects = await supabaseFetch('/projects', accessToken);
  if (!Array.isArray(projects) || projects.length === 0) {
    return { provider: 'supabase', services, assets, recommended_alerts: [], recommended_dashboards: [] };
  }

  services.push({
    service_type: 'supabase_project', display_name: 'Supabase Projects',
    count: projects.length, details: `${projects.length} project${projects.length !== 1 ? 's' : ''}`,
    recommended: true, high_cardinality: false,
  });

  for (const proj of projects) {
    const status = proj.status === 'ACTIVE_HEALTHY' ? 'healthy' : 'degraded';

    // Project as top-level asset
    assets.push(makeAsset({
      name: proj.name || proj.id,
      provider: 'supabase',
      category: 'app_platform',
      resource_type: 'supabase_project',
      region: proj.region || '',
      cloud_id: proj.id,
      cloud_account_id: proj.organization_id || '',
      metadata: {
        status: proj.status,
        database_host: proj.database?.host,
        created_at: proj.created_at,
      },
      status,
      status_reason: status !== 'healthy' ? `Status: ${proj.status}` : null,
    }));

    // Database as child asset
    if (proj.database) {
      assets.push(makeAsset({
        name: `${proj.name || proj.id}/postgres`,
        provider: 'supabase',
        category: 'database',
        resource_type: 'supabase_database',
        region: proj.region || '',
        cloud_id: `${proj.id}:database`,
        parent_cloud_id: proj.id,
        metadata: { host: proj.database.host, version: proj.database.version },
        status,
      }));
    }

    // Auth service as child asset
    try {
      const authConfig = await supabaseFetch(`/projects/${proj.ref || proj.id}/auth/config`, accessToken);
      assets.push(makeAsset({
        name: `${proj.name || proj.id}/auth`,
        provider: 'supabase',
        category: 'app_platform',
        resource_type: 'supabase_auth',
        cloud_id: `${proj.id}:auth`,
        parent_cloud_id: proj.id,
        metadata: {
          external_providers: authConfig?.external || {},
          mfa_enabled: authConfig?.MFA_ENABLED,
        },
        status: 'healthy',
      }));
    } catch {
      // Auth config may not be accessible
    }
  }

  const dbCount = assets.filter((a) => a.resource_type === 'supabase_database').length;
  if (dbCount > 0) {
    services.push({
      service_type: 'supabase_database', display_name: 'PostgreSQL Databases',
      count: dbCount, details: `${dbCount} database${dbCount !== 1 ? 's' : ''}`,
      recommended: true, high_cardinality: false,
    });
  }

  return {
    provider: 'supabase',
    services,
    assets,
    recommended_alerts: [
      'Database connections > 80%',
      'Auth error rate > 5%',
      'Database disk usage > 90%',
      'Realtime connections > 80% of limit',
    ],
    recommended_dashboards: [
      'Supabase Overview',
      'Database Performance',
      'Auth & Users',
      'Realtime Connections',
    ],
  };
}
