'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface IngestionToken {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  token?: string; // only on creation
}

export interface CreateTokenInput {
  name: string;
  scopes: ('metrics:write' | 'logs:write' | 'traces:write')[];
  expires_at?: string | null;
}

const KEYS = {
  all: ['ingestion-tokens'] as const,
};

export function useIngestionTokens() {
  return useQuery<{ data: IngestionToken[] }>({
    queryKey: KEYS.all,
    queryFn: () => api.get('/api/v1/ingestion-tokens'),
  });
}

export function useCreateIngestionToken() {
  const qc = useQueryClient();
  return useMutation<{ data: IngestionToken }, Error, CreateTokenInput>({
    mutationFn: (input) => api.post('/api/v1/ingestion-tokens', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useRevokeIngestionToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ingestion-tokens/${id}/revoke`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useDeleteIngestionToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/ingestion-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}
