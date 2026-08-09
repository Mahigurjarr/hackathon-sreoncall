'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface TenantUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: string;
  avatar_url: string | null;
  phone_number: string | null;
}

interface UsersResponse {
  data: TenantUser[];
  pagination: { total: number; has_more: boolean };
}

export function useUsers(opts?: { status?: string }) {
  return useQuery<TenantUser[], APIError>({
    queryKey: ['users', opts],
    queryFn: async () => {
      const res = await api.get<UsersResponse>('/api/v1/users', {
        status: opts?.status ?? 'active',
        limit: 200,
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // cache 5 min
  });
}

export function useResetUserPassword() {
  return useMutation<void, APIError, { userId: string; password: string }>({
    mutationFn: ({ userId, password }) =>
      api.post(`/api/v1/users/${userId}/reset-password`, { password }),
  });
}
