'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ArrowRight, Sparkles } from 'lucide-react';

interface PlanChangeResponse {
  pending: boolean;
  previous_plan?: string;
  new_plan?: string;
  changed_at?: string;
  changed_by?: 'admin' | 'stripe' | 'self';
}

const PLAN_DISPLAY: Record<string, { name: string; color: string }> = {
  free: { name: 'Free', color: '#94A3B8' },
  starter: { name: 'Starter', color: '#3B82F6' },
  business: { name: 'Business', color: '#8B5CF6' },
  enterprise: { name: 'Enterprise', color: '#FF6B2B' },
};

export function PlanChangePopup() {
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PlanChangeResponse>({
    queryKey: ['plan-change-pending'],
    queryFn: () => api.get<PlanChangeResponse>('/api/v1/billing/plan-change'),
    staleTime: 60000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => api.post('/api/v1/billing/plan-change/acknowledge'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-change-pending'] });
      setDismissed(true);
    },
  });

  if (isLoading || !data?.pending || dismissed) {
    return null;
  }

  const prev = PLAN_DISPLAY[data.previous_plan || 'free'] || PLAN_DISPLAY.free;
  const next = PLAN_DISPLAY[data.new_plan || 'free'] || PLAN_DISPLAY.free;
  const isUpgrade = getPlanRank(data.new_plan || 'free') > getPlanRank(data.previous_plan || 'free');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-[#1E293B] shadow-2xl overflow-hidden">
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-[#0D1117] to-[#161B22] px-6 py-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#FF6B2B]" />
            <h2 className="text-lg font-bold text-white">
              Plan {isUpgrade ? 'Upgraded' : 'Changed'}
            </h2>
          </div>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Your billing plan has been updated
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Plan transition visual */}
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="text-center">
              <div
                className="inline-flex items-center justify-center h-12 px-4 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: prev.color }}
              >
                {prev.name}
              </div>
              <p className="mt-1 text-xs text-[#94A3B8]">Previous</p>
            </div>
            <ArrowRight className="h-5 w-5 text-[#94A3B8] shrink-0" />
            <div className="text-center">
              <div
                className="inline-flex items-center justify-center h-12 px-4 rounded-lg text-sm font-semibold text-white ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#1E293B]"
                style={{ backgroundColor: next.color, ['--tw-ring-color' as any]: next.color }}
              >
                {next.name}
              </div>
              <p className="mt-1 text-xs text-[#94A3B8]">Current</p>
            </div>
          </div>

          <p className="mt-2 text-sm text-[#334155] dark:text-[#CBD5E1] text-center leading-relaxed">
            {data.changed_by === 'admin'
              ? 'A platform administrator has updated your plan. Your features and limits have been adjusted accordingly.'
              : 'Your plan has been updated. Please review the new features and limits available to your organization.'}
          </p>

          {/* Changed date */}
          {data.changed_at && (
            <p className="mt-3 text-xs text-[#94A3B8] text-center">
              Changed on {new Date(data.changed_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-3">
          <a
            href="/settings/billing"
            className="flex-1 flex items-center justify-center h-10 rounded-lg border border-[#E2E8F0] dark:border-[#334155] text-sm font-medium text-[#334155] dark:text-[#CBD5E1] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
            onClick={() => acknowledgeMutation.mutate()}
          >
            View Details
          </a>
          <button
            onClick={() => acknowledgeMutation.mutate()}
            disabled={acknowledgeMutation.isPending}
            className="flex-1 flex items-center justify-center h-10 rounded-lg bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-sm font-semibold text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50"
          >
            {acknowledgeMutation.isPending ? 'Accepting...' : 'Accept & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function getPlanRank(plan: string): number {
  const ranks: Record<string, number> = { free: 0, starter: 1, business: 2, enterprise: 3 };
  return ranks[plan] ?? 0;
}
