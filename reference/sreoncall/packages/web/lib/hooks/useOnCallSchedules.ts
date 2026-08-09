'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RotationType = 'daily' | 'weekly' | 'monthly' | 'custom_hours';

export interface ScheduleLayer {
  id: string;
  name: string;
  rotation_type: RotationType;
  users: string[];        // user IDs
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  timezone: string;
  rotation_length_seconds: number;
  restrictions: Array<{ start_hour: number; end_hour: number; days: number[] }>;
}

export interface ScheduleOverride {
  id: string;
  user_id: string;
  layer_id: string | null;
  start: string;   // ISO
  end: string;     // ISO
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OnCallSchedule {
  id: string;
  name: string;
  description: string;
  timezone: string;
  enabled: boolean;
  layers: ScheduleLayer[];
  overrides: ScheduleOverride[];
  service_ids: string[];
  escalation_policy_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CurrentOnCall {
  current_user_id: string | null;
  layer_id: string | null;
  next_user_id: string | null;
  handoff_at: string | null;
  handoff_in_seconds: number | null;
  override_active: boolean;
}

export interface CreateScheduleInput {
  name: string;
  description?: string;
  timezone?: string;
  layers?: Array<{
    id?: string;
    name: string;
    rotation_type?: RotationType;
    users?: string[];
    start_time?: string;
    end_time?: string;
    timezone?: string;
  }>;
  service_ids?: string[];
  escalation_policy_id?: string | null;
}

export interface UpdateScheduleInput extends Partial<CreateScheduleInput> {
  enabled?: boolean;
}

interface SchedulesResponse {
  data: OnCallSchedule[];
  pagination: { total: number };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useOnCallSchedules(opts?: { search?: string }) {
  return useQuery<OnCallSchedule[], APIError>({
    queryKey: ['oncall-schedules', opts],
    queryFn: async () => {
      const res = await api.get<SchedulesResponse>('/api/v1/oncall-schedules', {
        search: opts?.search,
        limit:  100,
      });
      return res.data;
    },
    retry: 2,
    retryDelay: 1000,
  });
}

export function useOnCallSchedule(id: string) {
  return useQuery<OnCallSchedule, APIError>({
    queryKey: ['oncall-schedule', id],
    queryFn:  () => api.get<OnCallSchedule>(`/api/v1/oncall-schedules/${id}`),
    enabled:  !!id,
  });
}

export interface OnCallUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export function useCurrentOnCallUsers() {
  return useQuery<OnCallUser[], APIError>({
    queryKey: ['oncall-current-users'],
    queryFn: async () => {
      const res = await api.get<{ data: OnCallUser[] }>('/api/v1/oncall-schedules/current-users');
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useCurrentOnCall(scheduleId: string) {
  return useQuery<CurrentOnCall, APIError>({
    queryKey: ['oncall-current', scheduleId],
    queryFn:  () => api.get<CurrentOnCall>(`/api/v1/oncall-schedules/${scheduleId}/current`),
    enabled:  !!scheduleId,
    refetchInterval: 60_000,  // refresh every minute
  });
}

export function useCreateOnCallSchedule() {
  const qc = useQueryClient();
  return useMutation<OnCallSchedule, APIError, CreateScheduleInput>({
    mutationFn: (input) => api.post<OnCallSchedule>('/api/v1/oncall-schedules', input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['oncall-schedules'] }),
  });
}

export function useUpdateOnCallSchedule() {
  const qc = useQueryClient();
  return useMutation<OnCallSchedule, APIError, { id: string; input: UpdateScheduleInput }>({
    mutationFn: ({ id, input }) => api.patch<OnCallSchedule>(`/api/v1/oncall-schedules/${id}`, input),
    onSuccess:  (data) => {
      qc.invalidateQueries({ queryKey: ['oncall-schedules'] });
      qc.invalidateQueries({ queryKey: ['oncall-schedule', data.id] });
    },
  });
}

export function useDeleteOnCallSchedule() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/oncall-schedules/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['oncall-schedules'] }),
  });
}

export function useAddOverride() {
  const qc = useQueryClient();
  return useMutation<OnCallSchedule, APIError, {
    scheduleId: string;
    user_id: string;
    layer_id?: string | null;
    start: string;
    end: string;
    reason?: string;
  }>({
    mutationFn: ({ scheduleId, ...body }) =>
      api.post<OnCallSchedule>(`/api/v1/oncall-schedules/${scheduleId}/overrides`, body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['oncall-schedules'] });
      qc.invalidateQueries({ queryKey: ['oncall-schedule', data.id] });
      qc.invalidateQueries({ queryKey: ['oncall-current', data.id] });
    },
  });
}

export function useDeleteOverride() {
  const qc = useQueryClient();
  return useMutation<OnCallSchedule, APIError, { scheduleId: string; overrideId: string }>({
    mutationFn: ({ scheduleId, overrideId }) =>
      api.delete<OnCallSchedule>(`/api/v1/oncall-schedules/${scheduleId}/overrides/${overrideId}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['oncall-schedules'] });
      qc.invalidateQueries({ queryKey: ['oncall-schedule', data.id] });
      qc.invalidateQueries({ queryKey: ['oncall-current', data.id] });
    },
  });
}
