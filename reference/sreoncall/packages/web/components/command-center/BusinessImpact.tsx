'use client';

import { DollarSign, Users, Clock, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

interface BusinessImpactData {
  revenue_impact_per_hour_cents: number;
  users_affected: number;
  customer_tiers: string[];
  sla_at_risk: Array<{
    name: string;
    breach_in_minutes: number;
  }>;
  support_ticket_surge_percent: number;
}

interface BusinessImpactProps {
  impact: BusinessImpactData | null;
}

function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toLocaleString()}`;
}

function formatUsers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toLocaleString();
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function BusinessImpact({ impact }: BusinessImpactProps) {
  if (!impact) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <p className="text-[10px] uppercase tracking-wide font-medium text-[#64748B]">
          Business Impact
        </p>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No impact data available</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="p-4 pb-3">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          Business Impact
        </p>
      </div>

      {/* Revenue + Users grid */}
      <div className="grid grid-cols-2 gap-3 px-4">
        <div className="rounded-[8px] bg-[#FEF2F2] dark:bg-red-950/30 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3 w-3 text-[#DC2626]" />
            <span className="text-[9px] uppercase tracking-wide font-medium text-[#DC2626]">
              Revenue/hr
            </span>
          </div>
          <p className="text-[18px] font-bold font-mono text-[#DC2626] leading-none">
            {formatCurrency(impact.revenue_impact_per_hour_cents)}
          </p>
        </div>

        <div className="rounded-[8px] bg-[#FFF7ED] dark:bg-orange-950/30 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="h-3 w-3 text-[#EA580C]" />
            <span className="text-[9px] uppercase tracking-wide font-medium text-[#EA580C]">
              Users Hit
            </span>
          </div>
          <p className="text-[18px] font-bold font-mono text-[#EA580C] leading-none">
            {formatUsers(impact.users_affected)}
          </p>
        </div>
      </div>

      {/* Customer Tiers */}
      {impact.customer_tiers.length > 0 && (
        <div className="px-4 pt-3">
          <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1.5">
            Customer Tiers Affected
          </p>
          <div className="flex flex-wrap gap-1">
            {impact.customer_tiers.map((tier) => (
              <Badge key={tier} variant="warning" className="text-[9px]">
                {tier}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* SLA at Risk */}
      {impact.sla_at_risk.length > 0 && (
        <div className="px-4 pt-3">
          <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1.5">
            SLA at Risk
          </p>
          <div className="space-y-1.5">
            {impact.sla_at_risk.map((sla) => {
              const isUrgent = sla.breach_in_minutes <= 15;
              return (
                <div
                  key={sla.name}
                  className={cn(
                    'flex items-center justify-between rounded-[6px] px-2.5 py-1.5 text-[12px]',
                    isUrgent
                      ? 'bg-[#FEF2F2] dark:bg-red-950/30'
                      : 'bg-[#FEFCE8] dark:bg-yellow-950/20',
                  )}
                >
                  <span
                    className={cn(
                      'font-medium',
                      isUrgent ? 'text-[#DC2626]' : 'text-[#A16207]',
                    )}
                  >
                    {sla.name}
                  </span>
                  <span
                    className={cn(
                      'font-mono font-bold text-[11px]',
                      isUrgent ? 'text-[#DC2626] animate-pulse' : 'text-[#A16207]',
                    )}
                  >
                    <Clock className="inline h-3 w-3 mr-0.5 -mt-px" />
                    {formatMinutes(sla.breach_in_minutes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Support Ticket Surge */}
      {impact.support_ticket_surge_percent > 0 && (
        <div className="px-4 pt-3 pb-4">
          <div className="flex items-center gap-1.5 rounded-[6px] bg-[#FFF7ED] dark:bg-orange-950/20 px-2.5 py-1.5">
            <TrendingUp className="h-3 w-3 text-[#EA580C]" />
            <span className="text-[12px] font-medium text-[#EA580C]">
              Support tickets up {impact.support_ticket_surge_percent}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
