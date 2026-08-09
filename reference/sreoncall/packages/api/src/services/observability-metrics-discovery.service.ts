import { mimirGet, getMimirBaseUrl } from './observability-upstream.service';
import { getRedis } from '../config/redis';
import { validateLabelValue } from '../models/observability-connection.model';
import { logger } from '../utils/logger';

export type MetricScope = Record<string, string>;
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'unknown';
export interface LabelValuesResult { values: string[]; total: number; truncated: boolean }

const DISCOVERY_MAX_VALUES = 1000;
const CACHE_TTL_SECS = 60;
const DEFAULT_WINDOW_SECS = 3600;

// HTTP/control params that are never PromQL label filters.
const RESERVED_QUERY_PARAMS = new Set(['metric', 'name', 'label', 'consumer_id', 'start', 'end', 'window', 'limit']);
// Scope KEY grammar — Prometheus label names. NOTE: intentionally NOT model.validateLabelKey, which rejects
// service_name/job (reserved for *ingestion* defaults); those are valid *filter* labels here (mirrors logs).
const SCOPE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Bare/clean PromQL metric-name grammar. Metric names with a colon (recording rules, e.g.
// `job:http_requests:rate5m`) or any other character (vendor names like `http.server.duration`) are
// routed through the `{__name__="<escaped>",...}` form instead — always valid regardless of spelling,
// and keeps escaping/matching logic in one place rather than special-casing colon-only names.
const METRIC_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validate/clean untrusted query params into a safe MetricScope. */
export function sanitizeMetricScope(raw: Record<string, unknown>): MetricScope {
  const out: MetricScope = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (RESERVED_QUERY_PARAMS.has(k)) continue;
    if (typeof v !== 'string') continue;              // drop arrays/objects
    if (!SCOPE_KEY_RE.test(k)) continue;
    if (validateLabelValue(v) !== null) continue;      // bounded length, no control chars
    out[k] = v;
  }
  return out;
}

function escapePromValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Label-matcher fragment from a scope, sorted + escaped, e.g. cluster="c",namespace="p" ('' when empty). */
function scopeParts(scope: MetricScope): string[] {
  return Object.keys(scope).sort().map((k) => `${k}="${escapePromValue(scope[k])}"`);
}

/** PromQL selector from a scope only (no metric), e.g. {cluster="c"}; '' when empty. Used for metric-name
 *  discovery and scope-only label discovery, and reused by the /generate-query route for its own
 *  scope selector so escaping logic lives in exactly one place. */
export function buildScopeMatcher(scope: MetricScope): string {
  const parts = scopeParts(scope);
  return parts.length ? `{${parts.join(',')}}` : '';
}

/**
 * PromQL matcher for one metric scoped by a label selection, e.g. `http_requests_total{cluster="c"}` or
 * `{__name__="job:http_requests:rate5m",cluster="c"}` for names with a colon or other odd characters
 * (review fix #2). Values always escaped so a value cannot break out of the selector.
 */
export function buildMetricMatcher(metric: string, scope: MetricScope): string {
  const parts = scopeParts(scope);
  if (METRIC_NAME_RE.test(metric)) {
    return parts.length ? `${metric}{${parts.join(',')}}` : metric;
  }
  const nameMatcher = `__name__="${escapePromValue(metric)}"`;
  return `{${[nameMatcher, ...parts].join(',')}}`;
}

function windowParams(windowSecs: number): { start: string; end: string } {
  const now = Math.floor(Date.now() / 1000);
  return { start: String(now - windowSecs), end: String(now) };
}

/** Lowercased origin of the managed Mimir base URL — used for cache-key fingerprints. */
function mimirBaseFingerprint(): string {
  try { return new URL(getMimirBaseUrl()).origin.toLowerCase(); } catch { return 'invalid'; }
}

async function cacheGet(key: string): Promise<LabelValuesResult | null> {
  try {
    const c = await getRedis().get(key);
    return c ? (JSON.parse(c) as LabelValuesResult) : null;
  } catch (err: any) {
    logger.warn('metricsdisc cache read failed', { key, error: err?.message });
    return null;
  }
}
async function cacheSet(key: string, val: LabelValuesResult, ttl = CACHE_TTL_SECS): Promise<void> {
  try { await getRedis().setex(key, ttl, JSON.stringify(val)); }
  catch (err: any) { logger.warn('metricsdisc cache write failed', { key, error: err?.message }); }
}
function cap(all: string[]): LabelValuesResult {
  return { values: all.slice(0, DISCOVERY_MAX_VALUES), total: all.length, truncated: all.length > DISCOVERY_MAX_VALUES };
}

/** Metric-name facet: all `__name__` values present for a scope. */
export async function listMetricNames(
  orgId: string, scope: MetricScope, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  const matcher = buildScopeMatcher(scope);
  const fp = mimirBaseFingerprint();
  const key = `metricsdisc:names:${orgId}:${fp}:${windowSecs}:${matcher}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const params: Record<string, string | string[]> = { ...windowParams(windowSecs) };
  if (matcher) params['match[]'] = [matcher];

  const resp = await mimirGet<{ data?: string[] }>('/prometheus/api/v1/label/__name__/values', params, orgId);
  const all = Array.isArray(resp.data) ? resp.data : [];
  const result = cap(all);
  await cacheSet(key, result);
  return result;
}

/** Label-name facet for one metric, scoped by the current selection. Drops `__*` (e.g. `__name__`). */
export async function listMetricLabelNames(
  orgId: string, metric: string, scope: MetricScope, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  const matcher = buildMetricMatcher(metric, scope);
  const fp = mimirBaseFingerprint();
  const key = `metricsdisc:labels:${orgId}:${fp}:${windowSecs}:${matcher}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const params: Record<string, string | string[]> = { ...windowParams(windowSecs), 'match[]': [matcher] };
  const resp = await mimirGet<{ data?: string[] }>('/prometheus/api/v1/labels', params, orgId);
  const all = (Array.isArray(resp.data) ? resp.data : []).filter((n) => !n.startsWith('__'));
  const result = cap(all);
  await cacheSet(key, result);
  return result;
}

/** Label-name facet for a flat scope only (no specific metric) — used for AI-query grounding, where the
 *  scope may be `{job, instance, ...}` (source-agnostic) rather than a K8s cluster/namespace/service scope.
 *  Drops `__*` (e.g. `__name__`). Empty scope → no match[] (global label names), same convention as
 *  listMetricNames. */
export async function listMetricLabelNamesForScope(
  orgId: string, scope: MetricScope, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  const matcher = buildScopeMatcher(scope);
  const fp = mimirBaseFingerprint();
  const key = `metricsdisc:scopelabels:${orgId}:${fp}:${windowSecs}:${matcher}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const params: Record<string, string | string[]> = { ...windowParams(windowSecs) };
  if (matcher) params['match[]'] = [matcher];

  const resp = await mimirGet<{ data?: string[] }>('/prometheus/api/v1/labels', params, orgId);
  const all = (Array.isArray(resp.data) ? resp.data : []).filter((n) => !n.startsWith('__'));
  const result = cap(all);
  await cacheSet(key, result);
  return result;
}

/** Label-value facet for one metric + label, scoped by the current selection minus the queried label. */
export async function listMetricLabelValues(
  orgId: string, metric: string, label: string, scope: MetricScope, windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  // Self-exclude the queried label so a picked value doesn't collapse its own list.
  const { [label]: _omit, ...scopeWithoutLabel } = scope;
  const matcher = buildMetricMatcher(metric, scopeWithoutLabel);
  const fp = mimirBaseFingerprint();
  const key = `metricsdisc:vals:${orgId}:${fp}:${windowSecs}:${label}:${matcher}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const params: Record<string, string | string[]> = { ...windowParams(windowSecs), 'match[]': [matcher] };
  const resp = await mimirGet<{ data?: string[] }>(`/prometheus/api/v1/label/${encodeURIComponent(label)}/values`, params, orgId);
  const all = Array.isArray(resp.data) ? resp.data : [];
  const result = cap(all);
  await cacheSet(key, result);
  return result;
}

/**
 * Type inferred from a well-known metric-name suffix — tier-2 fallback for when Mimir `/metadata`
 * has no entry for this exact name. Metadata is keyed by the base family name
 * (`http_request_duration_seconds`), but the facet lists the expanded series names Prometheus/Mimir
 * actually expose (`..._bucket`, `..._total`, `..._count`, `..._sum`), so a metadata lookup keyed on
 * the expanded name alone comes back empty even though the family IS a known type. Mirrors the
 * client's twin in packages/web/lib/observability/promql-build.ts so both tiers agree.
 */
function inferMetricTypeFromName(metric: string): MetricType {
  if (/_bucket$/.test(metric)) return 'histogram';
  if (/_(total|count|sum)$/.test(metric)) return 'counter';
  return 'unknown';
}

/** Metric type (counter/gauge/histogram/summary) from Mimir metadata, falling back to the name-suffix
 *  heuristic above when metadata has no entry for this exact name (spec tier-2). Cached; NEVER
 *  throws — 'unknown' on any upstream error, or when neither tier resolves a type. */
export async function getMetricType(orgId: string, metric: string): Promise<MetricType> {
  const fp = mimirBaseFingerprint();
  const key = `metricsdisc:type:${orgId}:${fp}:${metric}`;
  try {
    const cached = await getRedis().get(key);
    if (cached) return cached as MetricType;
  } catch (err: any) {
    logger.warn('metricsdisc type cache read failed', { key, error: err?.message });
  }

  let type: MetricType = 'unknown';
  try {
    const resp = await mimirGet<{ data?: Record<string, Array<{ type?: string }>> }>(
      '/prometheus/api/v1/metadata', { metric }, orgId,
    );
    const entry = resp.data?.[metric]?.[0]?.type;
    if (entry === 'counter' || entry === 'gauge' || entry === 'histogram' || entry === 'summary') {
      type = entry;
    } else {
      // Metadata miss (no entry under this exact name) — try the name-suffix heuristic before
      // giving up to 'unknown'.
      type = inferMetricTypeFromName(metric);
    }
  } catch (err: any) {
    logger.warn('metricsdisc type read failed; returning unknown', { orgId, metric, error: err?.message });
    return 'unknown';
  }

  try { await getRedis().setex(key, CACHE_TTL_SECS, type); }
  catch (err: any) { logger.warn('metricsdisc type cache write failed', { key, error: err?.message }); }
  return type;
}
