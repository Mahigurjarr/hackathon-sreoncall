'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DiscoveryMethodThreshold {
  enabled: boolean;
  base_observation_threshold: number;
}

export interface CriticalityMultiplier {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface ServiceTopologySettings {
  cascade_enabled: boolean;
  auto_approval: {
    enabled: boolean;
    thresholds: {
      auto_otel: DiscoveryMethodThreshold;
      auto_network: DiscoveryMethodThreshold;
      ai_parsed: DiscoveryMethodThreshold;
      document_upload: DiscoveryMethodThreshold;
    };
    criticality_multiplier: CriticalityMultiplier;
  };
}

export interface UpdateTopologySettingsInput {
  cascade_enabled?: boolean;
  auto_approval?: {
    enabled?: boolean;
  };
}

const KEYS = {
  all: ['service-topology-settings'] as const,
};

export function useTopologySettings() {
  return useQuery<{ data: ServiceTopologySettings }>({
    queryKey: KEYS.all,
    queryFn: () => api.get('/api/v1/service-topology-settings'),
  });
}

export function useUpdateTopologySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTopologySettingsInput) =>
      api.patch('/api/v1/service-topology-settings', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}
