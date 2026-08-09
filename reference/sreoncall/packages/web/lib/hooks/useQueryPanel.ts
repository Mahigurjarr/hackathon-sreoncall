'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MetricResult } from '@/lib/hooks/useObservabilityProxy';
import { parseRelativeTime, computeStep } from '@/lib/panel-data-transform';
import { applyQueryTransforms, type VariableValues } from '@/lib/query-substitution';

/**
 * Detect whether a query is LogQL (starts with `{`) vs PromQL (everything else).
 * count_over_time/sum_over_time/rate over a stream selector also indicate LogQL.
 */
function isLogQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.startsWith('{')) return true;
  // Functions wrapping a stream selector
  if (/^(sum|count|avg|max|min|topk|bottomk)?\s*\(?\s*(count_over_time|rate|sum_over_time|bytes_over_time)\s*\(\s*\{/.test(trimmed)) return true;
  return false;
}

// Enforce a minimum refetch interval (15s) to prevent dashboards with many
// panels from overwhelming the backend
const MIN_REFETCH_INTERVAL_MS = 15_000;

export function useQueryPanel(
  query: string,
  timeRange: { from: string; to: string },
  refreshIntervalSeconds: number,
  enabled = true,
  variables: VariableValues = {},
  scope: Record<string, string | undefined> = {},
  staggerIndex = 0,
) {
  // Stagger panel fetches: each panel waits (staggerIndex * 150 ms) before its
  // first query. This spreads a burst of N simultaneous fetches into a stream,
  // keeping the dashboard well under the upstream rate limit.
  const [ready, setReady] = useState(staggerIndex === 0);
  useEffect(() => {
    if (staggerIndex === 0) return;
    const t = setTimeout(() => setReady(true), staggerIndex * 150);
    return () => clearTimeout(t);
  }, [staggerIndex]);

  const fromSec = parseRelativeTime(timeRange.from);
  const toSec = parseRelativeTime(timeRange.to);
  const step = computeStep(fromSec, toSec);
  const isLogql = isLogQuery(query);

  // Substitute dashboard variables and apply resource-scope label injection
  // before dispatching the query. Both transforms are pure — the resulting
  // string is what gets sent to Mimir/Loki and what React Query keys on.
  const resolvedQuery = applyQueryTransforms(query, variables, scope);

  // Round refetch interval up to at least 15s
  const refetchMs = refreshIntervalSeconds > 0
    ? Math.max(refreshIntervalSeconds * 1000, MIN_REFETCH_INTERVAL_MS)
    : false;

  return useQuery<MetricResult>({
    queryKey: ['panel-query', isLogql ? 'logql' : 'promql', resolvedQuery, timeRange.from, timeRange.to, step],
    queryFn: () => {
      const params = new URLSearchParams({
        query: resolvedQuery,
        start: fromSec.toString(),
        end: toSec.toString(),
        step,
      });
      const endpoint = isLogql
        ? `/api/v1/observability/logs/query_range?${params}`
        : `/api/v1/observability/metrics/query_range?${params}`;
      return api.get(endpoint);
    },
    enabled: enabled && !!query && ready,
    refetchInterval: refetchMs,
    staleTime: 15_000,
    // Never retry rate-limit errors — retrying within the same window wastes
    // the remaining budget and causes cascading failures across all panels.
    // Let the auto-refresh cycle handle the next attempt.
    retry: (failureCount, error) => {
      const msg = (error as Error)?.message ?? '';
      if (/rate.?limit/i.test(msg)) return false;
      return failureCount < 1;
    },
    retryDelay: 5000,
    // Don't refetch on window focus for dashboards; they already poll
    refetchOnWindowFocus: false,
  });
}
