'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface ProviderObsConsumer {
  consumer_id: string;
  consumer_name: string | null;
  consumer_slug: string | null;
  observability_mode: 'managed' | 'byos';
  included_in_cross_tenant_query: boolean;
}

export function useProviderObservabilityConsumers(enabled = true) {
  return useQuery<ProviderObsConsumer[], APIError>({
    queryKey: ['provider-obs-consumers'],
    queryFn: async () => {
      const res = await api.get<{ data: ProviderObsConsumer[] }>('/api/v1/provider/observability/consumers');
      return res.data;
    },
    enabled,
  });
}

// ── Scope management ─────────────────────────────────────────────────

const ALL_SCOPES = [
  'incidents', 'escalations', 'oncall', 'runbooks',
  'communications', 'tickets', 'changes', 'managed_support', 'observability',
] as const;

export type ConsumerScope = typeof ALL_SCOPES[number];

export { ALL_SCOPES };

export function useUpdateConsumerScope() {
  const qc = useQueryClient();
  return useMutation<
    { _id: string; scope: string[] },
    APIError,
    { consumerId: string; scope: ConsumerScope[] }
  >({
    mutationFn: ({ consumerId, scope }) =>
      api.patch(`/api/v1/provider/consumers/${consumerId}/scope`, { scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-consumers'] });
      qc.invalidateQueries({ queryKey: ['provider-obs-consumers'] });
    },
  });
}

// ── Metrics ──────────────────────────────────────────────────────────

export interface MetricSample {
  metric: Record<string, string>;
  value?: [number, string];
  values?: [number, string][];
}

export interface MetricResult {
  status: string;
  data: { resultType: 'vector' | 'matrix' | 'scalar'; result: MetricSample[] };
}

export function useProviderMetricsQuery(
  query: string,
  consumerId?: string,
  time?: string,
  enabled = true,
) {
  return useQuery<MetricResult, APIError>({
    queryKey: ['provider-obs-metrics-query', query, consumerId, time],
    queryFn: () => {
      const params = new URLSearchParams({ query });
      if (time) params.set('time', time);
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`/api/v1/provider/observability/metrics/query?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 30_000,
  });
}

export function useProviderMetricsRangeQuery(
  query: string,
  consumerId?: string,
  start?: string,
  end?: string,
  step = '60s',
  enabled = true,
) {
  return useQuery<MetricResult, APIError>({
    queryKey: ['provider-obs-metrics-range', query, consumerId, start, end, step],
    queryFn: () => {
      const params = new URLSearchParams({ query, step });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`/api/v1/provider/observability/metrics/query_range?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 30_000,
  });
}

// ── Logs ─────────────────────────────────────────────────────────────

export interface LogStream {
  stream: Record<string, string>;
  values: [string, string][];
}

export interface LogResult {
  status: string;
  data: { resultType: 'streams' | 'matrix'; result: LogStream[] };
}

export function useProviderLogsQuery(
  query: string,
  consumerId?: string,
  start?: string,
  end?: string,
  limit = '200',
  direction: 'forward' | 'backward' = 'backward',
  enabled = true,
) {
  return useQuery<LogResult, APIError>({
    queryKey: ['provider-obs-logs', query, consumerId, start, end, limit, direction],
    queryFn: () => {
      const params = new URLSearchParams({ query, limit, direction });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`/api/v1/provider/observability/logs/query_range?${params}`);
    },
    enabled: enabled && !!query,
    staleTime: 15_000,
  });
}

export function useProviderLogVolume(
  logQuery: string,
  consumerId?: string,
  start?: string,
  end?: string,
  step?: string,
  enabled = true,
) {
  const volumeQuery = logQuery
    ? `sum by (level) (count_over_time(${logQuery} [${step || '1m'}]))`
    : '';
  return useQuery<MetricResult, APIError>({
    queryKey: ['provider-obs-log-volume', volumeQuery, consumerId, start, end, step],
    queryFn: () => {
      const params = new URLSearchParams({ query: volumeQuery });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (step) params.set('step', step);
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`/api/v1/provider/observability/logs/volume?${params}`);
    },
    enabled: enabled && !!logQuery,
    staleTime: 30_000,
  });
}

// ── Traces ───────────────────────────────────────────────────────────

export function useProviderTraceSearch(
  q?: string,
  consumerId?: string,
  start?: string,
  end?: string,
  limit?: string,
  enabled = true,
) {
  return useQuery<any, APIError>({
    queryKey: ['provider-obs-trace-search', q, consumerId, start, end, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (limit) params.set('limit', limit);
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`/api/v1/provider/observability/traces?${params}`);
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useProviderTraceById(traceId: string, consumerId?: string, enabled = true) {
  return useQuery<any, APIError>({
    queryKey: ['provider-obs-trace', traceId, consumerId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (consumerId) params.set('consumer_id', consumerId);
      const qs = params.toString() ? `?${params}` : '';
      return api.get(`/api/v1/provider/observability/traces/${traceId}${qs}`);
    },
    enabled: enabled && !!traceId,
  });
}
