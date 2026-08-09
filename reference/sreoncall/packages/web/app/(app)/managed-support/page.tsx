'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProviderSupportContracts, useCancelSupportContract, useActivateSupportContract, type SupportContract } from '@/lib/hooks/useSupportContracts';
import { Button } from '@/components/ui/Button';
import { ShieldCheck, Clock, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
  active:   'bg-[rgba(22,163,74,0.15)] text-[#16A34A]',
  amended:  'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
  expired:  'bg-[rgba(100,116,139,0.15)] text-[#64748B]',
  canceled: 'bg-[rgba(220,38,38,0.15)] text-[#DC2626]',
};

function formatAmount(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default function ManagedSupportPage() {
  const router = useRouter();
  const { data: contracts, isLoading } = useProviderSupportContracts();
  const activate = useActivateSupportContract();
  const cancel = useCancelSupportContract();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Managed Support Contracts</h1>
          <p className="text-sm text-muted-foreground">L1/L2/L3 coverage agreements with your consumers</p>
        </div>
        <Button size="sm" onClick={() => router.push('/managed-support/new')}>
          <Plus className="mr-1.5 h-4 w-4" /> New Contract
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !contracts?.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-muted-foreground">
          <ShieldCheck className="mb-3 h-10 w-10 opacity-50" />
          <p className="mb-4">No support contracts yet</p>
          <Button size="sm" onClick={() => router.push('/managed-support/new')}>
            <Plus className="mr-1.5 h-4 w-4" /> Create your first contract
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {contracts.map((c: SupportContract) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/managed-support/${c.id}`} className="block">
                    <p className="font-medium truncate hover:text-primary transition-colors">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.consumer_name || 'Unknown consumer'}</p>
                  </Link>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', STATUS_COLORS[c.status] || '')}>
                  {c.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" /> {c.coverage_window.type.toUpperCase()}
                </span>
                {c.tiers.map((t) => (
                  <span key={t.level} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    L{t.level}
                  </span>
                ))}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {c.sla_targets.length} SLA{c.sla_targets.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex items-end justify-between gap-3 pt-1">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{formatAmount(c.pricing.amount_cents, c.pricing.currency)}</span>
                  <span> / month · {c.pricing.provider_share_pct}% to you</span>
                </div>
                <div className="flex gap-2">
                  {c.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="info"
                      disabled={activate.isPending}
                      onClick={() => activate.mutate(c.id)}
                    >
                      Activate
                    </Button>
                  )}
                  {(c.status === 'active' || c.status === 'draft') && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={cancel.isPending}
                      onClick={() => {
                        if (confirm(`Cancel contract "${c.name}"? This ends the managed-support agreement.`)) {
                          cancel.mutate(c.id);
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
