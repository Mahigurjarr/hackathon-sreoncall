import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentDefinition {
  _id: string;
  slug: string;
  display_name: string;
  description: string;
  long_description: string;
  category: string;
  version: string;
  icon: string;
  capabilities: string[];
  triggers: string[];
  required_plan: string;
  tenant_type_restriction: string;
  llm_config: { primary_model: string; max_tokens: number; temperature: number };
  pricing: { monthly_cents: number; stripe_price_id?: string };
  is_active: boolean;
  is_beta: boolean;
  sort_order: number;
}

export interface AgentInstallation {
  _id: string;
  tenant_id: string;
  agent_definition_id: string;
  agent_slug: string;
  enabled: boolean;
  autonomy_level: 'observe' | 'recommend' | 'auto_low' | 'auto_full';
  configuration: {
    max_actions_per_execution: number;
    max_executions_per_hour: number;
    monthly_token_budget: number;
    monthly_cost_budget_cents: number;
    require_approval_above_risk: string;
    blocked_actions: string[];
    quiet_hours: { enabled: boolean; start_hour: number; end_hour: number; days: number[] };
  };
  consumer_overrides: any[];
  installed_at: string;
}

export interface AgentExecution {
  _id: string;
  tenant_id: string;
  consumer_tenant_id?: string;
  agent_slug: string;
  trigger: { type: string; event_type?: string; source_id?: string };
  status: string;
  context_summary: string;
  reasoning: string;
  actions_taken: {
    action_type: string;
    description: string;
    target_id?: string;
    risk_level: string;
    status: string;
    executed_at?: string;
  }[];
  recommendations: {
    action_type: string;
    description: string;
    reasoning: string;
    risk_level: string;
  }[];
  outcome?: { summary: string; success: boolean; error_message?: string };
  token_usage?: { input_tokens: number; output_tokens: number; model: string };
  cost_cents: number;
  duration_ms: number;
  started_at: string;
  completed_at?: string;
}

export interface AgentApproval {
  _id: string;
  tenant_id: string;
  consumer_tenant_id?: string;
  execution_id: string;
  agent_slug: string;
  action: {
    action_type: string;
    description: string;
    target_id?: string;
    risk_level: string;
    reasoning: string;
  };
  status: string;
  priority: string;
  requested_at: string;
  expires_at: string;
  decided_by?: string;
  decided_at?: string;
  decision_reason?: string;
}

export interface AgentUsageSummary {
  period: string;
  agents: {
    agent_slug: string;
    executions: number;
    input_tokens: number;
    output_tokens: number;
    actions_executed: number;
    cost_cents: number;
  }[];
  total: {
    executions: number;
    input_tokens: number;
    output_tokens: number;
    actions_executed: number;
    cost_cents: number;
  };
}

// ─── Catalog Hooks ───────────────────────────────────────────────────────────

export function useAgentCatalog() {
  return useQuery<AgentDefinition[]>({
    queryKey: ['agent-catalog'],
    queryFn: () => api.get('/api/v1/agents/catalog'),
  });
}

export function useAgentDetail(slug: string) {
  return useQuery<AgentDefinition>({
    queryKey: ['agent-catalog', slug],
    queryFn: () => api.get(`/api/v1/agents/catalog/${slug}`),
    enabled: !!slug,
  });
}

// ─── Installation Hooks ──────────────────────────────────────────────────────

export function useInstalledAgents() {
  return useQuery<AgentInstallation[]>({
    queryKey: ['agents-installed'],
    queryFn: () => api.get('/api/v1/agents/installed'),
  });
}

export function useInstallAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { agent_slug: string; autonomy_level?: string }) =>
      api.post('/api/v1/agents/install', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents-installed'] });
      qc.invalidateQueries({ queryKey: ['agent-catalog'] });
    },
  });
}

export function useUninstallAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.delete(`/api/v1/agents/installed/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents-installed'] });
      qc.invalidateQueries({ queryKey: ['agent-catalog'] });
    },
  });
}

export function useUpdateAgentConfig(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<AgentInstallation>) =>
      api.patch(`/api/v1/agents/installed/${slug}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents-installed'] }),
  });
}

// ─── Execution Hooks ─────────────────────────────────────────────────────────

export function useAgentExecutions(filters?: { agent_slug?: string; status?: string }) {
  return useQuery<{ items: AgentExecution[]; total: number }>({
    queryKey: ['agent-executions', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.agent_slug) params.set('agent_slug', filters.agent_slug);
      if (filters?.status) params.set('status', filters.status);
      return api.get(`/api/v1/agents/executions?${params.toString()}`);
    },
    refetchInterval: 30_000,
  });
}

export function useAgentExecution(id: string) {
  return useQuery<AgentExecution>({
    queryKey: ['agent-execution', id],
    queryFn: () => api.get(`/api/v1/agents/executions/${id}`),
    enabled: !!id,
  });
}

// ─── Approval Hooks ──────────────────────────────────────────────────────────

export function useAgentApprovals(status = 'pending') {
  return useQuery<AgentApproval[]>({
    queryKey: ['agent-approvals', status],
    queryFn: () => api.get(`/api/v1/agents/approvals?status=${status}`),
    refetchInterval: 15_000,
  });
}

export function useAgentApprovalCount() {
  const { data } = useAgentApprovals('pending');
  return data?.length ?? 0;
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'approved' | 'rejected'; reason?: string }) =>
      api.post(`/api/v1/agents/approvals/${id}/decide`, { decision, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-approvals'] });
      qc.invalidateQueries({ queryKey: ['agent-executions'] });
    },
  });
}

// ─── Usage Hooks ─────────────────────────────────────────────────────────────

export function useAgentUsage() {
  return useQuery<AgentUsageSummary>({
    queryKey: ['agent-usage'],
    queryFn: () => api.get('/api/v1/agents/usage'),
  });
}

export function useAgentUsageDetail(slug: string) {
  return useQuery({
    queryKey: ['agent-usage', slug],
    queryFn: () => api.get(`/api/v1/agents/usage/${slug}`),
    enabled: !!slug,
  });
}

// ─── Trigger Hook ────────────────────────────────────────────────────────────

export function useTriggerAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, source_id }: { slug: string; source_id?: string }) =>
      api.post(`/api/v1/agents/trigger/${slug}`, { source_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-executions'] }),
  });
}

// ─── Provider Hooks ──────────────────────────────────────────────────────────

export function useProviderAgentDashboard() {
  return useQuery({
    queryKey: ['provider-agent-dashboard'],
    queryFn: () => api.get('/api/v1/provider/agents/dashboard'),
    refetchInterval: 30_000,
  });
}

export function useProviderConsumerAgentConfig(consumerId: string) {
  return useQuery({
    queryKey: ['provider-consumer-agent-config', consumerId],
    queryFn: () => api.get(`/api/v1/provider/agents/consumers/${consumerId}/config`),
    enabled: !!consumerId,
  });
}

export function useUpdateProviderConsumerConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ consumerId, slug, data }: { consumerId: string; slug: string; data: any }) =>
      api.patch(`/api/v1/provider/agents/consumers/${consumerId}/config/${slug}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-consumer-agent-config'] }),
  });
}

export function useProviderAgentApprovals() {
  return useQuery<AgentApproval[]>({
    queryKey: ['provider-agent-approvals'],
    queryFn: () => api.get('/api/v1/provider/agents/approvals'),
    refetchInterval: 15_000,
  });
}

// ─── Consumer Hooks ──────────────────────────────────────────────────────────

export function useConsumerAgentActivity() {
  return useQuery<{ items: AgentExecution[]; total: number }>({
    queryKey: ['consumer-agent-activity'],
    queryFn: () => api.get('/api/v1/consumer/agents/activity'),
    refetchInterval: 30_000,
  });
}

export function useConsumerProviderAgentInfo() {
  return useQuery({
    queryKey: ['consumer-provider-agent-info'],
    queryFn: () => api.get('/api/v1/consumer/agents/provider-info'),
  });
}

export function useConsumerAgentPreferences() {
  return useQuery({
    queryKey: ['consumer-agent-preferences'],
    queryFn: () => api.get('/api/v1/consumer/agents/preferences'),
  });
}

export function useUpdateConsumerAgentPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.patch('/api/v1/consumer/agents/preferences', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consumer-agent-preferences'] }),
  });
}
