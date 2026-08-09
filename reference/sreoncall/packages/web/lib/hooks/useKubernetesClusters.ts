'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface KubernetesCluster {
  id: string;
  name: string;
  cloud_id: string;
  status: string;
  metadata: {
    node_count?: number;
    pod_count?: number;
    container_count?: number;
    [key: string]: any;
  };
}

export function useKubernetesClusters() {
  return useQuery<KubernetesCluster[]>({
    queryKey: ['kubernetes-clusters'],
    queryFn: async () => {
      const res = await api.get<{ data: KubernetesCluster[] }>('/api/v1/assets', {
        resource_type: 'k8s_cluster',
        limit: 50,
      });
      return res.data ?? [];
    },
    staleTime: 60_000,
  });
}
