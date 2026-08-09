'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Metrics (PromQL via Mimir) ──────────────────────────────────────

export interface MetricSample {
  metric: Record<string, string>;
  value?: [number, string];        // instant
  values?: [number, string][];     // range
}

export interface MetricResult {
  status: string;
  data: {
    resultType: 'vector' | 'matrix' | 'scalar';
    result: MetricSample[];
  };
}

export function useMetricsQuery(query: string, time?: string, enabled = true) {
  return useQuery<MetricResult>({
    queryKey: ['obs-metrics-query', query, time],
    queryFn: () => {
      const params = new URLSearchParams({ query });
      if (time) params.set('time', time);
      return api.get(`/api/v1/observability/metrics/query?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 30_000,
  });
}

export function useMetricsRangeQuery(
  query: string,
  start?: string,
  end?: string,
  step = '60s',
  enabled = true,
) {
  return useQuery<MetricResult>({
    queryKey: ['obs-metrics-range', query, start, end, step],
    queryFn: () => {
      const params = new URLSearchParams({ query, step });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return api.get(`/api/v1/observability/metrics/query_range?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 30_000,
  });
}

export function useMetricLabels(enabled = true) {
  return useQuery<{ status: string; data: string[] }>({
    queryKey: ['obs-metrics-labels'],
    queryFn: () => api.get('/api/v1/observability/metrics/labels'),
    enabled,
    staleTime: 60_000,
  });
}

export function useMetricsExemplars(
  query: string,
  start?: string,
  end?: string,
  enabled = true,
) {
  return useQuery<{
    status: string;
    data: Array<{
      seriesLabels: Record<string, string>;
      exemplars: Array<{
        labels: Record<string, string>;
        value: string;
        timestamp: number;
      }>;
    }>;
  }>({
    queryKey: ['obs-metrics-exemplars', query, start, end],
    queryFn: () => {
      const params = new URLSearchParams({ query });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return api.get(`/api/v1/observability/metrics/exemplars?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 30_000,
  });
}

export function useMetricNames(enabled = true) {
  return useQuery<{ status: string; data: string[] }>({
    queryKey: ['obs-metric-names'],
    queryFn: () => api.get('/api/v1/observability/metrics/label/__name__/values'),
    enabled,
    staleTime: 60_000,
  });
}

export function useMetricLabelValues(label: string, enabled = true) {
  return useQuery<{ status: string; data: string[] }>({
    queryKey: ['obs-metric-label-values', label],
    queryFn: () => api.get(`/api/v1/observability/metrics/label/${encodeURIComponent(label)}/values`),
    enabled: enabled && !!label,
    staleTime: 60_000,
  });
}

// ── Logs (LogQL via Loki) ───────────────────────────────────────────

export interface LogStream {
  stream: Record<string, string>;
  values: [string, string][];    // [nanosecond_ts, log_line]
}

export interface LogResult {
  status: string;
  data: {
    resultType: 'streams' | 'matrix';
    result: LogStream[];
    stats?: Record<string, unknown>;
  };
}

/** Imperative log fetch for pagination (not a hook) */
export async function fetchLogs(
  query: string,
  start: string,
  end: string,
  limit = '500',
  direction: 'forward' | 'backward' = 'backward',
): Promise<LogResult> {
  const params = new URLSearchParams({ query, limit, direction });
  params.set('start', start);
  params.set('end', end);
  return api.get(`/api/v1/observability/logs/query_range?${params}`);
}

export function useLogsQuery(
  query: string,
  start?: string,
  end?: string,
  limit = '100',
  direction: 'forward' | 'backward' = 'backward',
  enabled = true,
) {
  return useQuery<LogResult>({
    queryKey: ['obs-logs', query, start, end, limit, direction],
    queryFn: () => {
      const params = new URLSearchParams({ query, limit, direction });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return api.get(`/api/v1/observability/logs/query_range?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 15_000,
  });
}

/**
 * Log volume query — uses count_over_time metric query with step param
 * to get time-bucketed counts across the full range (for histograms).
 */
export function useLogVolume(
  logQuery: string,
  start?: string,
  end?: string,
  step?: string,
  enabled = true,
) {
  const volumeQuery = logQuery ? `sum by (level) (count_over_time(${logQuery} [${step || '1m'}]))` : '';
  return useQuery<any>({
    queryKey: ['obs-log-volume', volumeQuery, start, end, step],
    queryFn: () => {
      const params = new URLSearchParams({ query: volumeQuery });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (step) params.set('step', step);
      return api.get(`/api/v1/observability/logs/volume?${params}`);
    },
    enabled: enabled && !!logQuery,
    staleTime: 30_000,
  });
}

export function useLogLabels(enabled = true) {
  return useQuery<{ status: string; data: string[] }>({
    queryKey: ['obs-log-labels'],
    queryFn: () => api.get('/api/v1/observability/logs/labels'),
    enabled,
    staleTime: 60_000,
  });
}

export function useLogLabelValues(label: string, enabled = true) {
  return useQuery<{ status: string; data: string[] }>({
    queryKey: ['obs-log-label-values', label],
    queryFn: () => api.get(`/api/v1/observability/logs/label/${encodeURIComponent(label)}/values`),
    enabled: enabled && !!label,
    staleTime: 60_000,
  });
}

// ── Traces (via Tempo) ──────────────────────────────────────────────

export function useTraceById(traceId: string, enabled = true, scope?: 'platform') {
  return useQuery({
    queryKey: ['obs-trace', traceId, scope],
    queryFn: () => {
      const params = scope ? `?scope=${scope}` : '';
      return api.get(`/api/v1/observability/traces/${traceId}${params}`);
    },
    enabled: enabled && !!traceId,
  });
}

export function useTraceSearch(
  q?: string,
  start?: string,
  end?: string,
  limit?: string,
  enabled = true,
  scope?: 'platform',
) {
  return useQuery({
    queryKey: ['obs-trace-search', q, start, end, limit, scope],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (limit) params.set('limit', limit);
      if (scope) params.set('scope', scope);
      return api.get(`/api/v1/observability/traces?${params}`);
    },
    enabled,
    staleTime: 30_000,
  });
}

// ── LGTM Health ─────────────────────────────────────────────────────

export interface LgtmHealth {
  status: 'ok' | 'degraded';
  services: Record<string, { status: string; message: string }>;
}

export function useLgtmHealth(enabled = true) {
  return useQuery<LgtmHealth>({
    queryKey: ['obs-lgtm-health'],
    queryFn: () => api.get('/api/v1/observability/health'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
