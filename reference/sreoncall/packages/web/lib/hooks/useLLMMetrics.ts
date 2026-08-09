'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useLLMMetrics(params: { model?: string; service?: string }) {
  return useQuery<any>({
    queryKey: ['llm-metrics', params.model, params.service],
    queryFn: async () => {
      const queries: Record<string, string> = {
        requestRate: 'sum(rate(gen_ai_duration_seconds_count[5m])) by (gen_ai_request_model)',
        latencyP99: 'histogram_quantile(0.99, sum(rate(gen_ai_duration_seconds_bucket[5m])) by (le, gen_ai_request_model))',
        errorRate: 'sum(rate(gen_ai_duration_seconds_count{status_code="STATUS_CODE_ERROR"}[5m])) by (gen_ai_system)',
        topConsumers: 'topk(10, sum(rate(gen_ai_duration_seconds_count[5m])) by (service_name))',
      };

      const results: Record<string, any> = {};
      const now = Math.floor(Date.now() / 1000);
      const start = now - 3600;

      await Promise.all(
        Object.entries(queries).map(async ([key, query]) => {
          try {
            const res = await api.get<any>('/api/v1/observability/metrics/query_range', {
              query,
              start: String(start),
              end: String(now),
              step: '60',
            });
            results[key] = res?.data?.result ?? [];
          } catch {
            results[key] = [];
          }
        })
      );

      return results;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
};
