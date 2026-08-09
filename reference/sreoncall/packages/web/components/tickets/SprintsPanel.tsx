'use client';

import { useState } from 'react';
import { Plus, ChevronDown, ChevronUp, MoreHorizontal, Pencil, Trash2, Play, CheckCircle } from 'lucide-react';
import {
  useSprints,
  useSprintProgress,
  useSprintTickets,
  useCreateSprint,
  useUpdateSprint,
  useDeleteSprint,
  useRemoveTicketsFromSprint,
  useCompleteSprint,
  type Sprint,
  type CreateSprintInput,
} from '@/lib/hooks/useSprints';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STATUS_ORDER: Record<string, number> = { active: 0, planning: 1, completed: 2 };
const STATUS_LABELS: Record<string, string> = { active: 'Active', planning: 'Planning', completed: 'Completed' };
const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400',
  planning: 'text-yellow-400',
  completed: 'text-muted-foreground',
};

function CreateSprintModal({
  open,
  onClose,
  editingSprint,
}: {
  open: boolean;
  onClose: () => void;
  editingSprint?: Sprint | null;
}) {
  const createSprint = useCreateSprint();
  const updateSprint = useUpdateSprint();
  const [form, setForm] = useState<CreateSprintInput>({
    name:       editingSprint?.name       ?? '',
    goal:       (editingSprint as any)?.goal ?? '',
    start_date: editingSprint?.start_date?.slice(0, 10) ?? '',
    end_date:   editingSprint?.end_date?.slice(0, 10)   ?? '',
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      if (editingSprint) {
        await updateSprint.mutateAsync({ id: editingSprint.id, input: form });
        toast.success('Sprint updated');
      } else {
        await createSprint.mutateAsync(form);
        toast.success('Sprint created');
      }
      onClose();
    } catch {
      toast.error(editingSprint ? 'Failed to update sprint' : 'Failed to create sprint');
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingSprint ? 'Edit Sprint' : 'Create Sprint'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Sprint Name <span className="text-destructive">*</span>
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sprint 3 — June 2–13"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Goal</label>
            <textarea
              value={form.goal ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
              placeholder="What should this sprint achieve?"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Start Date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                End Date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createSprint.isPending || updateSprint.isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60 transition-colors"
            >
              {editingSprint ? 'Save Changes' : 'Create Sprint'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SprintTicketList({ sprintId }: { sprintId: string }) {
  const { data, isLoading } = useSprintTickets(sprintId);
  const removeTickets = useRemoveTicketsFromSprint();

  async function handleRemove(ticketId: string) {
    try {
      await removeTickets.mutateAsync({ sprintId, ticketIds: [ticketId] });
      toast.success('Ticket removed from sprint');
    } catch {
      toast.error('Failed to remove ticket');
    }
  }

  const tickets = data?.data ?? [];

  if (isLoading) {
    return <div className="px-4 pb-4 text-xs text-muted-foreground">Loading tickets...</div>;
  }
  if (tickets.length === 0) {
    return (
      <div className="border-t border-border px-4 py-4 text-center text-sm text-muted-foreground">
        No tickets yet. Add tickets from the <span className="font-medium text-foreground">Backlog</span> tab.
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      <table className="w-full text-sm">
        <tbody>
          {tickets.map((ticket: any) => {
            const id = ticket._id?.toString() ?? ticket.id;
            return (
              <tr key={id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-foreground">{ticket.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">#{ticket.number}</span>
                </td>
                <td className="px-3 py-2.5 text-xs capitalize text-muted-foreground">
                  {ticket.status?.replace(/_/g, ' ')}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {ticket.assignee_id?.name ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => handleRemove(id)}
                    className="text-xs text-muted-foreground hover:text-red-400"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SprintCard({ sprint }: { sprint: Sprint }) {
  const [expanded,          setExpanded]          = useState(false);
  const [menuOpen,           setMenuOpen]          = useState(false);
  const [editing,            setEditing]           = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [carryOverTo,        setCarryOverTo]        = useState<'backlog' | string>('backlog');
  const { data: progress } = useSprintProgress(sprint.id);
  const { data: allSprints } = useSprints();
  const updateSprint  = useUpdateSprint();
  const completeSprint = useCompleteSprint();
  const deleteSprint  = useDeleteSprint();

  const otherActiveSprints = (allSprints?.data ?? []).filter(
    (s) => s.id !== sprint.id && (s.status === 'active' || s.status === 'planning'),
  );

  const incompleteCount = progress
    ? (progress.total_tickets - progress.completed_tickets)
    : 0;

  async function handleStart() {
    try {
      await updateSprint.mutateAsync({ id: sprint.id, input: { status: 'active' } });
      toast.success('Sprint started');
    } catch {
      toast.error('Failed to start sprint');
    }
  }

  async function handleComplete() {
    try {
      const result = await completeSprint.mutateAsync({ sprintId: sprint.id, carryOverTo });
      toast.success(
        result.carried_over > 0
          ? `Sprint completed · ${result.completed_tickets} done · ${result.carried_over} carried over`
          : `Sprint completed · ${result.completed_tickets} tickets done`,
      );
      setShowCompleteDialog(false);
    } catch {
      toast.error('Failed to complete sprint');
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete sprint "${sprint.name}"? Tickets will be moved to backlog.`)) return;
    try {
      await deleteSprint.mutateAsync(sprint.id);
      toast.success('Sprint deleted');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete sprint');
    }
  }

  const startDate = new Date(sprint.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDate = new Date(sprint.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <>
      {editing && (
        <CreateSprintModal open={editing} onClose={() => setEditing(false)} editingSprint={sprint} />
      )}

      {/* Complete Sprint dialog with carry-over */}
      <Dialog open={showCompleteDialog} onClose={() => setShowCompleteDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Sprint — {sprint.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            {incompleteCount > 0 ? (
              <>
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{incompleteCount} ticket{incompleteCount !== 1 ? 's' : ''}</span> didn't
                  finish this sprint. Where should they go?
                </p>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 hover:bg-muted/40 transition-colors">
                    <input
                      type="radio"
                      name="carry-over"
                      value="backlog"
                      checked={carryOverTo === 'backlog'}
                      onChange={() => setCarryOverTo('backlog')}
                      className="mt-0.5 accent-brand"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">Move to Backlog</p>
                      <p className="text-xs text-muted-foreground">Tickets will be unscheduled</p>
                    </div>
                  </label>
                  {otherActiveSprints.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 hover:bg-muted/40 transition-colors">
                      <input
                        type="radio"
                        name="carry-over"
                        value={s.id}
                        checked={carryOverTo === s.id}
                        onChange={() => setCarryOverTo(s.id)}
                        className="mt-0.5 accent-brand"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">Move to {s.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{s.status}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-foreground">
                All tickets are done. This sprint will be marked as completed.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowCompleteDialog(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleComplete}
                disabled={completeSprint.isPending}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60 transition-colors"
              >
                {completeSprint.isPending ? 'Completing…' : 'Complete Sprint'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => setExpanded((v) => !v)} className="flex-1 text-left">
            <div className="flex items-center gap-2">
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-semibold text-foreground">{sprint.name}</span>
              <span className={cn('text-xs font-medium', STATUS_COLORS[sprint.status])}>
                {STATUS_LABELS[sprint.status]}
              </span>
            </div>
            <div className="ml-6 mt-0.5 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{startDate} — {endDate}</span>
              {(sprint as any).goal && (
                <span className="text-xs text-muted-foreground/60 italic truncate max-w-[200px]">
                  · {(sprint as any).goal}
                </span>
              )}
            </div>
          </button>

          {progress && progress.total_tickets > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500"
                  style={{ width: `${progress.pct_complete}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {progress.completed_tickets}/{progress.total_tickets}
              </span>
            </div>
          )}

          {sprint.status === 'planning' && (
            <button
              onClick={handleStart}
              disabled={updateSprint.isPending}
              className="flex items-center gap-1 rounded-md bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-400 hover:bg-green-500/20 disabled:opacity-50"
            >
              <Play className="h-3 w-3" />
              Start
            </button>
          )}
          {sprint.status === 'active' && (
            <button
              onClick={() => setShowCompleteDialog(true)}
              className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted/80"
            >
              <CheckCircle className="h-3 w-3" />
              Complete
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg">
                <button
                  onClick={() => { setEditing(true); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                {sprint.status === 'planning' && (
                  <button
                    onClick={() => { handleDelete(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-muted"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {expanded && <SprintTicketList sprintId={sprint.id} />}
      </div>
    </>
  );
}

interface SprintsPanelProps {
  projectId?: string;
}

export function SprintsPanel({ projectId }: SprintsPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useSprints({ project_id: projectId });

  const sprints = [...(data?.data ?? [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Sprints</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Sprint
        </button>
      </div>

      <CreateSprintModal open={showCreate} onClose={() => setShowCreate(false)} editingSprint={null} />

      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading sprints...</div>
      )}

      {!isLoading && sprints.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No sprints yet. Create your first sprint to get started.
        </div>
      )}

      <div className="space-y-3">
        {sprints.map((sprint) => (
          <SprintCard key={sprint.id} sprint={sprint} />
        ))}
      </div>
    </div>
  );
}
