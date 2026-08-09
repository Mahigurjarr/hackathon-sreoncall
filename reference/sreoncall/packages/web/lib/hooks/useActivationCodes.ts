'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type ActivationCodeStatus = 'pending' | 'redeemed' | 'expired' | 'revoked';

export interface ActivationCode {
  _id: string;
  code: string;
  tenant_id: string;
  plan: string;
  duration_months: number;
  status: ActivationCodeStatus;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
  generated_by: string;
  email_sent: boolean;
  email_sent_at: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ActivationCodesResponse {
  data: ActivationCode[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface GenerateCodeInput {
  tenant_id: string;
  plan: string;
  duration_months: number;
  expires_at: string;
  notes?: string;
  send_email: boolean;
}

// ─── Admin queries ─────────────────────────────────────────────────────────────

export function useActivationCodes(
  filters: { status?: string; tenant_id?: string; plan?: string } = {},
  page = 1
) {
  return useQuery<ActivationCodesResponse, APIError>({
    queryKey: ['activation-codes', filters, page],
    queryFn: () =>
      api.get<ActivationCodesResponse>('/api/v1/platform-admin/activation-codes', {
        ...filters,
        page,
        limit: 20,
      }),
  });
}

// ─── Admin mutations ───────────────────────────────────────────────────────────

export function useGenerateCode() {
  const qc = useQueryClient();
  return useMutation<ActivationCode, APIError, GenerateCodeInput>({
    mutationFn: (body) => api.post('/api/v1/platform-admin/activation-codes', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activation-codes'] }),
  });
}

export function useRevokeCode() {
  const qc = useQueryClient();
  return useMutation<ActivationCode, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/platform-admin/activation-codes/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activation-codes'] }),
  });
}

export function useResendCodeEmail() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/platform-admin/activation-codes/${id}/send-email`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activation-codes'] }),
  });
}

// ─── Tenant mutation ───────────────────────────────────────────────────────────

export function useRedeemCode() {
  const qc = useQueryClient();
  return useMutation<any, APIError, { code: string }>({
    mutationFn: (body) => api.post('/api/v1/billing/redeem', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-subscription'] });
      qc.invalidateQueries({ queryKey: ['tenant-current'] });
    },
  });
}
