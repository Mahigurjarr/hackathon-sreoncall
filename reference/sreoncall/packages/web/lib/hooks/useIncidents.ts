'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IncidentSeverity = 1 | 2 | 3 | 4 | 5;
export type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'monitoring' | 'resolved' | 'closed';
export type IncidentType = 'reliability' | 'performance' | 'security' | 'availability' | 'other';
export type IncidentSource = 'manual' | 'alert' | 'webhook' | 'ai' | 'synthetic_check';
export type TimelineEntryType =
  | 'declaration' | 'acknowledgment' | 'status_change' | 'severity_change'
  | 'role_assigned' | 'alert' | 'ai_insight' | 'runbook_started' | 'runbook_step'
  | 'note' | 'escalation' | 'resolution' | 'comms_sent';

export interface IncidentUser {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface Responder {
  user: IncidentUser;
  role: string;
  joined_at: string;
  left_at: string | null;
}

export interface IncidentMetrics {
  ack_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  mtta_seconds: number | null;
  mttr_seconds: number | null;
}

export interface TimelineActor {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface TimelineEntry {
  id: string;
  type: TimelineEntryType;
  timestamp: string;
  actor: TimelineActor | null;
  message: string;
  metadata: Record<string, unknown>;
}

export interface Incident {
  id: string;
  number: number;
  title: string;
  description: string;
  severity: IncidentSeverity;
  severity_label: string;
  status: IncidentStatus;
  type: IncidentType;
  source: IncidentSource;
  labels: string[];
  commander: IncidentUser | null;
  comms_lead: IncidentUser | null;
  operations_lead: IncidentUser | null;
  created_by: IncidentUser | null;
  responders: Responder[];
  metrics: IncidentMetrics;
  postmortem_id: string | null;
  war_room_channel_id: string | null;
  escalation_policy_id: string | null;
  linked_ticket_ids: string[];
  linked_tickets?: Array<{ id: string; number: number; title: string; status: string; priority: string }>;
  affected_service_ids: string[];
  affected_services: {
    id: string;
    name: string;
    type: string;
    current_status: string;
    cloud_metadata: {
      provider: string | null;
      resource_type: string | null;
      cloud_id: string | null;
      region: string | null;
    } | null;
  }[];
  source_alert_id: string | null;
  source_alert: {
    id: string;
    name: string;
    severity: string;
    source_type: string;
    query: string | null;
    alert_state: string;
    last_firing_labels: Record<string, string> | null;
  } | null;
  source_synthetic_check: {
    id: string;
    name: string;
    check_type: string;
    url: string | null;
    host: string | null;
    last_status: string | null;
  } | null;
  resource_labels: { key: string; value: string }[];
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  custom_fields?: Record<string, string>;
}

export interface IncidentFilters {
  status?: string;
  severity?: number;
  search?: string;
  source_consumer_tenant_id?: string;
}

interface IncidentsResponse {
  data: Incident[];
  pagination: { total?: number; has_more?: boolean };
}

// ─── List / Get ───────────────────────────────────────────────────────────────

export function useIncidents(filters: IncidentFilters = {}) {
  return useQuery<Incident[], APIError>({
    queryKey: ['incidents', filters],
    queryFn: async () => {
      const res = await api.get<IncidentsResponse>('/api/v1/incidents', {
        status: filters.status,
        severity: filters.severity,
        search: filters.search,
        source_consumer_tenant_id: filters.source_consumer_tenant_id,
        limit: 100,
      });
      return res.data;
    },
  });
}

export function useIncident(id: string) {
  return useQuery<Incident, APIError>({
    queryKey: ['incident', id],
    queryFn: () => api.get<Incident>(`/api/v1/incidents/${id}`),
    enabled: !!id,
  });
}

export function useIncidentTimeline(id: string) {
  return useQuery<TimelineEntry[], APIError>({
    queryKey: ['incident-timeline', id],
    queryFn: async () => {
      const res = await api.get<{ data: TimelineEntry[] }>(`/api/v1/incidents/${id}/timeline`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: 15000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { title: string; description?: string; severity?: number; type?: IncidentType; labels?: string[]; affected_service_ids?: string[] }>({
    mutationFn: (input) => api.post<Incident>('/api/v1/incidents', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useUpdateIncident() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { id: string; input: Partial<{ title: string; description: string; labels: string[]; commander_id: string | null; comms_lead_id: string | null; operations_lead_id: string | null }> }>({
    mutationFn: ({ id, input }) => api.patch<Incident>(`/api/v1/incidents/${id}`, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
    },
  });
}

export function useAcknowledgeIncident() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, string>({
    mutationFn: (id) => api.post<Incident>(`/api/v1/incidents/${id}/acknowledge`, {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.id] });
    },
  });
}

export function useResolveIncident() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { id: string; message?: string }>({
    mutationFn: ({ id, message }) => api.post<Incident>(`/api/v1/incidents/${id}/resolve`, { message }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.id] });
    },
  });
}

export function useCloseIncident() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, string>({
    mutationFn: (id) => api.post<Incident>(`/api/v1/incidents/${id}/close`, {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.id] });
    },
  });
}

export function useChangeSeverity() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { id: string; severity: number; reason?: string }>({
    mutationFn: ({ id, severity, reason }) =>
      api.post<Incident>(`/api/v1/incidents/${id}/severity`, { severity, reason }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.id] });
    },
  });
}

export function useEscalateIncident() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { id: string; reason?: string; escalation_policy_id?: string }>({
    mutationFn: ({ id, reason, escalation_policy_id }) => api.post<Incident>(`/api/v1/incidents/${id}/escalate`, { reason, escalation_policy_id }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.id] });
    },
  });
}

export function useAddResponder() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { id: string; user_id: string; role?: string }>({
    mutationFn: ({ id, user_id, role }) =>
      api.post<Incident>(`/api/v1/incidents/${id}/responders`, { user_id, role }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
    },
  });
}

export function useRemoveResponder() {
  const queryClient = useQueryClient();
  return useMutation<Incident, APIError, { id: string; userId: string }>({
    mutationFn: ({ id, userId }) => api.delete<Incident>(`/api/v1/incidents/${id}/responders/${userId}`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incident', data.id] });
    },
  });
}

export function useAddTimelineEntry() {
  const queryClient = useQueryClient();
  return useMutation<{ data: TimelineEntry[] }, APIError, { id: string; message: string; type?: TimelineEntryType; metadata?: Record<string, unknown> }>({
    mutationFn: ({ id, message, type, metadata }) =>
      api.post<{ data: TimelineEntry[] }>(`/api/v1/incidents/${id}/timeline`, { message, type, metadata }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', vars.id] });
    },
  });
}

export function useBulkIncidentAction() {
  const queryClient = useQueryClient();
  return useMutation<{ success: number; failed: number; errors: string[] }, APIError, { incident_ids: string[]; action: 'acknowledge' | 'resolve' | 'close' }>({
    mutationFn: (body) => api.post('/api/v1/incidents/bulk', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

export function useCreateIncidentPostmortem() {
  const queryClient = useQueryClient();
  return useMutation<{ postmortem_id: string }, APIError, string>({
    mutationFn: (id) => api.post<{ postmortem_id: string }>(`/api/v1/incidents/${id}/postmortem`, {}),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['incident', id] });
      queryClient.invalidateQueries({ queryKey: ['postmortems'] });
    },
  });
}
