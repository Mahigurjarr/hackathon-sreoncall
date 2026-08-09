import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// partner_token cookie auth — credentials: 'include'
async function partnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type DealStage = 'pending_approval' | 'prospect' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' | 'rejected';
export type ProductTier = 'startup' | 'growth' | 'enterprise' | 'self_hosted' | 'services';

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
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DealListResponse {
  data: Deal[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface CreateDealBody {
  referredCompany: string;
  contactName: string;
  contactEmail: string;
  estimatedARR: number;
  productTier: ProductTier;
  currentTools?: string[];
  expectedCloseDate: string;
}

export interface UpdatePartnerDealBody {
  stage?: DealStage;
  estimatedARR?: number;
  expectedCloseDate?: string;
  notes?: string;
}

export function usePartnerDeals(stage?: DealStage | '') {
  return useQuery<DealListResponse>({
    queryKey: ['partner-deals', stage],
    queryFn: () => {
      const params = stage ? `?stage=${stage}` : '';
      return partnerFetch<DealListResponse>(`/api/v1/partner/deals${params}`);
    },
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDealBody) =>
      partnerFetch<Deal>('/api/v1/partner/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-deals'] }),
  });
}

export function useUpdatePartnerDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePartnerDealBody }) =>
      partnerFetch<Deal>(`/api/v1/partner/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-deals'] }),
  });
}
