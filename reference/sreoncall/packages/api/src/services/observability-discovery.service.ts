import { mimirGet } from './observability-upstream.service';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

export type Level = 'cluster' | 'namespace' | 'service' | 'pod';
export type DiscoveryScope = { cluster?: string; namespace?: string; service?: string };
export interface LabelValuesResult {
  values: string[];
  total: number;
  truncated: boolean;
}

const DISCOVERY_MAX_VALUES = 1000;
const CACHE_TTL_SECS = 60;
const DEFAULT_WINDOW_SECS = 3600;
// Tighter caps for AI grounding: enough vocabulary for the model, small enough to keep the prompt cheap.
const GROUNDING_METRIC_CAP = 80;
const GROUNDING_LABEL_CAP = 40;

// Metric label names (OTel / Beyla / kube-state-metrics conventions).
const LABEL: Record<Level, string> = {
  cluster: 'cluster',
  namespace: 'namespace',
  service: 'service_name',
  pod: 'pod',
};

/** Build a PromQL matcher selector string from a scope, e.g. {cluster="c",namespace="n"}. */
function buildMatcher(scope: DiscoveryScope): string {
  const parts: string[] = [];
  if (scope.cluster) parts.push(`${LABEL.cluster}="${scope.cluster}"`);
  if (scope.namespace) parts.push(`${LABEL.namespace}="${scope.namespace}"`);
  if (scope.service) parts.push(`${LABEL.service}="${scope.service}"`);
  return `{${parts.join(',')}}`;
}

function cacheKey(orgId: string, label: string, matcher: string, windowSecs: number): string {
  return `obsdisc:${orgId}:${windowSecs}:${label}:${matcher}`;
}

/** Fetch values for one label, scoped by matchers, capped + cached. */
export async function listLabelValues(
  orgId: string,
  label: string,
  scope: DiscoveryScope,
  windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  const matcher = buildMatcher(scope);
  const key = cacheKey(orgId, label, matcher, windowSecs);

  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as LabelValuesResult;
  } catch (err: any) {
    logger.warn('discovery cache read failed', { key, error: err?.message });
  }

  const now = Math.floor(Date.now() / 1000);
  const params: Record<string, string | string[]> = {
    start: String(now - windowSecs),
    end: String(now),
  };
  // Only constrain by matchers when the scope is non-empty ('{}' matches nothing in Mimir).
  if (matcher !== '{}') params['match[]'] = [matcher];

  const resp = await mimirGet<{ status: string; data?: string[] }>(
    `/prometheus/api/v1/label/${label}/values`,
    params,
    orgId,
  );
  const all = Array.isArray(resp.data) ? resp.data : [];
  const result: LabelValuesResult = {
    values: all.slice(0, DISCOVERY_MAX_VALUES),
    total: all.length,
    truncated: all.length > DISCOVERY_MAX_VALUES,
  };

  try {
    await redis.setex(key, CACHE_TTL_SECS, JSON.stringify(result));
  } catch (err: any) {
    logger.warn('discovery cache write failed', { key, error: err?.message });
  }
  return result;
}

/** Values at a tree level, constrained by the parent scope. */
export async function getChildren(
  orgId: string,
  level: Level,
  scope: DiscoveryScope,
  windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  return listLabelValues(orgId, LABEL[level], scope, windowSecs);
}

/**
 * Capped, cached, NEVER-THROWS label read for AI grounding. Unlike listLabelValues
 * (which throws on upstream error so route handlers can surface it), grounding reads
 * are best-effort: any failure yields an empty result so query generation still proceeds.
 */
async function groundingRead(
  orgId: string,
  path: string,
  cacheLabel: string,
  scope: DiscoveryScope,
  cap: number,
  windowSecs: number,
): Promise<LabelValuesResult> {
  const matcher = buildMatcher(scope);
  const key = cacheKey(orgId, cacheLabel, matcher, windowSecs);

  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as LabelValuesResult;
  } catch (err: any) {
    logger.warn('grounding cache read failed', { key, error: err?.message });
  }

  let all: string[] = [];
  try {
    const now = Math.floor(Date.now() / 1000);
    const params: Record<string, string | string[]> = {
      start: String(now - windowSecs),
      end: String(now),
    };
    // '{}' matches nothing in Mimir; omit match[] so we get the unconstrained set.
    if (matcher !== '{}') params['match[]'] = [matcher];
    const resp = await mimirGet<{ status: string; data?: string[] }>(path, params, orgId);
    all = Array.isArray(resp.data) ? resp.data : [];
  } catch (err: any) {
    logger.warn('grounding read failed; returning empty', { path, orgId, error: err?.message });
    return { values: [], total: 0, truncated: false };
  }

  const result: LabelValuesResult = {
    values: all.slice(0, cap),
    total: all.length,
    truncated: all.length > cap,
  };
  try {
    await redis.setex(key, CACHE_TTL_SECS, JSON.stringify(result));
  } catch (err: any) {
    logger.warn('grounding cache write failed', { key, error: err?.message });
  }
  return result;
}

/** Metric names (`__name__` values) available for a scope — for AI grounding. Never throws. */
export async function listMetricNames(
  orgId: string,
  scope: DiscoveryScope,
  windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  return groundingRead(
    orgId,
    '/prometheus/api/v1/label/__name__/values',
    '__name__',
    scope,
    GROUNDING_METRIC_CAP,
    windowSecs,
  );
}

/** Label names present for a scope — for AI grounding. Never throws. */
export async function listLabelNames(
  orgId: string,
  scope: DiscoveryScope,
  windowSecs: number = DEFAULT_WINDOW_SECS,
): Promise<LabelValuesResult> {
  return groundingRead(
    orgId,
    '/prometheus/api/v1/labels',
    '__labelnames__',
    scope,
    GROUNDING_LABEL_CAP,
    windowSecs,
  );
}

export type Health = 'ok' | 'down' | 'unknown';

/**
 * Best-effort per-node health for a level, from the `up` metric:
 *   down  → at least one target under this node has up == 0
 *   ok    → has up series and none are down
 *   unknown → no up series carry this node's label (common; up may lack cluster/ns/service labels)
 * One instant query per state, cached 60s, never throws. Reliable health = alerts rollup (future).
 */
export async function getLevelHealth(
  orgId: string,
  level: Level,
  scope: DiscoveryScope,
): Promise<Record<string, Health>> {
  const label = LABEL[level];
  const matcher = buildMatcher(scope);
  const sel = matcher === '{}' ? '' : matcher;
  const key = `obsdisc:health:${orgId}:${label}:${matcher}`;

  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as Record<string, Health>;
  } catch (err: any) {
    logger.warn('discovery health cache read failed', { key, error: err?.message });
  }

  const out: Record<string, Health> = {};
  try {
    const valuesOf = async (q: string): Promise<string[]> => {
      const resp = await mimirGet<{ data?: { result?: Array<{ metric?: Record<string, string> }> } }>(
        '/prometheus/api/v1/query',
        { query: q },
        orgId,
      );
      const result = resp.data?.result ?? [];
      return result.map((r) => r.metric?.[label]).filter((v): v is string => !!v);
    };
    const known = await valuesOf(`count by(${label}) (up${sel})`);
    const down = await valuesOf(`count by(${label}) (up${sel} == 0)`);
    const downSet = new Set(down);
    for (const v of known) out[v] = downSet.has(v) ? 'down' : 'ok';
    for (const v of down) out[v] = 'down';
  } catch (err: any) {
    logger.warn('getLevelHealth failed; returning no health', { orgId, level, error: err?.message });
    return {};
  }

  try {
    await redis.setex(key, CACHE_TTL_SECS, JSON.stringify(out));
  } catch (err: any) {
    logger.warn('discovery health cache write failed', { key, error: err?.message });
  }
  return out;
}
