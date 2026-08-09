'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface DashboardPanel {
  id: string;
  title: string;
  type: 'line_chart' | 'bar_chart' | 'gauge' | 'stat' | 'table' | 'heatmap' | 'log_viewer' | 'trace_waterfall';
  grid: { x: number; y: number; w: number; h: number };
  data_source: {
    type: 'managed' | 'byos';
    provider: string | null;
    service_id: string | null;
  };
  query: string;
  options: Record<string, unknown>;
  thresholds: Array<{ value: number; color: string }>;
}

export interface DashboardVariable {
  name: string;
  label: string;
  type: 'query' | 'custom';
  source: { label_name?: string | null; values?: string[] | null; match_template?: string | null };
  default: string[];
  multi: boolean;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  is_template: boolean;
  is_public: boolean;
  share_token: string | null;
  panels: DashboardPanel[];
  variables: DashboardVariable[];
  time_range: { from: string; to: string };
  refresh_interval_seconds: number;
  tags: string[];
  source_template_id: string | null;
  hide_scope: boolean;
  default_time_range: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDashboardInput {
  name: string;
  description?: string;
  is_template?: boolean;
  is_public?: boolean;
  panels?: DashboardPanel[];
  variables?: DashboardVariable[];
  time_range?: { from: string; to: string };
  refresh_interval_seconds?: number;
  tags?: string[];
}

export interface DashboardFilters {
  is_template?: boolean;
  tags?: string;
}

interface DashboardsResponse {
  data: Dashboard[];
  pagination: { total: number };
}

export function useDashboards(filters: DashboardFilters = {}) {
  return useQuery<DashboardsResponse, APIError>({
    queryKey: ['dashboards', filters],
    queryFn: () =>
      api.get<DashboardsResponse>('/api/v1/dashboards', {
        is_template: filters.is_template,
        tags: filters.tags,
      }),
  });
}

export function useDashboard(id: string) {
  return useQuery<Dashboard, APIError>({
    queryKey: ['dashboard', id],
    queryFn: () => api.get<Dashboard>(`/api/v1/dashboards/${id}`),
    enabled: !!id,
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation<Dashboard, APIError, CreateDashboardInput>({
    mutationFn: (input) => api.post<Dashboard>('/api/v1/dashboards', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useUpdateDashboard() {
  const qc = useQueryClient();
  return useMutation<Dashboard, APIError, { id: string; input: Partial<CreateDashboardInput> }>({
    mutationFn: ({ id, input }) => api.patch<Dashboard>(`/api/v1/dashboards/${id}`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboard', data.id] });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/dashboards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useCloneDashboard() {
  const qc = useQueryClient();
  return useMutation<Dashboard, APIError, string>({
    mutationFn: (id) => api.post<Dashboard>(`/api/v1/dashboards/${id}/clone`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

// ── Dashboard Templates ──────────────────────────────────────────────

export interface DashboardTemplatePanel {
  id: string;
  title: string;
  type: string;
  grid: { x: number; y: number; w: number; h: number };
  query: string;
  options?: Record<string, unknown>;
  thresholds?: Array<{ value: number; color: string }>;
}

export interface DashboardTemplate {
  template_id: string;
  category: string;
  name: string;
  description: string;
  panels: DashboardTemplatePanel[];
  variables?: DashboardVariable[];
  tags: string[];
  requires_vendor: string | null;
}

interface DashboardTemplatesResponse {
  data: DashboardTemplate[];
  grouped: Record<string, DashboardTemplate[]>;
}

export function useDashboardTemplates() {
  return useQuery<DashboardTemplatesResponse, APIError>({
    queryKey: ['dashboard-templates'],
    queryFn: () => api.get<DashboardTemplatesResponse>('/api/v1/dashboards/templates'),
  });
}

export interface InstantiateResult {
  dashboard: Dashboard;
  already_existed: boolean;
}

export function useInstantiateDashboardTemplate() {
  const qc = useQueryClient();
  return useMutation<InstantiateResult, APIError, string>({
    mutationFn: async (templateId) => {
      try {
        const dashboard = await api.post<Dashboard>(
          `/api/v1/dashboards/templates/${templateId}/instantiate`,
          {},
        );
        return { dashboard, already_existed: false };
      } catch (err: any) {
        if (err?.status === 409 && err?.body?.dashboard) {
          return { dashboard: err.body.dashboard as Dashboard, already_existed: true };
        }
        throw err;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useDeduplicateDashboards() {
  const qc = useQueryClient();
  return useMutation<{ removed: number }, APIError, void>({
    mutationFn: () => api.post('/api/v1/dashboards/deduplicate', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}
