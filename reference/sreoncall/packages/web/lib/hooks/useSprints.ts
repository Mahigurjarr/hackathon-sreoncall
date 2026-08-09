'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface Sprint {
  id: string;
  _id?: string;
  name: string;
  goal: string;
  status: 'planning' | 'active' | 'completed';
  start_date: string;
  end_date: string;
  completed_at: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SprintProgress {
  total_tickets: number;
  completed_tickets: number;
  pct_complete: number;
}

export interface CreateSprintInput {
  name: string;
  start_date: string;
  end_date: string;
  goal?: string;
  project_id?: string;
}

function normaliseSprint(raw: any): Sprint {
  return { ...raw, id: raw._id?.toString() ?? raw.id };
}

export function useSprints(filters: { project_id?: string; status?: string } = {}) {
  return useQuery<{ data: Sprint[] }, APIError>({
    queryKey: ['sprints', filters],
    queryFn: async () => {
      const result = await api.get<{ data: any[] }>('/api/v1/sprints', filters);
      return { data: result.data.map(normaliseSprint) };
    },
  });
}

export function useSprintProgress(sprintId: string) {
  return useQuery<SprintProgress, APIError>({
    queryKey: ['sprint-progress', sprintId],
    queryFn: () => api.get<SprintProgress>(`/api/v1/sprints/${sprintId}/progress`),
    enabled: !!sprintId,
  });
}

export function useSprintTickets(sprintId: string) {
  return useQuery<{ data: any[] }, APIError>({
    queryKey: ['sprint-tickets', sprintId],
    queryFn: () => api.get<{ data: any[] }>(`/api/v1/sprints/${sprintId}/tickets`),
    enabled: !!sprintId,
  });
}

export function useCreateSprint() {
  const queryClient = useQueryClient();
  return useMutation<Sprint, APIError, CreateSprintInput>({
    mutationFn: async (input) => {
      const raw = await api.post<any>('/api/v1/sprints', {
        ...input,
        start_date: new Date(input.start_date).toISOString(),
        end_date:   new Date(input.end_date).toISOString(),
      });
      return normaliseSprint(raw);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
    },
  });
}

export function useUpdateSprint() {
  const queryClient = useQueryClient();
  return useMutation<Sprint, APIError, { id: string; input: Partial<CreateSprintInput> & { status?: Sprint['status'] } }>({
    mutationFn: async ({ id, input }) => {
      const body: Record<string, any> = { ...input };
      if (input.start_date) body.start_date = new Date(input.start_date).toISOString();
      if (input.end_date)   body.end_date   = new Date(input.end_date).toISOString();
      const raw = await api.patch<any>(`/api/v1/sprints/${id}`, body);
      return normaliseSprint(raw);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
      queryClient.invalidateQueries({ queryKey: ['sprint-progress'] });
    },
  });
}

export function useDeleteSprint() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/sprints/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
    },
  });
}

export function useAssignTicketsToSprint() {
  const queryClient = useQueryClient();
  return useMutation<{ assigned_count: number }, APIError, { sprintId: string; ticketIds: string[] }>({
    mutationFn: ({ sprintId, ticketIds }) =>
      api.post<{ assigned_count: number }>(`/api/v1/sprints/${sprintId}/tickets`, { ticket_ids: ticketIds }),
    onSuccess: (_data, { sprintId }) => {
      queryClient.invalidateQueries({ queryKey: ['sprint-tickets', sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprint-progress', sprintId] });
      queryClient.invalidateQueries({ queryKey: ['tickets-backlog'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useRemoveTicketsFromSprint() {
  const queryClient = useQueryClient();
  return useMutation<{ removed_count: number }, APIError, { sprintId: string; ticketIds: string[] }>({
    mutationFn: async ({ sprintId, ticketIds }) => {
      const sessionRes = await fetch('/api/auth/session');
      const session    = await sessionRes.json();
      const res = await fetch(`/api/v1/sprints/${sprintId}/tickets`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.accessToken ?? ''}`,
          'X-Tenant-Slug': session?.tenantSlug ?? 'platform',
        },
        body: JSON.stringify({ ticket_ids: ticketIds }),
      });
      if (!res.ok) throw new Error('Failed to remove tickets from sprint');
      return res.json() as Promise<{ removed_count: number }>;
    },
    onSuccess: (_data, { sprintId }) => {
      queryClient.invalidateQueries({ queryKey: ['sprint-tickets', sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprint-progress', sprintId] });
      queryClient.invalidateQueries({ queryKey: ['tickets-backlog'] });
    },
  });
}

export interface CompleteSprintResult {
  sprint:            Sprint;
  completed_tickets: number;
  carried_over:      number;
  carry_over_to:     string;
}

export function useCompleteSprint() {
  const queryClient = useQueryClient();
  return useMutation<CompleteSprintResult, import('@/lib/api').APIError, { sprintId: string; carryOverTo?: string }>({
    mutationFn: ({ sprintId, carryOverTo }) =>
      import('@/lib/api').then(({ api }) =>
        api.post<CompleteSprintResult>(`/api/v1/sprints/${sprintId}/complete`, {
          carry_over_to: carryOverTo ?? 'backlog',
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
      queryClient.invalidateQueries({ queryKey: ['tickets-backlog'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
    },
  });
}
