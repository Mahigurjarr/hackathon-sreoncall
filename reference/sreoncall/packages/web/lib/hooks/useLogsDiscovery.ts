import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface LogFacetResult {
  labels?: string[];
  label?: string;
  values?: string[];
  total: number;
  truncated: boolean;
}

/** Facet list: all present stream label names (window-global, no scope params). */
export function useLogLabelNames(
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<{ labels: string[]; total: number; truncated: boolean }> {
  const { consumerId, enabled = true } = opts;
  return useQuery<{ labels: string[]; total: number; truncated: boolean }>({
    queryKey: ['logs-discovery-labels', consumerId],
    queryFn: () => {
      const params = new URLSearchParams();
      const base = consumerId
        ? '/api/v1/provider/observability/logs-discovery/labels'
        : '/api/v1/observability/logs-discovery/labels';
      if (consumerId) params.set('consumer_id', consumerId);
      const qs = params.toString();
      return api.get(qs ? `${base}?${qs}` : base);
    },
    enabled,
    staleTime: 60_000,
  });
}

/** Facet values for one label, scoped by the current selection (other selected labels). */
export function useLogFacetValues(
  label: string,
  selection: Record<string, string>,
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<{ label: string; values: string[]; total: number; truncated: boolean }> {
  const { consumerId, enabled = true } = opts;
  const serializedSelection = JSON.stringify(
    Object.keys(selection)
      .sort()
      .map((k) => [k, selection[k]]),
  );
  return useQuery<{ label: string; values: string[]; total: number; truncated: boolean }>({
    queryKey: ['logs-discovery-values', label, serializedSelection, consumerId],
    queryFn: () => {
      const params = new URLSearchParams();
      Object.entries(selection).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      const base = consumerId
        ? '/api/v1/provider/observability/logs-discovery/label'
        : '/api/v1/observability/logs-discovery/label';
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`${base}/${encodeURIComponent(label)}/values?${params}`);
    },
    enabled: enabled && !!label,
    staleTime: 60_000,
  });
}
