'use client';

import { useLinkedConsumers, type LinkedConsumer } from '@/lib/hooks/useProvider';
import { useRouter } from 'next/navigation';
import { Building2, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-[rgba(22,163,74,0.15)] text-[#16A34A]',
  suspended: 'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
};

export default function ConsumersPage() {
  const router = useRouter();
  const { data: consumers, isLoading } = useLinkedConsumers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">My Consumers</h1>
        <p className="text-sm text-muted-foreground">Consumer tenants linked to your organization</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !consumers?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="mb-3 h-10 w-10 opacity-50" />
          <p>No consumers linked</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {consumers.map((item: LinkedConsumer) => (
            <div
              key={item._id}
              className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-primary/30 cursor-pointer transition-colors"
              onClick={() => router.push(`/consumers/incidents?consumer=${item.consumer?._id}`)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{item.consumer?.name || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">{item.consumer?.slug}</p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_COLORS[item.consumer?.status || ''] || '')}>
                  {item.consumer?.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {item.scope.map((s) => (
                  <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s}</span>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Plan: <span className="capitalize">{item.consumer?.plan}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
