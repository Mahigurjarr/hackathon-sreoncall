'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface WorkLogApprover {
  user_id: string;
  scope: 'tenant' | 'project';
  project_id?: string;
}

export interface WorkLogSettingsData {
  _id: string;
  tenant_id: string;
  approvers: WorkLogApprover[];
  digest_interval_days: number;
  auto_approve_threshold_minutes: number;
  approval_sla_days: number;
  approval_sla_action: 'escalate' | 'auto_approve' | 'notify_admin';
}

export function useWorkLogSettings() {
  return useQuery<WorkLogSettingsData, APIError>({
    queryKey: ['work-log-settings'],
    queryFn: async () => {
      const res = await api.get<{ data: WorkLogSettingsData }>('/api/v1/work-log-settings');
      return res.data;
    },
  });
}

export function useUpdateWorkLogSettings() {
  const queryClient = useQueryClient();
  return useMutation<WorkLogSettingsData, APIError, Partial<WorkLogSettingsData>>({
    mutationFn: async (input) => {
      const res = await api.patch<{ data: WorkLogSettingsData }>('/api/v1/work-log-settings', input);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-log-settings'] });
    },
  });
}
