'use client';

import { useSearchParams } from 'next/navigation';
import { useConsumerIncidents, type ConsumerIncident } from '@/lib/hooks/useProvider';
import { Siren } from 'lucide-react';
import { cn } from '@/lib/utils';

const SEVERITY_COLORS: Record<number, string> = {
  1: 'bg-[rgba(220,38,38,0.15)] text-[#DC2626]',
  2: 'bg-[rgba(255,107,43,0.15)] text-[#FF6B2B]',
  3: 'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
  4: 'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
  5: 'bg-[rgba(148,163,184,0.15)] text-[#94A3B8]',
};

export default function ConsumerIncidentsPage() {
  const searchParams = useSearchParams();
  const consumerId = searchParams.get('consumer') || undefined;

  const { data: incidents, isLoading } = useConsumerIncidents(consumerId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Consumer Incidents</h1>
        <p className="text-sm text-muted-foreground">Active incidents from consumer tenants</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !incidents?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Siren className="mb-3 h-10 w-10 opacity-50" />
          <p>No active consumer incidents</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Incident</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc: ConsumerIncident) => (
                <tr key={inc._id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold', SEVERITY_COLORS[inc.severity] || '')}>
                      P{inc.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">INC-{inc.number}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-xs">{inc.title}</p>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{inc.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inc.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
