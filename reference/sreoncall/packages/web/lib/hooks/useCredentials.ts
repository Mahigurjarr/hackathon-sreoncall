'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RotationHistoryEntry {
  rotated_at: string;
  rotated_by: string;
  status: 'success' | 'failed';
  error: string | null;
}

export interface Credential {
  _id: string;
  name: string;
  key: string;
  category: 'internal' | 'external';
  rotation_mode: 'auto' | 'manual';
  rotation_interval_days: number;
  last_rotated_at: string | null;
  next_rotation_at: string | null;
  rotated_by: string | null;
  status: 'healthy' | 'due' | 'overdue' | 'rotating' | 'failed';
  current_value_hint: string | null;
  rotation_instructions: string | null;
  env_var_keys: string[];
  history: RotationHistoryEntry[];
  notify_before_days: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useCredentials() {
  return useQuery<Credential[], APIError>({
    queryKey: ['platform-admin', 'credentials'],
    queryFn: async () => {
      const res = await api.get<{ data: Credential[] }>('/api/v1/platform/credentials');
      return res.data;
    },
    refetchInterval: 30000,
  });
}

export function useCredential(key: string) {
  return useQuery<Credential, APIError>({
    queryKey: ['platform-admin', 'credentials', key],
    queryFn: async () => {
      const res = await api.get<{ data: Credential }>(`/api/v1/platform/credentials/${key}`);
      return res.data;
    },
    enabled: !!key,
  });
}

export function useRotateCredential() {
  const queryClient = useQueryClient();
  return useMutation<Credential, APIError, string>({
    mutationFn: (key) => api.post<Credential>(`/api/v1/platform/credentials/${key}/rotate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'credentials'] });
    },
  });
}

export function useUpdateCredential() {
  const queryClient = useQueryClient();
  return useMutation<
    Credential,
    APIError,
    { key: string; updates: { rotation_interval_days?: number; notify_before_days?: number; rotation_mode?: 'auto' | 'manual' } }
  >({
    mutationFn: ({ key, updates }) => api.patch<Credential>(`/api/v1/platform/credentials/${key}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'credentials'] });
    },
  });
}

export function useSeedCredentials() {
  const queryClient = useQueryClient();
  return useMutation<{ data: Credential[] }, APIError, void>({
    mutationFn: () => api.post<{ data: Credential[] }>('/api/v1/platform/credentials/seed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'credentials'] });
    },
  });
}
