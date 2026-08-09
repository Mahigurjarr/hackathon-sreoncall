import { parser as logqlParser } from '@grafana/lezer-logql';
import { parser as promqlParser } from '@prometheus-io/lezer-promql';
import { logger } from '../utils/logger';

// ─── Advisory syntax validation for AI-generated LogQL / PromQL ──────────────
// Parses the model's generated query with the real Grafana/Prometheus Lezer
// grammars (the same parsers CodeMirror uses to highlight/lint these languages)
// and reports whether the grammar produced any error nodes. This is ADVISORY
// ONLY: it never blocks a query, it only informs the caller so it can warn the
// user and/or spend the shared one-shot repair budget. If the validator itself
// misbehaves for any reason (bad import, parser throw, unexpected shape), it
// fails OPEN — i.e. it reports the query as valid rather than risk blocking a
// query that a broken validator merely failed to check.

export interface QueryValidation {
  valid: boolean;
  error?: string;
}

/** Walks a Lezer parse tree looking for the first error node; returns its start offset, or -1 if none. */
function firstErrorPosition(tree: { cursor: () => any }): number {
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return cursor.from;
  } while (cursor.next());
  return -1;
}

export function validateLogQL(query: string): QueryValidation {
  try {
    const tree = logqlParser.parse(query);
    const errorPos = firstErrorPosition(tree);
    if (errorPos >= 0) {
      return { valid: false, error: `syntax error near position ${errorPos}` };
    }
    return { valid: true };
  } catch (err: any) {
    logger.warn('LogQL syntax validation failed internally — failing open', { error: err?.message });
    return { valid: true };
  }
}

export function validatePromQL(query: string): QueryValidation {
  try {
    const tree = promqlParser.parse(query);
    const errorPos = firstErrorPosition(tree);
    if (errorPos >= 0) {
      return { valid: false, error: `syntax error near position ${errorPos}` };
    }
    return { valid: true };
  } catch (err: any) {
    logger.warn('PromQL syntax validation failed internally — failing open', { error: err?.message });
    return { valid: true };
  }
}
