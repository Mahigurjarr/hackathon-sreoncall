'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeType   = 'standard' | 'normal' | 'emergency';
export type ChangeStatus =
  | 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected'
  | 'scheduled' | 'in_progress' | 'completed' | 'rolled_back' | 'cancelled';
export type RiskScore        = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalDecision = 'approved' | 'rejected' | 'abstained';
export type PirStatus  = 'pending' | 'completed' | 'waived';
export type PirOutcome = 'successful' | 'partial_success' | 'failed' | 'rolled_back';

export interface ChangeUser {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

export interface ApprovalDecisionEntry {
  user: ChangeUser | null;
  decision: ApprovalDecision;
  comment: string;
  decided_at: string;
}

export interface ApprovalStep {
  id: string;
  step: number;
  type: 'sequential' | 'parallel';
  required_approvals: number;
  approvers: Array<{ user: ChangeUser | null; role: string | null }>;
  decisions: ApprovalDecisionEntry[];
  completed_at: string | null;
}

export interface ImplementationWindow {
  start: string;
  end: string;
  timezone: string;
}

export interface Pir {
  status: PirStatus;
  outcome: PirOutcome | null;
  notes: string | null;
  reviewed_by: ChangeUser | null;
  reviewed_at: string | null;
}

export interface ChangeRequest {
  id: string;
  number: number;
  type: ChangeType;
  title: string;
  description: string;
  justification: string;
  rollback_plan: string;
  risk: {
    score: RiskScore;
    ai_score: RiskScore | null;
    factors: string[];
    blast_radius_description: string;
  };
  status: ChangeStatus;
  current_step: number;
  approval_chain: ApprovalStep[];
  affected_service_ids: string[];
  implementation_window: ImplementationWindow | null;
  pir: Pir | null;
  ai_conflict_warnings: string[];
  ai_window_suggestions: Array<{ start: string; end: string; reason: string }>;
  freeze_window_conflict: boolean;
  linked_ticket_ids: string[];
  linked_runbook_ids: string[];
  linked_incident_ids: string[];
  labels: string[];
  created_by: ChangeUser | null;
  requester: ChangeUser | null;
  change_owner: ChangeUser | null;
  roll_out_date: string | null;
  notes: Array<{
    user: ChangeUser | null;
    body: string;
    type: 'comment' | 'state_change' | 'discussion';
    created_at: string;
  }>;
  scheduled_at: string | null;
  implemented_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeFilters {
  status?: string;
  type?: string;
  search?: string;
  limit?: number;
}

interface ChangesResponse {
  data: ChangeRequest[];
  pagination: { total?: number; has_more?: boolean };
}

type CreateChangeInput = {
  title: string;
  description?: string;
  justification?: string;
  rollback_plan?: string;
  type?: ChangeType;
  risk_score?: RiskScore;
  labels?: string[];
  affected_service_ids?: string[];
  implementation_window?: { start: string; end: string; timezone?: string } | null;
  approval_chain?: Array<{
    type?: string;
    required_approvals?: number;
    approvers: Array<{ user_id: string; role?: string }>;
  }>;
  requester_id?: string;
  change_owner_id?: string;
  roll_out_date?: string | null;
};

// ─── Query hooks ──────────────────────────────────────────────────────────────

export function useChanges(filters: ChangeFilters = {}) {
  return useQuery<ChangeRequest[], APIError>({
    queryKey: ['changes', filters],
    queryFn: async () => {
      const res = await api.get<ChangesResponse>('/api/v1/changes', {
        status: filters.status,
        type:   filters.type,
        search: filters.search,
        limit:  filters.limit ?? 100,
      });
      return res.data;
    },
  });
}

export function useChange(id: string) {
  return useQuery<ChangeRequest, APIError>({
    queryKey: ['change', id],
    queryFn: () => api.get<ChangeRequest>(`/api/v1/changes/${id}`),
    enabled: !!id,
  });
}

export function useCalendar(from: string, to: string) {
  return useQuery<ChangeRequest[], APIError>({
    queryKey: ['changes-calendar', from, to],
    queryFn: async () => {
      const res = await api.get<{ data: ChangeRequest[] }>('/api/v1/changes/calendar', { from, to });
      return res.data;
    },
    enabled: !!from && !!to,
  });
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

export function useCreateChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, CreateChangeInput>({
    mutationFn: (input) => api.post<ChangeRequest>('/api/v1/changes', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useUpdateChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, { id: string; input: Partial<CreateChangeInput> }>({
    mutationFn: ({ id, input }) => api.patch<ChangeRequest>(`/api/v1/changes/${id}`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useSubmitChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, string>({
    mutationFn: (id) => api.post<ChangeRequest>(`/api/v1/changes/${id}/submit`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useApproveChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, { id: string; decision: ApprovalDecision; comment?: string }>({
    mutationFn: ({ id, decision, comment }) =>
      api.post<ChangeRequest>(`/api/v1/changes/${id}/approve`, { decision, comment }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useScheduleChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, { id: string; start: string; end: string; timezone?: string }>({
    mutationFn: ({ id, start, end, timezone }) =>
      api.post<ChangeRequest>(`/api/v1/changes/${id}/schedule`, { start, end, timezone }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
      qc.invalidateQueries({ queryKey: ['changes-calendar'] });
    },
  });
}

export function useImplementChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, string>({
    mutationFn: (id) => api.post<ChangeRequest>(`/api/v1/changes/${id}/implement`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useCompleteChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, string>({
    mutationFn: (id) => api.post<ChangeRequest>(`/api/v1/changes/${id}/complete`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useRollbackChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<ChangeRequest>(`/api/v1/changes/${id}/rollback`, { reason }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useCancelChange() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, string>({
    mutationFn: (id) => api.post<ChangeRequest>(`/api/v1/changes/${id}/cancel`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}

export function useSubmitPir() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, { id: string; outcome: PirOutcome; notes?: string; waived?: boolean }>({
    mutationFn: ({ id, outcome, notes, waived }) =>
      api.post<ChangeRequest>(`/api/v1/changes/${id}/pir`, { outcome, notes, waived }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}


export function useEscalateChange() {
  const qc = useQueryClient();
  return useMutation<{ bridge_id: string; provider_change_id: string; status: string; escalated_at: string }, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/changes/${id}/escalate`, {}),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', id] });
    },
  });
}

export function useAddChangeNote() {
  const qc = useQueryClient();
  return useMutation<ChangeRequest, APIError, { id: string; body: string; type?: string }>({
    mutationFn: ({ id, body, type }) =>
      api.post<ChangeRequest>(`/api/v1/changes/${id}/notes`, { body, type }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['changes'] });
      qc.invalidateQueries({ queryKey: ['change', data.id] });
    },
  });
}
