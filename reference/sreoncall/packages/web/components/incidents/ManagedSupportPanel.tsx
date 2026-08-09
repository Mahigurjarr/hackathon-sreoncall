'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Clock, ChevronUp, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useBridgeByIncident, useBridgeSlaState, useEscalateTier } from '@/lib/hooks/useBridges';

function formatCountdown(deadline: string | null, now: number): string {
  if (!deadline) return '—';
  const diff = new Date(deadline).getTime() - now;
  if (diff <= 0) return 'overdue';
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function slaBadge(met: string | null, breached: boolean): { label: string; variant: 'default' | 'destructive' | 'secondary' } {
  if (breached) return { label: 'breached', variant: 'destructive' };
  if (met) return { label: 'met', variant: 'default' };
  return { label: 'pending', variant: 'secondary' };
}

interface Props {
  incidentId: string;
  // The current viewer's role on this bridge: 'provider' shows escalate action; 'consumer' is read-only.
  viewerRole: 'provider' | 'consumer';
  incidentStatus: string;
  // Consumer side gets a simplified panel — they've handed off the work and
  // don't need internal-tier countdown / breach details. They mainly want to
  // know "is someone on it and meeting SLA".
}

export function ManagedSupportPanel({ incidentId, viewerRole, incidentStatus }: Props) {
  const { data: bridge } = useBridgeByIncident(incidentId);
  const { data: sla } = useBridgeSlaState(bridge?._id);
  const escalateTier = useEscalateTier();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick every second for the live countdown
  useEffect(() => {
    if (!sla || sla.status !== 'active') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sla?.status]);

  if (!bridge || bridge.status !== 'active' || !sla) return null;

  const isClosed = incidentStatus === 'closed' || incidentStatus === 'resolved';
  const tierLabel = `L${sla.current_tier}`;
  const tierName = sla.current_tier_name || tierLabel;
  const nextTier = sla.next_tier_name ? `L${sla.current_tier + 1}` : null;
  const nextTierName = sla.next_tier_name || null;
  const response = slaBadge(sla.response_sla.met_at, sla.response_sla.breached);
  const resolution = slaBadge(sla.resolution_sla.met_at, sla.resolution_sla.breached);

  async function handleEscalate() {
    setConfirmOpen(false);
    try {
      const res = await escalateTier.mutateAsync(bridge!._id);
      if (res.data.escalated) {
        toast.success(`Escalated to L${res.data.current_tier}${res.data.paged_user_count ? ` (${res.data.paged_user_count} paged)` : ''}`);
      } else {
        toast.info('No higher tier defined on this contract');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to escalate tier');
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Managed Support
            </div>
            <Badge variant="secondary" className="text-xs font-mono">{tierLabel}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Currently handled by <span className="font-medium text-foreground">{tierName}</span>
          </div>

          {/* Tier countdown is provider-internal. Consumer doesn't need it. */}
          {viewerRole === 'provider' && sla.tier_deadline && sla.status === 'active' && (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {nextTier ? `Auto-escalates to ${nextTier} in` : 'Tier deadline'}
              </span>
              <span className="font-mono font-medium">{formatCountdown(sla.tier_deadline, now)}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border px-2 py-1.5">
              <div className="text-muted-foreground">Response SLA</div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="font-mono">{sla.response_sla.target_minutes}m</span>
                <Badge variant={response.variant} className="text-[10px]">{response.label}</Badge>
              </div>
              {!sla.response_sla.met_at && sla.status === 'active' && (
                <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">
                  {formatCountdown(sla.response_sla.deadline_at, now)}
                </div>
              )}
            </div>
            <div className="rounded-md border px-2 py-1.5">
              <div className="text-muted-foreground">Resolution SLA</div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="font-mono">{sla.resolution_sla.target_minutes}m</span>
                <Badge variant={resolution.variant} className="text-[10px]">{resolution.label}</Badge>
              </div>
              {!sla.resolution_sla.met_at && sla.status === 'active' && (
                <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">
                  {formatCountdown(sla.resolution_sla.deadline_at, now)}
                </div>
              )}
            </div>
          </div>

          {(sla.response_sla.breached || sla.resolution_sla.breached) && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {sla.response_sla.breached && 'Response SLA breached. '}
                {sla.resolution_sla.breached && 'Resolution SLA breached. '}
                Customer is notified per contract.
              </span>
            </div>
          )}

          {viewerRole === 'provider' && nextTier && sla.status === 'active' && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setConfirmOpen(true)}
              disabled={escalateTier.isPending || isClosed}
              title={nextTierName ? `Next: ${nextTierName}` : undefined}
            >
              {escalateTier.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ChevronUp className="mr-1.5 h-3.5 w-3.5" />}
              Escalate to {nextTier}
              {nextTierName && <span className="ml-1 text-muted-foreground">· {nextTierName}</span>}
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleEscalate}
        title={`Escalate to ${nextTier}?`}
        description={`This will page the ${nextTier} on-call immediately. The current tier's pages will be canceled. Use only if you need help beyond the current tier's scope.`}
        confirmLabel={`Escalate to ${nextTier}`}
      />
    </>
  );
}
