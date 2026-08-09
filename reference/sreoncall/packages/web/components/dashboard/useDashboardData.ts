'use client';

import { useQuery } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardStats {
  active_incidents: number;
  open_tickets: number;
  in_progress_tickets: number;
  resolved_today: number;
  total_resolved: number;
  avg_resolution_minutes: number;
  sla_compliance: number;
  overdue_count: number;
}

export interface RecentTicket {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  type: string;
  assignee: { id: string; name: string; email: string; avatar_url: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  actor: string;
  resource_type: string;
  resource_id: string;
  timestamp: string;
}

export interface IncidentSummary {
  id: string;
  number: number;
  title: string;
  severity: number;
  severity_label: string;
  status: string;
  affected_services: { name: string; current_status: string }[];
  created_at: string;
  mtta_seconds: number | null;
  mttr_seconds: number | null;
}

export interface ServiceHealth {
  id: string;
  name: string;
  type: string;
  current_status: string;
}

export interface ServiceHealthSummary {
  total: number;
  by_status: Record<string, number>;
  services: ServiceHealth[];
}

export interface OnCallEntry {
  schedule_id: string;
  schedule_name: string;
  layers: { users: { id: string; name: string; email: string }[]; rotation_type: string }[];
  overrides: { user_id: string; start: string; end: string; reason: string }[];
}

export interface SLASummary {
  total_with_sla: number;
  breached_count: number;
  compliance_percentage: number;
  avg_response_minutes: number;
  avg_resolution_minutes: number;
  by_service: {
    service_id: string;
    service_name: string;
    total: number;
    breached: number;
    compliance: number;
  }[];
}

export interface ChangeSummary {
  by_status: Record<string, number>;
  recent: {
    id: string;
    number: number;
    title: string;
    type: string;
    risk_score: number | null;
    status: string;
    created_at: string;
  }[];
}

export interface ConsumerHealth {
  consumer_id: string;
  consumer_name: string;
  consumer_slug: string;
  active_incidents: number;
  open_tickets: number;
  sla_compliance: number;
}

export interface AgentSummary {
  installed_count: number;
  executions_30d: number;
  successful: number;
  failed: number;
  pending_approvals: number;
}

export interface PlatformOverview {
  total_tenants: number;
  by_type: Record<string, number>;
  by_plan: Record<string, number>;
  total_users: number;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useDashboardStats() {
  return useQuery<DashboardStats, APIError>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardStats>('/api/v1/dashboard/stats'),
    refetchInterval: 30000,
  });
}

export function useRecentTickets() {
  return useQuery<{ data: RecentTicket[] }, APIError>({
    queryKey: ['dashboard-recent-tickets'],
    queryFn: () => api.get<{ data: RecentTicket[] }>('/api/v1/dashboard/recent-tickets'),
  });
}

export function useDashboardActivity() {
  return useQuery<{ data: ActivityItem[] }, APIError>({
    queryKey: ['dashboard-activity'],
    queryFn: () => api.get<{ data: ActivityItem[] }>('/api/v1/dashboard/activity'),
  });
}

export function useIncidentsSummary() {
  return useQuery<{ data: IncidentSummary[] }, APIError>({
    queryKey: ['dashboard-incidents-summary'],
    queryFn: () => api.get<{ data: IncidentSummary[] }>('/api/v1/dashboard/incidents-summary'),
    refetchInterval: 30000,
  });
}

export function useServicesHealth() {
  return useQuery<ServiceHealthSummary, APIError>({
    queryKey: ['dashboard-services-health'],
    queryFn: () => api.get<ServiceHealthSummary>('/api/v1/dashboard/services-health'),
    refetchInterval: 30000,
  });
}

export function useOnCallStatus() {
  return useQuery<{ data: OnCallEntry[] }, APIError>({
    queryKey: ['dashboard-oncall-status'],
    queryFn: () => api.get<{ data: OnCallEntry[] }>('/api/v1/dashboard/oncall-status'),
  });
}

export function useSLASummary() {
  return useQuery<SLASummary, APIError>({
    queryKey: ['dashboard-sla-summary'],
    queryFn: () => api.get<SLASummary>('/api/v1/dashboard/sla-summary'),
  });
}

export function useChangesSummary() {
  return useQuery<ChangeSummary, APIError>({
    queryKey: ['dashboard-changes-summary'],
    queryFn: () => api.get<ChangeSummary>('/api/v1/dashboard/changes-summary'),
  });
}

export function useProviderOverview(enabled: boolean) {
  return useQuery<{ data: ConsumerHealth[] }, APIError>({
    queryKey: ['dashboard-provider-overview'],
    queryFn: () => api.get<{ data: ConsumerHealth[] }>('/api/v1/dashboard/provider-overview'),
    enabled,
    refetchInterval: 30000,
  });
}

export function useAgentSummary() {
  return useQuery<AgentSummary, APIError>({
    queryKey: ['dashboard-agent-summary'],
    queryFn: () => api.get<AgentSummary>('/api/v1/dashboard/agent-summary'),
  });
}

export function usePlatformOverview(enabled: boolean) {
  return useQuery<PlatformOverview, APIError>({
    queryKey: ['dashboard-platform-overview'],
    queryFn: () => api.get<PlatformOverview>('/api/v1/dashboard/platform-overview'),
    enabled,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function formatDuration(minutes: number): string {
  if (!minutes || minutes === 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes / 1440)}d`;
}

export function formatSeconds(seconds: number | null): string {
  if (!seconds) return '—';
  const min = Math.round(seconds / 60);
  return formatDuration(min);
}

export function severityColor(severity: number): string {
  switch (severity) {
    case 1: return '#DC2626';
    case 2: return '#FF6B2B';
    case 3: return '#EAB308';
    case 4: return '#2563EB';
    default: return '#94A3B8';
  }
}

export function severityLabel(severity: number): string {
  switch (severity) {
    case 1: return 'P1';
    case 2: return 'P2';
    case 3: return 'P3';
    case 4: return 'P4';
    default: return `P${severity}`;
  }
}

export function statusDotColor(status: string): string {
  switch (status) {
    case 'operational': return '#16A34A';
    case 'degraded': return '#EAB308';
    case 'partial_outage': return '#FF6B2B';
    case 'major_outage': return '#DC2626';
    case 'maintenance': return '#2563EB';
    default: return '#94A3B8';
  }
}
