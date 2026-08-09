import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useEffectiveFlags() {
  return useQuery<Record<string, boolean>>({
    queryKey: ['feature-flags-effective'],
    queryFn: async () => {
      const res = await api.get<{ flags: Record<string, boolean> }>('/api/v1/feature-flags/effective');
      return res.flags;
    },
    staleTime: 5 * 60_000,
  });
}

/** True only when the flag is explicitly enabled for this tenant. */
export function useFeatureFlag(key: string): boolean {
  const { data } = useEffectiveFlags();
  return !!data?.[key];
}
