'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface BridgeSlaState {
  id: string;
  bridge_id: string;
  contract_id: string;
  current_tier: number;
  current_tier_name: string | null;
  next_tier_name: string | null;
  tier_started_at: string;
  tier_deadline: string | null;
  response_sla: { target_minutes: number; deadline_at: string; met_at: string | null; breached: boolean };
  resolution_sla: { target_minutes: number; deadline_at: string; met_at: string | null; breached: boolean };
  tier_history: Array<{ level: number; started_at: string; ended_at: string | null; reason: string }>;
  status: string;
}

interface EscalateTierResult {
  current_tier: number;
  tier_deadline: string | null;
  next_tier_schedule_id: string | null;
  escalated: boolean;
  paged_user_count?: number;
}

export interface BridgeIncident {
  _id: string;
  number: number;
  title: string;
  severity: number;
  status: string;
}

export interface IncidentBridge {
  _id: string;
  consumer_tenant_id: string;
  consumer_incident_id: string;
  consumer_incident?: BridgeIncident;
  provider_tenant_id: string;
  provider_incident_id: string;
  provider_incident?: BridgeIncident;
  status: 'active' | 'resolved' | 'expired';
  escalated_at: string;
  resolved_at: string | null;
  createdAt: string;
}

export function useBridges() {
  return useQuery<IncidentBridge[], APIError>({
    queryKey: ['bridges'],
    queryFn: async () => {
      const res = await api.get<{ data: IncidentBridge[] }>('/api/v1/bridges', { limit: 100 });
      return res.data;
    },
  });
}

export function useBridgeByIncident(incidentId: string) {
  return useQuery<IncidentBridge | null, APIError>({
    queryKey: ['bridge-by-incident', incidentId],
    queryFn: async () => {
      try {
        return await api.get<IncidentBridge>(`/api/v1/bridges/incident/${incidentId}`);
      } catch {
        return null;
      }
    },
    enabled: !!incidentId,
  });
}

export function useBridgeSlaState(bridgeId: string | undefined) {
  return useQuery<BridgeSlaState | null, APIError>({
    queryKey: ['bridge-sla-state', bridgeId],
    queryFn: async () => {
      try {
        const res = await api.get<{ data: BridgeSlaState }>(`/api/v1/bridges/${bridgeId}/sla-state`);
        return res.data;
      } catch {
        return null;
      }
    },
    enabled: !!bridgeId,
    refetchInterval: 30000,
  });
}

export function useEscalateTier() {
  const qc = useQueryClient();
  return useMutation<{ data: EscalateTierResult }, APIError, string>({
    mutationFn: (bridgeId) => api.post(`/api/v1/bridges/${bridgeId}/escalate-tier`, {}),
    onSuccess: (_data, bridgeId) => {
      qc.invalidateQueries({ queryKey: ['bridge-sla-state', bridgeId] });
    },
  });
}
