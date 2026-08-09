'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────

export interface OnboardingItem {
  id: string;
  tenant_name: string;
  tenant_slug: string;
  contact_email: string;
  assignee_email: string;
  status: 'pending_submission' | 'submitted' | 'approved' | 'rejected';
  token: string | null;
  token_expires_at: string | null;
  form_data: Record<string, any> | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  tenant_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
  };
}

interface SlugCheckResult {
  available: boolean;
  reason?: string;
}

// ─── Admin Hooks ────────────────────────────────────────────────────

export function useOnboardings(filters?: {
  status?: string;
  search?: string;
  limit?: number;
}) {
  return useQuery<PaginatedResponse<OnboardingItem>, APIError>({
    queryKey: ['platform-admin', 'onboarding', filters],
    queryFn: () =>
      api.get<PaginatedResponse<OnboardingItem>>('/api/v1/platform-admin/onboarding', {
        ...filters,
      }),
  });
}

export function useOnboarding(id: string) {
  return useQuery<OnboardingItem, APIError>({
    queryKey: ['platform-admin', 'onboarding', id],
    queryFn: () => api.get<OnboardingItem>(`/api/v1/platform-admin/onboarding/${id}`),
    enabled: !!id,
  });
}

export function useCreateOnboarding() {
  const queryClient = useQueryClient();

  return useMutation<
    OnboardingItem,
    APIError,
    { tenant_name: string; tenant_slug: string; contact_email: string; assignee_email: string }
  >({
    mutationFn: (data) =>
      api.post<OnboardingItem>('/api/v1/platform-admin/onboarding', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'onboarding'] });
    },
  });
}

export function useCheckSlug(slug: string) {
  return useQuery<SlugCheckResult, APIError>({
    queryKey: ['platform-admin', 'onboarding', 'check-slug', slug],
    queryFn: () =>
      api.get<SlugCheckResult>('/api/v1/platform-admin/onboarding/check-slug', { slug }),
    enabled: slug.length >= 3,
  });
}

export function useApproveOnboarding() {
  const queryClient = useQueryClient();

  return useMutation<OnboardingItem, APIError, { id: string; notes?: string }>({
    mutationFn: ({ id, notes }) =>
      api.patch<OnboardingItem>(`/api/v1/platform-admin/onboarding/${id}/approve`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'onboarding'] });
    },
  });
}

export function useRejectOnboarding() {
  const queryClient = useQueryClient();

  return useMutation<OnboardingItem, APIError, { id: string; notes?: string }>({
    mutationFn: ({ id, notes }) =>
      api.patch<OnboardingItem>(`/api/v1/platform-admin/onboarding/${id}/reject`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'onboarding'] });
    },
  });
}
