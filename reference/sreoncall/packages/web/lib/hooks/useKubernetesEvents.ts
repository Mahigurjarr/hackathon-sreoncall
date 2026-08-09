'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface K8sEvent {
  timestamp: string;
  severity: 'critical' | 'warning' | 'info';
  namespace: string;
  workload: string;
  pod: string;
  event_type: string;
  message: string;
  source: 'metrics' | 'k8s_api';
}

export function useKubernetesEvents(params: {
  cluster?: string | null;
  namespace?: string;
  severity?: string;
  start?: string;
  end?: string;
  limit?: number;
}) {
  return useQuery<K8sEvent[]>({
    queryKey: ['kubernetes-events', params],
    queryFn: async () => {
      const res = await api.get<{ data: K8sEvent[] }>('/api/v1/kubernetes/events', {
        cluster: params.cluster ?? undefined,
        namespace: params.namespace || undefined,
        severity: params.severity || undefined,
        start: params.start || undefined,
        end: params.end || undefined,
        limit: params.limit ?? 200,
      });
      return res.data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
