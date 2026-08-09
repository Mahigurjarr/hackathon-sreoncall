'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface WorkloadMetricsData {
  cpu: any[];
  memory: any[];
  network_rx: any[];
  network_tx: any[];
  restarts: any[];
}

const EMPTY: WorkloadMetricsData = { cpu: [], memory: [], network_rx: [], network_tx: [], restarts: [] };

export function useWorkloadMetrics(params: {
  namespace: string | null;
  workload: string | null;
  kind: string | null;
  enabled?: boolean;
}) {
  return useQuery<WorkloadMetricsData>({
    queryKey: ['workload-metrics', params.namespace, params.workload, params.kind],
    queryFn: async () => {
      const res = await api.get<{ data: WorkloadMetricsData }>('/api/v1/kubernetes/workload-metrics', {
        namespace: params.namespace ?? undefined,
        workload: params.workload ?? undefined,
        kind: params.kind ?? 'Deployment',
      });
      return res.data ?? EMPTY;
    },
    enabled: !!params.namespace && !!params.workload && params.enabled !== false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
