'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ApiKeysResponse {
  data: ApiKeyItem[];
}

export interface CreateApiKeyInput {
  name: string;
  permissions?: string[];
}

export interface CreatedApiKey extends ApiKeyItem {
  key: string;
}

export function useApiKeys() {
  return useQuery<ApiKeysResponse, APIError>({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeysResponse>('/api/v1/api-keys'),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation<CreatedApiKey, APIError, CreateApiKeyInput>({
    mutationFn: (input) => api.post<CreatedApiKey>('/api/v1/api-keys', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
