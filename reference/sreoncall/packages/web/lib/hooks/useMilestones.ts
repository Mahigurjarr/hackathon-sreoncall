'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface Milestone {
  id: string;
  project_id: string | null;
  name: string;
  description: string;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  start_date: string;
  target_date: string;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MilestoneProgress {
  total_tickets: number;
  completed_tickets: number;
  pct_complete: number;
  estimated_hours: number;
  actual_hours: number;
  overdue: boolean;
}

interface MilestonesResponse {
  data: Milestone[];
  pagination: { has_more: boolean; next_cursor: string | null; total: number };
}

export interface MilestoneFilters {
  project_id?: string;
  status?: string;
}

export interface CreateMilestoneInput {
  project_id?: string | null;
  name: string;
  description?: string;
  status?: string;
  start_date: string;
  target_date: string;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string;
  status?: string;
  start_date?: string;
  target_date?: string;
}

export function useMilestones(filters: MilestoneFilters = {}) {
  return useQuery<MilestonesResponse, APIError>({
    queryKey: ['milestones', filters],
    queryFn: () => api.get<MilestonesResponse>('/api/v1/milestones', {
      project_id: filters.project_id,
      status: filters.status,
      limit: 200,
    }),
  });
}

export function useMilestone(id: string) {
  return useQuery<Milestone, APIError>({
    queryKey: ['milestone', id],
    queryFn: () => api.get<Milestone>(`/api/v1/milestones/${id}`),
    enabled: !!id,
  });
}

export function useMilestoneProgress(id: string) {
  return useQuery<MilestoneProgress, APIError>({
    queryKey: ['milestone-progress', id],
    queryFn: () => api.get<MilestoneProgress>(`/api/v1/milestones/${id}/progress`),
    enabled: !!id,
  });
}

export function useCreateMilestone() {
  const qc = useQueryClient();
  return useMutation<Milestone, APIError, CreateMilestoneInput>({
    mutationFn: (input) => api.post<Milestone>('/api/v1/milestones', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  });
}

export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation<Milestone, APIError, { id: string; input: UpdateMilestoneInput }>({
    mutationFn: ({ id, input }) => api.patch<Milestone>(`/api/v1/milestones/${id}`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['milestones'] });
      qc.invalidateQueries({ queryKey: ['milestone', data.id] });
      qc.invalidateQueries({ queryKey: ['milestone-progress', data.id] });
    },
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/milestones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  });
}
