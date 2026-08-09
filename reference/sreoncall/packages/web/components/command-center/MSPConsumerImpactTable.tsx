'use client';

import { AlertTriangle, Users, DollarSign, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConsumerImpactEntry } from '@/lib/hooks/useCommandCenter';

interface MSPConsumerImpactTableProps {
  entries: ConsumerImpactEntry[];
  onSelectConsumer: (consumerId: string) => void;
}

function formatRevenue(cents: number | null): string {
  if (cents == null) return '—';
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k/hr`;
  return `$${Math.round(dollars)}/hr`;
}

function formatUsers(count: number | null): string {
  if (count == null) return '—';
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function MSPConsumerImpactTable({ entries, onSelectConsumer }: MSPConsumerImpactTableProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#7C3AED] mb-2">
          Consumer Impact
        </p>
        <p className="text-[13px] text-[#94A3B8]">No active consumer tenants</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="px-4 pt-4 pb-2">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#7C3AED]">
          Consumer Impact
        </p>
      </div>

      <div className="px-2 pb-3 space-y-1">
        {entries.map((entry) => {
          const hasSlaBreach = entry.sla_at_risk_count > 0;
          const revenue = entry.business_impact.revenue_impact_per_hour_cents;
          const users = entry.business_impact.users_affected;

          return (
            <button
              key={entry.consumer.id}
              onClick={() => onSelectConsumer(entry.consumer.id)}
              className={cn(
                'w-full rounded-[8px] px-3 py-2 text-left transition-colors hover:bg-muted/60',
                hasSlaBreach
                  ? 'bg-[#FEF2F2] dark:bg-red-950/20 hover:bg-[#FEF2F2]/80'
                  : 'bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                {/* Consumer name + SLA warning */}
                <div className="flex items-center gap-1.5 min-w-0">
                  {hasSlaBreach && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-[#DC2626]" />
                  )}
                  <span className={cn(
                    'text-[12px] font-semibold truncate',
                    hasSlaBreach ? 'text-[#DC2626]' : 'text-foreground',
                  )}>
                    {entry.consumer.name}
                  </span>
                </div>

                {/* Metrics strip */}
                <div className="flex items-center gap-3 shrink-0">
                  {revenue != null && (
                    <div className="flex items-center gap-0.5">
                      <DollarSign className="h-3 w-3 text-[#64748B]" />
                      <span className="text-[11px] font-mono font-bold text-foreground">
                        {formatRevenue(revenue)}
                      </span>
                    </div>
                  )}
                  {users != null && (
                    <div className="flex items-center gap-0.5">
                      <Users className="h-3 w-3 text-[#64748B]" />
                      <span className="text-[11px] font-mono text-foreground">
                        {formatUsers(users)}
                      </span>
                    </div>
                  )}
                  {hasSlaBreach && (
                    <div className="flex items-center gap-0.5">
                      <ShieldAlert className="h-3 w-3 text-[#DC2626]" />
                      <span className="text-[11px] font-bold text-[#DC2626]">
                        {entry.sla_at_risk_count}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-3">
        <p className="text-[10px] text-[#94A3B8]">
          Click a consumer to scope the ICC view to their data.
        </p>
      </div>
    </div>
  );
}
