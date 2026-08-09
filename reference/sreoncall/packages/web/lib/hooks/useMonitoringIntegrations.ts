'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type IntegrationType = 'prometheus' | 'datadog' | 'newrelic' | 'grafana' | 'mimir' | 'loki';

export interface MonitoringIntegration {
  id: string;
  name: string;
  type: IntegrationType;
  endpoint_url: string;
  api_key: string;
  extra_headers: Record<string, string>;
  status: 'connected' | 'error' | 'pending';
  last_tested_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIntegrationInput {
  name: string;
  type: IntegrationType;
  endpoint_url: string;
  api_key?: string;
  extra_headers?: Record<string, string>;
}

export function useMonitoringIntegrations() {
  return useQuery<{ data: MonitoringIntegration[] }, APIError>({
    queryKey: ['monitoring-integrations'],
    queryFn: () => api.get('/api/v1/monitoring-integrations'),
  });
}

export function useCreateIntegration() {
  const qc = useQueryClient();
  return useMutation<MonitoringIntegration, APIError, CreateIntegrationInput>({
    mutationFn: (input) => api.post('/api/v1/monitoring-integrations', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring-integrations'] }),
  });
}

export function useUpdateIntegration() {
  const qc = useQueryClient();
  return useMutation<MonitoringIntegration, APIError, { id: string; input: Partial<CreateIntegrationInput> }>({
    mutationFn: ({ id, input }) => api.patch(`/api/v1/monitoring-integrations/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring-integrations'] }),
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/monitoring-integrations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring-integrations'] }),
  });
}

export function useTestIntegration() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; message: string; latency_ms: number }, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/monitoring-integrations/${id}/test`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring-integrations'] }),
  });
}

export function useMetricsQuery(query: string, enabled = true) {
  return useQuery<any, APIError>({
    queryKey: ['metrics-query', query],
    queryFn: () => api.get('/api/v1/metrics/query_range', {
      query,
      start: Math.floor((Date.now() - 3600_000) / 1000).toString(),
      end:   Math.floor(Date.now() / 1000).toString(),
      step:  '60',
    }),
    enabled: !!query && enabled,
    refetchInterval: 60_000,
  });
}

export function useLogsQuery(query: string, enabled = true) {
  return useQuery<any, APIError>({
    queryKey: ['logs-query', query],
    queryFn: () => api.get('/api/v1/metrics/logs', {
      query,
      start: new Date(Date.now() - 3600_000).toISOString(),
      end:   new Date().toISOString(),
      limit: '100',
    }),
    enabled: !!query && enabled,
    refetchInterval: 30_000,
  });
}
