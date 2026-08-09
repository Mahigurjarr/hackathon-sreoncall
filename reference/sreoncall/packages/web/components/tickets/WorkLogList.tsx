'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Clock, CheckCircle, XCircle, Loader2, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import {
  useEditWorkLog,
  useApproveWorkLog,
  useRejectWorkLog,
  useBulkApproveWorkLogs,
  useRemoveWorkLog,
  type WorkLog,
} from '@/lib/hooks/useTickets';

interface WorkLogListProps {
  ticketId: string;
  logs: WorkLog[];
  totalMinutes: number;
  canApprove?: boolean;
}

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  pending:  { bg: '#FEFCE8', text: '#A16207', label: 'Pending' },
  approved: { bg: '#F0FDF4', text: '#16A34A', label: 'Approved' },
  rejected: { bg: '#FEF2F2', text: '#DC2626', label: 'Rejected' },
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function parseDurationToMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const compound = /^(\d+)\s*h\s*(\d+)\s*m$/.exec(s);
  const hours    = /^(\d+(?:\.\d+)?)\s*h$/.exec(s);
  const mins     = /^(\d+)\s*m$/.exec(s);
  const num      = /^(\d+)$/.exec(s);
  if (compound) return parseInt(compound[1], 10) * 60 + parseInt(compound[2], 10);
  if (hours)    return Math.round(parseFloat(hours[1]) * 60);
  if (mins)     return parseInt(mins[1], 10);
  if (num)      return parseInt(num[1], 10);
  return null;
}

function EditWorkLogRow({ log, ticketId, onDone }: { log: WorkLog; ticketId: string; onDone: () => void }) {
  const editWorkLog = useEditWorkLog();
  const [duration, setDuration] = useState(formatDuration(log.minutes));
  const [description, setDescription] = useState(log.description || '');
  const [loggedAt, setLoggedAt] = useState(log.logged_at.slice(0, 10));

  async function handleSave() {
    const minutes = parseDurationToMinutes(duration);
    if (!minutes || minutes <= 0) { toast.error('Invalid duration. Use: 2h, 30m, 1h30m'); return; }
    try {
      await editWorkLog.mutateAsync({
        ticketId,
        logId: log.id,
        duration_minutes: minutes,
        description,
        logged_at: new Date(loggedAt).toISOString(),
      });
      toast.success('Work log updated');
      onDone();
    } catch {
      toast.error('Failed to update work log');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-background px-3 py-2">
      <Input value={duration} onChange={(e) => setDuration(e.target.value)} className="w-24 h-7 text-xs" placeholder="2h, 30m" />
      <input type="date" value={loggedAt} onChange={(e) => setLoggedAt(e.target.value)} className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} className="flex-1 h-7 text-xs min-w-[120px]" placeholder="Description" />
      <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={editWorkLog.isPending}>
        {editWorkLog.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
    </div>
  );
}

function RejectRow({ log, ticketId, onDone }: { log: WorkLog; ticketId: string; onDone: () => void }) {
  const rejectWorkLog = useRejectWorkLog();
  const [reason, setReason] = useState('');

  async function handleReject() {
    try {
      await rejectWorkLog.mutateAsync({ logId: log.id, ticketId, reason: reason.trim() || undefined });
      toast.success('Work log rejected');
      onDone();
    } catch {
      toast.error('Failed to reject work log');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <Input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="flex-1 h-7 text-xs min-w-[160px]"
        placeholder="Rejection reason (optional)"
        onKeyDown={(e) => { if (e.key === 'Enter') handleReject(); if (e.key === 'Escape') onDone(); }}
      />
      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleReject} disabled={rejectWorkLog.isPending}>
        {rejectWorkLog.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm Reject'}
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
    </div>
  );
}

const logSchema = z.object({
  duration:    z.string().min(1, 'Duration is required'),
  description: z.string().max(5000).optional(),
});
type LogFormData = z.infer<typeof logSchema>;

export function WorkLogList({ ticketId, logs, totalMinutes, canApprove = false }: WorkLogListProps) {
  const [showForm, setShowForm]       = useState(false);
  const [isBillable, setIsBillable]   = useState(true);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const approveWorkLog    = useApproveWorkLog();
  const bulkApprove       = useBulkApproveWorkLogs();
  const removeWorkLog     = useRemoveWorkLog();

  const pendingLogs = logs.filter((l) => (l.status ?? 'pending') === 'pending');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LogFormData>({ resolver: zodResolver(logSchema) });

  async function onSubmit(data: LogFormData) {
    const raw = data.duration.trim().toLowerCase();
    let minutes = 0;
    const hourMatch     = /^(\d+(?:\.\d+)?)\s*h$/.exec(raw);
    const minMatch      = /^(\d+)\s*m$/.exec(raw);
    const compoundMatch = /^(\d+)\s*h\s*(\d+)\s*m$/.exec(raw);
    const numMatch      = /^(\d+)$/.exec(raw);

    if (compoundMatch)     minutes = parseInt(compoundMatch[1], 10) * 60 + parseInt(compoundMatch[2], 10);
    else if (hourMatch)    minutes = Math.round(parseFloat(hourMatch[1]) * 60);
    else if (minMatch)     minutes = parseInt(minMatch[1], 10);
    else if (numMatch)     minutes = parseInt(numMatch[1], 10);
    else { toast.error('Invalid duration format. Use: 30m, 2h, 1h30m'); return; }

    if (minutes <= 0) { toast.error('Duration must be greater than zero.'); return; }

    try {
      await api.post(`/api/v1/tickets/${ticketId}/work-logs`, {
        duration_minutes: minutes,
        description: data.description || '',
        billable: isBillable,
      });
      toast.success('Work log added');
      reset();
      setIsBillable(true);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['work-logs'] });
    } catch {
      toast.error('Failed to add work log');
    }
  }

  async function handleApprove(logId: string) {
    try {
      await approveWorkLog.mutateAsync({ logId, ticketId });
      toast.success('Work log approved');
    } catch {
      toast.error('Failed to approve work log');
    }
  }

  async function handleBulkApprove() {
    const ids = pendingLogs
      .filter((l) => selected.size === 0 || selected.has(l.id))
      .map((l) => l.id);
    if (ids.length === 0) return;
    try {
      const result = await bulkApprove.mutateAsync({ ids, ticketId });
      toast.success(`${result.approved_count} work log${result.approved_count !== 1 ? 's' : ''} approved`);
      setSelected(new Set());
    } catch {
      toast.error('Failed to bulk approve');
    }
  }

  async function handleDelete(logId: string) {
    try {
      await removeWorkLog.mutateAsync({ ticketId, logId });
      toast.success('Work log removed');
    } catch {
      toast.error('Failed to remove work log');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const pendingCount = pendingLogs.length;
  const selectedPendingCount = pendingLogs.filter((l) => selected.has(l.id)).length;
  const bulkTarget = selected.size > 0 ? selectedPendingCount : pendingCount;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Work Logs
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({formatDuration(totalMinutes)} total)
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {canApprove && pendingCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-green-500/40 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
              onClick={handleBulkApprove}
              disabled={bulkApprove.isPending}
            >
              {bulkApprove.isPending ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="mr-1.5 h-3 w-3" />
              )}
              Approve {bulkTarget > 0 ? `(${bulkTarget})` : 'All'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Log Time'}
          </Button>
        </div>
      </div>

      {/* Bulk select bar — only shown when canApprove and pending logs exist */}
      {canApprove && pendingCount > 1 && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5">
          <input
            type="checkbox"
            className="accent-brand h-3.5 w-3.5"
            checked={selected.size === pendingCount}
            onChange={(e) =>
              setSelected(e.target.checked ? new Set(pendingLogs.map((l) => l.id)) : new Set())
            }
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : `Select pending to batch approve`}
          </span>
        </div>
      )}

      {/* Add time form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="flex items-start gap-2 rounded-md border border-input bg-background p-3">
          <div className="flex-shrink-0">
            <Input placeholder="e.g. 2h, 30m" className="w-28" {...register('duration')} />
            {errors.duration && (
              <p className="mt-1 text-xs text-destructive">{errors.duration.message}</p>
            )}
          </div>
          <textarea
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[36px]"
            placeholder="Description (optional)"
            rows={1}
            {...register('description')}
          />
          <div className="flex flex-col items-end gap-1.5">
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={isBillable}
                onChange={(e) => setIsBillable(e.target.checked)}
                className="accent-brand h-3 w-3"
              />
              Billable
            </label>
          </div>
        </form>
      )}

      {/* Log entries */}
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No work logged yet.</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const logStatus = log.status ?? 'pending';
            const statusStyle = statusColors[logStatus] ?? statusColors.pending;
            const isPending = logStatus === 'pending';

            if (editingId === log.id) {
              return <EditWorkLogRow key={log.id} log={log} ticketId={ticketId} onDone={() => setEditingId(null)} />;
            }
            if (rejectingId === log.id) {
              return <RejectRow key={log.id} log={log} ticketId={ticketId} onDone={() => setRejectingId(null)} />;
            }

            return (
              <div
                key={log.id}
                className={cn(
                  'flex items-start gap-3 rounded-md border border-input bg-background px-3 py-2.5 group',
                  isPending && canApprove && selected.has(log.id) && 'border-brand/40 bg-brand/5',
                )}
              >
                {/* Checkbox for pending logs when canApprove */}
                {canApprove && isPending && pendingCount > 1 && (
                  <input
                    type="checkbox"
                    className="accent-brand mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    checked={selected.has(log.id)}
                    onChange={() => toggleSelect(log.id)}
                  />
                )}

                <Clock className="mt-0.5 h-4 w-4 text-muted-foreground flex-shrink-0" />

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {formatDuration(log.minutes)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      by {log.user?.name || log.source_user_name || 'Unknown'}
                      {log.source === 'provider' && (
                        <span className="ml-1 text-[10px] text-muted-foreground/60">(provider)</span>
                      )}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
                    >
                      {logStatus === 'approved' && <CheckCircle className="mr-1 h-3 w-3" />}
                      {logStatus === 'rejected' && <XCircle className="mr-1 h-3 w-3" />}
                      {statusStyle.label}
                    </span>
                    {log.billable === false && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        Non-billable
                      </span>
                    )}
                  </div>

                  {log.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">{log.description}</p>
                  )}
                  {log.rejection_reason && (
                    <p className="mt-0.5 text-xs text-destructive">Reason: {log.rejection_reason}</p>
                  )}
                  {logStatus === 'approved' && log.approved_by && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      Approved{log.approved_at ? ` ${new Date(log.approved_at).toLocaleDateString()}` : ''}
                    </p>
                  )}
                </div>

                <span className="text-xs text-muted-foreground flex-shrink-0 mt-0.5">
                  {new Date(log.logged_at).toLocaleDateString()}
                </span>

                {/* Per-row actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {/* Approve button — only for pending logs when canApprove */}
                  {canApprove && isPending && (
                    <button
                      onClick={() => handleApprove(log.id)}
                      disabled={approveWorkLog.isPending}
                      className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950 disabled:opacity-50"
                      title="Approve"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* Reject button — only for pending logs when canApprove */}
                  {canApprove && isPending && (
                    <button
                      onClick={() => setRejectingId(log.id)}
                      className="rounded p-1 text-destructive hover:bg-destructive/10"
                      title="Reject"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* Edit button */}
                  <button
                    onClick={() => setEditingId(log.id)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(log.id)}
                    disabled={removeWorkLog.isPending}
                    className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
