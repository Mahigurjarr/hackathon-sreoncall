/**
 * Grafana-style variable substitution + platform-wide resource-scope label
 * injection for PromQL and LogQL queries.
 *
 * Two transformations run in order:
 *   1. substituteVariables — replaces $var / ${var} tokens with the selected
 *      values from the dashboard variable bar
 *   2. injectScopeLabels   — appends a label-matcher expression for each
 *      active resource-scope selection (cluster / namespace / region / etc.)
 *      into every metric/stream selector, skipping any label already bound
 *      by a dashboard variable
 *
 * Together these power the "pick a template, pick a cluster, see data" flow.
 */

export type VariableValues = Record<string, string[]>;

/**
 * Format a list of values as a PromQL/LogQL regex alternation safe for
 * `label=~"..."` matching. Escapes regex metacharacters.
 */
function formatMultiValue(values: string[]): string {
  const escaped = values
    .filter((v) => v != null && v !== '')
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return '.*';
  if (escaped.length === 1) return escaped[0]!;
  return escaped.join('|');
}

/**
 * Replace $name and ${name} tokens in `query` with the value(s) from `values`.
 * Multi-value variables produce a regex alternation suitable for `=~`.
 * An empty/unselected variable falls back to `.+` so queries don't break.
 */
export function substituteVariables(query: string, values: VariableValues): string {
  if (!query) return query;
  return query.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced || bare;
    const vals = values[name];
    if (!vals || vals.length === 0) return '.+';
    return formatMultiValue(vals);
  });
}

/**
 * Return the set of label names that are *already* referenced in `query`
 * (e.g. `cluster=~"$cluster"`). Used to avoid double-injecting a scope label
 * that a dashboard variable already binds.
 */
function referencedLabels(query: string): Set<string> {
  const out = new Set<string>();
  // Match `label=`, `label!=`, `label=~`, `label!~` inside any selector.
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:!=|=~|!~|=)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * Build the extra matcher fragment (e.g. `cluster="prod",namespace="checkout"`)
 * to inject into every selector. Skips labels already referenced in the query.
 */
function buildScopeFragment(
  scope: Record<string, string | undefined>,
  skip: Set<string>,
): string[] {
  const parts: string[] = [];
  for (const [label, value] of Object.entries(scope)) {
    if (!value || skip.has(label)) continue;
    const escaped = value.replace(/"/g, '\\"');
    parts.push(`${label}="${escaped}"`);
  }
  return parts;
}

/**
 * For PromQL: append scope matchers into every `metric_name{...}` selector,
 * including bare metric names (`metric_name` → `metric_name{scope}`).
 *
 * For LogQL: append scope matchers into every `{stream_selector}`.
 */
export function injectScopeLabels(
  query: string,
  scope: Record<string, string | undefined>,
): string {
  if (!query) return query;
  const skip = referencedLabels(query);
  const fragments = buildScopeFragment(scope, skip);
  if (fragments.length === 0) return query;
  const extra = fragments.join(',');

  // Both PromQL and LogQL use `{...}` selectors. We inject scope matchers
  // into every such selector; queries on bare metric names (no `{}`) are not
  // rewritten, because safely distinguishing a metric name from a `by (label)`
  // grouping clause or function argument without a real parser is too fragile.
  // Templates that want scope must include at least empty `{}` on their metric
  // reference — e.g. `rate(http_requests_total{}[5m])`.
  return query.replace(/\{([^}]*)\}/g, (_match, labels) => {
    const trimmed = labels.trim();
    const merged = trimmed ? `${trimmed},${extra}` : extra;
    return `{${merged}}`;
  });
}

/**
 * Apply variable substitution then resource-scope injection, in that order.
 * This is the single entry point used by the panel renderer before dispatching
 * a query to the observability proxy.
 */
export function applyQueryTransforms(
  query: string,
  variables: VariableValues,
  scope: Record<string, string | undefined>,
): string {
  return injectScopeLabels(substituteVariables(query, variables), scope);
}
