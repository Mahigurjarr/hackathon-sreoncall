import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type PartnerType = 'referral' | 'reseller' | 'msp';
export type PartnerStatus = 'pending' | 'active' | 'inactive' | 'rejected';

export interface PartnerNote {
  _id: string;
  body: string;
  author: string;
  created_at: string;
}

export interface Partner {
  _id: string;
  leadId?: string;
  name: string;
  email: string;
  company: string;
  partnerType: PartnerType;
  status: PartnerStatus;
  commissionRate: number;
  assignedTo: string | null;
  notes: PartnerNote[];
  inviteToken?: string;
  inviteSentAt: string | null;
  activatedAt: string | null;
  source_ip: string | null;
  createdAt: string;
  updatedAt: string;
  activeDeals?: number;
  dealsTotalARR?: number;
  totalEarned?: number;
  totalARR?: number;
  commissionEarned?: number;
  commissionForecast?: {
    year1: number;
    year2: number;
    year3: number;
    totalThreeYear: number;
    weighted: number;
  };
}

export function usePartnerDetail(id: string | null) {
  return useQuery<Partner>({
    queryKey: ['admin-partner', id],
    enabled: !!id,
    queryFn: () => api.request<Partner>(`/api/v1/platform/partners/${id}`),
  });
}

export interface PartnerListResponse {
  data: Partner[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { total: number; pending: number; active: number; totalCommissionEarned: number; totalCommissionForecast?: number };
}

export interface PartnerFilters {
  status?: PartnerStatus | '';
  partnerType?: PartnerType | '';
  assigned_to?: string;
  q?: string;
  page?: number;
}

export function usePartners(filters: PartnerFilters = {}) {
  return useQuery<PartnerListResponse>({
    queryKey: ['admin-partners', filters],
    queryFn: () =>
      api.request<PartnerListResponse>('/api/v1/platform/partners', {
        params: {
          ...filters,
          page: filters.page || 1,
        },
      }),
  });
}

export interface CreatePartnerInput {
  name: string;
  email: string;
  company: string;
  partnerType: PartnerType;
  commissionRate: number;
}

export function useCreatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePartnerInput) =>
      api.request<Partner>('/api/v1/platform/partners', { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partners'] }),
  });
}

export function useUpdatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Partner, 'status' | 'commissionRate' | 'assignedTo'>> }) =>
      api.request<Partner>(`/api/v1/platform/partners/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partners'] }),
  });
}

export function useAddPartnerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.request<Partner>(`/api/v1/platform/partners/${id}/notes`, { method: 'POST', body: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partners'] }),
  });
}

export function useDeletePartnerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, noteId }: { partnerId: string; noteId: string }) =>
      api.request<Partner>(`/api/v1/platform/partners/${partnerId}/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partners'] }),
  });
}

export function useSendPartnerInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.request<Partner>(`/api/v1/platform/partners/${id}/invite`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partners'] }),
  });
}
