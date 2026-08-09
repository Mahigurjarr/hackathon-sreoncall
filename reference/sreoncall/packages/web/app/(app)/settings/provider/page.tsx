'use client';

import { useMyProvider } from '@/lib/hooks/useConsumer';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ProviderSettingsPage() {
  const { data: providerInfo, isLoading, error } = useMyProvider();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">My Provider</h1>
        <p className="text-sm text-muted-foreground">Provider organization linked to your tenant</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error || !providerInfo ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="mb-3 h-10 w-10 opacity-50" />
          <p>No provider linked to your organization</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 max-w-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[rgba(124,58,237,0.15)]">
              <Building2 className="h-6 w-6 text-[#7C3AED]" />
            </div>
            <div>
              <p className="font-semibold text-lg">{providerInfo.provider?.name || 'Unknown'}</p>
              <p className="text-sm text-muted-foreground">{providerInfo.provider?.slug}</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-medium', {
                'bg-[rgba(22,163,74,0.15)] text-[#16A34A]': providerInfo.status === 'active',
                'bg-[rgba(234,179,8,0.15)] text-[#EAB308]': providerInfo.status === 'pending',
              })}>
                {providerInfo.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Scope</span>
              <div className="flex flex-wrap gap-1">
                {providerInfo.scope.map((s) => (
                  <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
