'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface PostMortem {
  id: string;
  title: string;
  incident_id: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'draft' | 'in-review' | 'published';
  summary: string;
  timeline: Array<{ time: string; description: string }>;
  root_cause: string;
  contributing_factors: string[];
  action_items: Array<{
    description: string;
    owner_id?: string;
    due_date?: string;
    status: 'open' | 'in_progress' | 'done';
  }>;
  author: { id: string; name: string };
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PostMortemsResponse {
  data: PostMortem[];
  pagination: { has_more: boolean; next_cursor: string | null; total?: number };
}

export interface CreatePostMortemInput {
  title: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  summary?: string;
  incident_id?: string;
}

export function usePostMortems(filters: { status?: string; severity?: string } = {}) {
  return useQuery<PostMortemsResponse, APIError>({
    queryKey: ['postmortems', filters],
    queryFn: () =>
      api.get<PostMortemsResponse>('/api/v1/postmortems', {
        status: filters.status,
        severity: filters.severity,
        limit: 50,
      }),
  });
}

export function usePostMortem(id: string) {
  return useQuery<PostMortem, APIError>({
    queryKey: ['postmortem', id],
    queryFn: () => api.get<PostMortem>(`/api/v1/postmortems/${id}`),
    enabled: !!id,
  });
}

export function useCreatePostMortem() {
  const queryClient = useQueryClient();
  return useMutation<PostMortem, APIError, CreatePostMortemInput>({
    mutationFn: (input) => api.post<PostMortem>('/api/v1/postmortems', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['postmortems'] });
    },
  });
}

export function useUpdatePostMortem() {
  const queryClient = useQueryClient();
  return useMutation<PostMortem, APIError, { id: string; input: Partial<PostMortem> }>({
    mutationFn: ({ id, input }) => api.patch<PostMortem>(`/api/v1/postmortems/${id}`, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['postmortems'] });
      queryClient.invalidateQueries({ queryKey: ['postmortem', data.id] });
    },
  });
}

export function usePublishPostMortem() {
  const queryClient = useQueryClient();
  return useMutation<PostMortem, APIError, string>({
    mutationFn: (id) => api.post<PostMortem>(`/api/v1/postmortems/${id}/publish`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['postmortems'] });
      queryClient.invalidateQueries({ queryKey: ['postmortem', data.id] });
    },
  });
}

export function useDeletePostMortem() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/postmortems/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['postmortems'] });
    },
  });
}
