'use client';

import { useMutation } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';
import { DiscoveryScope } from '@/lib/hooks/useObservabilityDiscovery';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateQueryScope extends DiscoveryScope {
  pod?: string;
}

export interface GenerateQueryInput {
  question: string;
  scope?: GenerateQueryScope;
  consumerId?: string;
  /** Set on a retry after the previous query failed to render. */
  repair?: { previousQuery: string; error: string };
}

export interface GenerateQueryResult {
  promql: string;
  explanation: string;
  grounded: boolean;
  truncated: boolean;
  /** Advisory server-side syntax check of the generated PromQL. false = fill the box but don't auto-run. */
  valid: boolean;
  /** Whether the server already spent its one shared model-repair attempt for this request. */
  repaired: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Turn a natural-language question into a single grounded PromQL expression.
 * Generate-only: the backend does NOT execute the query — the explorer renders the chart
 * from the returned `promql` using its existing machinery.
 */
export function useGenerateQuery() {
  return useMutation<GenerateQueryResult, APIError, GenerateQueryInput>({
    mutationFn: ({ question, scope, consumerId, repair }) =>
      api.post<GenerateQueryResult>('/api/v1/observability/ai/generate-query', {
        question,
        scope,
        consumer_id: consumerId,
        repair,
      }),
  });
}
