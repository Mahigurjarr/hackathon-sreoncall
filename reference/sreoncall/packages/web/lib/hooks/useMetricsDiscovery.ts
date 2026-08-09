import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MetricType } from '@/lib/observability/promql-build';

/** Sorted-serialized scope/selection for a stable, order-independent query key. */
function serializeScope(scope: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(scope)
      .sort()
      .map((k) => [k, scope[k]]),
  );
}

function scopeParams(scope: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  Object.entries(scope).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  return params;
}

/** Metric-name facet: all `__name__` values present for a scope. */
export function useMetricNames(
  scope: Record<string, string>,
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<{ metrics: string[]; total: number; truncated: boolean }> {
  const { consumerId, enabled = true } = opts;
  const serializedScope = serializeScope(scope);
  return useQuery<{ metrics: string[]; total: number; truncated: boolean }>({
    queryKey: ['metrics-discovery-names', serializedScope, consumerId],
    queryFn: () => {
      const params = scopeParams(scope);
      const base = consumerId
        ? '/api/v1/provider/observability/metrics-discovery/metric-names'
        : '/api/v1/observability/metrics-discovery/metric-names';
      if (consumerId) params.set('consumer_id', consumerId);
      const qs = params.toString();
      return api.get(qs ? `${base}?${qs}` : base);
    },
    enabled,
    staleTime: 60_000,
  });
}

/** Label-name facet for one metric, scoped by the current selection. */
export function useMetricLabelNames(
  metric: string,
  scope: Record<string, string>,
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<{ labels: string[]; total: number; truncated: boolean }> {
  const { consumerId, enabled = true } = opts;
  const serializedScope = serializeScope(scope);
  return useQuery<{ labels: string[]; total: number; truncated: boolean }>({
    queryKey: ['metrics-discovery-labels', metric, serializedScope, consumerId],
    queryFn: () => {
      const params = scopeParams(scope);
      const base = consumerId
        ? '/api/v1/provider/observability/metrics-discovery/metric'
        : '/api/v1/observability/metrics-discovery/metric';
      if (consumerId) params.set('consumer_id', consumerId);
      const qs = params.toString();
      const path = `${base}/${encodeURIComponent(metric)}/labels`;
      return api.get(qs ? `${path}?${qs}` : path);
    },
    enabled: enabled && !!metric,
    staleTime: 60_000,
  });
}

/** Facet values for one label on one metric, scoped by the current selection (other selected labels). */
export function useMetricFacetValues(
  metric: string,
  label: string,
  scope: Record<string, string>,
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<{ label: string; values: string[]; total: number; truncated: boolean }> {
  const { consumerId, enabled = true } = opts;
  const serializedScope = serializeScope(scope);
  return useQuery<{ label: string; values: string[]; total: number; truncated: boolean }>({
    queryKey: ['metrics-discovery-values', metric, label, serializedScope, consumerId],
    queryFn: () => {
      const params = scopeParams(scope);
      const base = consumerId
        ? '/api/v1/provider/observability/metrics-discovery/metric'
        : '/api/v1/observability/metrics-discovery/metric';
      if (consumerId) params.set('consumer_id', consumerId);
      const path = `${base}/${encodeURIComponent(metric)}/label/${encodeURIComponent(label)}/values`;
      return api.get(`${path}?${params}`);
    },
    enabled: enabled && !!metric && !!label,
    staleTime: 60_000,
  });
}

/** Metric type (counter/gauge/histogram/summary/unknown) for one metric. */
export function useMetricType(
  metric: string,
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<MetricType> {
  const { consumerId, enabled = true } = opts;
  return useQuery<MetricType>({
    queryKey: ['metrics-discovery-type', metric, consumerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      const base = consumerId
        ? '/api/v1/provider/observability/metrics-discovery/metric'
        : '/api/v1/observability/metrics-discovery/metric';
      if (consumerId) params.set('consumer_id', consumerId);
      const qs = params.toString();
      const path = `${base}/${encodeURIComponent(metric)}/type`;
      const res = await api.get<{ metric: string; type: MetricType }>(qs ? `${path}?${qs}` : path);
      return res.type;
    },
    enabled: enabled && !!metric,
    staleTime: 60_000,
  });
}
