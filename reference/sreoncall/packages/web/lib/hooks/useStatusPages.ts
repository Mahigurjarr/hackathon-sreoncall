'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatusPageComponent {
  id?: string;
  name: string;
  description: string;
  status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
  service_id?: string | null;
  synthetic_check_id?: string | null;
  source?: 'service' | 'synthetic_check' | 'manual';
  type?: string | null;
  last_status?: string | null;
  uptime_24h?: number | null;
}

export interface StatusPageSettings {
  show_on_login?: boolean;
  access_control: {
    visibility: 'public' | 'private';
    allowed_viewer_emails: string[];
    allowed_viewer_domains: string[];
  };
  display_options: {
    show_incidents: boolean;
    show_weekly_summary: boolean;
    show_rca_followups: boolean;
    selected_service_ids: string[];
    selected_synthetic_check_ids: string[];
  };
  localization: {
    additional_locales_enabled: boolean;
    default_language: string;
  };
  branding?: {
    primary_color: string;
    custom_domain: string;
  };
}

export interface CustomAnnouncement {
  enabled: boolean;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'critical';
}

export interface StatusPageItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_public: boolean;
  components: StatusPageComponent[];
  custom_domain: string | null;
  settings?: StatusPageSettings;
  custom_announcement?: CustomAnnouncement;
  created_at: string;
  updated_at: string;
}

export interface StatusUpdateItem {
  id: string;
  status_page_id: string;
  title: string;
  body: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'informational';
  visibility: 'public' | 'internal';
  affected_components: Array<{
    component_id?: string;
    name: string;
    status_before: string;
    status_after: string;
  }>;
  created_by?: string;
  notify_subscribers: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriberItem {
  id: string;
  email: string;
  confirmed: boolean;
  created_at: string;
}

interface StatusPagesResponse {
  data: StatusPageItem[];
}

interface StatusUpdatesResponse {
  data: StatusUpdateItem[];
}

interface SubscribersResponse {
  data: SubscriberItem[];
}

export interface CreateStatusPageInput {
  slug: string;
  name: string;
  description?: string;
  is_public?: boolean;
  components?: Array<{ name: string; description?: string; status?: string }>;
}

export interface CreateStatusUpdateInput {
  title: string;
  body?: string;
  status: string;
  visibility?: string;
  affected_components?: Array<{
    component_id: string;
    name: string;
    status_before?: string;
    status_after?: string;
  }>;
  notify_subscribers?: boolean;
}

// ─── Status Pages ───────────────────────────────────────────────────────────

export function useStatusPages() {
  return useQuery<StatusPagesResponse, APIError>({
    queryKey: ['status-pages'],
    queryFn: () => api.get<StatusPagesResponse>('/api/v1/status-pages'),
    refetchInterval: 30_000,
  });
}

export function useStatusPage(id: string) {
  return useQuery<StatusPageItem, APIError>({
    queryKey: ['status-pages', id],
    queryFn: () => api.get<StatusPageItem>(`/api/v1/status-pages/${id}`),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useCreateStatusPage() {
  const queryClient = useQueryClient();
  return useMutation<StatusPageItem, APIError, CreateStatusPageInput>({
    mutationFn: (input) => api.post<StatusPageItem>('/api/v1/status-pages', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages'] });
    },
  });
}

export function useUpdateStatusPage() {
  const queryClient = useQueryClient();
  return useMutation<
    StatusPageItem,
    APIError,
    { id: string; input: Partial<CreateStatusPageInput> & Record<string, any> }
  >({
    mutationFn: ({ id, input }) => api.patch<StatusPageItem>(`/api/v1/status-pages/${id}`, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['status-pages'] });
      queryClient.invalidateQueries({ queryKey: ['status-pages', variables.id] });
    },
  });
}

export function useDeleteStatusPage() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/status-pages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages'] });
    },
  });
}

// ─── Status Updates ─────────────────────────────────────────────────────────

export function useStatusUpdates(pageId: string) {
  return useQuery<StatusUpdatesResponse, APIError>({
    queryKey: ['status-pages', pageId, 'updates'],
    queryFn: () => api.get<StatusUpdatesResponse>(`/api/v1/status-pages/${pageId}/updates`),
    enabled: !!pageId,
    refetchInterval: 30_000,
  });
}

export function useCreateStatusUpdate(pageId: string) {
  const queryClient = useQueryClient();
  return useMutation<StatusUpdateItem, APIError, CreateStatusUpdateInput>({
    mutationFn: (input) =>
      api.post<StatusUpdateItem>(`/api/v1/status-pages/${pageId}/updates`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages', pageId, 'updates'] });
    },
  });
}

export function useUpdateStatusUpdate(pageId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    StatusUpdateItem,
    APIError,
    { updateId: string; input: Partial<CreateStatusUpdateInput> }
  >({
    mutationFn: ({ updateId, input }) =>
      api.patch<StatusUpdateItem>(`/api/v1/status-pages/${pageId}/updates/${updateId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages', pageId, 'updates'] });
    },
  });
}

export function useDeleteStatusUpdate(pageId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (updateId) =>
      api.delete(`/api/v1/status-pages/${pageId}/updates/${updateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages', pageId, 'updates'] });
    },
  });
}

// ─── Subscribers ────────────────────────────────────────────────────────────

export function useStatusPageSubscribers(pageId: string) {
  return useQuery<SubscribersResponse, APIError>({
    queryKey: ['status-pages', pageId, 'subscribers'],
    queryFn: () => api.get<SubscribersResponse>(`/api/v1/status-pages/${pageId}/subscribers`),
    enabled: !!pageId,
  });
}

export function useAddSubscriber(pageId: string) {
  const queryClient = useQueryClient();
  return useMutation<SubscriberItem, APIError, string>({
    mutationFn: (email) =>
      api.post<SubscriberItem>(`/api/v1/status-pages/${pageId}/subscribers`, { email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages', pageId, 'subscribers'] });
    },
  });
}

export function useRemoveSubscriber(pageId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (subId) =>
      api.delete(`/api/v1/status-pages/${pageId}/subscribers/${subId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages', pageId, 'subscribers'] });
    },
  });
}
