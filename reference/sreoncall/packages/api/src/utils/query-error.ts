/**
 * Matches a bare PromQL vector selector — a metric name with optional label
 * matchers (e.g. `up`, `node_cpu_seconds_total{mode="idle"}`) and nothing else.
 */
const BARE_METRIC_SELECTOR = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?$/;

/**
 * Whether `expr` is a bare metric selector rather than a complete PromQL
 * expression. A stored rule/SLI query may be either: a bare selector, which
 * needs a range-function wrapper (`avg_over_time(...[w])`, `sum(increase(...[w]))`)
 * to become a valid range query, or an already-complete expression (a
 * comparison like `up == 0`, arithmetic like `a / b * 100`, or a function call
 * like `rate(x[5m])`). A range selector can only suffix a vector selector —
 * wrapping a full expression produces invalid PromQL (e.g. `avg_over_time(up
 * == 0[2m])`). Callers should only wrap when this returns true.
 */
export function isBarePromqlSelector(expr: string): boolean {
  return BARE_METRIC_SELECTOR.test(expr.trim());
}

/**
 * Raised when a metrics/logs backend (Mimir/Loki) rejects a query as malformed
 * — i.e. an HTTP 4xx response for bad PromQL/LogQL syntax — as opposed to a
 * query that executed fine but returned no series/lines.
 *
 * This distinction matters: a broken query must surface as an error in the
 * dry-run (and be logged by the worker) rather than silently masquerading as
 * "no data → would stay OK", which would let engineers save alerts that can
 * never fire. Transient failures (5xx, timeouts, network) are NOT this error —
 * those still resolve to null/no-data so evaluation stays resilient.
 */
export class QueryExecutionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'QueryExecutionError';
    this.status = status;
  }
}

/**
 * Given a non-OK backend response, throw a {@link QueryExecutionError} when it
 * is a 4xx (the query was malformed), carrying the backend's error text. For
 * any other status (5xx/network-adjacent) it returns null so the caller keeps
 * treating it as transient no-data. Callers use it as `return throwOnBadQuery(resp)`.
 */
export async function throwOnBadQuery(resp: Response): Promise<null> {
  if (resp.status >= 400 && resp.status < 500) {
    let detail = `query rejected (HTTP ${resp.status})`;
    try {
      const text = await resp.text();
      if (text) {
        try { const b = JSON.parse(text); detail = b.error || b.message || text.slice(0, 300); }
        catch { detail = text.slice(0, 300); }
      }
    } catch { /* ignore body read errors */ }
    throw new QueryExecutionError(detail, resp.status);
  }
  return null;
}
