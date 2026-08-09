// PromQL query builder for the "no-PromQL" Metrics Explorer facet rail. Mirrors the backend's
// buildMetricMatcher/escapePromValue (packages/api/src/services/observability-metrics-discovery.service.ts)
// for the selector half, and composes the type-appropriate function wrapper (rate/histogram_quantile/raw)
// plus an optional trailing aggregation the frontend needs to render a full query.
//
// Compose, don't wrap (review fix #5): each metric type produces its OWN complete expression —
// counter gets rate(), histogram gets histogram_quantile(...) with `le` baked into its inner by(),
// gauge/summary/unknown stay raw. An optional agg/by is then applied on TOP of that expression for
// counter/gauge/summary/unknown, but a finished histogram_quantile(...) is never re-wrapped in
// another agg — `le` already lives inside its own sum by(), and stacking another aggregation on top
// would just discard/duplicate that grouping.

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'unknown';

export interface BuildOpts {
  type: MetricType;
  window?: string;
  agg?: string;
  by?: string;
}

const DEFAULT_WINDOW = '5m';

// Bare/clean PromQL metric-name grammar — identical to the backend's METRIC_NAME_RE. Names with a
// colon (recording rules, e.g. `job:http_requests:rate5m`) or any other character (vendor names like
// `http.server.duration`) are routed through the `{__name__="<escaped>",...}` form instead.
const METRIC_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function escapePromValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Type inferred from a well-known metric-name suffix — tier-2 fallback for when Mimir `/metadata`
 * has no entry for this exact name. Metadata is keyed by the base family name
 * (`http_request_duration_seconds`), but the facet lists the expanded series names Prometheus/Mimir
 * actually expose (`..._bucket`, `..._total`, `..._count`, `..._sum`), so a metadata lookup keyed on
 * the expanded name alone comes back empty even though the family IS a known type. Mirrors the
 * backend's twin in observability-metrics-discovery.service.ts so both tiers agree.
 */
export function inferMetricTypeFromName(metric: string): MetricType {
  if (/_bucket$/.test(metric)) return 'histogram';
  if (/_(total|count|sum)$/.test(metric)) return 'counter';
  return 'unknown';
}

/** Label-matcher fragment from a selection, sorted + escaped, e.g. ['cluster="c"', 'namespace="p"']. */
function selectionParts(selection: Record<string, string>): string[] {
  return Object.keys(selection)
    .sort()
    .map((k) => `${k}="${escapePromValue(selection[k])}"`);
}

/**
 * PromQL selector for one metric scoped by a label selection, e.g. `http_requests_total{cluster="c"}`
 * or `{__name__="job:http_requests:rate5m",cluster="c"}` for names with a colon or other odd
 * characters. Values are always escaped so a value cannot break out of the selector — mirrors the
 * backend's buildMetricMatcher exactly so front and back agree.
 */
function buildSelector(metric: string, selection: Record<string, string>): string {
  const parts = selectionParts(selection);
  if (METRIC_NAME_RE.test(metric)) {
    return parts.length ? `${metric}{${parts.join(',')}}` : metric;
  }
  const nameMatcher = `__name__="${escapePromValue(metric)}"`;
  return `{${[nameMatcher, ...parts].join(',')}}`;
}

/** Apply an optional trailing `<agg> by(<by>)(...)` / `<agg>(...)` wrapper on top of an expression. */
function applyAgg(expr: string, agg?: string, by?: string): string {
  const hasAgg = !!agg && agg !== '(raw)';
  if (!hasAgg) return expr;
  const hasBy = !!by && by !== '(none)';
  return hasBy ? `${agg} by(${by})(${expr})` : `${agg}(${expr})`;
}

/**
 * Build a full PromQL query string for one metric from its type, a facet-rail label selection, and
 * optional window/agg/by refinements. Empty metric name returns '' — never a catch-all query.
 *
 * - counter    → `rate(<selector>[<window|5m>])`, then optional `<agg> by(<by>)(...)` on top.
 * - histogram  → `histogram_quantile(0.95, sum by(le<,by>)(rate(<selector>[window])))`. `le` is
 *                ALWAYS the first (and, absent `by`, only) inner grouping dimension. The finished
 *                histogram_quantile(...) is NEVER re-wrapped in another agg — `agg` is ignored here.
 * - gauge/summary/unknown → raw `<selector>`, then optional `<agg> by(<by>)(...)` on top.
 */
export function buildMetricQuery(metric: string, selection: Record<string, string>, opts: BuildOpts): string {
  if (!metric) return '';
  const selector = buildSelector(metric, selection);
  const window = opts.window || DEFAULT_WINDOW;

  if (opts.type === 'counter') {
    return applyAgg(`rate(${selector}[${window}])`, opts.agg, opts.by);
  }

  if (opts.type === 'histogram') {
    const hasBy = !!opts.by && opts.by !== '(none)';
    const byClause = hasBy ? `le,${opts.by}` : 'le';
    return `histogram_quantile(0.95, sum by(${byClause})(rate(${selector}[${window}])))`;
  }

  // gauge / summary / unknown
  return applyAgg(selector, opts.agg, opts.by);
}
