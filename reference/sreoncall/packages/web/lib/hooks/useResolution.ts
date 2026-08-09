'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolutionStatus = 'draft' | 'in_progress' | 'validating' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type StepType = 'manual' | 'automated' | 'approval' | 'validation';

export interface ResolutionStep {
  id: string;
  order: number;
  title: string;
  description: string;
  type: StepType;
  status: StepStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  output: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface ResolutionPlan {
  id: string;
  incident_id: string;
  status: ResolutionStatus;
  diagnosis: string;
  root_cause: string | null;
  confidence: number;
  steps: ResolutionStep[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  validated_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export interface ValidationResult {
  id: string;
  resolution_id: string;
  passed: boolean;
  checks: { name: string; passed: boolean; message: string }[];
  validated_at: string;
}

// ─── Full validation entry types (GET /validations) ───────────────────────────

export type ValidationCheckStatus = 'running' | 'passed' | 'failed' | 'skipped';
export type ValidationCheckType =
  | 'health_endpoint'
  | 'metric_threshold'
  | 'synthetic_monitor'
  | 'tenant_e2e'
  | 'dependency_health';
export type ValidationEntryStatus = 'running' | 'passed' | 'partial' | 'failed';

export interface ValidationEntryCheck {
  name: string;
  type: ValidationCheckType;
  status: ValidationCheckStatus;
  details: string | null;
  executed_at: string;
}

export interface ValidationEntry {
  id: string;
  iteration: number;
  triggered_at: string;
  completed_at: string | null;
  status: ValidationEntryStatus;
  checks: ValidationEntryCheck[];
  ai_analysis_of_failure: string | null;
  additional_steps_suggested: boolean;
}

export interface RediagnoseResult {
  resolution_id: string;
  diagnosis: string;
  root_cause: string | null;
  confidence: number;
  steps: ResolutionStep[];
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useResolutionPlan(incidentId: string) {
  return useQuery<ResolutionPlan, APIError>({
    queryKey: ['resolution', incidentId],
    queryFn: () => api.get<ResolutionPlan>(`/api/v1/incidents/${incidentId}/resolution`),
    enabled: !!incidentId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateResolution() {
  const queryClient = useQueryClient();
  return useMutation<ResolutionPlan, APIError, { incidentId: string; diagnosis?: string }>({
    mutationFn: ({ incidentId, diagnosis }) =>
      api.post<ResolutionPlan>(`/api/v1/incidents/${incidentId}/resolution`, { diagnosis }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', data.incident_id] });
      queryClient.invalidateQueries({ queryKey: ['incident', data.incident_id] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.incident_id] });
    },
  });
}

export function useUpdateStep() {
  const queryClient = useQueryClient();
  return useMutation<
    ResolutionStep,
    APIError,
    { incidentId: string; stepId: string; input: Partial<{ status: StepStatus; output: string; error: string; notes: string }> }
  >({
    mutationFn: ({ incidentId, stepId, input }) =>
      api.patch<ResolutionStep>(`/api/v1/incidents/${incidentId}/resolution/steps/${stepId}`, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', vars.incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', vars.incidentId] });
    },
  });
}

export function useDeleteStep() {
  const queryClient = useQueryClient();
  return useMutation<ResolutionPlan, APIError, { incidentId: string; stepId: string }>({
    mutationFn: ({ incidentId, stepId }) =>
      api.delete<ResolutionPlan>(`/api/v1/incidents/${incidentId}/resolution/steps/${stepId}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', vars.incidentId] });
    },
  });
}

export function useAddStep() {
  const queryClient = useQueryClient();
  return useMutation<
    ResolutionStep,
    APIError,
    { incidentId: string; input: { title: string; description?: string; type?: StepType; assignee_id?: string; order?: number } }
  >({
    mutationFn: ({ incidentId, input }) =>
      api.post<ResolutionStep>(`/api/v1/incidents/${incidentId}/resolution/steps`, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', vars.incidentId] });
    },
  });
}

export function useTriggerValidation() {
  const queryClient = useQueryClient();
  return useMutation<ValidationResult, APIError, string>({
    mutationFn: (incidentId) =>
      api.post<ValidationResult>(`/api/v1/incidents/${incidentId}/resolution/validate`, {}),
    onSuccess: (_data, incidentId) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', incidentId] });
      queryClient.invalidateQueries({ queryKey: ['resolution-validations', incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', incidentId] });
    },
  });
}

export function useValidationResults(incidentId: string) {
  return useQuery<ValidationEntry[], APIError>({
    queryKey: ['resolution-validations', incidentId],
    queryFn: async () => {
      const res = await api.get<{ data: ValidationEntry[] }>(
        `/api/v1/incidents/${incidentId}/resolution/validations`,
      );
      return res.data;
    },
    enabled: !!incidentId,
  });
}

export function useRediagnose() {
  const queryClient = useQueryClient();
  return useMutation<RediagnoseResult, APIError, { incidentId: string; reason?: string }>({
    mutationFn: ({ incidentId, reason }) =>
      api.post<RediagnoseResult>(`/api/v1/incidents/${incidentId}/resolution/rediagnose`, { reason }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', vars.incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', vars.incidentId] });
    },
  });
}

export function useConfirmResolution() {
  const queryClient = useQueryClient();
  return useMutation<ResolutionPlan, APIError, { incidentId: string; message?: string }>({
    mutationFn: ({ incidentId, message }) =>
      api.post<ResolutionPlan>(`/api/v1/incidents/${incidentId}/resolution/confirm`, { message }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['resolution', data.incident_id] });
      queryClient.invalidateQueries({ queryKey: ['incident', data.incident_id] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-timeline', data.incident_id] });
    },
  });
}
