// LogQL selector builder for the "no-LogQL" Logs Explorer. Mirrors the backend's
// buildLogSelector (packages/api/src/services/observability-logs-discovery.service.ts)
// for the stream-selector half, and adds the line-field / level-filter / lineContains
// pipeline the frontend needs to render a full query.
//
// Stream label vs. line field is a question of SELECTION ORIGIN, not a static label list.
// The shipped backend's `/observability/logs-discovery/labels` only returns Loki STREAM
// labels (the `detected_fields`/parsed-line-field discovery work was deferred) — so every
// facet the rail shows really is a stream label. The only fields that are genuinely
// line-level are ones discovered by parsing a JSON log line client-side (the log-row
// detail's "+ filter" button on a parsed field). Callers are responsible for keeping the
// two apart and passing them to buildLogQLSelector as separate arguments below — do not
// reintroduce a static-name classifier here, that was the bug (a real stream label like
// `job` routed through `| json | job="..."` never matches, because `job` isn't inside the
// stream selector `{...}` where Loki actually looks for it).

const LEVEL_KEYS = ['error', 'warn', 'info', 'debug'] as const;
type LevelKey = (typeof LEVEL_KEYS)[number];

export interface LogQLOpts {
  /** Row-detail "+ filter" clicks on a parsed JSON line field (NOT a stream label). */
  lineFieldFilters?: Record<string, string>;
  lineContains?: string;
  levels?: Record<LevelKey, boolean>;
}

function escapeLogValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build a LogQL query string from separate stream-label and line-field inputs.
 *
 * - `streamSelection` — facet-rail selections. Always stream labels (see file header) —
 *   rendered as the `{k="v",...}` selector (sorted, escaped).
 * - `opts.lineFieldFilters` — row-detail "+ filter" clicks on a parsed JSON field —
 *   rendered as `| json | k="v"` (sorted, escaped) after the selector.
 * - `base` is a fallback stream selector used only when `streamSelection` is empty (e.g.
 *   the component's DEFAULT_ALL_STREAMS = '{job=~".+"}'); it defaults to '' so pure/unit
 *   callers see an honest empty result.
 * - An empty selection (and no usable base) returns '' — NOT a catch-all, and never
 *   with a hidden tenant_id filter.
 * - Levels: a strict, non-empty subset of the four levels adds `| json | level=~"a|b"`.
 *   All-on and all-off are both treated as "no level filtering" — an all-off selection
 *   must not silently fall through to showing every level (see logql.test.ts).
 */
export function buildLogQLSelector(
  streamSelection: Record<string, string>,
  opts: LogQLOpts = {},
  base = '',
): string {
  const lineFieldFilters = opts.lineFieldFilters ?? {};
  const streamKeys = Object.keys(streamSelection).sort();
  const lineKeys = Object.keys(lineFieldFilters).sort();

  const streamSel = streamKeys.length
    ? `{${streamKeys.map((k) => `${k}="${escapeLogValue(streamSelection[k])}"`).join(',')}}`
    : '';

  const effective = streamSel || base;
  if (!effective) return '';

  let out = effective;

  if (opts.lineContains) {
    out += ` |= "${escapeLogValue(opts.lineContains)}"`;
  }

  const enabledLevels = opts.levels ? LEVEL_KEYS.filter((l) => opts.levels![l]) : [];
  // Only a STRICT, non-empty subset of levels is an actual filter. All four on, or all
  // four off, both mean "no level filtering" — treating all-off as "only show nothing
  // filtered" would otherwise invert into showing every level, which is wrong.
  const isPartialLevelSelection = enabledLevels.length > 0 && enabledLevels.length < LEVEL_KEYS.length;

  if (lineKeys.length > 0 || isPartialLevelSelection) {
    out += ' | json';
  }

  if (isPartialLevelSelection) {
    out += ` | level=~"${enabledLevels.join('|')}"`;
  }

  for (const k of lineKeys) {
    out += ` | ${k}="${escapeLogValue(lineFieldFilters[k])}"`;
  }

  return out;
}
