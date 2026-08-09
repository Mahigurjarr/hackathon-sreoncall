'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
// 'expr'   = native PromQL/LogQL: the expression's non-empty result vector is
//            the fire signal (no threshold comparison).
// 'absent' = the inverse: fire when the expression returns NOTHING (signal went
//            dark / no matching series or log lines).
export type AlertOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'expr' | 'absent';
export type ConditionLogic = 'and' | 'or';

export interface AlertCondition {
  metric: string;
  operator: AlertOperator;
  threshold: number;
  window_minutes: number;
  query?: string | null;
}

export type AlertSourceType = 'managed_promql' | 'managed_logql' | 'byos_webhook' | 'synthetic';

export interface AlertRuleRouting {
  escalation_policy_id: string | null;
  oncall_schedule_id: string | null;
  additional_channels: string[];
}

export interface AlertRuleSilence {
  _id: string;
  start: string;
  end: string;
  reason: string;
  created_by: string;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  service_id: string | null;
  service: { id: string; name: string; type: string; current_status: string } | null;
  status: 'active' | 'inactive';
  severity: AlertSeverity;
  source_type: AlertSourceType;
  synthetic_check_id: string | null;
  query: string | null;
  condition: AlertCondition;
  conditions: AlertCondition[];
  condition_logic: ConditionLogic;
  for_duration_seconds: number;
  labels: Record<string, string>;
  routing: AlertRuleRouting | null;
  active_silences: AlertRuleSilence[];
  auto_create_incident: boolean;
  incident_severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  notification_channels: string[];
  webhook_url: string | null;
  webhook_secret: string | null;
  last_triggered_at: string | null;
  last_webhook_at: string | null;
  last_value: number | null;
  alert_state: 'ok' | 'firing' | 'no_data';
  last_firing_labels: Record<string, string> | null;
  trigger_count: number;
  is_predefined: boolean;
  template_id: string | null;
  category: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleDryRunResult {
  source_type: AlertSourceType;
  value: number | null;
  triggered: boolean;
  labels: Record<string, string>;
  query_executed: string | null;
  explanation: string;
  /** Set when the backend rejected the query as malformed (bad PromQL/LogQL). */
  error?: string;
}

export interface SavedRuleTestResult {
  kind: 'evaluation' | 'webhook';
  message: string;
  source_type: AlertSourceType;
  result?: AlertRuleDryRunResult;
  ingress_path?: string;
  connectivity_test_path?: string;
  sample_payload?: Record<string, unknown>;
  curl_command?: string;
}

interface AlertRulesResponse {
  data: AlertRule[];
  pagination: { has_more: boolean; next_cursor: string | null; total: number };
}

export interface CreateAlertRuleInput {
  name: string;
  description?: string;
  service_id?: string | null;
  status?: 'active' | 'inactive';
  severity?: AlertSeverity;
  source_type?: AlertSourceType;
  synthetic_check_id?: string | null;
  query?: string | null;
  condition: {
    metric: string;
    operator: AlertOperator;
    threshold: number;
    window_minutes?: number;
    query?: string | null;
  };
  conditions?: Array<{
    metric?: string;
    operator: AlertOperator;
    threshold?: number;
    window_minutes?: number;
    query?: string | null;
  }>;
  condition_logic?: ConditionLogic;
  for_duration_seconds?: number;
  labels?: Record<string, string>;
  routing?: {
    escalation_policy_id?: string | null;
    oncall_schedule_id?: string | null;
    additional_channels?: string[];
  };
  auto_create_incident?: boolean;
  incident_severity?: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  notification_channels?: string[];
  webhook_url?: string | null;
}

export interface AlertRuleDryRunInput extends CreateAlertRuleInput {
  sample_value?: number | null;
}

export interface AlertRuleFilters {
  search?: string;
  status?: string;
  severity?: string;
  service_id?: string;
}

export function useAlertRules(filters: AlertRuleFilters = {}) {
  return useQuery<AlertRulesResponse, APIError>({
    queryKey: ['alert-rules', filters],
    queryFn: () =>
      api.get<AlertRulesResponse>('/api/v1/alert-rules', {
        search:     filters.search,
        status:     filters.status,
        severity:   filters.severity,
        service_id: filters.service_id,
        limit:      100,
      }),
  });
}

export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation<AlertRule, APIError, CreateAlertRuleInput>({
    mutationFn: (input) => api.post<AlertRule>('/api/v1/alert-rules', input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

export function useUpdateAlertRule() {
  const qc = useQueryClient();
  return useMutation<AlertRule, APIError, { id: string; input: Partial<CreateAlertRuleInput> }>({
    mutationFn: ({ id, input }) => api.patch<AlertRule>(`/api/v1/alert-rules/${id}`, input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/alert-rules/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

export function useToggleAlertRule() {
  const qc = useQueryClient();
  return useMutation<AlertRule, APIError, string>({
    mutationFn: (id) => api.post<AlertRule>(`/api/v1/alert-rules/${id}/toggle`, {}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['alert-rules'] });
      qc.invalidateQueries({ queryKey: ['alert-templates'] });
    },
  });
}

export function useTestAlertRule() {
  return useMutation<SavedRuleTestResult, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/alert-rules/${id}/test`, {}),
  });
}

export function useDryRunAlertRule() {
  return useMutation<AlertRuleDryRunResult, APIError, AlertRuleDryRunInput>({
    mutationFn: (input) => api.post<AlertRuleDryRunResult>('/api/v1/alert-rules/dry-run', input),
  });
}

export function useCreateSilence() {
  const qc = useQueryClient();
  return useMutation<AlertRule, APIError, { ruleId: string; start: string; end: string; reason?: string }>({
    mutationFn: ({ ruleId, ...body }) => api.post<AlertRule>(`/api/v1/alert-rules/${ruleId}/silences`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

export function useDeleteSilence() {
  const qc = useQueryClient();
  return useMutation<AlertRule, APIError, { ruleId: string; silenceId: string }>({
    mutationFn: ({ ruleId, silenceId }) => api.delete<AlertRule>(`/api/v1/alert-rules/${ruleId}/silences/${silenceId}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

// ── Pre-defined Alert Templates ──────────────────────────────────────

export interface AlertTemplate {
  template_id: string;
  category: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  source_type: 'managed_promql' | 'managed_logql';
  query: string;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
    threshold: number;
    window_minutes: number;
  };
  for_duration_seconds: number;
  requires_vendor: string | null;
  is_active: boolean;
}

interface AlertTemplatesResponse {
  data: AlertTemplate[];
  grouped: Record<string, AlertTemplate[]>;
  activated_template_ids: string[];
}

export function useAlertTemplates() {
  return useQuery<AlertTemplatesResponse, APIError>({
    queryKey: ['alert-templates'],
    queryFn: () => api.get<AlertTemplatesResponse>('/api/v1/alert-rules/templates'),
  });
}

export function useActivateTemplate() {
  const qc = useQueryClient();
  return useMutation<AlertRule, APIError, { template: AlertTemplate; overrides?: Partial<CreateAlertRuleInput> }>({
    mutationFn: ({ template, overrides }) =>
      api.post<AlertRule>('/api/v1/alert-rules', {
        name: template.name,
        description: template.description,
        severity: template.severity,
        source_type: template.source_type,
        query: template.query,
        condition: {
          metric: overrides?.condition?.metric ?? template.condition.metric,
          operator: overrides?.condition?.operator ?? template.condition.operator,
          threshold: overrides?.condition?.threshold ?? template.condition.threshold,
          window_minutes: overrides?.condition?.window_minutes ?? template.condition.window_minutes,
        },
        for_duration_seconds: overrides?.for_duration_seconds ?? template.for_duration_seconds,
        is_predefined: true,
        template_id: template.template_id,
        category: template.category,
        status: 'active',
        ...overrides,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alert-rules'] });
      qc.invalidateQueries({ queryKey: ['alert-templates'] });
    },
  });
}
