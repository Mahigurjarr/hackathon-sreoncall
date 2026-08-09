'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  roles: string[];
  status: string;
  mfa_enabled: boolean;
  backup_codes_remaining: number;
  mfa_required_by_tenant: boolean;
  notification_preferences: Record<string, boolean>;
  timezone: string;
  phone_number: string | null;
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    plan_limits: Record<string, number | boolean | string[]> | null;
  };
}

interface UpdateProfileInput {
  name?: string;
  avatar_url?: string | null;
  notification_preferences?: Record<string, boolean>;
  timezone?: string;
  phone_number?: string;
}

export function useCurrentUser() {
  return useQuery<CurrentUser, APIError>({
    queryKey: ['current-user'],
    queryFn: () => api.get<CurrentUser>('/api/v1/auth/me'),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<CurrentUser, APIError, UpdateProfileInput>({
    mutationFn: (input) => api.patch<CurrentUser>('/api/v1/users/me', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['current-user'] });
    },
  });
}
