'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface SloDefinition {
  id: string;
  service_id: string | null;
  name: string;
  description: string;
  sli: {
    source: 'managed_promql' | 'managed_logql' | 'synthetic' | 'byos';
    query_good: string;
    query_total: string;
    synthetic_check_id: string | null;
  };
  objective_pct: number;
  window_days: number;
  alert_on_burn_rate: boolean;
  burn_rate_thresholds: {
    fast_burn: number;
    slow_burn: number;
  };
  status: 'active' | 'inactive';
  current_sli_pct: number | null;
  error_budget_remaining_pct: number | null;
  burn_rate: number | null;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSloInput {
  service_id: string;
  name: string;
  description?: string;
  sli: {
    source: 'managed_promql' | 'managed_logql' | 'synthetic' | 'byos';
    query_good?: string;
    query_total?: string;
    synthetic_check_id?: string | null;
  };
  objective_pct: number;
  window_days?: number;
  alert_on_burn_rate?: boolean;
  burn_rate_thresholds?: {
    fast_burn?: number;
    slow_burn?: number;
  };
}

const KEYS = {
  all: ['slos'] as const,
  detail: (id: string) => ['slos', id] as const,
};

export function useSLOs() {
  return useQuery<{ data: SloDefinition[] }>({
    queryKey: KEYS.all,
    queryFn: () => api.get('/api/v1/slos'),
  });
}

export function useSLO(id: string) {
  return useQuery<{ data: SloDefinition }>({
    queryKey: KEYS.detail(id),
    queryFn: () => api.get(`/api/v1/slos/${id}`),
    enabled: !!id,
  });
}

export function useCreateSLO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSloInput) => api.post('/api/v1/slos', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateSLO(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateSloInput> & { status?: string }) =>
      api.patch(`/api/v1/slos/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useDeleteSLO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/slos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}
