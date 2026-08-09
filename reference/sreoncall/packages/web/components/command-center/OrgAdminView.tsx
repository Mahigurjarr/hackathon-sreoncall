'use client';

import {
  DollarSign,
  Users,
  Clock,
  TrendingUp,
  Globe,
  Shield,
  UserCircle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface ImpactData {
  revenue_impact_per_hour_cents: number;
  users_affected: number;
  customer_tiers: string[];
  support_ticket_surge_percent: number;
}

interface StakeholderUpdate {
  id: string;
  audience: string;
  content: string;
  status: 'draft' | 'sent' | 'pending';
}

interface ResolutionProgress {
  stepsCompleted: number;
  stepsTotal: number;
  confidence: 'high' | 'medium' | 'low';
}

interface OrgAdminViewProps {
  impact: ImpactData | null;
  stakeholderUpdates: StakeholderUpdate[];
  resolutionProgress: ResolutionProgress;
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

const confidenceConfig = {
  high: { label: 'High', color: 'text-[#16A34A]', bg: 'bg-[#16A34A]', variant: 'success' as const },
  medium: { label: 'Medium', color: 'text-[#A16207]', bg: 'bg-[#EAB308]', variant: 'warning' as const },
  low: { label: 'Low', color: 'text-[#DC2626]', bg: 'bg-[#DC2626]', variant: 'destructive' as const },
};

export function OrgAdminView({
  impact,
  stakeholderUpdates,
  resolutionProgress,
}: OrgAdminViewProps) {
  const conf = confidenceConfig[resolutionProgress.confidence];
  const progressPct =
    resolutionProgress.stepsTotal > 0
      ? (resolutionProgress.stepsCompleted / resolutionProgress.stepsTotal) * 100
      : 0;

  const customerUpdate = stakeholderUpdates.find(
    (u) => u.audience === 'external_customer' || u.audience === 'status_page',
  );

  return (
    <div className="space-y-6">
      {/* Impact Metrics — 4-column grid */}
      <div>
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B] mb-3">
          Business Impact Overview
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Revenue */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign className="h-3.5 w-3.5 text-[#DC2626]" />
                <span className="text-[9px] uppercase tracking-wide font-medium text-[#DC2626]">
                  Revenue Impact/hr
                </span>
              </div>
              <p className="text-[24px] font-bold font-mono text-[#DC2626] leading-none">
                {impact ? formatCurrency(impact.revenue_impact_per_hour_cents) : '--'}
              </p>
            </div>
          </Card>

          {/* Users affected */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-3.5 w-3.5 text-[#EA580C]" />
                <span className="text-[9px] uppercase tracking-wide font-medium text-[#EA580C]">
                  Users Affected
                </span>
              </div>
              <p className="text-[24px] font-bold font-mono text-[#EA580C] leading-none">
                {impact ? formatUsers(impact.users_affected) : '--'}
              </p>
            </div>
          </Card>

          {/* Customer tiers */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="h-3.5 w-3.5 text-[#A16207]" />
                <span className="text-[9px] uppercase tracking-wide font-medium text-[#A16207]">
                  Tiers Affected
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {impact && impact.customer_tiers.length > 0 ? (
                  impact.customer_tiers.map((tier) => (
                    <Badge key={tier} variant="warning" className="text-[9px]">
                      {tier}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[14px] font-mono text-[#94A3B8]">--</span>
                )}
              </div>
            </div>
          </Card>

          {/* Support surge */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="h-3.5 w-3.5 text-[#2563EB]" />
                <span className="text-[9px] uppercase tracking-wide font-medium text-[#2563EB]">
                  Support Surge
                </span>
              </div>
              <p className="text-[24px] font-bold font-mono text-[#2563EB] leading-none">
                {impact ? `+${impact.support_ticket_surge_percent}%` : '--'}
              </p>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Customer-facing Status Page Draft */}
        <Card className="border-l-4 border-l-[#16A34A]">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-[#F0FDF4] dark:bg-green-950/20 flex items-center justify-center">
                <Globe className="w-3.5 h-3.5 text-[#16A34A]" />
              </div>
              <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                Customer-Facing Update
              </span>
              {customerUpdate && (
                <Badge
                  variant={customerUpdate.status === 'sent' ? 'success' : 'warning'}
                  className="text-[8px]"
                >
                  {customerUpdate.status === 'sent' ? 'Published' : 'Draft'}
                </Badge>
              )}
            </div>

            {customerUpdate ? (
              <div className="rounded-[8px] bg-[#F0FDF4] dark:bg-green-950/10 p-3 text-[12px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap min-h-[100px]">
                {customerUpdate.content}
              </div>
            ) : (
              <div className="rounded-[8px] border-2 border-dashed border-[#E2E8F0] dark:border-[#1E293B] bg-[#F0FDF4] dark:bg-green-950/10 p-6 text-center min-h-[100px] flex items-center justify-center">
                <p className="text-[12px] text-[#94A3B8]">
                  No customer-facing update has been drafted yet.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Resolution Progress */}
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                Resolution Progress
              </span>
              <Badge variant={conf.variant} className="text-[8px]">
                {conf.label} Confidence
              </Badge>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-[#64748B]">Steps completed</span>
                <span className="text-[12px] font-mono font-bold text-gray-900 dark:text-gray-100">
                  {resolutionProgress.stepsCompleted} / {resolutionProgress.stepsTotal}
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-[#E2E8F0] dark:bg-navy-elevated overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    conf.bg,
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-1.5 mb-4">
              {Array.from({ length: resolutionProgress.stepsTotal }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold',
                    i < resolutionProgress.stepsCompleted
                      ? 'bg-[#16A34A] text-white'
                      : 'bg-[#E2E8F0] dark:bg-navy-elevated text-[#94A3B8]',
                  )}
                >
                  {i < resolutionProgress.stepsCompleted ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    i + 1
                  )}
                </div>
              ))}
            </div>

            {/* Commander info placeholder */}
            <div className="rounded-[8px] bg-[#F8FAFC] dark:bg-navy-elevated p-3 flex items-center gap-3">
              <UserCircle className="w-8 h-8 text-[#94A3B8]" />
              <div>
                <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B]">
                  Incident Commander
                </p>
                <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
                  Assigned responder
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
