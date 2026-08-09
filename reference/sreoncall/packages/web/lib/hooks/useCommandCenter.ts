'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandCenterService {
  id: string;
  name: string;
  type: string;
  status: string;
  health: 'healthy' | 'degraded' | 'down' | 'unknown';
  metrics: Record<string, unknown>;
}

export interface CommandCenterAlert {
  id: string;
  name: string;
  severity: string;
  source_type: string;
  fired_at: string;
  labels: Record<string, string>;
}

export interface TopologyNodeHealth {
  error_rate_percent: number | null;
  latency_p99_ms: number | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  last_updated_at: string | null;
}

export interface TopologyNode {
  service_id: string;
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  is_root_cause: boolean;
  is_affected: boolean;
  health: TopologyNodeHealth;
  owner_team: { _id: string; name: string } | null;
  oncall_user: { _id: string; name: string; email: string } | null;
}

export interface TopologyEdge {
  source_service_id: string;
  target_service_id: string;
  dependency_type: string;
  criticality: string;
  traffic: {
    requests_per_minute: number | null;
    error_rate_percent: number | null;
    latency_ms: number | null;
  };
}

export interface CommandCenterTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface CommandCenterPersona {
  role: string;
  summary: string;
  recommendations: string[];
}

// ─── ICC sub-section types (match backend command-center.service.ts shapes) ──

export interface ICCContextBrief {
  service_name: string;
  service_description: string | null;
  owner_team: string | null;
  oncall_engineer: string | null;
  last_deploy: {
    version: string | null;
    deployed_by: string | null;
    deployed_at: string | null;
    commit_message: string | null;
  } | null;
  recent_incidents: Array<{
    _id: string;
    number: number;
    title: string;
    severity: number;
    resolved_at: string | null;
    mttr_seconds: number | null;
    root_cause: string | null;
  }>;
  known_quirks: string[];
  current_state: {
    error_rate: string;
    latency_p99: string;
    uptime_24h: string | null;
    active_alerts: number;
  };
}

export interface ICCChangeCorrelation {
  recent_deploys: Array<{
    service_name: string;
    version: string;
    deployed_by: string;
    deployed_at: string;
    commit_message: string | null;
    time_before_incident_minutes: number;
  }>;
  recent_config_changes: Array<{
    type: string;
    description: string;
    changed_by: string | null;
    changed_at: string;
    time_before_incident_minutes: number;
  }>;
  recent_alerts: Array<{
    alert_name: string;
    service_name: string;
    fired_at: string;
    severity: string;
  }>;
}

export interface ICCAffectedService { id: string; name: string; type: string }

export interface ICCBlastRadius {
  directly_affected_services: ICCAffectedService[];
  indirectly_affected_services: ICCAffectedService[];
  sla_at_risk: Array<{
    sla_name: string;
    tenant_name: string | null;
    commitment: string;
    remaining_error_budget_minutes: number;
    breach_eta: string | null;
  }>;
  estimated_users_affected: number | null;
  estimated_revenue_impact_per_hour: number | null;
}

export interface ICCBusinessImpact {
  revenue_impact_per_hour_cents: number | null;
  users_affected: number | null;
  customer_tiers: Array<{ tier: string; count: number }>;
  sla_at_risk: Array<{
    customer: string;
    sla: string;
    remaining_minutes: number;
    breach_eta: string | null;
  }>;
  support_ticket_surge_percent: number | null;
}

export interface ICCCorrelatedIncident {
  _id: string;
  correlation_id: string;
  incidents: Array<{
    _id: string;
    number: number;
    title: string;
    severity: number;
    status: string;
    service_name: string;
  }>;
  correlation_type: string;
  confidence_percent: number;
  evidence: Array<{ type: string; description: string }>;
  status: 'proposed' | 'confirmed' | 'rejected';
}

export interface ICCCompliance {
  regulatory_clock_active: boolean;
  regulation: string | null;
  deadline: string | null;
  time_remaining: string | null;
  required_actions: Array<{
    key: string;
    action: string;
    status: 'pending' | 'completed';
    completed_at: string | null;
  }>;
}

export interface ICCPermissions {
  can_resolve_steps: boolean;
  can_add_timeline_notes: boolean;
  can_trigger_validation: boolean;
  can_send_comms: boolean;
  can_merge_correlations: boolean;
  can_manage_compliance: boolean;
}

export interface CommandCenterData {
  incident_id: string;
  persona: CommandCenterPersona | null;
  services: CommandCenterService[];
  alerts: CommandCenterAlert[];
  topology: CommandCenterTopology;
  context_brief: ICCContextBrief;
  change_correlation: ICCChangeCorrelation;
  blast_radius: ICCBlastRadius;
  business_impact: ICCBusinessImpact | null;
  correlated_incidents: ICCCorrelatedIncident[];
  compliance: ICCCompliance | null;
  _permissions: ICCPermissions;
  updated_at: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useCommandCenter(incidentId: string, persona?: string, consumerTenantId?: string) {
  return useQuery<CommandCenterData, APIError>({
    queryKey: ['command-center', incidentId, persona, consumerTenantId],
    queryFn: () =>
      api.get<CommandCenterData>(`/api/v1/incidents/${incidentId}/command-center`, {
        persona,
        ...(consumerTenantId ? { consumer_tenant_id: consumerTenantId } : {}),
      }),
    enabled: !!incidentId,
    refetchInterval: 15000,
  });
}

export function useCommandCenterTopology(incidentId: string) {
  return useQuery<CommandCenterTopology, APIError>({
    queryKey: ['command-center-topology', incidentId],
    queryFn: () =>
      api.get<CommandCenterTopology>(`/api/v1/incidents/${incidentId}/command-center/topology`),
    enabled: !!incidentId,
    refetchInterval: 10000,
  });
}

export interface ConsumerImpactEntry {
  consumer: { id: string; name: string; slug: string };
  business_impact: {
    revenue_impact_per_hour_cents: number | null;
    users_affected: number | null;
    customer_tiers: Array<{ tier: string; count: number }>;
    sla_at_risk: Array<{ customer: string; sla: string; remaining_minutes: number; breach_eta: string | null }>;
    support_ticket_surge_percent: number | null;
  };
  sla_at_risk_count: number;
}

export function useConsumerImpacts(incidentId: string, enabled: boolean) {
  return useQuery<ConsumerImpactEntry[], APIError>({
    queryKey: ['command-center-consumer-impacts', incidentId],
    queryFn: async () => {
      const res = await api.get<{ data: ConsumerImpactEntry[] }>(
        `/api/v1/incidents/${incidentId}/command-center/consumer-impacts`,
      );
      return res.data;
    },
    enabled: enabled && !!incidentId,
    staleTime: 30_000,
  });
}

export function useMarkComplianceAction() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { incidentId: string; actionKey: string }>({
    mutationFn: ({ incidentId, actionKey }) =>
      api.patch(`/api/v1/incidents/${incidentId}/command-center/compliance/${actionKey}`, {}),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['command-center', vars.incidentId] });
    },
  });
}
