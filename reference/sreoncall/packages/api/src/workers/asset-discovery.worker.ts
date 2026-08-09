import { ObservabilityConnection } from '../models/observability-connection.model';
import { discoverCloudServices } from '../services/cloud-discovery.service';
import { discoverFromLgtm, buildAssetIdentityMap, AssetIdentityMap } from '../services/lgtm-discovery.service';
import { upsertDiscoveredAssets, removeStaleAssets } from '../services/asset.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 15 * 60_000; // 15 minutes
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Find all active connections across all tenants
    const rawConnections = await ObservabilityConnection.find({
      status: { $in: ['connected', 'pending'] },
    }).lean();

    if (rawConnections.length === 0) return;

    logger.debug(`Asset discovery worker: processing ${rawConnections.length} connections`);

    const CLOUD_PROVIDERS = ['aws', 'gcp', 'azure', 'scaleway', 'digitalocean', 'heroku', 'supabase', 'vercel'];

    // Sort so cloud-provider connections run BEFORE managed LGTM ones. This
    // ensures the per-tenant asset identity map is populated from the cloud
    // SDK before any LGTM discovery fires — so LGTM never races ahead and
    // creates duplicate clusters/nodes under synthetic lgtm-… cloud_ids.
    const connections = [...rawConnections].sort((a, b) => {
      const aIsCloud = CLOUD_PROVIDERS.includes((a.config?.cloud_provider as string) ?? '');
      const bIsCloud = CLOUD_PROVIDERS.includes((b.config?.cloud_provider as string) ?? '');
      if (aIsCloud === bIsCloud) return 0;
      return aIsCloud ? -1 : 1;
    });

    // Precompute the set of tenants that have at least one cloud-provider
    // connection. The managed branch uses this (not the per-tick
    // lgtmDiscoveredTenants set) to decide whether to skip — that way a
    // transient cloud-SDK error doesn't leak a self_managed run through
    // the managed branch, which would dedupe-miss and write `lgtm-…` /
    // `self_managed` duplicates on the failing tick.
    const cloudProviderTenants = new Set<string>();
    for (const c of rawConnections) {
      const cp = c.config?.cloud_provider as string | undefined;
      if (cp && CLOUD_PROVIDERS.includes(cp)) {
        cloudProviderTenants.add(String(c.tenant_id));
      }
    }

    // Track tenants that have already had LGTM discovery run (avoid duplicates)
    const lgtmDiscoveredTenants = new Set<string>();
    // Per-tenant identity map — fingerprint → cloud_id from cloud SDK
    // discovery, consulted by LGTM discovery in both branches below.
    const identityMapByTenant = new Map<string, AssetIdentityMap>();
    // Per-tenant default region — derived from the cloud SDK's managed K8s
    // cluster. Propagated into LGTM discovery so K8s workloads / Beyla
    // services inherit `fr-par` / `us-east-1` / etc. instead of the legacy
    // on-premise default.
    const regionByTenant = new Map<string, string>();

    for (const conn of connections) {
      const tenantId = String(conn.tenant_id);
      const connectionId = String(conn._id);

      try {
        const cloudProvider = conn.config?.cloud_provider as string | undefined;

        if (cloudProvider && CLOUD_PROVIDERS.includes(cloudProvider)) {
          // Cloud provider API discovery (Scaleway, AWS, GCP, etc.)
          const credentials = (conn.config?.credentials as Record<string, string>) || {};
          const discovery = await discoverCloudServices(cloudProvider as any, credentials);
          if (discovery.assets.length > 0) {
            await upsertDiscoveredAssets(tenantId, connectionId, discovery.assets, cloudProvider);
            const seenCloudIds = discovery.assets.map((a) => a.cloud_id);
            await removeStaleAssets(tenantId, connectionId, seenCloudIds);
          }

          // Populate the per-tenant identity map from this cloud SDK's
          // discovered assets (clusters + VMs). Merge with any map built
          // from a prior cloud connection for the same tenant.
          const sdkMap = buildAssetIdentityMap(discovery.assets);
          const existing = identityMapByTenant.get(tenantId);
          if (existing) {
            for (const [k, v] of sdkMap) existing.set(k, v);
          } else {
            identityMapByTenant.set(tenantId, sdkMap);
          }

          // Derive default region from the first managed K8s cluster found
          // in this cloud SDK's assets. LGTM-discovered workloads inherit
          // it (e.g. `fr-par`) instead of the legacy on-premise default.
          if (!regionByTenant.has(tenantId)) {
            const managedCluster = discovery.assets.find(
              (a) => a.category === 'kubernetes' &&
                ['kapsule', 'eks', 'gke', 'aks', 'doks'].includes(a.resource_type),
            );
            if (managedCluster?.region) regionByTenant.set(tenantId, managedCluster.region);
          }

          // Also run LGTM discovery for tenants with cloud providers that may have
          // K8s agents sending telemetry (workloads, pods, services)
          if (!lgtmDiscoveredTenants.has(tenantId)) {
            lgtmDiscoveredTenants.add(tenantId);
            try {
              const lgtmResult = await discoverFromLgtm(
                MANAGED_MIMIR_URL, tenantId, cloudProvider,
                identityMapByTenant.get(tenantId),
                regionByTenant.get(tenantId),
              );
              if (lgtmResult.assets.length > 0) {
                await upsertDiscoveredAssets(tenantId, connectionId, lgtmResult.assets, cloudProvider);
              }
            } catch (_lgtmErr: any) {
              // Non-fatal: LGTM discovery may fail if no agent is installed yet
            }
          }
        } else if (conn.mode === 'managed') {
          // Skip if this tenant has any cloud-provider connection — the
          // cloud branch is responsible for LGTM discovery for that tenant.
          // Gating on `cloudProviderTenants` (not `lgtmDiscoveredTenants`)
          // means we skip even on ticks where the cloud SDK errored
          // transiently, so we never create duplicate `lgtm-…` /
          // self_managed rows under this connection.
          if (cloudProviderTenants.has(tenantId)) continue;
          if (lgtmDiscoveredTenants.has(tenantId)) continue;

          const lgtmResult = await discoverFromLgtm(
            MANAGED_MIMIR_URL, tenantId, undefined,
            identityMapByTenant.get(tenantId),
            regionByTenant.get(tenantId),
          );
          lgtmDiscoveredTenants.add(tenantId);
          if (lgtmResult.assets.length > 0) {
            await upsertDiscoveredAssets(tenantId, connectionId, lgtmResult.assets, undefined);
            const seenCloudIds = lgtmResult.assets.map((a: any) => a.cloud_id);
            await removeStaleAssets(tenantId, connectionId, seenCloudIds);
          }
        }
      } catch (err: any) {
        logger.warn(`Asset discovery failed for connection ${connectionId}`, {
          tenantId,
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Asset discovery worker tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

export function startAssetDiscoveryWorker(): void {
  logger.info('Starting asset discovery worker (interval: 15min)');
  // Delay first run by 30s to let the server fully start
  setTimeout(() => {
    tick().catch(() => {});
    timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
  }, 30_000);
}

export function stopAssetDiscoveryWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logger.info('Asset discovery worker stopped');
}
