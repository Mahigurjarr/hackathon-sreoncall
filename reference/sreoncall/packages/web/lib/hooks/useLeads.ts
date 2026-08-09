import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type LeadTrack = 'hero' | 'demo' | 'referral' | 'reseller' | 'msp' | 'partner' | 'general';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed_won' | 'closed_lost';

export interface LeadNote {
  _id: string;
  body: string;
  author: string;
  created_at: string;
}

export interface Lead {
  _id: string;
  name: string;
  email: string;
  company: string;
  role: string | null;
  company_size: string | null;
  message: string | null;
  track: LeadTrack;
  status: LeadStatus;
  assigned_to: string | null;
  notes: LeadNote[];
  follow_up_at: string | null;
  source_ip: string | null;
  partnerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListResponse {
  data: Lead[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { total: number; new: number; qualified: number; closed_won: number };
}

export interface LeadFilters {
  status?: LeadStatus | '';
  track?: LeadTrack | '';
  assigned_to?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
}

export function useLeads(filters: LeadFilters = {}) {
  return useQuery<LeadListResponse>({
    queryKey: ['admin-leads', filters],
    queryFn: () =>
      api.request<LeadListResponse>('/api/v1/platform/leads', {
        params: {
          ...filters,
          page: filters.page || 1,
        },
      }),
  });
}

export interface CreateLeadInput {
  name: string;
  email: string;
  company: string;
  role?: string;
  company_size?: string;
  message?: string;
  track: LeadTrack;
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLeadInput) =>
      api.request<Lead>('/api/v1/platform/leads', { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-leads'] }),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Lead, 'status' | 'assigned_to' | 'follow_up_at'>> }) =>
      api.request<Lead>(`/api/v1/platform/leads/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-leads'] }),
  });
}

export function useAddLeadNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.request<Lead>(`/api/v1/platform/leads/${id}/notes`, { method: 'POST', body: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-leads'] }),
  });
}

export function useDeleteLeadNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, noteId }: { leadId: string; noteId: string }) =>
      api.request<Lead>(`/api/v1/platform/leads/${leadId}/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-leads'] }),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, partnerType, commissionRate }: { id: string; partnerType: 'referral' | 'reseller' | 'msp'; commissionRate: number }) =>
      api.request<{ partnerId: string; inviteSentAt: string }>(`/api/v1/platform/leads/${id}/convert`, {
        method: 'POST',
        body: { partnerType, commissionRate },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-leads'] }),
  });
}
