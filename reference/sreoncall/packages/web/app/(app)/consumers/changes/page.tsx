'use client';

import { useSearchParams } from 'next/navigation';
import { useConsumerChangeRequests, type ConsumerChangeRequest } from '@/lib/hooks/useProvider';
import { GitPullRequestArrow } from 'lucide-react';
import { cn } from '@/lib/utils';

const RISK_COLORS: Record<string, string> = {
  critical: 'bg-[rgba(220,38,38,0.15)] text-[#DC2626]',
  high:     'bg-[rgba(255,107,43,0.15)] text-[#FF6B2B]',
  medium:   'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
  low:      'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
};

export default function ConsumerChangesPage() {
  const searchParams = useSearchParams();
  const consumerId = searchParams.get('consumer') || undefined;

  const { data: changes, isLoading } = useConsumerChangeRequests(consumerId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Consumer Change Requests</h1>
        <p className="text-sm text-muted-foreground">Active change requests from consumer tenants</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !changes?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <GitPullRequestArrow className="mb-3 h-10 w-10 opacity-50" />
          <p>No active consumer change requests</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((cr: ConsumerChangeRequest) => (
                <tr key={cr._id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">CR-{cr.number}</td>
                  <td className="px-4 py-3">
                    <p className="truncate max-w-xs">{cr.title}</p>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{cr.type}</td>
                  <td className="px-4 py-3">
                    {cr.risk_score ? (
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', RISK_COLORS[cr.risk_score] || '')}>
                        {cr.risk_score}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{cr.status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(cr.createdAt).toLocaleDateString()}
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
