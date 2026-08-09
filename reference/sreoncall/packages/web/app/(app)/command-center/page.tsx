'use client';

import { useRouter } from 'next/navigation';
import {
  Radar,
  Loader2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Shield,
  Activity,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { useIncidents, type Incident } from '@/lib/hooks/useIncidents';
import { cn } from '@/lib/utils';

/* ─── Constants ─────────────────────────────────────────────────────────── */

const SEV_COLORS: Record<number, string> = {
  1: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  2: 'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]',
  3: 'bg-[#FEFCE8] text-[#A16207] border-[#FDE68A]',
  4: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
  5: 'bg-[#F1F5F9] text-[#94A3B8] border-[#E2E8F0]',
};

const STATUS_DOT: Record<string, string> = {
  open: 'bg-[#EF4444] animate-pulse',
  acknowledged: 'bg-[#FF6B2B]',
  investigating: 'bg-[#8B5CF6]',
  monitoring: 'bg-[#06B6D4]',
  resolved: 'bg-[#22C55E]',
  closed: 'bg-[#64748B]',
};

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function CommandCenterIndexPage() {
  const router = useRouter();
  const { data: incidents = [], isLoading } = useIncidents({
    status: 'open,acknowledged,investigating,monitoring',
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#FF6B2B]/10">
            <Radar className="h-[18px] w-[18px] text-[#FF6B2B]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Incident Command Center</h1>
            <p className="text-sm text-muted-foreground">
              Select an active incident to open its Command Center
            </p>
          </div>
          {incidents.length > 0 && (
            <span className="ml-auto inline-flex items-center rounded-full bg-[#FEF2F2] px-2.5 py-0.5 text-xs font-semibold text-[#DC2626] border border-[#FECACA]">
              {incidents.length} active
            </span>
          )}
        </div>
      </div>

      {/* Empty state */}
      {incidents.length === 0 && (
        <EmptyState
          title="All clear"
          description="No active incidents. The Command Center will be available when an incident is open."
        />
      )}

      {/* Active incidents grid */}
      {incidents.length > 0 && (
        <div className="grid gap-3">
          {incidents.map((inc: Incident) => {
            const sevClass = SEV_COLORS[inc.severity] || SEV_COLORS[5];
            const dotClass = STATUS_DOT[inc.status] || STATUS_DOT.open;
            const elapsed = inc.created_at
              ? formatDistanceToNow(new Date(inc.created_at), { addSuffix: false })
              : '—';

            return (
              <Card
                key={inc.id}
                className={cn(
                  'group cursor-pointer border-l-4 transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.35)]',
                  inc.severity === 1
                    ? 'border-l-[#DC2626]'
                    : inc.severity === 2
                    ? 'border-l-[#EA580C]'
                    : 'border-l-[#FF6B2B]',
                )}
                onClick={() => router.push(`/command-center/${inc.id}`)}
              >
                <div className="flex items-center gap-4 p-4">
                  {/* Status dot */}
                  <div className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', dotClass)} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">
                        INC-{String(inc.number).padStart(4, '0')}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-bold tracking-[0.02em]',
                          sevClass,
                        )}
                      >
                        SEV-{inc.severity}
                      </span>
                      <span className="text-xs font-medium capitalize text-muted-foreground">
                        {inc.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground truncate">
                      {inc.title}
                    </p>
                    {inc.affected_services && inc.affected_services.length > 0 && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Activity className="h-3 w-3" />
                        {inc.affected_services.map((s: any) => s.name).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Right side */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {elapsed}
                      </div>
                      {inc.commander && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          <Shield className="mr-1 inline h-3 w-3" />
                          {inc.commander.name}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="group-hover:border-[#FF6B2B] group-hover:text-[#FF6B2B] transition-colors"
                    >
                      Open
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
