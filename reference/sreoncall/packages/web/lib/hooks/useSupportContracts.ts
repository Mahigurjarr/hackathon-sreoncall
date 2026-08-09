'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type CoverageType = '8x5' | '24x7' | 'custom';
export type ContractStatus = 'draft' | 'active' | 'amended' | 'expired' | 'canceled';

export type TierNotifyChannel = 'email' | 'sms' | 'slack' | 'voice' | 'whatsapp' | 'in_app';

export interface SupportTier {
  level: 1 | 2 | 3;
  name: string;
  schedule_id: string | null;
  schedule_ids: string[];
  schedule_name: string | null;
  escalation_timeout_minutes: number | null;
  notify_channels: TierNotifyChannel[];
}

export interface SupportSlaTarget {
  severity: 1 | 2 | 3 | 4 | 5;
  response_minutes: number;
  resolution_minutes: number;
}

export interface SupportContract {
  id: string;
  name: string;
  status: ContractStatus;
  provider_tenant_id: string;
  consumer_tenant_id: string;
  consumer_name: string | null;
  provider_name?: string | null;
  provider_slug?: string | null;
  coverage_window: {
    type: CoverageType;
    timezone: string;
    schedule: Array<{ day: number; start: string; end: string }>;
  };
  tiers: SupportTier[];
  sla_targets: SupportSlaTarget[];
  pricing: {
    amount_cents: number;
    currency: string;
    provider_share_pct: number;
    platform_share_pct: number;
  };
  effective_from: string | null;
  effective_until: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SlaStatus {
  id: string;
  consumer_incident_id: string;
  current_tier: 1 | 2 | 3;
  tier_started_at: string;
  tier_deadline: string | null;
  response_deadline: string;
  response_met_at: string | null;
  response_breached: boolean;
  resolution_deadline: string;
  resolution_breached: boolean;
  tier_history: Array<{ level: 1 | 2 | 3; started_at: string; ended_at: string | null; reason: string }>;
}

export interface RevenueReport {
  active_contract_count: number;
  total_monthly_cents: number;
  platform_share_cents_monthly: number;
  provider_share_cents_monthly: number;
  currency: string;
}

export interface ContractSlaReport {
  contract_id: string;
  total_incidents: number;
  response_breach_count: number;
  resolution_breach_count: number;
  response_met_count: number;
  response_compliance_pct: number;
  resolution_compliance_pct: number;
  active_count: number;
  resolved_count: number;
}

export interface CreateContractInput {
  consumer_tenant_id: string;
  name: string;
  coverage_window: SupportContract['coverage_window'];
  tiers: SupportTier[];
  sla_targets: SupportSlaTarget[];
  pricing: SupportContract['pricing'];
}

export interface TierCounts {
  L1: number;
  L2: number;
  L3: number;
}

export interface ConsumerRollup {
  consumer_tenant_id: string;
  consumer_name: string | null;
  contract_id: string;
  contract_name: string;
  coverage_type: string;
  active_by_tier: TierCounts;
  open_total: number;
  response_compliance_pct: number;
  resolution_compliance_pct: number;
  total_recent_incidents: number;
}

export interface AtRiskEntry {
  state_id: string;
  bridge_id: string;
  contract_id: string;
  consumer_name: string | null;
  consumer_incident_id: string;
  provider_incident_id: string;
  incident_title: string | null;
  severity: number | null;
  current_tier: 1 | 2 | 3;
  deadline_kind: 'tier' | 'response' | 'resolution';
  deadline_at: string;
  minutes_remaining: number;
}

export interface RecentBreach {
  state_id: string;
  consumer_name: string | null;
  consumer_incident_id: string;
  incident_title: string | null;
  kind: 'response' | 'resolution';
  deadline_at: string;
  breached_at: string;
}

export interface ProviderDashboard {
  totals: {
    active_contracts: number;
    open_incidents: number;
    breaches_last_24h: number;
    active_by_tier: TierCounts;
  };
  consumers: ConsumerRollup[];
  at_risk: AtRiskEntry[];
  recent_breaches: RecentBreach[];
}

// Provider hooks

export function useProviderSupportDashboard() {
  return useQuery<ProviderDashboard, APIError>({
    queryKey: ['provider-support-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ data: ProviderDashboard }>('/api/v1/provider/support-dashboard');
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function useProviderSupportContracts() {
  return useQuery<SupportContract[], APIError>({
    queryKey: ['provider-support-contracts'],
    queryFn: async () => {
      const res = await api.get<{ data: SupportContract[] }>('/api/v1/provider/support-contracts');
      return res.data;
    },
  });
}

export function useProviderSupportContract(id: string | undefined) {
  return useQuery<SupportContract, APIError>({
    queryKey: ['provider-support-contract', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.get<{ data: SupportContract }>(`/api/v1/provider/support-contracts/${id}`);
      return res.data;
    },
  });
}

export function useContractSlaReport(id: string | undefined) {
  return useQuery<ContractSlaReport, APIError>({
    queryKey: ['provider-support-contract-sla', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.get<{ data: ContractSlaReport }>(`/api/v1/provider/support-contracts/${id}/sla-report`);
      return res.data;
    },
  });
}

export function useCreateSupportContract() {
  const qc = useQueryClient();
  return useMutation<SupportContract, APIError, CreateContractInput>({
    mutationFn: async (input) => {
      const res = await api.post<{ data: SupportContract }>('/api/v1/provider/support-contracts', input);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-support-contracts'] }),
  });
}

export function useAmendSupportContract() {
  const qc = useQueryClient();
  return useMutation<SupportContract, APIError, { id: string; input: Partial<CreateContractInput> }>({
    mutationFn: async ({ id, input }) => {
      const res = await api.patch<{ data: SupportContract }>(`/api/v1/provider/support-contracts/${id}`, input);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-support-contracts'] }),
  });
}

export function useActivateSupportContract() {
  const qc = useQueryClient();
  return useMutation<SupportContract, APIError, string>({
    mutationFn: async (id) => {
      const res = await api.post<{ data: SupportContract }>(`/api/v1/provider/support-contracts/${id}/activate`, {});
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-support-contracts'] }),
  });
}

export function useCancelSupportContract() {
  const qc = useQueryClient();
  return useMutation<SupportContract, APIError, string>({
    mutationFn: async (id) => {
      const res = await api.delete<{ data: SupportContract }>(`/api/v1/provider/support-contracts/${id}`);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-support-contracts'] }),
  });
}

// Consumer hooks

export interface ConsumerManagedTier {
  id: string;
  level: number;
  name: string;
  schedule_id: string;
  notify_channels: TierNotifyChannel[];
  escalation_timeout_minutes: number | null;
}

export function useConsumerManagedTiers() {
  return useQuery<ConsumerManagedTier[], APIError>({
    queryKey: ['consumer-managed-tiers'],
    queryFn: async () => {
      const res = await api.get<{ data: ConsumerManagedTier[] }>('/api/v1/consumer/support-contract/tiers');
      return res.data;
    },
  });
}

export function useAddConsumerTier() {
  const queryClient = useQueryClient();
  return useMutation<ConsumerManagedTier, APIError, { name: string; schedule_id: string; notify_channels: TierNotifyChannel[]; escalation_timeout_minutes?: number | null }>({
    mutationFn: (body) => api.post('/api/v1/consumer/support-contract/tiers', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consumer-managed-tiers'] }),
  });
}

export function useUpdateConsumerTier() {
  const queryClient = useQueryClient();
  return useMutation<ConsumerManagedTier, APIError, { id: string; name?: string; schedule_id?: string; notify_channels?: TierNotifyChannel[]; escalation_timeout_minutes?: number | null }>({
    mutationFn: ({ id, ...body }) => api.patch(`/api/v1/consumer/support-contract/tiers/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consumer-managed-tiers'] }),
  });
}

export function useDeleteConsumerTier() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/consumer/support-contract/tiers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consumer-managed-tiers'] }),
  });
}

export function useConsumerSupportContract() {
  return useQuery<SupportContract | null, APIError>({
    queryKey: ['consumer-support-contract'],
    queryFn: async () => {
      const res = await api.get<{ data: SupportContract | null }>('/api/v1/consumer/support-contract');
      return res.data;
    },
  });
}

export function useConsumerSlaStatus() {
  return useQuery<SlaStatus[], APIError>({
    queryKey: ['consumer-support-contract-sla'],
    queryFn: async () => {
      const res = await api.get<{ data: SlaStatus[] }>('/api/v1/consumer/support-contract/sla-status');
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

// Platform admin hooks

export function useAdminSupportContracts() {
  return useQuery<SupportContract[], APIError>({
    queryKey: ['admin-support-contracts'],
    queryFn: async () => {
      const res = await api.get<{ data: SupportContract[] }>('/api/v1/platform-admin/support-contracts');
      return res.data;
    },
  });
}

export function useAdminManagedSupportRevenue() {
  return useQuery<RevenueReport, APIError>({
    queryKey: ['admin-managed-support-revenue'],
    queryFn: async () => {
      const res = await api.get<{ data: RevenueReport }>('/api/v1/platform-admin/support-contracts/revenue');
      return res.data;
    },
  });
}
