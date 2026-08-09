'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface RumSummary {
  hasData: boolean;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  jsErrors: Array<{ time: string; value: number }>;
  pageLoad: Array<{ url_path: string; value: number }>;
  sessions: Array<{ time: string; value: number }>;
  browsers: Array<{ name: string; value: number }>;
  samples: number;
}

export function useRUMMetrics(appSlug?: string) {
  return useQuery<RumSummary>({
    queryKey: ['obs-rum-summary', appSlug || 'internal'],
    queryFn: () => api.get('/api/v1/observability/rum/summary', appSlug ? { appSlug } : undefined),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
