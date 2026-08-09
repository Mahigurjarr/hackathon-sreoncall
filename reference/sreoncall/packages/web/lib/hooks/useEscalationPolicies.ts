'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type NotifyChannel = 'email' | 'sms' | 'slack' | 'teams' | 'in_app' | 'voice' | 'whatsapp';

export interface EscalationStep {
  delay_minutes: number;
  targets?: string[];
  target_type?: string;
  note?: string;
  notify_channels?: NotifyChannel[];
}

export interface EscalationPolicy {
  _id: string;
  name: string;
  description?: string;
  status: 'active' | 'disabled';
  steps: EscalationStep[];
  repeat_count?: number;
  repeat_interval_minutes?: number;
  created_at: string;
}

export interface CreateEscalationPolicyInput {
  name: string;
  description?: string;
  steps: EscalationStep[];
  repeat_count?: number;
  repeat_interval_minutes?: number;
}

interface EscalationPoliciesResponse {
  data: EscalationPolicy[];
  pagination: { total?: number };
}

export function useEscalationPolicies(opts?: { status?: string }) {
  return useQuery<EscalationPolicy[], APIError>({
    queryKey: ['escalation-policies', opts],
    queryFn: async () => {
      const res = await api.get<EscalationPoliciesResponse | EscalationPolicy[]>('/api/v1/escalation-policies', {
        status: opts?.status,
      });
      return Array.isArray(res) ? res : res.data;
    },
  });
}

export function useCreateEscalationPolicy() {
  const queryClient = useQueryClient();
  return useMutation<EscalationPolicy, APIError, CreateEscalationPolicyInput>({
    mutationFn: (input) => api.post<EscalationPolicy>('/api/v1/escalation-policies', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-policies'] });
    },
  });
}

export function useUpdateEscalationPolicy() {
  const queryClient = useQueryClient();
  return useMutation<EscalationPolicy, APIError, { id: string; input: Partial<CreateEscalationPolicyInput & { status: 'active' | 'disabled' }> }>({
    mutationFn: ({ id, input }) => api.patch<EscalationPolicy>(`/api/v1/escalation-policies/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-policies'] });
    },
  });
}

export function useDeleteEscalationPolicy() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/escalation-policies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-policies'] });
    },
  });
}
