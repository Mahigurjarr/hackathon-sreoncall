'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type ExternalAlertPlatform = 'groundcover' | 'alertmanager' | 'grafana' | 'datadog' | 'generic';

export interface ExternalAlertSource {
  id: string;
  name: string;
  description?: string;
  platform: ExternalAlertPlatform;
  token_prefix: string;
  default_severity: number;
  auto_create_incident: boolean;
  auto_resolve: boolean;
  escalation_policy_id: string | null;
  service_id: string | null;
  labels: string[];
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  webhook_url: string;
}

export interface CreatedExternalAlertSource extends ExternalAlertSource {
  token: string;
}

export interface CreateExternalAlertSourceInput {
  name: string;
  description?: string;
  platform: ExternalAlertPlatform;
  default_severity?: number;
  auto_create_incident?: boolean;
  auto_resolve?: boolean;
  service_id?: string | null;
}

export function useExternalAlertSources() {
  return useQuery<{ data: ExternalAlertSource[] }, APIError>({
    queryKey: ['external-alert-sources'],
    queryFn: () => api.get('/api/v1/external-alert-sources'),
  });
}

export function useCreateExternalAlertSource() {
  const queryClient = useQueryClient();
  return useMutation<{ data: CreatedExternalAlertSource; note: string }, APIError, CreateExternalAlertSourceInput>({
    mutationFn: (input) => api.post('/api/v1/external-alert-sources', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external-alert-sources'] });
    },
  });
}

export function useDeleteExternalAlertSource() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/external-alert-sources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external-alert-sources'] });
    },
  });
}

export function useRotateExternalAlertSourceToken() {
  const queryClient = useQueryClient();
  return useMutation<{ data: CreatedExternalAlertSource; note: string }, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/external-alert-sources/${id}/rotate-token`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external-alert-sources'] });
    },
  });
}
