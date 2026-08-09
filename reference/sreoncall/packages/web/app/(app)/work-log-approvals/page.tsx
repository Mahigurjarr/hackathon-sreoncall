'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, ExternalLink, TicketCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  useWorkLogs,
  useApproveWorkLog,
  useRejectWorkLog,
  useBulkApproveWorkLogs,
  type WorkLogEntry,
} from '@/lib/hooks/useTickets';

type TabStatus = 'pending' | 'approved' | 'rejected' | '';

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: '#FEFCE8', text: '#A16207', label: 'Pending' },
  approved: { bg: '#F0FDF4', text: '#16A34A', label: 'Approved' },
  rejected: { bg: '#FEF2F2', text: '#DC2626', label: 'Rejected' },
};

const priorityColors: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  medium: 'text-yellow-600',
  low: 'text-blue-600',
};

const ticketStatusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
  waiting_on_customer: 'bg-yellow-100 text-yellow-700',
  waiting_on_vendor: 'bg-orange-100 text-orange-700',
};

export default function WorkLogApprovalsPage() {
  const [tab, setTab] = useState<TabStatus>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const bulkApprove = useBulkApproveWorkLogs();

  const { data, isLoading } = useWorkLogs(tab ? { status: tab } : {});
  const approveLog = useApproveWorkLog();
  const rejectLog = useRejectWorkLog();

  const logs = data?.data || [];
  const totalMinutes = data?.total_minutes || 0;

  async function handleApprove(log: WorkLogEntry) {
    try {
      await approveLog.mutateAsync({ logId: log.id, ticketId: log.entity_id });
      toast.success('Work log approved');
    } catch {
      toast.error('Failed to approve work log');
    }
  }

  async function handleReject(log: WorkLogEntry) {
    try {
      await rejectLog.mutateAsync({ logId: log.id, ticketId: log.entity_id, reason: rejectReason });
      toast.success('Work log rejected');
      setRejectingId(null);
      setRejectReason('');
    } catch {
      toast.error('Failed to reject work log');
    }
  }

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map((l) => l.id)));
    }
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return;
    try {
      const result = await bulkApprove.mutateAsync({ ids: Array.from(selectedIds) });
      toast.success(`${result.approved_count} work log(s) approved`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Failed to bulk approve');
    }
  }

  const tabs: { label: string; value: TabStatus }[] = [
    { label: 'Pending', value: 'pending' },
    { label: 'Approved', value: 'approved' },
    { label: 'Rejected', value: 'rejected' },
    { label: 'All', value: '' },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Work Log Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and approve or reject work logs for billing.
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      {tab === 'approved' && totalMinutes > 0 && (
        <div className="mb-4 rounded-md border border-input bg-background p-3">
          <span className="text-sm font-medium text-foreground">
            Total billable hours: {formatDuration(totalMinutes)}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No work logs found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-input">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {tab === 'pending' && (
                  <th className="w-10 px-2 py-3">
                    <input
                      type="checkbox"
                      checked={logs.length > 0 && selectedIds.size === logs.length}
                      onChange={toggleAll}
                      className="rounded border-border"
                    />
                  </th>
                )}
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ticket</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Duration</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                {tab === 'pending' && (
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-input">
              {logs.map((log) => {
                const badge = statusBadge[log.status] || statusBadge.pending;
                const isExpanded = expandedId === log.id;
                return (
                  <>
                    <tr
                      key={log.id}
                      className="bg-background cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      {tab === 'pending' && (
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(log.id)}
                            onChange={() => toggleId(log.id)}
                            className="rounded border-border"
                          />
                        </td>
                      )}
                      <td className="px-2 py-3 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-4 py-3">
                        {log.ticket ? (
                          <span className="font-medium text-foreground">
                            TKT-{String(log.ticket.number).padStart(4, '0')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {log.source === 'provider' && log.source_user_name
                          ? log.source_user_name
                          : (log.user?.name || 'Unknown')}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {formatDuration(log.duration_minutes)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[250px] truncate">
                        {log.description || '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(log.logged_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: badge.bg, color: badge.text }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      {tab === 'pending' && (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {rejectingId === log.id ? (
                            <div className="flex items-center gap-2 justify-end">
                              <Input
                                placeholder="Reason (optional)"
                                className="w-40 text-xs"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                              />
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleReject(log)}
                                disabled={rejectLog.isPending}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setRejectingId(null); setRejectReason(''); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleApprove(log)}
                                disabled={approveLog.isPending}
                              >
                                <CheckCircle className="mr-1 h-3 w-3" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRejectingId(log.id)}
                              >
                                <XCircle className="mr-1 h-3 w-3" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {isExpanded && (
                      <tr key={`${log.id}-detail`} className="bg-muted/20">
                        <td colSpan={tab === 'pending' ? 9 : 7} className="px-6 py-4">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {/* Ticket Details */}
                            {log.ticket ? (
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <TicketCheck className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ticket Details</span>
                                </div>
                                <div className="rounded-lg border border-input bg-background p-4 space-y-2">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <p className="font-medium text-foreground">{log.ticket.title}</p>
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        TKT-{String(log.ticket.number).padStart(4, '0')} / {log.ticket.type}
                                      </p>
                                    </div>
                                    <Link
                                      href={`/tickets/${log.ticket.id}`}
                                      className="text-primary hover:underline text-xs flex items-center gap-1 shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      View Ticket <ExternalLink className="h-3 w-3" />
                                    </Link>
                                  </div>
                                  <div className="flex items-center gap-2 mt-2">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ticketStatusColors[log.ticket.status] || 'bg-gray-100 text-gray-600'}`}>
                                      {log.ticket.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                    </span>
                                    <span className={`text-xs font-medium capitalize ${priorityColors[log.ticket.priority] || 'text-muted-foreground'}`}>
                                      {log.ticket.priority} priority
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <TicketCheck className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ticket Details</span>
                                </div>
                                <p className="text-sm text-muted-foreground">No ticket linked</p>
                              </div>
                            )}

                            {/* Work Log Details */}
                            <div className="space-y-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work Log Details</span>
                              <div className="rounded-lg border border-input bg-background p-4 space-y-2">
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                  <div>
                                    <p className="text-xs text-muted-foreground">Duration</p>
                                    <p className="font-medium text-foreground">{formatDuration(log.duration_minutes)}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-muted-foreground">Logged At</p>
                                    <p className="font-medium text-foreground">{new Date(log.logged_at).toLocaleString()}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-muted-foreground">Source</p>
                                    <p className="font-medium text-foreground capitalize">{log.source || 'internal'}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-muted-foreground">User</p>
                                    <p className="font-medium text-foreground">
                                      {log.source === 'provider' && log.source_user_name ? log.source_user_name : (log.user?.name || 'Unknown')}
                                    </p>
                                  </div>
                                </div>
                                {log.description && (
                                  <div className="pt-2 border-t border-input">
                                    <p className="text-xs text-muted-foreground mb-1">Description</p>
                                    <p className="text-sm text-foreground whitespace-pre-wrap">{log.description}</p>
                                  </div>
                                )}
                                {log.rejection_reason && (
                                  <div className="pt-2 border-t border-input">
                                    <p className="text-xs text-destructive mb-1">Rejection Reason</p>
                                    <p className="text-sm text-destructive">{log.rejection_reason}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk approve floating bar */}
      {tab === 'pending' && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-lg border border-input bg-background px-6 py-3 shadow-lg">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            onClick={handleBulkApprove}
            disabled={bulkApprove.isPending}
          >
            {bulkApprove.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-1.5 h-4 w-4" />
            )}
            Approve All
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
