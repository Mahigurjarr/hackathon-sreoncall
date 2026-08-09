'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Loader2, Trash2, Mail, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useStatusPageSubscribers,
  useAddSubscriber,
  useRemoveSubscriber,
} from '@/lib/hooks/useStatusPages';

function AddSubscriberDialog({
  open,
  onClose,
  pageId,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string;
}) {
  const addSub = useAddSubscriber(pageId);
  const [emails, setEmails] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailList = emails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (emailList.length === 0) {
      toast.error('Enter at least one email address');
      return;
    }

    try {
      for (const email of emailList) {
        await addSub.mutateAsync(email);
      }
      toast.success(`Added ${emailList.length} subscriber${emailList.length > 1 ? 's' : ''}`);
      setEmails('');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add subscriber');
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle>Add Subscriber</DialogTitle>
          <p className="text-xs text-muted-foreground">Admin-added subscribers are auto-confirmed</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Email Address</label>
            <Input
              placeholder="user@example.com, team@example.com"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Comma-separated for bulk adding
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={addSub.isPending}>
              {addSub.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Subscriber
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StatusPageSubscribers() {
  const { id } = useParams();
  const pageId = id as string;
  const { data: subsData, isLoading } = useStatusPageSubscribers(pageId);
  const removeSub = useRemoveSubscriber(pageId);

  const [showAdd, setShowAdd] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const subscribers = subsData?.data ?? [];
  const confirmedCount = subscribers.filter((s) => s.confirmed).length;
  const pendingCount = subscribers.filter((s) => !s.confirmed).length;

  const filtered = subscribers.filter((sub) => {
    const matchesSearch = !search || sub.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'confirmed' && sub.confirmed) ||
      (statusFilter === 'pending' && !sub.confirmed);
    return matchesSearch && matchesStatus;
  });

  async function handleRemove() {
    if (!removeId) return;
    try {
      await removeSub.mutateAsync(removeId);
      toast.success('Subscriber removed');
      setRemoveId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Email Subscribers</h2>
          <p className="text-[11.5px] text-muted-foreground">Manage notification recipients for this status page</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            <Users className="mr-2 h-3.5 w-3.5" />
            Bulk Add
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Subscriber
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <p className="text-[26px] font-bold text-cyan-500 font-mono">{subscribers.length}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">Total Subscribers</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-[26px] font-bold text-emerald-500 font-mono">{confirmedCount}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">Confirmed</p>
            </div>
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
              <p className="text-[26px] font-bold text-yellow-500 font-mono">{pendingCount}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">Pending Confirmation</p>
            </div>
          </div>

          {/* Channel breakdown */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[9px] font-extrabold text-muted-foreground tracking-[2px] uppercase mb-2">BY CHANNEL</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/10 text-blue-300">
                  <Mail className="h-3 w-3" /> Email
                </span>
                <span className="font-mono text-xs text-muted-foreground">{confirmedCount} confirmed</span>
              </div>
            </div>
          </div>

          {subscribers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Mail className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-[15px] font-semibold text-muted-foreground mb-1">No subscribers yet</p>
                <p className="text-xs text-muted-foreground">
                  Add subscribers manually or share your public status page link.
                </p>
                <Button className="mt-4" onClick={() => setShowAdd(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Subscriber
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              {/* Search + filter bar */}
              <div className="flex items-center gap-3 border-b border-border p-3">
                <div className="relative max-w-[300px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    placeholder="Search by email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-40 !py-1.5 !text-xs"
                >
                  <option value="all">All subscribers</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                </Select>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                        Subscribed
                      </th>
                      <th className="px-4 py-3 text-right text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((sub) => (
                      <tr key={sub.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-[13px] text-foreground">{sub.email}</td>
                        <td className="px-4 py-3">
                          {sub.confirmed ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.2)]" />
                              Confirmed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-yellow-400">
                              <span className="h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_0_2px_rgba(234,179,8,0.2)]" />
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                          {new Date(sub.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            onClick={() => setRemoveId(sub.id)}
                            title="Remove subscriber"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-[11px] font-mono text-muted-foreground">
                  Showing {filtered.length} of {subscribers.length}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      <AddSubscriberDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        pageId={pageId}
      />

      <ConfirmDialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        onConfirm={handleRemove}
        title="Remove Subscriber"
        description="Are you sure you want to remove this subscriber? They will stop receiving status update emails."
        confirmLabel="Remove"
        variant="destructive"
      />
    </div>
  );
}
