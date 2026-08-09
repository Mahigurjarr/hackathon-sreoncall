'use client';

import { useQuery } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface MyProvider {
  _id: string;
  provider: {
    _id: string;
    slug: string;
    name: string;
    type: string;
    status: string;
  } | null;
  scope: string[];
  status: string;
}

export function useMyProvider() {
  return useQuery<MyProvider, APIError>({
    queryKey: ['consumer-provider'],
    queryFn: () => api.get<MyProvider>('/api/v1/consumer/provider'),
  });
}
