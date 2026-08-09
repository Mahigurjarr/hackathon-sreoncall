'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlertQualityEntry {
  id: string;
  alert_rule_id: string | null;
  alert_rule: { id: string; name: string; severity: string; status: string } | null;
  signal_score: number;
  noise_score: number;
  recommendation: string;
  recommendation_details: string | null;
  total_firings: number;
  incident_created_count: number;
  created_at: string;
  updated_at: string;
}

export interface AlertQualityFilters {
  alert_rule_id?: string;
  service_id?: string;
  recommendation?: string;
  min_noise_score?: number;
}

export interface AlertQualityReport {
  total_alerts: number;
  average_score: number;
  false_positive_rate: number;
  top_noisy_alerts: { alert_name: string; noise_count: number }[];
  recommendations: string[];
  generated_at: string;
}

export interface IncidentCorrelation {
  id: string;
  source_incident_id: string;
  target_incident_id: string;
  correlation_type: 'causal' | 'temporal' | 'service' | 'pattern' | 'ai_suggested';
  confidence: number;
  status: 'pending' | 'confirmed' | 'rejected';
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IncidentCorrelationFilters {
  incident_id?: string;
  correlation_type?: string;
  status?: string;
  min_confidence?: number;
}

export interface CustomerTier {
  tier: string;
  count: number;
  sla_commitment?: string | null;
}

export interface BusinessImpactConfig {
  id: string;
  service_id: string | null;
  service: { id: string; name: string; type: string; current_status: string } | null;
  revenue_per_request_cents: number | null;
  avg_requests_per_minute: number | null;
  affected_user_scope: 'all' | 'subset' | 'internal_only';
  estimated_users_affected_percent: number;
  total_user_count: number | null;
  customer_tiers: CustomerTier[];
  sla_config_id: string | null;
  support_escalation_threshold_minutes: number | null;
  notes: string | null;
  updated_by: { id: string; name: string | null; email: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface StakeholderUpdate {
  id: string;
  incident_id: string;
  title: string;
  body: string;
  audience: 'internal_engineering' | 'internal_leadership' | 'external_customer' | 'status_page';
  status: 'draft' | 'sent';
  sent_at: string | null;
  sent_by: string | null;
  channels: string[];
  created_by: string | null;
  created_at: string;
}

export interface EmergingRisk {
  id: string;
  title: string;
  description: string;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  source: string;
  affected_services: string[];
  indicators: { metric: string; current_value: number; threshold: number; trend: 'rising' | 'falling' | 'stable' }[];
  recommended_actions: string[];
  detected_at: string;
}

export interface ICCVisibility {
  id: string;
  incident_id: string;
  panels: { panel_id: string; visible: boolean; order: number }[];
  layout: string;
  updated_at: string;
}

// ─── Alert Quality ───────────────────────────────────────────────────────────

export function useAlertQuality(filters: AlertQualityFilters = {}) {
  return useQuery<AlertQualityEntry[], APIError>({
    queryKey: ['alert-quality', filters],
    queryFn: async () => {
      const res = await api.get<{ data: AlertQualityEntry[] }>('/api/v1/alert-quality', {
        alert_rule_id:  filters.alert_rule_id,
        service_id:     filters.service_id,
        recommendation: filters.recommendation,
        min_noise_score: filters.min_noise_score,
      });
      return res.data;
    },
    enabled: !filters.service_id || filters.service_id.length > 0,
  });
}

export function useAlertQualityReport() {
  return useQuery<AlertQualityReport, APIError>({
    queryKey: ['alert-quality-report'],
    queryFn: () => api.get<AlertQualityReport>('/api/v1/alert-quality/report'),
  });
}

// ─── Incident Correlations ───────────────────────────────────────────────────

export function useIncidentCorrelations(filters: IncidentCorrelationFilters = {}) {
  return useQuery<IncidentCorrelation[], APIError>({
    queryKey: ['incident-correlations', filters],
    queryFn: async () => {
      const res = await api.get<{ data: IncidentCorrelation[] }>('/api/v1/incident-correlations', {
        incident_id: filters.incident_id,
        correlation_type: filters.correlation_type,
        status: filters.status,
        min_confidence: filters.min_confidence,
      });
      return res.data;
    },
  });
}

export function useConfirmCorrelation() {
  const queryClient = useQueryClient();
  return useMutation<IncidentCorrelation, APIError, string>({
    mutationFn: (id) =>
      api.post<IncidentCorrelation>(`/api/v1/incident-correlations/${id}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-correlations'] });
      queryClient.invalidateQueries({ queryKey: ['command-center-correlations'] });
    },
  });
}

export function useRejectCorrelation() {
  const queryClient = useQueryClient();
  return useMutation<IncidentCorrelation, APIError, string>({
    mutationFn: (id) =>
      api.post<IncidentCorrelation>(`/api/v1/incident-correlations/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-correlations'] });
      queryClient.invalidateQueries({ queryKey: ['command-center-correlations'] });
    },
  });
}

export function useMergeCorrelation() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) =>
      api.post(`/api/v1/incident-correlations/${id}/merge`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-correlations'] });
      queryClient.invalidateQueries({ queryKey: ['command-center-correlations'] });
      queryClient.invalidateQueries({ queryKey: ['command-center'] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

// ─── Business Impact Configs ─────────────────────────────────────────────────

export function useBusinessImpactConfigs() {
  return useQuery<BusinessImpactConfig[], APIError>({
    queryKey: ['business-impact-configs'],
    queryFn: async () => {
      const res = await api.get<{ data: BusinessImpactConfig[] }>('/api/v1/business-impact-configs');
      return res.data;
    },
  });
}

// ─── Stakeholder Updates ─────────────────────────────────────────────────────

export function useStakeholderUpdates(incidentId: string) {
  return useQuery<StakeholderUpdate[], APIError>({
    queryKey: ['stakeholder-updates', incidentId],
    queryFn: async () => {
      const res = await api.get<{ data: StakeholderUpdate[] }>(
        `/api/v1/incidents/${incidentId}/stakeholder-updates`,
      );
      return res.data;
    },
    enabled: !!incidentId,
  });
}

export function useCreateStakeholderUpdate() {
  const queryClient = useQueryClient();
  return useMutation<
    StakeholderUpdate,
    APIError,
    { incidentId: string; input: { audience: StakeholderUpdate['audience'] } }
  >({
    mutationFn: ({ incidentId, input }) =>
      api.post<StakeholderUpdate>(`/api/v1/incidents/${incidentId}/stakeholder-updates`, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['stakeholder-updates', vars.incidentId] });
    },
  });
}

export function useSendStakeholderUpdate() {
  const queryClient = useQueryClient();
  return useMutation<StakeholderUpdate, APIError, { incidentId: string; updateId: string }>({
    mutationFn: ({ incidentId, updateId }) =>
      api.post<StakeholderUpdate>(
        `/api/v1/incidents/${incidentId}/stakeholder-updates/${updateId}/send`,
        {},
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['stakeholder-updates', vars.incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', vars.incidentId] });
    },
  });
}

// ─── Emerging Risks ──────────────────────────────────────────────────────────

export function useEmergingRisks() {
  return useQuery<EmergingRisk[], APIError>({
    queryKey: ['emerging-risks'],
    queryFn: async () => {
      const res = await api.get<{ data: EmergingRisk[] }>('/api/v1/emerging-risks');
      return res.data;
    },
  });
}

// ─── Postmortem open action items count ──────────────────────────────────────

export function useOpenActionItemsCount(incidentIds: string[]) {
  return useQuery<number, APIError>({
    queryKey: ['open-action-items-count', incidentIds],
    queryFn: async () => {
      if (incidentIds.length === 0) return 0;
      const res = await api.get<{ count: number }>(
        '/api/v1/postmortems/open-action-items-count',
        { incident_ids: incidentIds.join(',') },
      );
      return res.count;
    },
    enabled: incidentIds.length > 0,
    staleTime: 60_000,
  });
}

// ─── ICC Visibility ──────────────────────────────────────────────────────────

export function useICCVisibility() {
  return useQuery<ICCVisibility, APIError>({
    queryKey: ['icc-visibility'],
    queryFn: () => api.get<ICCVisibility>('/api/v1/icc-visibility'),
  });
}

export function useUpdateICCVisibility() {
  const queryClient = useQueryClient();
  return useMutation<
    ICCVisibility,
    APIError,
    { panels?: ICCVisibility['panels']; layout?: string }
  >({
    mutationFn: (input) => api.patch<ICCVisibility>('/api/v1/icc-visibility', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icc-visibility'] });
    },
  });
}
