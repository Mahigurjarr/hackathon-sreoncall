'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepType = 'manual' | 'bash_script' | 'api_call' | 'ansible_playbook';
export type StepExecutionStatus =
  | 'pending' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'skipped';
export type ExecutionStatus =
  | 'running' | 'paused_approval' | 'completed' | 'failed' | 'cancelled';

export interface RunbookStep {
  id: string | null;
  order: number;
  title: string;
  instructions: string;
  type: StepType;
  requires_approval: boolean;
  approval_roles: string[];
  timeout_seconds: number;
  working_directory: string;
  environment_vars: Record<string, string>;
  api_method: string;
  api_url: string;
  api_headers: Record<string, string>;
  api_body: string;
  attachments: Array<{ file_id: string; original_name: string; mime_type: string; size_bytes: number }>;
}

export interface RunbookVariable {
  name: string;
  default_value: string;
  description: string;
  required: boolean;
}

export interface Runbook {
  id: string;
  title: string;
  description: string;
  /**
   * Full markdown body when the runbook was AI-generated from an incident.
   * Empty for manually-authored runbooks.
   */
  content?: string;
  category: string;
  status: 'draft' | 'published';
  steps: RunbookStep[];
  variables: RunbookVariable[];
  tags: string[];
  service_ids: string[];
  author: { id: string | null; name: string; email: string };
  ai_generated: boolean;
  version: number;
  version_history_count: number;
  stats: {
    executions: number;
    successful: number;
    failed: number;
    avg_duration_seconds: number | null;
    last_executed_at: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface ExecutionStepState {
  id: string | null;
  step_id: string;
  order: number;
  title: string;
  type: string;
  requires_approval: boolean;
  status: StepExecutionStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  output: string;
  error: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_comment: string | null;
}

export interface RunbookExecution {
  id: string;
  runbook_id: string;
  runbook_title: string;
  runbook_version: number;
  status: ExecutionStatus;
  triggered_by: string | null;
  triggered_by_incident_id: string | null;
  current_step: number;
  steps_state: ExecutionStepState[];
  variables: Record<string, string>;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  output_log: Array<{ timestamp: string; level: string; message: string }>;
  created_at: string;
  updated_at: string;
}

interface RunbooksResponse {
  data: Runbook[];
  pagination: { has_more: boolean; next_cursor: string | null; total?: number };
}

export interface RunbookFilters {
  search?: string;
  tags?: string;
  status?: string;
  category?: string;
}

export interface CreateRunbookInput {
  title: string;
  description?: string;
  category?: string;
  steps?: Partial<RunbookStep>[];
  variables?: Partial<RunbookVariable>[];
  tags?: string[];
  service_ids?: string[];
}

// ─── Runbook hooks ─────────────────────────────────────────────────────────────

export function useRunbooks(filters: RunbookFilters = {}) {
  return useQuery<RunbooksResponse, APIError>({
    queryKey: ['runbooks', filters],
    queryFn: () =>
      api.get<RunbooksResponse>('/api/v1/runbooks', {
        search:   filters.search,
        tags:     filters.tags,
        status:   filters.status,
        category: filters.category,
        limit:    50,
      }),
  });
}

export function useRunbook(id: string) {
  return useQuery<Runbook, APIError>({
    queryKey: ['runbook', id],
    queryFn:  () => api.get<Runbook>(`/api/v1/runbooks/${id}`),
    enabled:  !!id,
  });
}

export function useRunbookVersions(id: string) {
  return useQuery<{ current_version: number; history: any[] }, APIError>({
    queryKey: ['runbook-versions', id],
    queryFn:  () => api.get<any>(`/api/v1/runbooks/${id}/versions`),
    enabled:  !!id,
  });
}

export function useCreateRunbook() {
  const qc = useQueryClient();
  return useMutation<Runbook, APIError, CreateRunbookInput>({
    mutationFn: (input) => api.post<Runbook>('/api/v1/runbooks', input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['runbooks'] }),
  });
}

export function useUpdateRunbook() {
  const qc = useQueryClient();
  return useMutation<Runbook, APIError, { id: string; input: Partial<CreateRunbookInput> & { status?: string; change_note?: string } }>({
    mutationFn: ({ id, input }) => api.patch<Runbook>(`/api/v1/runbooks/${id}`, input),
    onSuccess:  (data) => {
      qc.invalidateQueries({ queryKey: ['runbooks'] });
      qc.invalidateQueries({ queryKey: ['runbook', data.id] });
      qc.invalidateQueries({ queryKey: ['runbook-versions', data.id] });
    },
  });
}

export function useDeleteRunbook() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/runbooks/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['runbooks'] }),
  });
}

// ─── Execution hooks ───────────────────────────────────────────────────────────

export function useRunbookExecutions(runbookId: string) {
  return useQuery<{ data: RunbookExecution[] }, APIError>({
    queryKey: ['runbook-executions', runbookId],
    queryFn:  () => api.get<{ data: RunbookExecution[] }>(`/api/v1/runbooks/${runbookId}/executions`),
    enabled:  !!runbookId,
  });
}

export function useExecution(executionId: string, active: boolean) {
  return useQuery<RunbookExecution, APIError>({
    queryKey:       ['runbook-execution', executionId],
    queryFn:        () => api.get<RunbookExecution>(`/api/v1/runbook-executions/${executionId}`),
    enabled:        !!executionId,
    refetchInterval: active ? 3000 : false,
  });
}

export function useStartExecution() {
  const qc = useQueryClient();
  return useMutation<RunbookExecution, APIError, {
    runbookId: string;
    variables?: Record<string, string>;
    incident_id?: string | null;
  }>({
    mutationFn: ({ runbookId, ...body }) =>
      api.post<RunbookExecution>(`/api/v1/runbooks/${runbookId}/execute`, body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['runbook-executions', data.runbook_id] });
      qc.invalidateQueries({ queryKey: ['runbook', data.runbook_id] });
    },
  });
}

export function useCompleteManualStep() {
  const qc = useQueryClient();
  return useMutation<RunbookExecution, APIError, { executionId: string; stepIdx: number; output?: string }>({
    mutationFn: ({ executionId, stepIdx, output }) =>
      api.post<RunbookExecution>(`/api/v1/runbook-executions/${executionId}/steps/${stepIdx}/complete`, { output }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['runbook-execution', data.id] });
      qc.invalidateQueries({ queryKey: ['runbook-executions', data.runbook_id] });
    },
  });
}

export function useApproveStep() {
  const qc = useQueryClient();
  return useMutation<RunbookExecution, APIError, {
    executionId: string;
    stepIdx: number;
    decision: 'approved' | 'rejected';
    comment?: string;
  }>({
    mutationFn: ({ executionId, stepIdx, decision, comment }) =>
      api.post<RunbookExecution>(`/api/v1/runbook-executions/${executionId}/steps/${stepIdx}/approve`, { decision, comment }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['runbook-execution', data.id] });
      qc.invalidateQueries({ queryKey: ['runbook-executions', data.runbook_id] });
    },
  });
}

export function useCancelExecution() {
  const qc = useQueryClient();
  return useMutation<RunbookExecution, APIError, string>({
    mutationFn: (executionId) =>
      api.post<RunbookExecution>(`/api/v1/runbook-executions/${executionId}/cancel`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['runbook-execution', data.id] });
      qc.invalidateQueries({ queryKey: ['runbook-executions', data.runbook_id] });
      qc.invalidateQueries({ queryKey: ['runbook', data.runbook_id] });
    },
  });
}
