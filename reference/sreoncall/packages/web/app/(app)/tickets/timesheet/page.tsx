'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, DollarSign } from 'lucide-react';
import { useTimesheet } from '@/lib/hooks/useTickets';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { cn } from '@/lib/utils';

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getWeekBounds(offset = 0): { from: string; until: string; label: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    from:  monday.toISOString(),
    until: sunday.toISOString(),
    label: offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `${fmt(monday)} – ${fmt(sunday)}`,
  };
}

export default function TimesheetPage() {
  const [weekOffset,  setWeekOffset]  = useState(0);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  const bounds = getWeekBounds(weekOffset);
  const { data, isLoading } = useTimesheet({ from: bounds.from, until: bounds.until });

  const rows = data?.data ?? [];
  const grandTotal    = rows.reduce((s, r) => s + r.total_minutes, 0);
  const billableTotal = rows.reduce((s, r) => s + r.billable_minutes, 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Timesheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">Work logged on tickets</p>
        </div>
        <a href="/tickets" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Tickets
        </a>
      </div>

      {/* Week picker */}
      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
        >
          ←
        </button>
        <span className="min-w-[120px] text-center text-sm font-medium text-foreground">{bounds.label}</span>
        <button
          onClick={() => setWeekOffset((w) => Math.min(w + 1, 0))}
          disabled={weekOffset === 0}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          →
        </button>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="ml-2 text-xs text-brand hover:underline"
          >
            This week
          </button>
        )}
      </div>

      {/* Summary bar */}
      {!isLoading && rows.length > 0 && (
        <div className="mb-4 flex items-center gap-6 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">{formatMinutes(grandTotal)}</span>
            <span className="text-xs text-muted-foreground">total</span>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-semibold text-foreground">{formatMinutes(billableTotal)}</span>
            <span className="text-xs text-muted-foreground">billable</span>
          </div>
          {grandTotal > 0 && (
            <div className="ml-auto text-xs text-muted-foreground">
              {Math.round((billableTotal / grandTotal) * 100)}% billable
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No time logged this week.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isExpanded = expandedUid === row.user.id;
            const pct = row.total_minutes > 0 ? Math.round((row.billable_minutes / row.total_minutes) * 100) : 0;
            return (
              <div key={row.user.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  onClick={() => setExpandedUid(isExpanded ? null : row.user.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <UserAvatar name={row.user.name || row.user.email} imageUrl={row.user.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{row.user.name || row.user.email}</p>
                    <p className="text-xs text-muted-foreground">{row.entries.length} log{row.entries.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">{formatMinutes(row.total_minutes)}</p>
                      <p className="text-[10px] text-muted-foreground">{formatMinutes(row.billable_minutes)} billable</p>
                    </div>
                    {/* Mini progress bar */}
                    <div className="w-16">
                      <div className="mb-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[9px] text-muted-foreground text-right">{pct}%</p>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ticket</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Description</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                          <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Duration</th>
                          <th className="px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Billable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.entries.map((entry: any) => (
                          <tr key={entry.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-2.5">
                              {entry.entity_id ? (
                                <a href={`/tickets/${entry.entity_id}`} className="font-mono text-xs text-primary hover:underline">
                                  {entry.entity_id.slice(-8)}
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[240px] truncate">
                              {entry.description || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {entry.logged_at ? new Date(entry.logged_at).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs font-medium text-foreground">
                              {formatMinutes(entry.duration_minutes)}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={cn(
                                'inline-block h-2 w-2 rounded-full',
                                entry.billable ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                              )} title={entry.billable ? 'Billable' : 'Non-billable'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
