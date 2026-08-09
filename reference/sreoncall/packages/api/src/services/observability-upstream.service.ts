import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { logger } from '../utils/logger';
import { assertUrlSafe } from '../utils/ssrf-guard';

const MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const QUERY_TIMEOUT_MS = 30_000;

export function getMimirBaseUrl(): string {
  return MIMIR_URL;
}

/** Own-tenant managed org id is the tenant's own id (matches observability-proxy resolveEndpoints). */
export async function resolveOwnOrgId(tenantId: string): Promise<string> {
  return tenantId;
}

/** Resolve the `X-Scope-OrgID` for a provider viewing one/all of its observability consumers. */
export async function resolveConsumerOrgId(
  providerTenantId: string,
  consumerId?: string,
): Promise<{ orgId: string; count: number } | null> {
  const filter: Record<string, unknown> = {
    provider_tenant_id: providerTenantId,
    status: 'active',
    scope: 'observability',
  };
  if (consumerId) filter.consumer_tenant_id = consumerId;

  const links = await ProviderConsumerLink.find(filter).select('consumer_tenant_id').lean();
  if (links.length === 0) return null;

  const allIds = links.map((l: any) => String(l.consumer_tenant_id));
  const byos = await ObservabilityConnection.find({
    tenant_id: { $in: allIds },
    mode: 'byos',
    status: { $in: ['connected', 'pending'] },
  })
    .select('tenant_id')
    .lean();
  const byosSet = new Set(byos.map((c: any) => String(c.tenant_id)));

  const managedIds = allIds.filter((id) => !byosSet.has(id));
  if (managedIds.length === 0) return null;
  return { orgId: managedIds.join('|'), count: managedIds.length };
}

/** Authenticated GET against Mimir's Prometheus API. */
export async function mimirGet<T = any>(
  path: string,
  params: Record<string, string | string[]>,
  orgId: string,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.append(k, v);
  }
  const url = `${MIMIR_URL}${path}?${qs.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Mimir ${resp.status}: ${text.slice(0, 500)}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const MANAGED_LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';

/** Lowercased origin (proto+host+port) — used for SSRF classification and cache-key fingerprints. */
export function normalizedLokiFingerprint(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin.toLowerCase();
  } catch {
    return 'invalid';
  }
}

/**
 * Own-tenant logs endpoint, resolved exactly like observability-proxy.routes.ts resolveEndpoints():
 * a BYOS connection uses its logs_url (fallback to managed if blank); otherwise managed. orgId = tenantId.
 */
export async function resolveLogsEndpoint(tenantId: string): Promise<{ url: string; orgId: string }> {
  const conn = await ObservabilityConnection
    .findOne({ tenant_id: tenantId, status: { $in: ['connected', 'pending'] } })
    .sort({ created_at: -1 });
  if (conn && conn.mode === 'byos' && conn.endpoints) {
    return { url: conn.endpoints.logs_url || MANAGED_LOKI_URL, orgId: tenantId };
  }
  return { url: MANAGED_LOKI_URL, orgId: tenantId };
}

/** Authenticated GET against a Loki instance (managed or BYOS). SSRF-guards non-managed base URLs. */
export async function lokiGet<T = any>(
  baseUrl: string,
  path: string,
  params: Record<string, string | string[]>,
  orgId: string,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.append(k, v);
  }
  const base = baseUrl.replace(/\/+$/, '');           // safe join: strip trailing slashes
  const query = qs.toString();
  const url = `${base}${path}${query ? `?${query}` : ''}`;

  // SSRF: skip only for the managed origin (internal by design); guard everything else.
  const isManaged = normalizedLokiFingerprint(baseUrl) === normalizedLokiFingerprint(MANAGED_LOKI_URL);
  if (!isManaged) await assertUrlSafe(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Loki ${resp.status}: ${text.slice(0, 500)}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
