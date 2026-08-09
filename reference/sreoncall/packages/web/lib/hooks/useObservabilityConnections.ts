'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ObservabilityConnection {
  id: string;
  name: string;
  mode: 'managed' | 'byos' | 'third_party';
  vendor: string | null;
  endpoints: {
    metrics_url: string;
    logs_url: string;
    traces_url: string;
  };
  status: 'pending' | 'connected' | 'error';
  last_health_check_at: string | null;
  health_check_message: string | null;
  config: Record<string, unknown>;
  default_labels: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface CreateConnectionInput {
  name: string;
  mode: 'managed' | 'byos' | 'third_party';
  vendor?: string | null;
  endpoints?: {
    metrics_url?: string;
    logs_url?: string;
    traces_url?: string;
  };
  config?: Record<string, unknown>;
  default_labels?: Record<string, string>;
}

export interface LabelSuggestions {
  recommended_keys: string[];
  reserved_keys: string[];
  values: Record<string, string[]>;
}

const KEYS = {
  all: ['observability-connections'] as const,
  detail: (id: string) => ['observability-connections', id] as const,
};

export function useObservabilityConnections() {
  return useQuery<{ data: ObservabilityConnection[] }>({
    queryKey: KEYS.all,
    queryFn: () => api.get('/api/v1/observability-connections'),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConnectionInput) =>
      api.post('/api/v1/observability-connections', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

export function useUpdateConnection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateConnectionInput>) =>
      api.patch(`/api/v1/observability-connections/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/observability-connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useHealthCheckConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/v1/observability-connections/${id}/health-check`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useLabelSuggestions() {
  return useQuery<{ data: LabelSuggestions }>({
    queryKey: ['observability-connections', 'label-suggestions'],
    queryFn: () => api.get('/api/v1/observability-connections/label-suggestions'),
    staleTime: 60_000,
  });
}

export interface HerokuDrainMigrationAction {
  app: string;
  action: 'migrated' | 'already_current' | 'no_sreoncall_drain' | 'skipped' | 'error';
  legacyDrainsFound?: number;
  error?: string;
  plannedUrl?: string;
}

export interface HerokuDrainMigrationReport {
  tenantId: string;
  connectionId: string;
  connectionName: string;
  dryRun: boolean;
  appsSeen: number;
  apps: HerokuDrainMigrationAction[];
  totals: {
    migrated: number;
    already_current: number;
    no_sreoncall_drain: number;
    error: number;
  };
}

export function useMigrateHerokuDrains() {
  const qc = useQueryClient();
  return useMutation<
    { data: HerokuDrainMigrationReport },
    Error,
    { connectionId: string; dryRun: boolean }
  >({
    mutationFn: ({ connectionId, dryRun }) =>
      api.post(
        `/api/v1/observability-connections/${connectionId}/migrate-heroku-drains?dry_run=${dryRun}`,
        {},
      ),
    onSuccess: (_res, vars) => {
      if (!vars.dryRun) qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}
