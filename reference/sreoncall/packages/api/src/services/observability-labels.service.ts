import { ObservabilityConnection, RESERVED_LABEL_KEYS, validateLabelKey, validateLabelValue } from '../models/observability-connection.model';
import { logger } from '../utils/logger';

/**
 * Centralised label-stamping for every log pipeline (Heroku / Vercel /
 * Supabase drains, Supabase poller, future agents). Two responsibilities:
 *
 *  1. Merge the customer's `default_labels` from their
 *     ObservabilityConnection onto every emitted Loki stream so
 *     environment/team/tier/etc. follow the logs automatically.
 *  2. Move high-cardinality fields (request_id, deployment_id,
 *     session_id, frame_id…) off stream labels and into the log line
 *     body as JSON. Loki indexes streams by label-set and each new
 *     request_id value creates a fresh stream — which kills query
 *     performance at scale. Putting them in the line keeps them
 *     queryable (via `| json` + field filters) without bloating the
 *     index.
 */

// Conservative TTL — customer edits to default_labels propagate within 60 s.
const CACHE_TTL_MS = 60_000;

interface CachedLabels {
  labels: Record<string, string>;
  expiresAt: number;
}

const labelCache = new Map<string, CachedLabels>();

function cacheKey(tenantId: string, provider: string): string {
  return `${tenantId}:${provider}`;
}

/**
 * Fetch customer-defined labels for a tenant+provider, cached for
 * CACHE_TTL_MS. Multiple connections of the same provider are merged
 * (later connections win) so a customer with e.g. two Vercel teams
 * can still pin different label sets per connection when the drain
 * URL includes a project slug.
 */
export async function getDefaultLabels(
  tenantId: string,
  provider: string,
): Promise<Record<string, string>> {
  const key = cacheKey(tenantId, provider);
  const cached = labelCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.labels;

  try {
    const connections = await ObservabilityConnection.find({
      tenant_id: tenantId,
      'config.cloud_provider': provider,
      status: { $in: ['connected', 'pending', 'error'] },
    })
      .select('default_labels')
      .lean();

    const merged: Record<string, string> = {};
    for (const conn of connections) {
      const raw = (conn as any).default_labels;
      if (!raw) continue;
      const entries =
        raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
      for (const [k, v] of entries) {
        if (validateLabelKey(String(k))) continue;
        if (validateLabelValue(String(v))) continue;
        merged[String(k)] = String(v);
      }
    }

    labelCache.set(key, { labels: merged, expiresAt: Date.now() + CACHE_TTL_MS });
    return merged;
  } catch (err: any) {
    logger.warn('getDefaultLabels failed', { tenantId, provider, error: err.message });
    return {};
  }
}

/** Flush a single cache entry (used after connection edits). */
export function invalidateLabelsCache(tenantId: string, provider: string): void {
  labelCache.delete(cacheKey(tenantId, provider));
}

/**
 * Merge customer labels onto a platform-provided label set. Platform
 * labels (the `base` argument) always win to preserve source/service
 * identity — customer can add new labels but can't override tenant_id
 * or source.
 */
export function mergeLabels(
  base: Record<string, string>,
  custom: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...custom };
  for (const [k, v] of Object.entries(base)) {
    out[k] = v; // platform labels always overwrite
  }
  // Strip keys whose value is empty — Loki treats empty-value labels as
  // fresh streams, which silently blows cardinality for every optional
  // field (dyno, deployment_id, request_id…).
  for (const k of Object.keys(out)) {
    if (out[k] === '' || out[k] == null) delete out[k];
  }
  // Belt-and-suspenders: reject any reserved key that slipped through.
  for (const reserved of RESERVED_LABEL_KEYS) {
    if (!(reserved in base)) delete out[reserved];
  }
  return out;
}

/**
 * Build a log line that carries high-cardinality context as structured
 * JSON so it's queryable via LogQL's `| json` without becoming an
 * indexed stream label. When `message` is already JSON we merge into
 * it; otherwise we wrap.
 */
export function enrichLogLine(
  message: string,
  metadata: Record<string, string | number | undefined | null>,
): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v === undefined || v === null || v === '') continue;
    clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return message;

  // Try to merge if message is already JSON — avoids nested {"msg": "{...}"}
  const trimmed = message.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify({ ...clean, ...parsed });
      }
    } catch {
      /* fall through */
    }
  }

  return JSON.stringify({ ...clean, message });
}
