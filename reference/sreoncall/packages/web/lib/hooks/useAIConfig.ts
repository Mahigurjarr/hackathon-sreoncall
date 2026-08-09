'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import providerData from '../../../api/ai-providers.json';

export interface AIConfigResponse {
  provider: 'openai' | 'anthropic' | 'google' | null;
  model: string | null;
  api_key_hint: string | null;
  configured_by: string | null;
  configured_at: string | null;
}

export interface UpdateAIConfigInput {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  api_key: string;
}

export const AI_PROVIDERS_CLIENT = providerData.providers as unknown as readonly ['openai', 'anthropic', 'google'];
export type AIProviderClient = (typeof AI_PROVIDERS_CLIENT)[number];

export const AI_MODELS_CLIENT: Record<AIProviderClient, string[]> = providerData.models;

export const AI_PROVIDER_LABELS: Record<AIProviderClient, string> = providerData.labels;

export function useAIConfig() {
  return useQuery<AIConfigResponse>({
    queryKey: ['ai-config'],
    queryFn: () => api.get('/api/v1/settings/ai-config'),
  });
}

export function useUpdateAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAIConfigInput) =>
      api.put('/api/v1/settings/ai-config', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-config'] }),
  });
}

export function useDeleteAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/api/v1/settings/ai-config'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-config'] }),
  });
}
