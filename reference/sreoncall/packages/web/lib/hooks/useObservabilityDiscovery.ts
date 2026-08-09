import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type DiscoveryLevel = 'cluster' | 'namespace' | 'service' | 'pod';
export interface DiscoveryScope {
  cluster?: string;
  namespace?: string;
  service?: string;
}
export interface DiscoveryResult {
  level: string;
  values: string[];
  total: number;
  truncated: boolean;
  health?: Record<string, 'ok' | 'down' | 'unknown'>;
}

export function useDiscoveryChildren(
  level: DiscoveryLevel,
  scope: DiscoveryScope,
  opts: { consumerId?: string; enabled?: boolean } = {},
): UseQueryResult<DiscoveryResult> {
  const { consumerId, enabled = true } = opts;
  return useQuery<DiscoveryResult>({
    queryKey: ['obs-discovery', level, scope.cluster, scope.namespace, scope.service, consumerId],
    queryFn: () => {
      const params = new URLSearchParams({ level });
      if (scope.cluster) params.set('cluster', scope.cluster);
      if (scope.namespace) params.set('namespace', scope.namespace);
      if (scope.service) params.set('service', scope.service);
      const base = consumerId
        ? '/api/v1/provider/observability/discovery/children'
        : '/api/v1/observability/discovery/children';
      if (consumerId) params.set('consumer_id', consumerId);
      return api.get(`${base}?${params}`);
    },
    enabled,
    staleTime: 60_000,
  });
}
