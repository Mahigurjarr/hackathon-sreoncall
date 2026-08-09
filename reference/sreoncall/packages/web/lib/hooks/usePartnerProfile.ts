import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PartnerData } from '@/lib/types/partner';

async function partnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function usePartnerMe() {
  return useQuery<PartnerData>({
    queryKey: ['partner-me'],
    queryFn: () => partnerFetch<PartnerData>('/api/v1/partner/me'),
  });
}

export interface UpdateMeBody {
  name?: string;
  email?: string;
  password?: {
    current: string;
    new: string;
  };
}

export function useUpdatePartnerMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeBody) =>
      partnerFetch<PartnerData>('/api/v1/partner/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-me'] }),
  });
}
