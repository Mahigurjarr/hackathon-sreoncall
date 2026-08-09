'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useProfileLabelValues(label: string) {
  return useQuery<string[]>({
    queryKey: ['profile-label-values', label],
    queryFn: async () => {
      const res = await api.get<{ names?: string[] }>('/api/v1/observability/profiles/label-values', {
        label,
      });
      return (res as any)?.names ?? (Array.isArray(res) ? res : []);
    },
    staleTime: 60_000,
  });
}

export function useProfileRender(params: {
  query: string | null;
  from?: string;
  until?: string;
  enabled?: boolean;
}) {
  return useQuery<any>({
    queryKey: ['profile-render', params.query, params.from, params.until],
    queryFn: async () => {
      const res = await api.get<any>('/api/v1/observability/profiles/render', {
        query: params.query ?? undefined,
        from: params.from || String(Math.floor(Date.now() / 1000) - 3600),
        until: params.until || String(Math.floor(Date.now() / 1000)),
        format: 'json',
      });
      return res;
    },
    enabled: !!params.query && params.enabled !== false,
    staleTime: 30_000,
  });
}
