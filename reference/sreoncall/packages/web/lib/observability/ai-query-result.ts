// Decides what the Metrics Explorer should do after an AI-generated query renders.
// Pure + framework-free so it can be unit-tested without React/jsdom — the component
// just feeds it the current query-result state and acts on the verdict.

export type AiResultAction =
  | 'repair' // render errored → ask the model to fix it (caller still guards the cap + in-flight)
  | 'empty-repair' // query is valid but returned NO data → spend the one shared repair to try a better parser/filter
  | 'empty-note' // valid-but-empty AND the repair budget is already spent → show the honest note
  | 'ok' // query returned data → clear notes
  | 'none'; // not an AI-originated query, still loading, or repair budget spent

export interface AiResultState {
  /** A query is currently active (rendering). */
  hasActiveQuery: boolean;
  /** The active query was produced by the AI ask bar (not a manual/golden/tree query). */
  aiOriginated: boolean;
  /** The render failed (Mimir error or error envelope). */
  isError: boolean;
  /** The render succeeded. */
  isSuccess: boolean;
  /** Number of series returned. */
  seriesCount: number;
  /** How many auto-repairs have already fired for this question (cap is 1). */
  repairCount: number;
}

export function classifyAiResult(s: AiResultState): AiResultAction {
  if (!s.hasActiveQuery || !s.aiOriginated) return 'none';
  if (s.isError) return s.repairCount < 1 ? 'repair' : 'none';
  if (s.isSuccess) {
    if (s.seriesCount > 0) return 'ok';
    // Valid but zero data: spend the one shared repair (parser/filter may not match the log
    // format — e.g. `| json` on non-JSON) if the budget is untouched; otherwise be honest.
    return s.repairCount < 1 ? 'empty-repair' : 'empty-note';
  }
  return 'none';
}
