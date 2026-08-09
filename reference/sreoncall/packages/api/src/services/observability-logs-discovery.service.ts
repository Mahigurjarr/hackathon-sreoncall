import { lokiGet, normalizedLokiFingerprint } from './observability-upstream.service';
import { getRedis } from '../config/redis';
import { validateLabelValue } from '../models/observability-connection.model';
import { logger } from '../utils/logger';

export type LogScope = Record<string, string>;
export interface LabelValuesResult { values: string[]; total: number; truncated: boolean }

const DISCOVERY_MAX_VALUES = 1000;
const GROUNDING_LABEL_CAP = 40;
const CACHE_TTL_SECS = 60;
const VERSION_TTL_SECS = 3600;
const DEFAULT_WINDOW_SECS = 3600;

// HTTP/control params that are never stream-label filters.
const RESERVED_QUERY_PARAMS = new Set(['name', 'consumer_id', 'start', 'end', 'window', 'limit']);
// Scope KEY grammar — Prometheus label names (uppercase allowed). NOTE: intentionally NOT model.validateLabelKey,
// which rejects service_name/job (reserved for *ingestion*); those are valid *filter* labels here.
const SCOPE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Facet-name noise to hide from the list.
const HIDDEN_LABELS = new Set(['tenant_id', 'source']);

/** Validate/clean untrusted query params into a safe LogScope. */
export function sanitizeLogScope(raw: Record<string, unknown>): LogScope {
  const out: LogScope = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (RESERVED_QUERY_PARAMS.has(k)) continue;
    if (typeof v !== 'string') continue;              // drop arrays/objects
    if (!SCOPE_KEY_RE.test(k)) continue;
    if (validateLabelValue(v) !== null) continue;      // bounded length, no control chars
    out[k] = v;
  }
  return out;
}

/** LogQL stream selector from a scope, e.g. {cluster="c",namespace="p"}; '' when empty. Values are escaped. */
export function buildLogSelector(scope: LogScope): string {
  const keys = Object.keys(scope).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLogValue(scope[k])}"`);
  return `{${parts.join(',')}}`;
}

function escapeLogValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function windowParams(windowSecs: number): { start: string; end: string } {
  const now = Math.floor(Date.now() / 1000);
  return { start: String(now - windowSecs), end: String(now) };
}

async function cacheGet(key: string): Promise<LabelValuesResult | null> {
  try {
    const c = await getRedis().get(key);
    return c ? (JSON.parse(c) as LabelValuesResult) : null;
  } catch (err: any) {
    logger.warn('logdisc cache read failed', { key, error: err?.message });
    return null;
  }
}
async function cacheSet(key: string, val: LabelValuesResult, ttl = CACHE_TTL_SECS): Promise<void> {
  try { await getRedis().setex(key, ttl, JSON.stringify(val)); }
  catch (err: any) { logger.warn('logdisc cache write failed', { key, error: err?.message }); }
}
function cap(all: string[]): LabelValuesResult {
  return { values: all.slice(0, DISCOVERY_MAX_VALUES), total: all.length, truncated: all.length > DISCOVERY_MAX_VALUES };
}

/** Facet list: all present stream label names (minus noise). */
export async function listLogLabelNames(
  lokiUrl: string, orgId: string, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  const fp = normalizedLokiFingerprint(lokiUrl);
  const key = `logdisc:labels:${orgId}:${fp}:${windowSecs}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const resp = await lokiGet<{ data?: string[] }>(lokiUrl, '/loki/api/v1/labels', windowParams(windowSecs), orgId);
  const all = (Array.isArray(resp.data) ? resp.data : [])
    .filter((n) => !n.startsWith('__') && !HIDDEN_LABELS.has(n));
  const result = cap(all);
  await cacheSet(key, result);
  return result;
}

/** Detect whether this Loki host supports the label-values `query` param (≳2.9). Cached, best-effort. */
async function supportsQueryParam(lokiUrl: string, orgId: string): Promise<boolean> {
  const fp = normalizedLokiFingerprint(lokiUrl);
  const key = `logdisc:ver:${fp}`;
  try {
    const cached = await getRedis().get(key);
    if (cached !== null && cached !== undefined) return cached === '1';
  } catch { /* ignore */ }
  let ok = true; // default optimistic: newer Loki
  try {
    const info = await lokiGet<{ version?: string }>(lokiUrl, '/loki/api/v1/status/buildinfo', {}, orgId);
    const [maj, min] = String(info.version ?? '0.0').split('.').map((x) => parseInt(x, 10) || 0);
    ok = maj > 2 || (maj === 2 && min >= 9);
  } catch (err: any) {
    logger.warn('loki buildinfo probe failed; assuming query-param support', { error: err?.message });
  }
  try { await getRedis().setex(key, VERSION_TTL_SECS, ok ? '1' : '0'); } catch { /* ignore */ }
  return ok;
}

/** Facet values for one label, scoped by the current selection. */
export async function listLogLabelValues(
  lokiUrl: string, orgId: string, label: string, scope: LogScope, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  const selector = buildLogSelector(scope);
  const fp = normalizedLokiFingerprint(lokiUrl);
  const key = `logdisc:vals:${orgId}:${fp}:${windowSecs}:${label}:${selector}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const win = windowParams(windowSecs);
  let all: string[];

  if (!selector) {
    // Empty scope never needs the version probe — there's no `query`/`match[]` to gate.
    const resp = await lokiGet<{ data?: string[] }>(
      lokiUrl, `/loki/api/v1/label/${encodeURIComponent(label)}/values`, win, orgId);
    all = Array.isArray(resp.data) ? resp.data : [];
  } else if (await supportsQueryParam(lokiUrl, orgId)) {
    const resp = await lokiGet<{ data?: string[] }>(
      lokiUrl, `/loki/api/v1/label/${encodeURIComponent(label)}/values`, { ...win, query: selector }, orgId);
    all = Array.isArray(resp.data) ? resp.data : [];
  } else {
    // Older Loki + non-empty scope: series fallback, extract distinct values of `label`
    // from matching stream label-sets (no query param support on /label/:name/values).
    const resp = await lokiGet<{ data?: Array<Record<string, string>> }>(
      lokiUrl, '/loki/api/v1/series', { ...win, 'match[]': [selector] }, orgId);
    const set = new Set<string>();
    for (const s of Array.isArray(resp.data) ? resp.data : []) if (s[label]) set.add(s[label]);
    all = Array.from(set);
  }

  const result = cap(all);
  await cacheSet(key, result);
  return result;
}

/** Never-throws grounding read of stream label names (for AI). */
export async function listLogLabelNamesGrounding(
  lokiUrl: string, orgId: string, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  try {
    const full = await listLogLabelNames(lokiUrl, orgId, windowSecs);
    return { values: full.values.slice(0, GROUNDING_LABEL_CAP), total: full.total, truncated: full.total > GROUNDING_LABEL_CAP };
  } catch (err: any) {
    logger.warn('log grounding read failed; returning empty', { orgId, error: err?.message });
    return { values: [], total: 0, truncated: false };
  }
}
