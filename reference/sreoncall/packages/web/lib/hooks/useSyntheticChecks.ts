'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type CheckType = 'http' | 'tcp' | 'dns';
export type CheckStatus = 'active' | 'paused';
export type CheckResultStatus = 'up' | 'down' | 'degraded';

export interface SyntheticCheck {
  id: string;
  name: string;
  type: CheckType;
  status: CheckStatus;
  service_id: string | null;
  interval_seconds: number;
  timeout_seconds: number;
  url: string | null;
  method: string;
  http_headers: Record<string, string>;
  expected_status_code: number;
  allowed_status_codes: number[];
  keyword_check: string | null;
  host: string | null;
  port: number | null;
  hostname: string | null;
  record_type: string;
  expected_value: string | null;
  last_check_at: string | null;
  last_status: CheckResultStatus | null;
  last_response_time_ms: number | null;
  uptime_1h: number;
  uptime_24h: number;
  uptime_7d: number;
  consecutive_failures: number;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_city: string | null;
  geo_country: string | null;
  geo_ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckResult {
  _id: string;
  check_id: string;
  status: CheckResultStatus;
  response_time_ms: number | null;
  error: string | null;
  http_status_code: number | null;
  ssl_issuer: string | null;
  ssl_valid_from: string | null;
  ssl_valid_to: string | null;
  ssl_days_remaining: number | null;
  checked_at: string;
}

export interface CreateCheckInput {
  name: string;
  type: CheckType;
  service_id?: string | null;
  interval_seconds?: number;
  timeout_seconds?: number;
  url?: string;
  method?: 'GET' | 'POST' | 'HEAD';
  http_headers?: Record<string, string>;
  expected_status_code?: number;
  allowed_status_codes?: number[];
  keyword_check?: string;
  host?: string;
  port?: number | null;
  hostname?: string;
  record_type?: 'A' | 'CNAME' | 'MX' | 'TXT';
  expected_value?: string;
}

interface ChecksResponse {
  data: SyntheticCheck[];
  pagination: { has_more: boolean; total: number };
}

export function useSyntheticChecks(filters: { status?: string; type?: string; search?: string } = {}) {
  return useQuery<ChecksResponse, APIError>({
    queryKey: ['synthetic-checks', filters],
    queryFn: () => api.get<ChecksResponse>('/api/v1/synthetic-checks', { ...filters, limit: 100 }),
    refetchInterval: 30_000,
  });
}

export interface CheckResultsParams {
  from?: number;   // ms epoch
  until?: number;  // ms epoch
  limit?: number;
}

export async function fetchCheckResults(checkId: string, params: CheckResultsParams = {}): Promise<{ data: CheckResult[] }> {
  return api.get(`/api/v1/synthetic-checks/${checkId}/results`, {
    limit: params.limit ?? 500,
    ...(params.from  ? { from:  new Date(params.from).toISOString()  } : {}),
    ...(params.until ? { until: new Date(params.until).toISOString() } : {}),
  });
}

export function useCheckResults(checkId: string, params: CheckResultsParams = {}, enabled = true) {
  return useQuery<{ data: CheckResult[] }, APIError>({
    queryKey: ['check-results', checkId, params],
    queryFn: () => api.get(`/api/v1/synthetic-checks/${checkId}/results`, {
      limit: params.limit ?? 500,
      ...(params.from  ? { from:  new Date(params.from).toISOString()  } : {}),
      ...(params.until ? { until: new Date(params.until).toISOString() } : {}),
    }),
    enabled: !!checkId && enabled,
    refetchInterval: 30_000,
  });
}

export function useCreateCheck() {
  const qc = useQueryClient();
  return useMutation<SyntheticCheck, APIError, CreateCheckInput>({
    mutationFn: (input) => api.post('/api/v1/synthetic-checks', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synthetic-checks'] }),
  });
}

export function useUpdateCheck() {
  const qc = useQueryClient();
  return useMutation<SyntheticCheck, APIError, { id: string; input: Partial<CreateCheckInput> & { status?: string } }>({
    mutationFn: ({ id, input }) => api.patch(`/api/v1/synthetic-checks/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synthetic-checks'] }),
  });
}

export function useDeleteCheck() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/synthetic-checks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synthetic-checks'] }),
  });
}

export function useTriggerCheck() {
  const qc = useQueryClient();
  return useMutation<SyntheticCheck, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/synthetic-checks/${id}/trigger`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synthetic-checks'] }),
  });
}

export function usePauseCheck() {
  const qc = useQueryClient();
  return useMutation<SyntheticCheck, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/synthetic-checks/${id}/pause`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synthetic-checks'] }),
  });
}

export function useResumeCheck() {
  const qc = useQueryClient();
  return useMutation<SyntheticCheck, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/synthetic-checks/${id}/resume`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synthetic-checks'] }),
  });
}
