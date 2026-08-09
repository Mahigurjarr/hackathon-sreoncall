'use client';

import { useMutation } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIQueryResult {
  answer: string;
  queries: Array<{
    type: 'promql' | 'logql' | 'traceql' | string;
    query: string;
    results: unknown;
  }>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAIQuery() {
  return useMutation<AIQueryResult, APIError, string>({
    mutationFn: (question) =>
      api.post<AIQueryResult>('/api/v1/observability/ai/query', { question }),
  });
}
