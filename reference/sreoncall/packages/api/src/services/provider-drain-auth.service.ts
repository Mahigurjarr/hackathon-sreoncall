import { ObservabilityConnection } from '../models/observability-connection.model';
import { getRedis } from '../config/redis';

const SUPPORTED_PROVIDER_DRAINS = new Set(['heroku', 'supabase', 'vercel']);
const AUTH_CACHE_TTL = 60;

export async function validateProviderDrainToken(
  tenantId: string,
  provider: string,
  drainToken: string,
): Promise<boolean> {
  if (!tenantId || !provider || !drainToken) return false;
  if (!SUPPORTED_PROVIDER_DRAINS.has(provider)) return false;

  const redis = getRedis();
  const cacheKey = `drain_auth:${tenantId}:${provider}:${drainToken}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) return cached === '1';

  const connections = await ObservabilityConnection.find({
    tenant_id: tenantId,
    status: { $in: ['pending', 'connected', 'error'] },
    'config.cloud_provider': provider,
  })
    .select('config')
    .lean();

  if (connections.length === 0) {
    await redis.setex(cacheKey, AUTH_CACHE_TTL, '0');
    return false;
  }

  const enforcedConnections = connections.filter(
    (connection: any) => !!connection?.config?.enforce_drain_token,
  );

  // Legacy rollout: older provider connections continue to accept drain traffic
  // until they are re-onboarded with explicit token enforcement enabled.
  if (enforcedConnections.length === 0) {
    await redis.setex(cacheKey, AUTH_CACHE_TTL, '1');
    return true;
  }

  const result = enforcedConnections.some(
    (connection: any) => connection?.config?.drain_token === drainToken,
  );
  await redis.setex(cacheKey, AUTH_CACHE_TTL, result ? '1' : '0');
  return result;
}
