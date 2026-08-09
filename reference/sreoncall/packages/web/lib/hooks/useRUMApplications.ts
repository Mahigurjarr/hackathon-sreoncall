'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface RUMApplication {
  id: string;
  slug: string;
  display_name: string;
  status: 'active';
  created_at: string;
  updated_at: string;
}

export interface CreateRUMApplicationInput {
  slug: string;
  display_name: string;
}

export interface RUMApplicationSnippet {
  id: string;
  slug: string;
  display_name: string;
  app_name: string;
  framework: 'html' | 'nextjs' | 'react' | 'vite';
  ingest_url: string;
  snippet: string;
  limitations: string[];
}

const KEYS = {
  all: ['rum-applications'] as const,
  snippet: (id: string) => ['rum-applications', id, 'snippet'] as const,
};

export function useRUMApplications() {
  return useQuery<{ data: RUMApplication[] }>({
    queryKey: KEYS.all,
    queryFn: () => api.get('/api/v1/rum-applications'),
    staleTime: 30_000,
  });
}

export function useCreateRUMApplication() {
  const qc = useQueryClient();
  return useMutation<{ data: RUMApplication }, Error, CreateRUMApplicationInput>({
    mutationFn: (input) => api.post('/api/v1/rum-applications', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useDeleteRUMApplication() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/v1/rum-applications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useRUMApplicationSnippet(
  id: string | null,
  framework: 'html' | 'nextjs' | 'react' | 'vite' = 'html',
) {
  return useQuery<{ data: RUMApplicationSnippet }>({
    queryKey: id ? [...KEYS.snippet(id), framework] : ['rum-applications', 'snippet', 'disabled', framework],
    queryFn: () => api.get(`/api/v1/rum-applications/${id}/snippet`, { framework }),
    enabled: !!id,
    staleTime: 30_000,
  });
}
