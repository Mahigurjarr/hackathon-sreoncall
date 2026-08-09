'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface WebhookItem {
  id: string;
  url: string;
  description: string;
  secret_prefix: string;
  events: string[];
  active: boolean;
  last_triggered_at: string | null;
  delivery_stats: { success: number; failed: number };
  success_rate: number;
  created_at: string;
  updated_at: string;
}

interface WebhooksResponse {
  data: WebhookItem[];
}

export interface CreateWebhookInput {
  url: string;
  description?: string;
  secret: string;
  events: string[];
}

export function useWebhooks() {
  return useQuery<WebhooksResponse, APIError>({
    queryKey: ['webhooks'],
    queryFn: () => api.get<WebhooksResponse>('/api/v1/webhooks'),
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation<WebhookItem, APIError, CreateWebhookInput>({
    mutationFn: (input) => api.post<WebhookItem>('/api/v1/webhooks', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation<
    WebhookItem,
    APIError,
    { id: string; input: { active?: boolean; events?: string[] } }
  >({
    mutationFn: ({ id, input }) => api.patch<WebhookItem>(`/api/v1/webhooks/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useTestWebhook() {
  return useMutation<{ success: boolean; status?: number }, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/webhooks/${id}/test`),
  });
}
