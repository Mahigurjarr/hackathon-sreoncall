'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TenantType = 'standalone' | 'provider' | 'consumer';
export type TenantStatus = 'active' | 'suspended' | 'provisioning' | 'deleted';

export interface AdminTenant {
  _id: string;
  slug: string;
  name: string;
  type: TenantType;
  status: TenantStatus;
  plan: string;
  plan_limits: Record<string, any>;
  is_platform_tenant: boolean;
  branding: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTenantDetail extends AdminTenant {
  stats: {
    user_count: number;
    open_incidents: number;
    total_incidents: number;
    total_tickets: number;
  };
}

export interface PlanLimits {
  max_users: number;
  min_users: number;
  max_tickets_per_month: number;
  max_storage_gb: number;
  api_rate_limit: number;
  custom_fields: boolean;
  sla_management: boolean;
  custom_workflows: boolean;
  audit_log_retention_days: number;
  agents_enabled: boolean;
  max_agents: number;
  // New fields
  max_incidents_per_month: number;
  max_on_call_schedules: number;
  max_escalation_policies: number;
  max_notifications_per_day: number;
  observability_retention_days: number;
  max_synthetic_checks: number;
  max_status_pages: number;
  sso_enabled: boolean;
  scim_enabled: boolean;
  voice_whatsapp_enabled: boolean;
  white_label_enabled: boolean;
  notification_channels: string[];
}

export interface PlanDefinition {
  _id: string;
  name: string;
  display_name: string;
  description: string;
  limits: PlanLimits;
  features: string[];
  price_monthly_cents: number;
  price_yearly_cents: number;
  stripe_price_id: string | null;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlag {
  _id: string;
  key: string;
  description: string;
  default_value: boolean;
  tenant_overrides: Array<{ tenant_id: string; value: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalConfigItem {
  _id: string;
  key: string;
  value: any;
  description: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStats {
  tenants: {
    total: number;
    active: number;
    suspended: number;
    by_type: { standalone: number; provider: number; consumer: number };
    by_plan: Record<string, number>;
  };
  users: { total: number; active: number };
  incidents: { total: number; open: number; resolved: number };
  tickets: { total: number; open: number };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: Record<string, any>;
  action: string;
  resource_type: string;
  resource_id: string;
  tenant_id: string | null;
  changes: any;
  result: string;
  request_id: string;
}

export interface ProviderLink {
  _id: string;
  provider_tenant_id: string;
  consumer_tenant_id: string;
  status: 'active' | 'pending' | 'suspended';
  scope: string[];
  provider_tenant?: AdminTenant;
  consumer_tenant?: AdminTenant;
  created_by: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Tenant Hooks ─────────────────────────────────────────────────────────────

interface TenantFilters {
  search?: string;
  type?: string;
  plan?: string;
  status?: string;
}

export function useAdminTenants(filters: TenantFilters = {}) {
  return useQuery<AdminTenant[], APIError>({
    queryKey: ['admin-tenants', filters],
    queryFn: async () => {
      const res = await api.get<{ data: AdminTenant[] }>('/api/v1/platform/tenants', {
        search: filters.search,
        type: filters.type,
        plan: filters.plan,
        status: filters.status,
        limit: 100,
      });
      return res.data;
    },
  });
}

export function useAdminTenant(id: string) {
  return useQuery<AdminTenantDetail, APIError>({
    queryKey: ['admin-tenant', id],
    queryFn: () => api.get<AdminTenantDetail>(`/api/v1/platform/tenants/${id}`),
    enabled: !!id,
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation<AdminTenant, APIError, { id: string; input: Partial<{ type: TenantType; plan: string; status: string; name: string }> }>({
    mutationFn: ({ id, input }) => api.patch<AdminTenant>(`/api/v1/platform/tenants/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-tenant'] });
    },
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/platform/tenants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
  });
}

// ─── Plan Hooks ───────────────────────────────────────────────────────────────

export function useAdminPlans() {
  return useQuery<PlanDefinition[], APIError>({
    queryKey: ['admin-plans'],
    queryFn: async () => {
      const res = await api.get<{ data: PlanDefinition[] }>('/api/v1/platform/plans');
      return res.data;
    },
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation<PlanDefinition, APIError, Partial<PlanDefinition>>({
    mutationFn: (input) => api.post<PlanDefinition>('/api/v1/platform/plans', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-plans'] }),
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();
  return useMutation<PlanDefinition, APIError, { id: string; input: Partial<PlanDefinition> }>({
    mutationFn: ({ id, input }) => api.patch<PlanDefinition>(`/api/v1/platform/plans/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-plans'] }),
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/platform/plans/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-plans'] }),
  });
}

// ─── Feature Flag Hooks ───────────────────────────────────────────────────────

export function useFeatureFlags() {
  return useQuery<FeatureFlag[], APIError>({
    queryKey: ['admin-feature-flags'],
    queryFn: async () => {
      const res = await api.get<{ data: FeatureFlag[] }>('/api/v1/platform/feature-flags');
      return res.data;
    },
  });
}

export function useCreateFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation<FeatureFlag, APIError, Partial<FeatureFlag>>({
    mutationFn: (input) => api.post<FeatureFlag>('/api/v1/platform/feature-flags', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-feature-flags'] }),
  });
}

export function useUpdateFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation<FeatureFlag, APIError, { id: string; input: Partial<FeatureFlag> }>({
    mutationFn: ({ id, input }) => api.patch<FeatureFlag>(`/api/v1/platform/feature-flags/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-feature-flags'] }),
  });
}

export function useDeleteFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/platform/feature-flags/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-feature-flags'] }),
  });
}

// ─── Global Config Hooks ──────────────────────────────────────────────────────

export function useGlobalConfig(category?: string) {
  return useQuery<GlobalConfigItem[], APIError>({
    queryKey: ['admin-global-config', category],
    queryFn: async () => {
      const res = await api.get<{ data: GlobalConfigItem[] }>('/api/v1/platform/config', {
        category,
      });
      return res.data;
    },
  });
}

export function useUpdateGlobalConfig() {
  const queryClient = useQueryClient();
  return useMutation<{ data: GlobalConfigItem[] }, APIError, { items: Array<{ key: string; value: any; description?: string; category?: string }> }>({
    mutationFn: (input) => api.patch('/api/v1/platform/config', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-global-config'] }),
  });
}

// ─── Stats Hooks ──────────────────────────────────────────────────────────────

export function useSystemStats() {
  return useQuery<SystemStats, APIError>({
    queryKey: ['admin-system-stats'],
    queryFn: () => api.get<SystemStats>('/api/v1/platform/stats'),
  });
}

// ─── Audit Log Hooks ──────────────────────────────────────────────────────────

interface AuditLogFilters {
  tenant_id?: string;
  resource_type?: string;
  action?: string;
  from_date?: string;
  to_date?: string;
}

export function useAdminAuditLog(filters: AuditLogFilters = {}) {
  return useQuery<AuditLogEntry[], APIError>({
    queryKey: ['admin-audit-log', filters],
    queryFn: async () => {
      const res = await api.get<{ data: AuditLogEntry[] }>('/api/v1/platform/audit-log', {
        ...filters,
        limit: 100,
      });
      return res.data;
    },
  });
}

// ─── Provider Link Hooks ──────────────────────────────────────────────────────

export function useProviderLinks() {
  return useQuery<ProviderLink[], APIError>({
    queryKey: ['admin-provider-links'],
    queryFn: async () => {
      const res = await api.get<{ data: ProviderLink[] }>('/api/v1/platform/provider-links');
      return res.data;
    },
  });
}

export function useCreateProviderLink() {
  const queryClient = useQueryClient();
  return useMutation<ProviderLink, APIError, { provider_tenant_id: string; consumer_tenant_id: string; scope: string[] }>({
    mutationFn: (input) => api.post<ProviderLink>('/api/v1/platform/provider-links', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-provider-links'] }),
  });
}

export function useUpdateProviderLink() {
  const queryClient = useQueryClient();
  return useMutation<ProviderLink, APIError, { id: string; input: Partial<{ status: string; scope: string[] }> }>({
    mutationFn: ({ id, input }) => api.patch<ProviderLink>(`/api/v1/platform/provider-links/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-provider-links'] }),
  });
}

export function useDeleteProviderLink() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/platform/provider-links/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-provider-links'] }),
  });
}
