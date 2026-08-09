'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useConsumerTickets, type ConsumerTicket } from '@/lib/hooks/useProvider';
import { Ticket, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-[rgba(220,38,38,0.15)] text-[#DC2626]',
  medium: 'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
  low:    'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
};

export default function ConsumerTicketsPage() {
  const searchParams = useSearchParams();
  const consumerId = searchParams.get('consumer') || undefined;

  const { data: tickets, isLoading } = useConsumerTickets(consumerId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Consumer Tickets</h1>
        <p className="text-sm text-muted-foreground">Active work tickets from consumer tenants</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !tickets?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Ticket className="mb-3 h-10 w-10 opacity-50" />
          <p>No active consumer tickets</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Consumer</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t: ConsumerTicket) => (
                <tr key={t._id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs font-medium">TK-{String(t.number).padStart(4, '0')}</td>
                  <td className="px-4 py-3">
                    {t.tenant_name ? (
                      <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                        {t.tenant_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate max-w-xs">{t.title}</p>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{t.type?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', PRIORITY_COLORS[t.priority] || '')}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{t.status?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/tickets/${t._id}`}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Link>
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
