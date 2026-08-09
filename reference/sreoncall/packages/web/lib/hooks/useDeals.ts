import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type DealStage = 'pending_approval' | 'prospect' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' | 'rejected';
export type ProductTier = 'startup' | 'growth' | 'enterprise' | 'self_hosted' | 'services';
export type CommissionTrack = 'referral' | 'reseller' | 'msp';

export interface CommissionYear {
  year: 1 | 2 | 3;
  ratePct: number;
  annualAmount: number;
}

export interface CommissionBreakdown {
  track: CommissionTrack;
  basis: 'flat' | 'tapered' | 'custom';
  years: CommissionYear[];
  totalThreeYear: number;
  notes?: string;
}

export interface Deal {
  _id: string;
  partnerId: string;
  referredCompany: string;
  contactName: string;
  contactEmail: string;
  estimatedARR: number;
  productTier: ProductTier;
  currentTools: string[];
  expectedCloseDate: string;
  stage: DealStage;
  commissionRate: number;
  commissionEarned: number;
  commissionBreakdown?: CommissionBreakdown | null;
  commissionOverride?: boolean;
  notes: string;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payout {
  _id: string;
  dealId: string;
  partnerId: string;
  amount: number;
  currency: string;
  paidAt: string;
  reference: string;
  notes?: string;
  createdAt: string;
}

export interface DealListResponse {
  data: Deal[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { total: number; pendingApproval: number; inPipeline: number; closedWon: number; totalCommissionPayable: number };
}

export interface DealFilters {
  partnerId?: string;
  stage?: DealStage | '';
  from?: string;
  to?: string;
  q?: string;
  page?: number;
}

export function useDeals(filters: DealFilters = {}) {
  return useQuery<DealListResponse>({
    queryKey: ['admin-deals', filters],
    queryFn: () =>
      api.request<DealListResponse>('/api/v1/platform/deals', {
        params: {
          ...filters,
          page: filters.page || 1,
        },
      }),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Deal, 'stage' | 'adminNotes' | 'estimatedARR' | 'expectedCloseDate'>> & { commissionBreakdown?: CommissionBreakdown; resetCommission?: boolean }}) =>
      api.request<Deal>(`/api/v1/platform/deals/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-deals'] }),
  });
}

export function useAddPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }: { dealId: string; data: { amount: number; paidAt: string; reference: string; notes?: string } }) =>
      api.request<Payout>(`/api/v1/platform/deals/${dealId}/payouts`, { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-deals'] }),
  });
}

export function useDeletePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, payoutId }: { dealId: string; payoutId: string }) =>
      api.request<Payout>(`/api/v1/platform/deals/${dealId}/payouts/${payoutId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-deals'] }),
  });
}
