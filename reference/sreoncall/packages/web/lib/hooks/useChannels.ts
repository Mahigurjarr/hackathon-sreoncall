'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type ChannelType = 'general' | 'incident_war_room' | 'dm' | 'customer' | 'topic' | 'broadcast' | 'internal_escalation';

export interface SlackIntegration {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
}

export interface TeamsIntegration {
  team_id: string;
  channel_id: string;
}

export interface Channel {
  _id: string;
  name: string;
  type: ChannelType;
  description?: string;
  incident_id?: string;
  slack_integration?: SlackIntegration | null;
  teams_integration?: TeamsIntegration | null;
  is_archived?: boolean;
  last_message_at?: string | null;
  created_at: string;
}

export interface MessageAuthor {
  _id: string;
  name: string;
}

export interface Message {
  _id: string;
  body: string;
  author: MessageAuthor;
  created_at: string;
}

export interface CreateChannelInput {
  name: string;
  type: ChannelType;
  description?: string;
  slack_integration?: SlackIntegration;
  teams_integration?: TeamsIntegration;
}

interface ChannelsResponse {
  data: Channel[];
  pagination: { total?: number };
}

export function useChannels() {
  return useQuery<Channel[], APIError>({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await api.get<ChannelsResponse | Channel[]>('/api/v1/channels');
      return Array.isArray(res) ? res : res.data;
    },
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation<Channel, APIError, CreateChannelInput>({
    mutationFn: (input) => api.post<Channel>('/api/v1/channels', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}

export function useChannelMessages(id: string | null) {
  return useQuery<Message[], APIError>({
    queryKey: ['channel-messages', id],
    queryFn: () => api.get<Message[]>(`/api/v1/channels/${id}/messages`),
    enabled: !!id,
    refetchInterval: 10000,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation<Message, APIError, { channelId: string; body: string }>({
    mutationFn: ({ channelId, body }) =>
      api.post<Message>(`/api/v1/channels/${channelId}/messages`, { body }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['channel-messages', variables.channelId] });
    },
  });
}
