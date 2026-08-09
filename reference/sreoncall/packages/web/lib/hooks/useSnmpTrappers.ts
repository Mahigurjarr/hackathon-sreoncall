'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface SnmpTrapper {
  id: string;
  name: string;
  hostname: string;
  version: string;
  status: 'online' | 'offline' | 'degraded';
  last_heartbeat_at: string | null;
  uptime_seconds: number;
  trap_rate: number;
  active_correlations: number;
  ip_address: string;
  config_hash: string;
  created_at: string;
}

interface SnmpTrappersResponse {
  data: SnmpTrapper[];
}

export function useSnmpTrappers() {
  return useQuery<SnmpTrappersResponse, APIError>({
    queryKey: ['snmp-trappers'],
    queryFn: () => api.get<SnmpTrappersResponse>('/api/v1/snmp-trappers'),
  });
}

export function useDeleteSnmpTrapper() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/snmp-trappers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snmp-trappers'] });
    },
  });
}
