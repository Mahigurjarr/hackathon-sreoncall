// Pure helpers for the Ask ⇄ LogQL bar (LogsExploreV2). Kept separate from the ambient
// facet-derived fetch query per the locked bar-vs-fetch nuance: `barLogql` is what the bar
// shows / what the user edits / what Run executes, and it may legitimately be '' (the
// backend's empty-scope contract returns `logql: ''` + an explanation hint). `fetchLogql` is
// the already-coerced facet-derived query (never empty — falls back to DEFAULT_ALL_STREAMS).
// The bar must NEVER have DEFAULT_ALL_STREAMS substituted into it and presented as an
// AI-produced query — these two helpers keep that boundary explicit and testable.

/**
 * The query that actually drives the log stream / volume histogram: the bar's own
 * non-empty query when the user has typed or the AI produced one, otherwise the ambient
 * facet-derived fetch query. Never used to mutate `barLogql` itself — only to pick what
 * gets fetched.
 */
export function effectiveLogQuery(barLogql: string, fetchLogql: string): string {
  const trimmed = barLogql.trim();
  return trimmed.length > 0 ? trimmed : fetchLogql;
}

/**
 * Whether the LogQL-mode Run/send button may fire. The bar must never execute a blank
 * query — when `barLogql` is empty (manually cleared, or the AI's empty-scope contract),
 * Run stays disabled and the caller renders the returned explanation as a hint instead.
 */
export function canRunBarQuery(barLogql: string): boolean {
  return barLogql.trim().length > 0;
}
