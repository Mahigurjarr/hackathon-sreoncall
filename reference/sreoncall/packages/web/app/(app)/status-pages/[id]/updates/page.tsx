'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useStatusPage,
  useStatusUpdates,
  useCreateStatusUpdate,
  useUpdateStatusUpdate,
  useDeleteStatusUpdate,
  type StatusUpdateItem,
  type CreateStatusUpdateInput,
} from '@/lib/hooks/useStatusPages';

const statusOptions = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'informational', label: 'Informational' },
];

const statusDotColor: Record<string, string> = {
  investigating: 'bg-rose-500',
  identified: 'bg-yellow-500',
  monitoring: 'bg-blue-500',
  resolved: 'bg-emerald-500',
  informational: 'bg-cyan-500',
};

const statusDotShadow: Record<string, string> = {
  investigating: 'shadow-[0_0_0_3px_rgba(244,63,94,0.2)]',
  identified: 'shadow-[0_0_0_3px_rgba(234,179,8,0.2)]',
  monitoring: 'shadow-[0_0_0_3px_rgba(59,130,246,0.2)]',
  resolved: 'shadow-[0_0_0_3px_rgba(16,185,129,0.2)]',
  informational: 'shadow-[0_0_0_3px_rgba(6,182,212,0.2)]',
};

const statusBadgeStyles: Record<string, string> = {
  investigating: 'bg-rose-500/10 text-rose-500 border border-rose-500/20',
  identified: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20',
  monitoring: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  informational: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
};

const statusFilterStyles: Record<string, { active: string; inactive: string }> = {
  investigating: {
    active: 'border-rose-500/25 bg-rose-500/10 text-rose-500',
    inactive: 'border-border text-muted-foreground hover:border-rose-500/15 hover:text-rose-400',
  },
  identified: {
    active: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-500',
    inactive: 'border-border text-muted-foreground hover:border-yellow-500/15 hover:text-yellow-400',
  },
  monitoring: {
    active: 'border-blue-500/25 bg-blue-500/10 text-blue-500',
    inactive: 'border-border text-muted-foreground hover:border-blue-500/15 hover:text-blue-400',
  },
  resolved: {
    active: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
    inactive: 'border-border text-muted-foreground hover:border-emerald-500/15 hover:text-emerald-400',
  },
  informational: {
    active: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-500',
    inactive: 'border-border text-muted-foreground hover:border-cyan-500/15 hover:text-cyan-400',
  },
};

const statusButtonStyles: Record<string, { active: string; inactive: string }> = {
  investigating: {
    active: 'border-rose-500/40 bg-rose-500/15 text-rose-500 ring-1 ring-rose-500/20',
    inactive: 'border-border text-muted-foreground hover:border-rose-500/25 hover:text-rose-400',
  },
  identified: {
    active: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-500 ring-1 ring-yellow-500/20',
    inactive: 'border-border text-muted-foreground hover:border-yellow-500/25 hover:text-yellow-400',
  },
  monitoring: {
    active: 'border-blue-500/40 bg-blue-500/15 text-blue-500 ring-1 ring-blue-500/20',
    inactive: 'border-border text-muted-foreground hover:border-blue-500/25 hover:text-blue-400',
  },
  resolved: {
    active: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/20',
    inactive: 'border-border text-muted-foreground hover:border-emerald-500/25 hover:text-emerald-400',
  },
  informational: {
    active: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-500 ring-1 ring-cyan-500/20',
    inactive: 'border-border text-muted-foreground hover:border-cyan-500/25 hover:text-cyan-400',
  },
};

function UpdateDialog({
  open,
  onClose,
  pageId,
  components,
  update,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string;
  components: Array<{ id?: string; name: string; status: string }>;
  update?: StatusUpdateItem | null;
}) {
  const isEdit = !!update;
  const createUpdate = useCreateStatusUpdate(pageId);
  const editUpdate = useUpdateStatusUpdate(pageId);

  const [title, setTitle] = useState(update?.title ?? '');
  const [body, setBody] = useState(update?.body ?? '');
  const [status, setStatus] = useState<'investigating' | 'identified' | 'monitoring' | 'resolved' | 'informational'>(update?.status ?? 'investigating');
  const [visibility, setVisibility] = useState<'public' | 'internal'>(update?.visibility ?? 'public');
  const [selectedComponents, setSelectedComponents] = useState<string[]>(
    update?.affected_components?.map((c) => c.component_id || '') ?? []
  );
  const [notifySubscribers, setNotifySubscribers] = useState(false);

  const [lastUpdate, setLastUpdate] = useState(update);
  if (update !== lastUpdate) {
    setLastUpdate(update);
    setTitle(update?.title ?? '');
    setBody(update?.body ?? '');
    setStatus((update?.status ?? 'investigating') as typeof status);
    setVisibility((update?.visibility ?? 'public') as typeof visibility);
    setSelectedComponents(update?.affected_components?.map((c) => c.component_id || '') ?? []);
    setNotifySubscribers(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    const affected_components = selectedComponents
      .filter(Boolean)
      .map((cid) => {
        const comp = components.find((c) => c.id === cid);
        return {
          component_id: cid,
          name: comp?.name || '',
          status_before: comp?.status || '',
          status_after: comp?.status || '',
        };
      });

    const input: CreateStatusUpdateInput = {
      title: title.trim(),
      body: body.trim(),
      status,
      visibility,
      affected_components,
      notify_subscribers: notifySubscribers,
    };

    try {
      if (isEdit && update) {
        await editUpdate.mutateAsync({ updateId: update.id, input });
        toast.success('Update edited');
      } else {
        await createUpdate.mutateAsync(input);
        toast.success('Update posted');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save update');
    }
  }

  const isPending = createUpdate.isPending || editUpdate.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Update' : 'Post Status Update'}</DialogTitle>
          {!isEdit && <p className="text-[11.5px] text-muted-foreground">Publish a new status update to this page</p>}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          {/* Status - colored button row */}
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {statusOptions.map((opt) => {
                const isActive = status === opt.value;
                const styles = statusButtonStyles[opt.value];
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value as typeof status)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all ${
                      isActive ? styles.active : styles.inactive
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor[opt.value]}`} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title + Visibility side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Title</label>
              <Input
                placeholder="e.g., Investigating elevated errors"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Visibility</label>
              <div className="flex gap-2 mt-0.5">
                <button
                  type="button"
                  onClick={() => setVisibility('public')}
                  className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                    visibility === 'public'
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border hover:border-border/80'
                  }`}
                >
                  <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                    visibility === 'public' ? 'border-primary' : 'border-muted-foreground/30'
                  }`}>
                    {visibility === 'public' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                  <span className="text-[12px] font-medium">Public</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('internal')}
                  className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                    visibility === 'internal'
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border hover:border-border/80'
                  }`}
                >
                  <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                    visibility === 'internal' ? 'border-primary' : 'border-muted-foreground/30'
                  }`}>
                    {visibility === 'internal' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                  <span className="text-[12px] font-medium">Internal</span>
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
              Body <span className="font-normal normal-case text-muted-foreground/60 tracking-normal">(Markdown supported)</span>
            </label>
            <textarea
              className="flex min-h-[100px] w-full rounded-lg border border-border bg-background px-4 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12 resize-y leading-relaxed"
              placeholder="Describe the issue, affected users, and current actions being taken..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {/* Affected Components - checkbox rows with status */}
          {components.length > 0 && (
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Affected Components</label>
              <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg border border-border">
                {components.map((comp) => {
                  const isSelected = selectedComponents.includes(comp.id || '');
                  return (
                    <label
                      key={comp.id}
                      className={`flex items-center justify-between gap-2 cursor-pointer px-3 py-2 transition-colors ${
                        isSelected ? 'bg-muted/40' : 'hover:bg-muted/20'
                      } ${comp.id !== components[components.length - 1]?.id ? 'border-b border-border' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedComponents((prev) => [...prev, comp.id || '']);
                            } else {
                              setSelectedComponents((prev) => prev.filter((id) => id !== comp.id));
                            }
                          }}
                          className="h-3.5 w-3.5 rounded border-input accent-primary"
                        />
                        <span className="text-[13px] font-medium text-foreground">{comp.name}</span>
                      </div>
                      {comp.status && (
                        <span className="text-[10px] font-mono text-muted-foreground capitalize">{comp.status}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notify Subscribers - orange highlight row */}
          {!isEdit && (
            <div className="rounded-[10px] border border-orange-500/25 bg-orange-500/5 p-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setNotifySubscribers(!notifySubscribers)}
                className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full transition-colors ${
                  notifySubscribers ? 'bg-orange-500' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-[3px] ml-[3px] ${
                    notifySubscribers ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <p className="text-[13.5px] font-semibold text-foreground">Notify Subscribers</p>
                <p className="text-[11px] text-muted-foreground">Send email alert to confirmed subscribers</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Post Update'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StatusPageUpdates() {
  const { id } = useParams();
  const pageId = id as string;
  const { data: page } = useStatusPage(pageId);
  const { data: updatesData, isLoading } = useStatusUpdates(pageId);
  const deleteUpdate = useDeleteStatusUpdate(pageId);

  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<StatusUpdateItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const updates = updatesData?.data ?? [];
  const components = page?.components ?? [];

  const filteredUpdates = statusFilter === 'all'
    ? updates
    : updates.filter((u) => u.status === statusFilter);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteUpdate.mutateAsync(deleteId);
      toast.success('Update deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Status Updates</h2>
          <p className="text-[11.5px] text-muted-foreground">Timeline of all updates posted to this page</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Post Update
        </Button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setStatusFilter('all')}
          className={`inline-flex items-center rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-all ${
            statusFilter === 'all'
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          All
          <span className="ml-1.5 font-mono text-[10px] opacity-60">{updates.length}</span>
        </button>
        {statusOptions.map((opt) => {
          const isActive = statusFilter === opt.value;
          const styles = statusFilterStyles[opt.value];
          const count = updates.filter((u) => u.status === opt.value).length;
          return (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(isActive ? 'all' : opt.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-all ${
                isActive ? styles.active : styles.inactive
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor[opt.value]}`} />
              {opt.label}
              {count > 0 && <span className="font-mono text-[10px] opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredUpdates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {statusFilter !== 'all' ? 'No updates match this filter.' : 'No updates posted yet.'}
            </p>
            {statusFilter === 'all' && (
              <Button className="mt-4" variant="outline" onClick={() => setShowCreate(true)}>
                Post your first update
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Activity Feed Timeline */
        <div className="relative pl-8">
          {/* Vertical stem line */}
          <div className="absolute left-[9px] top-3 bottom-0 w-[2px] bg-gradient-to-b from-border via-border to-transparent" />

          <div className="space-y-4">
            {filteredUpdates.map((update, idx) => (
              <div key={update.id} className="relative">
                {/* Timeline dot */}
                <div
                  className={`absolute -left-[23px] top-5 h-3 w-3 rounded-full ${
                    statusDotColor[update.status] || 'bg-muted-foreground'
                  } ${statusDotShadow[update.status] || ''}`}
                />

                {/* Update card */}
                <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-border/80">
                  {/* Header: pills + timestamp + actions */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {/* Status pill */}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                          statusBadgeStyles[update.status] || 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor[update.status] || 'bg-muted-foreground'}`} />
                        {update.status.charAt(0).toUpperCase() + update.status.slice(1)}
                      </span>
                      {/* Visibility pill */}
                      {update.visibility === 'public' ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                          Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground border border-border">
                          Internal
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10.5px] text-muted-foreground mr-1">
                        {new Date(update.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <button
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        onClick={() => setEditItem(update)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        onClick={() => setDeleteId(update.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-[14px] font-bold text-foreground leading-snug">{update.title}</h3>

                  {/* Body */}
                  {update.body && (
                    <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {update.body}
                    </p>
                  )}

                  {/* Affected components chips */}
                  {update.affected_components?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex flex-wrap gap-1.5">
                        {update.affected_components.map((c, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-md bg-muted/60 border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {c.name}
                            {c.status_before && c.status_after && c.status_before !== c.status_after && (
                              <>
                                <span className="text-yellow-400">{c.status_before}</span>
                                <span>&rarr;</span>
                                <span className="text-emerald-400">{c.status_after}</span>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notified indicator */}
                  {update.notify_subscribers && (
                    <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Bell className="h-3 w-3" /> Subscribers notified
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <UpdateDialog
        open={showCreate || !!editItem}
        onClose={() => {
          setShowCreate(false);
          setEditItem(null);
        }}
        pageId={pageId}
        components={components}
        update={editItem}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Update"
        description="Are you sure you want to delete this status update? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
