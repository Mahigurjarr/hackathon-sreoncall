'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface LinkedConsumer {
  _id: string;
  consumer: {
    _id: string;
    slug: string;
    name: string;
    type: string;
    status: string;
    plan: string;
  } | null;
  scope: string[];
  status: string;
  createdAt: string;
}

export interface ConsumerIncident {
  _id: string;
  number: number;
  title: string;
  severity: number;
  status: string;
  tenant_id: string;
  createdAt: string;
}

export function useLinkedConsumers() {
  return useQuery<LinkedConsumer[], APIError>({
    queryKey: ['provider-consumers'],
    queryFn: async () => {
      const res = await api.get<{ data: LinkedConsumer[] }>('/api/v1/provider/consumers', { limit: 100 });
      return res.data;
    },
  });
}

export interface ConsumerOnCallSchedule {
  id: string;
  name: string;
  timezone: string;
}

export function useConsumerOnCallSchedules(consumerId: string | null) {
  return useQuery<ConsumerOnCallSchedule[], APIError>({
    queryKey: ['provider-consumer-oncall-schedules', consumerId],
    queryFn: async () => {
      const res = await api.get<{ data: ConsumerOnCallSchedule[] }>(`/api/v1/provider/consumers/${consumerId}/oncall-schedules`);
      return res.data;
    },
    enabled: !!consumerId,
  });
}

export function useConsumerIncidents(consumerId?: string) {
  return useQuery<ConsumerIncident[], APIError>({
    queryKey: ['provider-consumer-incidents', consumerId],
    queryFn: async () => {
      const path = consumerId
        ? `/api/v1/provider/consumers/${consumerId}/incidents`
        : '/api/v1/provider/consumers/all/incidents';
      const res = await api.get<{ data: ConsumerIncident[] }>(path, { limit: 100 });
      return res.data;
    },
  });
}

export interface ConsumerTicket {
  _id: string;
  number: number;
  title: string;
  type: string;
  status: string;
  priority: string;
  tenant_id: string;
  tenant_name: string | null;
  createdAt: string;
}

export interface ConsumerChangeRequest {
  _id: string;
  number: number;
  title: string;
  type: string;
  status: string;
  risk_score: string | null;
  tenant_id: string;
  createdAt: string;
}

export function useConsumerTickets(consumerId?: string) {
  return useQuery<ConsumerTicket[], APIError>({
    queryKey: ['provider-consumer-tickets', consumerId],
    queryFn: async () => {
      const path = consumerId
        ? `/api/v1/provider/consumers/${consumerId}/tickets`
        : '/api/v1/provider/consumers/all/tickets';
      const res = await api.get<{ data: ConsumerTicket[] }>(path, { limit: 100 });
      return res.data;
    },
  });
}

export function useConsumerChangeRequests(consumerId?: string) {
  return useQuery<ConsumerChangeRequest[], APIError>({
    queryKey: ['provider-consumer-changes', consumerId],
    queryFn: async () => {
      const path = consumerId
        ? `/api/v1/provider/consumers/${consumerId}/changes`
        : '/api/v1/provider/consumers/all/changes';
      const res = await api.get<{ data: ConsumerChangeRequest[] }>(path, { limit: 100 });
      return res.data;
    },
  });
}

export interface LinkToConsumerResult {
  bridge_id: string;
  consumer_ticket_id: string;
  provider_ticket_id: string;
  status: string;
}

export function useLinkTicketToConsumer() {
  const queryClient = useQueryClient();
  return useMutation<LinkToConsumerResult, APIError, { ticketId: string; consumerId: string }>({
    mutationFn: async ({ ticketId, consumerId }) => {
      return api.post<LinkToConsumerResult>(`/api/v1/provider/tickets/${ticketId}/link-to-consumer`, {
        consumer_id: consumerId,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-bridge', variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] });
    },
  });
}
