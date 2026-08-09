'use client';

import { useMutation } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateLogQLInput {
  question: string;
  scope?: Record<string, string>;
  consumerId?: string;
  /** Set on a retry after the previous query failed to render. */
  repair?: { previousQuery: string; error: string };
}

export interface GenerateLogQLResult {
  logql: string;
  explanation: string;
  grounded: boolean;
  truncated: boolean;
  /** Advisory server-side syntax check of the generated LogQL. false = fill the box but don't auto-run. */
  valid: boolean;
  /** Whether the server already spent its one shared model-repair attempt for this request. */
  repaired: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Turn a natural-language question into a single grounded LogQL expression.
 * Generate-only: the backend does NOT execute the query — the explorer renders the log
 * stream from the returned `logql` using its existing machinery.
 */
export function useGenerateLogQL() {
  return useMutation<GenerateLogQLResult, APIError, GenerateLogQLInput>({
    mutationFn: ({ question, scope, consumerId, repair }) =>
      api.post<GenerateLogQLResult>('/api/v1/observability/ai/generate-logql', {
        question,
        scope,
        consumer_id: consumerId,
        repair,
      }),
  });
}
