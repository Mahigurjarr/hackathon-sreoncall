'use client';

import { useQuery } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface SLAMetrics {
  consumer_tenant_id: string;
  consumer_name?: string;
  total_incidents: number;
  avg_response_seconds: number | null;
  avg_resolution_seconds: number | null;
  p50_response_seconds: number | null;
  p90_response_seconds: number | null;
}

export function useProviderSLA(consumerId?: string) {
  return useQuery<SLAMetrics[], APIError>({
    queryKey: ['provider-sla', consumerId],
    queryFn: async () => {
      const res = await api.get<{ data: SLAMetrics[] }>('/api/v1/provider/consumers/sla', {
        consumer_id: consumerId,
      });
      return res.data;
    },
  });
}
