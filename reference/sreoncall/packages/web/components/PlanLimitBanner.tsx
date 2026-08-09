'use client';

import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';
import { APIError } from '@/lib/api';

interface PlanLimitBannerProps {
  error: APIError | null | undefined;
}

/**
 * Renders an upgrade prompt banner when the API returns a 402 plan-limit-reached error.
 * Drop this at the top of any page that creates resources gated by plan limits.
 *
 * @example
 * const createSchedule = useCreateSchedule();
 * <PlanLimitBanner error={createSchedule.error} />
 */
export function PlanLimitBanner({ error }: PlanLimitBannerProps) {
  if (!error?.isPlanLimitError()) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm dark:border-orange-800 dark:bg-orange-950">
      <div className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
        <Zap className="h-4 w-4 shrink-0" />
        <span>{error.message}</span>
      </div>
      <Link
        href="/settings/billing"
        className="flex shrink-0 items-center gap-1 font-medium text-orange-800 hover:underline dark:text-orange-200"
      >
        Upgrade plan <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
