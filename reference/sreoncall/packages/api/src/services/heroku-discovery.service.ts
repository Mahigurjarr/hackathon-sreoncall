import { logger } from '../utils/logger';
import type { DiscoveredAsset, DiscoveredService, CloudDiscoveryResult } from './cloud-discovery.service';

const HEROKU_API = 'https://api.heroku.com';

interface HerokuCreds {
  api_key?: string;
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

async function herokuFetch(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${HEROKU_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/vnd.heroku+json; version=3',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Heroku API ${path} returned ${res.status}`);
  }
  return res.json();
}

// ── Discover apps ────────────────────────────────────────────────────

async function discoverApps(
  apiKey: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
): Promise<string[]> {
  // Fetch personal apps + team apps (deduped by id)
  const personalApps = await herokuFetch('/apps', apiKey);
  const appMap = new Map<string, any>();
  if (Array.isArray(personalApps)) {
    for (const a of personalApps) appMap.set(a.id, a);
  }

  // Also fetch apps from all teams the user belongs to
  try {
    const teams = await herokuFetch('/teams', apiKey);
    if (Array.isArray(teams)) {
      for (const team of teams) {
        try {
          const teamApps = await herokuFetch(`/teams/${team.name}/apps`, apiKey);
          if (Array.isArray(teamApps)) {
            for (const a of teamApps) appMap.set(a.id, a);
          }
        } catch {
          // Team app listing may fail due to permissions — non-fatal
        }
      }
    }
  } catch {
    // No teams — fine
  }

  const apps = [...appMap.values()];
  if (apps.length === 0) return [];

  services.push({
    service_type: 'heroku_app',
    display_name: 'Heroku Apps',
    count: apps.length,
    details: `${apps.length} app${apps.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  const appIds: string[] = [];
  for (const app of apps) {
    const status = app.maintenance ? 'degraded' : 'healthy';
    assets.push(makeAsset({
      name: app.name,
      provider: 'heroku',
      category: 'app_platform',
      resource_type: 'heroku_app',
      region: app.region?.name || '',
      cloud_id: app.id,
      cloud_account_id: app.owner?.email || '',
      metadata: {
        stack: app.stack?.name,
        git_url: app.git_url,
        web_url: app.web_url,
        created_at: app.created_at,
        updated_at: app.updated_at,
        maintenance: app.maintenance,
        buildpack: app.buildpack_provided_description,
      },
      status,
      status_reason: app.maintenance ? 'Maintenance mode enabled' : null,
    }));
    appIds.push(app.id);
  }
  return appIds;
}

// ── Discover dynos per app ───────────────────────────────────────────

async function discoverDynos(
  apiKey: string,
  appName: string,
  appCloudId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  try {
    const dynos = await herokuFetch(`/apps/${appName}/dynos`, apiKey);
    if (!Array.isArray(dynos) || dynos.length === 0) return;

    // Group by type for summary
    const byType = new Map<string, number>();
    for (const d of dynos) {
      byType.set(d.type, (byType.get(d.type) ?? 0) + 1);
    }

    // Create one asset per dyno type (not per individual dyno — dynos are ephemeral)
    for (const [type, count] of byType) {
      const sample = dynos.find((d: any) => d.type === type);
      const state = sample?.state || 'unknown';
      const status = state === 'up' ? 'healthy' : state === 'idle' ? 'healthy' : 'degraded';

      assets.push(makeAsset({
        name: `${appName}/${type}`,
        provider: 'heroku',
        category: 'compute',
        resource_type: 'heroku_dyno',
        cloud_id: `${appCloudId}:dyno:${type}`,
        parent_cloud_id: appCloudId,
        metadata: {
          dyno_type: type,
          size: sample?.size,
          count,
          state,
          command: sample?.command,
        },
        status,
        status_reason: status !== 'healthy' ? `Dyno state: ${state}` : null,
        is_aggregate: count > 1,
        aggregate_count: count > 1 ? count : null,
      }));
    }
  } catch (err: any) {
    logger.warn('Failed to discover dynos for Heroku app', { app: appName, error: err.message });
  }
}

// ── Discover add-ons per app ─────────────────────────────────────────

async function discoverAddons(
  apiKey: string,
  appName: string,
  appCloudId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  try {
    const addons = await herokuFetch(`/apps/${appName}/addons`, apiKey);
    if (!Array.isArray(addons) || addons.length === 0) return;

    for (const addon of addons) {
      const serviceName = addon.addon_service?.name || 'unknown';
      const planName = addon.plan?.name || '';
      const category = inferAddonCategory(serviceName);
      const status = addon.state === 'provisioned' ? 'healthy' : 'degraded';

      assets.push(makeAsset({
        name: addon.name || `${appName}/${serviceName}`,
        provider: 'heroku',
        category,
        resource_type: 'heroku_addon',
        cloud_id: addon.id,
        parent_cloud_id: appCloudId,
        metadata: {
          addon_service: serviceName,
          plan: planName,
          state: addon.state,
          web_url: addon.web_url,
        },
        status,
        status_reason: status !== 'healthy' ? `Add-on state: ${addon.state}` : null,
      }));
    }
  } catch (err: any) {
    logger.warn('Failed to discover add-ons for Heroku app', { app: appName, error: err.message });
  }
}

function inferAddonCategory(serviceName: string): DiscoveredAsset['category'] {
  const lower = serviceName.toLowerCase();
  if (lower.includes('postgres') || lower.includes('mysql') || lower.includes('mongo')) return 'database';
  if (lower.includes('redis') || lower.includes('memcache')) return 'cache';
  if (lower.includes('kafka') || lower.includes('rabbitmq') || lower.includes('cloudamqp')) return 'queue';
  if (lower.includes('s3') || lower.includes('bucket') || lower.includes('storage')) return 'storage';
  if (lower.includes('logging') || lower.includes('papertrail') || lower.includes('logdna')) return 'networking';
  return 'app_platform';
}

// ── Main discovery ───────────────────────────────────────────────────

export async function discoverHerokuReal(credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  const creds = credentials as HerokuCreds;
  const apiKey = creds.api_key || '';

  if (!apiKey) {
    throw new Error('Heroku api_key is required');
  }

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  // Discover apps
  const appIds = await discoverApps(apiKey, assets, services);

  // For each app, discover dynos and add-ons in parallel
  const appAssets = assets.filter((a) => a.resource_type === 'heroku_app');

  const results = await Promise.allSettled(
    appAssets.flatMap((app) => [
      discoverDynos(apiKey, app.name, app.cloud_id, assets, services),
      discoverAddons(apiKey, app.name, app.cloud_id, assets, services),
    ]),
  );

  for (const r of results) {
    if (r.status === 'rejected') {
      logger.warn('Heroku discovery sub-task failed', { error: r.reason?.message });
    }
  }

  // Count dynos and add-ons for services summary
  const dynoAssets = assets.filter((a) => a.resource_type === 'heroku_dyno');
  const addonAssets = assets.filter((a) => a.resource_type === 'heroku_addon');

  if (dynoAssets.length > 0) {
    services.push({
      service_type: 'heroku_dyno',
      display_name: 'Dynos',
      count: dynoAssets.reduce((sum, d) => sum + ((d.metadata as any)?.count || 1), 0),
      details: `${dynoAssets.length} dyno type${dynoAssets.length !== 1 ? 's' : ''} across ${appAssets.length} app${appAssets.length !== 1 ? 's' : ''}`,
      recommended: true,
      high_cardinality: false,
    });
  }

  if (addonAssets.length > 0) {
    services.push({
      service_type: 'heroku_addon',
      display_name: 'Add-ons',
      count: addonAssets.length,
      details: `${addonAssets.length} add-on${addonAssets.length !== 1 ? 's' : ''}`,
      recommended: true,
      high_cardinality: false,
    });
  }

  return {
    provider: 'heroku',
    services,
    assets,
    recommended_alerts: [
      'Dyno memory quota exceeded (R14)',
      'Request timeout (H12)',
      'Boot timeout (R10)',
      'Dyno crash (R10/R99)',
      'PostgreSQL connections > 80%',
      'Worker queue latency > 60s',
    ],
    recommended_dashboards: [
      'Heroku Apps Overview',
      'Dyno Performance & Memory',
      'PostgreSQL Health',
      'Worker Queue Throughput',
      'Error Rate & Response Time',
    ],
  };
}
