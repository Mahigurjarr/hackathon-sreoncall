import { logger } from '../utils/logger';
import type { DiscoveredAsset, DiscoveredService, CloudDiscoveryResult } from './cloud-discovery.service';

const VERCEL_API = 'https://api.vercel.com';

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

async function vercelFetch(path: string, token: string, teamId?: string): Promise<any> {
  const url = new URL(`${VERCEL_API}${path}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Vercel API ${path} returned ${res.status}`);
  return res.json();
}

export async function discoverVercelReal(credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  const token = credentials.api_token || '';
  const teamId = credentials.team_id || undefined;
  if (!token) throw new Error('Vercel api_token is required');

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  // Discover projects
  const projectsRes = await vercelFetch('/v6/projects', token, teamId);
  const projects = projectsRes?.projects || [];

  if (projects.length === 0) {
    return { provider: 'vercel', services, assets, recommended_alerts: [], recommended_dashboards: [] };
  }

  services.push({
    service_type: 'vercel_project', display_name: 'Vercel Projects',
    count: projects.length, details: `${projects.length} project${projects.length !== 1 ? 's' : ''}`,
    recommended: true, high_cardinality: false,
  });

  for (const proj of projects) {
    const framework = proj.framework || 'unknown';
    const status = proj.targets?.production ? 'healthy' : 'unknown';

    assets.push(makeAsset({
      name: proj.name,
      provider: 'vercel',
      category: 'app_platform',
      resource_type: 'vercel_project',
      cloud_id: proj.id,
      cloud_account_id: proj.accountId || teamId || '',
      metadata: {
        framework,
        git_repo: proj.link?.repo,
        git_provider: proj.link?.type,
        production_url: proj.targets?.production?.alias?.[0],
        created_at: proj.createdAt,
        updated_at: proj.updatedAt,
      },
      status,
    }));

    // Discover custom domains for this project
    try {
      const domainsRes = await vercelFetch(`/v6/projects/${proj.id}/domains`, token, teamId);
      const domains = domainsRes?.domains || [];
      for (const d of domains) {
        assets.push(makeAsset({
          name: d.name,
          provider: 'vercel',
          category: 'networking',
          resource_type: 'vercel_domain',
          cloud_id: `${proj.id}:domain:${d.name}`,
          parent_cloud_id: proj.id,
          metadata: {
            verified: d.verified,
            configured: d.configured,
            redirect: d.redirect,
          },
          status: d.verified && d.configured ? 'healthy' : 'degraded',
          status_reason: !d.verified ? 'Domain not verified' : !d.configured ? 'DNS not configured' : null,
        }));
      }
    } catch {
      // Domain listing may fail — non-fatal
    }
  }

  const domainCount = assets.filter((a) => a.resource_type === 'vercel_domain').length;
  if (domainCount > 0) {
    services.push({
      service_type: 'vercel_domain', display_name: 'Custom Domains',
      count: domainCount, details: `${domainCount} domain${domainCount !== 1 ? 's' : ''}`,
      recommended: false, high_cardinality: false,
    });
  }

  return {
    provider: 'vercel',
    services,
    assets,
    recommended_alerts: [
      'Deployment failure',
      'Build time > 5 minutes',
      'Function invocation errors > 5%',
      'Edge function latency P99 > 500ms',
    ],
    recommended_dashboards: [
      'Vercel Projects Overview',
      'Deployment History',
      'Edge Network Performance',
      'Serverless Function Metrics',
    ],
  };
}
