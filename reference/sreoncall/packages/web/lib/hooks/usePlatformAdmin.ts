'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────

export interface PlatformOverview {
  total_tenants: number;
  active_tenants: number;
  suspended_tenants: number;
  total_users: number;
  active_users: number;
  total_tickets: number;
  total_incidents: number;
  active_incidents: number;
  tenants_by_plan: Record<string, number>;
  recent_signups: Array<{
    id: string;
    slug: string;
    name: string;
    plan: string;
    status: string;
    created_at: string;
  }>;
}

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  plan_limits: Record<string, any>;
  is_platform_tenant: boolean;
  custom_domains: string[];
  created_at: string;
  updated_at: string;
  user_count: number;
  service_count: number;
}

export interface PlatformUser {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  roles: string[];
  status: string;
  source: string;
  avatar_url: string | null;
  email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformAuditLog {
  id: string;
  tenant_id: string;
  timestamp: string;
  actor: {
    type: string;
    id?: string;
    email?: string;
    ip: string;
    user_agent: string;
    impersonated_by?: string;
  };
  action: string;
  resource_type: string;
  resource_id: string | null;
  changes: Array<{ field: string; old_value: any; new_value: any }>;
  result: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: Array<{
    name: string;
    status: 'up' | 'down' | 'degraded';
    latency_ms?: number;
    details?: string;
  }>;
  timestamp: string;
}

export interface PlatformSettings {
  maintenance_mode: boolean;
  signup_enabled: boolean;
  default_plan: string;
  max_tenants: number;
}

export interface ImpersonationResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  tenant_slug: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
  };
}

// ─── Overview ────────────────────────────────────────────────────────

export function usePlatformOverview() {
  return useQuery<PlatformOverview, APIError>({
    queryKey: ['platform-admin', 'overview'],
    queryFn: () => api.get<PlatformOverview>('/api/v1/platform-admin/overview'),
    refetchInterval: 60000,
  });
}

// ─── Tenants ─────────────────────────────────────────────────────────

export function usePlatformTenants(filters?: {
  status?: string;
  plan?: string;
  search?: string;
  limit?: number;
}) {
  return useQuery<PaginatedResponse<PlatformTenant>, APIError>({
    queryKey: ['platform-admin', 'tenants', filters],
    queryFn: () =>
      api.get<PaginatedResponse<PlatformTenant>>('/api/v1/platform-admin/tenants', {
        ...filters,
      }),
  });
}

export function usePlatformTenant(id: string) {
  return useQuery<PlatformTenant, APIError>({
    queryKey: ['platform-admin', 'tenants', id],
    queryFn: () => api.get<PlatformTenant>(`/api/v1/platform-admin/tenants/${id}`),
    enabled: !!id,
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();

  return useMutation<
    PlatformTenant,
    APIError,
    { slug: string; name: string; plan?: string; status?: string }
  >({
    mutationFn: (data) => api.post<PlatformTenant>('/api/v1/platform-admin/tenants', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'overview'] });
    },
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();

  return useMutation<
    PlatformTenant,
    APIError,
    { id: string; data: { name?: string; plan?: string; status?: string } }
  >({
    mutationFn: ({ id, data }) =>
      api.patch<PlatformTenant>(`/api/v1/platform-admin/tenants/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'overview'] });
    },
  });
}

export function useSuspendTenant() {
  const queryClient = useQueryClient();

  return useMutation<PlatformTenant, APIError, string>({
    mutationFn: (id) =>
      api.post<PlatformTenant>(`/api/v1/platform-admin/tenants/${id}/suspend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'overview'] });
    },
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();

  return useMutation<PlatformTenant, APIError, string>({
    mutationFn: (id) => api.delete<PlatformTenant>(`/api/v1/platform-admin/tenants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants-deleted'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'overview'] });
    },
  });
}

export interface CascadeDeleteStep {
  collection: string;
  label: string;
  deleted_count: number;
  status: 'success' | 'error';
  error?: string;
}

export interface CascadeDeleteResult {
  tenant_id: string;
  tenant_slug: string;
  steps: CascadeDeleteStep[];
  lgtm_cleanup: {
    attempted: boolean;
    results: Array<{ service: string; status: string; detail?: string }>;
  };
  total_documents_deleted: number;
  completed_at: string;
}

export function useHardDeleteTenant() {
  const queryClient = useQueryClient();

  return useMutation<CascadeDeleteResult, APIError, string>({
    mutationFn: (id) => api.delete<CascadeDeleteResult>(`/api/v1/platform-admin/tenants/${id}?mode=hard`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants-deleted'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'overview'] });
    },
  });
}

export function useDeletedTenants(filters?: { search?: string; limit?: number }) {
  return useQuery<PaginatedResponse<PlatformTenant>, APIError>({
    queryKey: ['platform-admin', 'tenants-deleted', filters],
    queryFn: () =>
      api.get<PaginatedResponse<PlatformTenant>>('/api/v1/platform-admin/tenants-deleted', {
        ...filters,
      }),
  });
}

export function useRestoreTenant() {
  const queryClient = useQueryClient();

  return useMutation<PlatformTenant, APIError, string>({
    mutationFn: (id) =>
      api.post<PlatformTenant>(`/api/v1/platform-admin/tenants/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants-deleted'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'overview'] });
    },
  });
}

export function useImpersonateTenant() {
  return useMutation<ImpersonationResult, APIError, string>({
    mutationFn: (id) =>
      api.post<ImpersonationResult>(`/api/v1/platform-admin/tenants/${id}/impersonate`),
  });
}

// ─── Users ───────────────────────────────────────────────────────────

export function usePlatformUsers(filters?: {
  status?: string;
  role?: string;
  tenant_id?: string;
  search?: string;
  limit?: number;
}) {
  return useQuery<PaginatedResponse<PlatformUser>, APIError>({
    queryKey: ['platform-admin', 'users', filters],
    queryFn: () =>
      api.get<PaginatedResponse<PlatformUser>>('/api/v1/platform-admin/users', {
        ...filters,
      }),
  });
}

export function usePlatformUser(id: string) {
  return useQuery<PlatformUser, APIError>({
    queryKey: ['platform-admin', 'users', id],
    queryFn: () => api.get<PlatformUser>(`/api/v1/platform-admin/users/${id}`),
    enabled: !!id,
  });
}

export function useUpdatePlatformUser() {
  const queryClient = useQueryClient();

  return useMutation<
    PlatformUser,
    APIError,
    { id: string; data: { name?: string; roles?: string[]; status?: string } }
  >({
    mutationFn: ({ id, data }) =>
      api.patch<PlatformUser>(`/api/v1/platform-admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'users'] });
    },
  });
}

export function useResetUserPassword() {
  const queryClient = useQueryClient();

  return useMutation<
    { message: string; user: PlatformUser },
    APIError,
    { id: string; password: string }
  >({
    mutationFn: ({ id, password }) =>
      api.post(`/api/v1/platform-admin/users/${id}/reset-password`, { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'users'] });
    },
  });
}

export function useDisableUser() {
  const queryClient = useQueryClient();

  return useMutation<PlatformUser, APIError, string>({
    mutationFn: (id) =>
      api.post<PlatformUser>(`/api/v1/platform-admin/users/${id}/disable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'users'] });
    },
  });
}

export function useCreateTenantUser() {
  const queryClient = useQueryClient();

  return useMutation<
    PlatformUser,
    APIError,
    { tenantId: string; data: { email: string; name: string; password: string; roles: string[] } }
  >({
    mutationFn: ({ tenantId, data }) =>
      api.post<PlatformUser>(`/api/v1/platform-admin/tenants/${tenantId}/users`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'users'] });
    },
  });
}

// ─── System Health ───────────────────────────────────────────────────

export function useSystemHealth(refetchInterval = 30000) {
  return useQuery<SystemHealth, APIError>({
    queryKey: ['platform-admin', 'system-health'],
    queryFn: () => api.get<SystemHealth>('/api/v1/platform-admin/system/health'),
    refetchInterval,
  });
}

// ─── Audit Logs ──────────────────────────────────────────────────────

export function usePlatformAuditLogs(filters?: {
  tenant_id?: string;
  action?: string;
  resource_type?: string;
  actor_email?: string;
  limit?: number;
}) {
  return useQuery<PaginatedResponse<PlatformAuditLog>, APIError>({
    queryKey: ['platform-admin', 'audit-logs', filters],
    queryFn: () =>
      api.get<PaginatedResponse<PlatformAuditLog>>('/api/v1/platform-admin/audit-logs', {
        ...filters,
      }),
  });
}

// ─── Settings ────────────────────────────────────────────────────────

export function usePlatformSettings() {
  return useQuery<PlatformSettings, APIError>({
    queryKey: ['platform-admin', 'settings'],
    queryFn: () => api.get<PlatformSettings>('/api/v1/platform-admin/settings'),
  });
}

export function useUpdatePlatformSettings() {
  const queryClient = useQueryClient();

  return useMutation<PlatformSettings, APIError, Partial<PlatformSettings>>({
    mutationFn: (data) =>
      api.patch<PlatformSettings>('/api/v1/platform-admin/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'settings'] });
    },
  });
}
