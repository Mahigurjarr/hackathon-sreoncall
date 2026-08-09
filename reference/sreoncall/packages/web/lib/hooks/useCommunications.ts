'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────

export interface InboxItem {
  consumer_tenant_id: string;
  consumer_name: string;
  consumer_slug: string;
  total_unread: number;
  thread_count: number;
  last_message_at: string;
  oldest_unanswered_at: string | null;
}

export interface CommThread {
  _id: string;
  provider_tenant_id: string;
  consumer_tenant_id: string;
  channel_id: string;
  subject: string;
  status: 'open' | 'closed';
  tag?: 'question' | 'request' | 'update' | 'fyi';
  unread_by_provider: number;
  last_message_at: string;
  external_thread_id?: string;
  initiated_by: 'provider' | 'consumer';
  createdAt: string;
  updatedAt: string;
}

export interface CommMessage {
  _id: string;
  thread_id: string;
  origin: 'provider' | 'consumer_slack' | 'consumer_teams';
  sender_user_id?: string;
  sender_display_name: string;
  body: string;
  tag?: string;
  delivery_status: 'pending' | 'delivered' | 'failed';
  external_message_id?: string;
  read_by_provider: boolean;
  read_at: string | null;
  sent_at: string;
}

export interface CommChannel {
  _id: string;
  consumer_tenant_id: string;
  platform: 'slack' | 'teams';
  external_channel_id: string;
  display_name: string;
  channel_role: 'bidirectional' | 'ingest_only' | 'notify_only';
  source_consumer_tenant_ids: string[];
  installation_id: string | null;
  app_id: string | null;
  aad_tenant_id: string | null;
  team_id: string | null;
  token_prefix: string | null;
  is_active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlackInstallation {
  _id: string;
  consumer_tenant_id: string;
  team_id: string;
  team_name: string;
  bot_user_id: string;
  scopes: string;
  is_active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlackChannelOption {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
  topic?: string;
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

// ─── Provider hooks ─────────────────────────────────────────────────────

export function useCommsInbox(params?: { search?: string; sort?: string; has_unread?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.has_unread) qs.set('has_unread', 'true');
  const query = qs.toString();

  return useQuery<{ data: InboxItem[] }, APIError>({
    queryKey: ['comms-inbox', params],
    queryFn: () => api.get(`/api/v1/provider/communications${query ? `?${query}` : ''}`),
    refetchInterval: 60000,
    staleTime: 15000,
  });
}

export function useCommsUnreadTotal() {
  return useQuery<{ data: InboxItem[] }, APIError>({
    queryKey: ['comms-inbox', undefined],
    queryFn: () => api.get('/api/v1/provider/communications'),
    refetchInterval: 60000,
    staleTime: 15000,
    select: (data) => {
      const total = data.data.reduce((sum, item) => sum + item.total_unread, 0);
      return { data: data.data, total };
    },
  });
}

export function useConsumerThreads(consumerId: string, filters?: { status?: string; tag?: string }) {
  const params: Record<string, string> = {};
  if (filters?.status) params.status = filters.status;
  if (filters?.tag) params.tag = filters.tag;
  const qs = new URLSearchParams(params).toString();

  return useQuery<PaginatedResponse<CommThread>, APIError>({
    queryKey: ['comms-threads', consumerId, filters],
    queryFn: () => api.get(`/api/v1/provider/communications/${consumerId}${qs ? `?${qs}` : ''}`),
    enabled: !!consumerId,
  });
}

export function useThreadMessages(threadId: string) {
  return useQuery<PaginatedResponse<CommMessage>, APIError>({
    queryKey: ['comms-messages', threadId],
    queryFn: () => api.get(`/api/v1/provider/communications/threads/${threadId}?limit=100&sort_order=asc`),
    enabled: !!threadId,
    refetchInterval: false,
    staleTime: 10000,
  });
}

export function useSendProviderReply() {
  const queryClient = useQueryClient();
  return useMutation<CommMessage, APIError, { threadId: string; body: string; tag?: string }>({
    mutationFn: ({ threadId, body, tag }) =>
      api.post(`/api/v1/provider/communications/threads/${threadId}/messages`, { body, tag }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comms-messages', variables.threadId] });
      queryClient.invalidateQueries({ queryKey: ['comms-threads'] });
      queryClient.invalidateQueries({ queryKey: ['comms-inbox'] });
    },
  });
}

export function useCreateProviderThread() {
  const queryClient = useQueryClient();
  return useMutation<
    { thread: CommThread; message: CommMessage },
    APIError,
    { consumerId: string; channel_id: string; subject: string; body: string; tag?: string }
  >({
    mutationFn: ({ consumerId, ...input }) =>
      api.post(`/api/v1/provider/communications/${consumerId}/threads`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comms-threads'] });
      queryClient.invalidateQueries({ queryKey: ['comms-inbox'] });
    },
  });
}

export function useUpdateThread() {
  const queryClient = useQueryClient();
  return useMutation<
    CommThread,
    APIError,
    { threadId: string; tag?: string; status?: string }
  >({
    mutationFn: ({ threadId, ...input }) =>
      api.patch(`/api/v1/provider/communications/threads/${threadId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comms-threads'] });
      queryClient.invalidateQueries({ queryKey: ['comms-inbox'] });
    },
  });
}

// ─── Consumer hooks ─────────────────────────────────────────────────────

export function useConsumerChannels() {
  return useQuery<{ data: CommChannel[] }, APIError>({
    queryKey: ['comm-channels'],
    queryFn: () => api.get('/api/v1/consumer/channels'),
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation<
    CommChannel,
    APIError,
    {
      platform: string;
      external_channel_id: string;
      display_name: string;
      channel_role?: 'bidirectional' | 'ingest_only' | 'notify_only';
      access_token: string;
      signing_secret: string;
      app_id?: string;
      aad_tenant_id?: string;
      team_id?: string;
    }
  >({
    mutationFn: (input) => api.post('/api/v1/consumer/channels', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comm-channels'] });
    },
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation<
    CommChannel,
    APIError,
    {
      id: string;
      updates: {
        display_name?: string;
        is_active?: boolean;
        channel_role?: 'bidirectional' | 'ingest_only' | 'notify_only';
        source_consumer_tenant_ids?: string[];
      };
    }
  >({
    mutationFn: ({ id, updates }) => api.patch(`/api/v1/consumer/channels/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comm-channels'] });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/consumer/channels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comm-channels'] });
    },
  });
}

// ─── Slack Installation hooks ────────────────────────────────────────────

export function useSlackInstallations() {
  return useQuery<{ data: SlackInstallation[] }, APIError>({
    queryKey: ['slack-installations'],
    queryFn: () => api.get('/api/v1/consumer/channels/slack-installations'),
  });
}

export function useSlackChannelList(installationId: string | null) {
  return useQuery<{ data: SlackChannelOption[] }, APIError>({
    queryKey: ['slack-channel-list', installationId],
    queryFn: () => api.get(`/api/v1/consumer/channels/slack-installations/${installationId}/channels`),
    enabled: !!installationId,
  });
}

export function useSelectSlackChannels() {
  const queryClient = useQueryClient();
  return useMutation<
    { data: CommChannel[] },
    APIError,
    {
      installationId: string;
      channels: {
        slack_channel_id: string;
        display_name: string;
        channel_role?: 'bidirectional' | 'ingest_only' | 'notify_only';
        source_consumer_tenant_ids?: string[];
      }[];
    }
  >({
    mutationFn: ({ installationId, channels }) =>
      api.post(`/api/v1/consumer/channels/slack-installations/${installationId}/select`, { channels }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comm-channels'] });
      queryClient.invalidateQueries({ queryKey: ['slack-installations'] });
    },
  });
}

export function useDeleteSlackInstallation() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/consumer/channels/slack-installations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack-installations'] });
      queryClient.invalidateQueries({ queryKey: ['comm-channels'] });
    },
  });
}

// ─── Channel members (for @mention picker) ──────────────────────────────

export interface ChannelMember {
  id: string;
  display_name: string;
}

export function useChannelMembers(threadId: string | null) {
  return useQuery<{ data: ChannelMember[] }, APIError>({
    queryKey: ['channel-members', threadId],
    queryFn: () => api.get(`/api/v1/provider/communications/threads/${threadId}/members`),
    enabled: !!threadId,
    staleTime: 5 * 60 * 1000,
  });
}
