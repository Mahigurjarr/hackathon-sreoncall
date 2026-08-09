import { useQuery } from '@tanstack/react-query';

async function partnerFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).detail || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface CommissionYear {
  year: 1 | 2 | 3;
  ratePct: number;
  annualAmount: number;
}

export interface CommissionBreakdown {
  track: 'referral' | 'reseller' | 'msp';
  basis: 'flat' | 'tapered' | 'custom';
  years: CommissionYear[];
  totalThreeYear: number;
  notes?: string;
}

export interface CommissionDeal {
  _id: string;
  referredCompany: string;
  stage: string;
  estimatedARR: number;
  commissionRate: number;
  commissionEarned: number;
  commissionBreakdown?: CommissionBreakdown | null;
}

export interface CommissionForecast {
  year1: number;
  year2: number;
  year3: number;
  totalThreeYear: number;
  weighted: number;
}

export interface CommissionsResponse {
  totalEarned: number;
  totalPaid: number;
  pendingPayout: number;
  deals: CommissionDeal[];
  forecast?: CommissionForecast;
}

export interface Payout {
  _id: string;
  dealId: string;
  amount: number;
  currency: string;
  paidAt: string;
  reference: string;
  notes?: string;
}

export function usePartnerCommissions() {
  return useQuery<CommissionsResponse>({
    queryKey: ['partner-commissions'],
    queryFn: () => partnerFetch<CommissionsResponse>('/api/v1/partner/commissions'),
  });
}

export function usePartnerPayouts() {
  return useQuery<Payout[]>({
    queryKey: ['partner-payouts'],
    queryFn: () => partnerFetch<Payout[]>('/api/v1/partner/payouts'),
  });
}
