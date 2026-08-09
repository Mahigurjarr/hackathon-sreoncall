'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ShieldCheck, DollarSign, Activity, TrendingUp } from 'lucide-react';
import { useAdminSupportContracts, useAdminManagedSupportRevenue, type SupportContract } from '@/lib/hooks/useSupportContracts';

function formatAmount(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  amended: 'bg-blue-100 text-blue-700',
  expired: 'bg-gray-100 text-gray-600',
  canceled: 'bg-red-100 text-red-700',
};

export default function AdminManagedSupportPage() {
  const { data: contracts, isLoading } = useAdminSupportContracts();
  const { data: revenue } = useAdminManagedSupportRevenue();

  const active = (contracts || []).filter((c) => c.status === 'active');
  const draft = (contracts || []).filter((c) => c.status === 'draft');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Managed Support Revenue</h1>
        <p className="text-sm text-muted-foreground">Platform revenue from managed-support contracts across all providers</p>
      </div>

      {/* Revenue tiles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Active Contracts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{revenue?.active_contract_count ?? active.length}</p>
            <p className="text-xs text-muted-foreground">{draft.length} draft · {(contracts?.length ?? 0) - active.length - draft.length} closed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Monthly GMV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{revenue ? formatAmount(revenue.total_monthly_cents, revenue.currency) : '—'}</p>
            <p className="text-xs text-muted-foreground">Across all active contracts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" /> Platform Share
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-[#FF6B2B]">
              {revenue ? formatAmount(revenue.platform_share_cents_monthly, revenue.currency) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">Monthly platform revenue</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> Provider Payouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {revenue ? formatAmount(revenue.provider_share_cents_monthly, revenue.currency) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">Monthly aggregate payouts</p>
          </CardContent>
        </Card>
      </div>

      {/* Contract list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Contracts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : !contracts?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No contracts yet</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Consumer</th>
                    <th className="px-3 py-2 font-medium">Coverage</th>
                    <th className="px-3 py-2 font-medium">Tiers</th>
                    <th className="px-3 py-2 font-medium">Monthly</th>
                    <th className="px-3 py-2 font-medium">Platform share</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c: SupportContract & { provider_name?: string | null }) => {
                    const platformCents = Math.round(c.pricing.amount_cents * (c.pricing.platform_share_pct / 100));
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 font-medium">
                          <Link href={`/managed-support/${c.id}`} className="hover:text-primary">
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{c.provider_name || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{c.consumer_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{c.coverage_window.type}</td>
                        <td className="px-3 py-2 font-mono text-xs">{c.tiers.map((t) => `L${t.level}`).join(' · ')}</td>
                        <td className="px-3 py-2 font-mono text-xs">{formatAmount(c.pricing.amount_cents, c.pricing.currency)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-[#FF6B2B]">{formatAmount(platformCents, c.pricing.currency)}</td>
                        <td className="px-3 py-2">
                          <Badge className={STATUS_COLORS[c.status] || ''}>{c.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
