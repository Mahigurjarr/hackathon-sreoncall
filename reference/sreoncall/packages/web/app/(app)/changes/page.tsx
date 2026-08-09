'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, GitPullRequest, Loader2, AlertTriangle, CircleDot, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Select';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useChanges, useCreateChange, type RiskScore, type ChangeType } from '@/lib/hooks/useChanges';
import { useUsers } from '@/lib/hooks/useUsers';
import { cn } from '@/lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskScore, string> = {
  low:      'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]',
  medium:   'bg-[#FEFCE8] text-[#A16207] border-[#FDE68A]',
  high:     'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]',
  critical: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
};

const TYPE_COLORS: Record<ChangeType, string> = {
  standard:  'bg-[#EFF6FF] text-[#2563EB]',
  normal:    'bg-[#F8FAFC] text-[#64748B]',
  emergency: 'bg-[#FEF2F2] text-[#DC2626]',
};

const STATUS_COLORS: Record<string, string> = {
  draft:            'bg-[#F1F5F9] text-[#64748B]',
  submitted:        'bg-[#EFF6FF] text-[#2563EB]',
  pending_approval: 'bg-[#FEFCE8] text-[#A16207]',
  approved:         'bg-[#F0FDF4] text-[#16A34A]',
  rejected:         'bg-[#FEF2F2] text-[#DC2626]',
  scheduled:        'bg-[#F5F3FF] text-[#7C3AED]',
  in_progress:      'bg-[#FFF7ED] text-[#EA580C]',
  completed:        'bg-[#F0FDF4] text-[#16A34A]',
  rolled_back:      'bg-[#FEF2F2] text-[#DC2626]',
  cancelled:        'bg-[#F8FAFC] text-[#94A3B8]',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChangesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    justification: '',
    rollback_plan: '',
    type: 'normal' as ChangeType,
    risk_score: 'medium' as RiskScore,
    requester_id: '',
    change_owner_id: '',
    roll_out_date: '',
  });

  const { data: changes = [], isLoading } = useChanges({
    search:  search || undefined,
    status:  statusFilter || undefined,
    type:    typeFilter || undefined,
  });

  const createMutation = useCreateChange();
  const { data: orgUsers = [] } = useUsers();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      const cr = await createMutation.mutateAsync({
        title:         form.title.trim(),
        description:   form.description.trim(),
        justification: form.justification.trim(),
        rollback_plan: form.rollback_plan.trim(),
        type:          form.type,
        risk_score:    form.risk_score,
        requester_id:    form.requester_id || undefined,
        change_owner_id: form.change_owner_id || undefined,
        roll_out_date:   form.roll_out_date || undefined,
      });
      toast.success(`CR-${String(cr.number).padStart(4, '0')} created`);
      setShowCreate(false);
      setForm({ title: '', description: '', justification: '', rollback_plan: '', type: 'normal', risk_score: 'medium', requester_id: '', change_owner_id: '', roll_out_date: '' });
      router.push(`/changes/${cr.id}`);
    } catch {
      toast.error('Failed to create change request');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Change Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan, approve, and track change requests</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          New Change Request
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          containerClassName="flex-1 sm:max-w-xs"
          placeholder="Search changes..."
          value={search}
          onChange={setSearch}
        />
        <FilterSelect label="Status" icon={<CircleDot />} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="rolled_back">Rolled Back</option>
          <option value="cancelled">Cancelled</option>
        </FilterSelect>
        <FilterSelect label="Type" icon={<Tag />} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All</option>
          <option value="standard">Standard</option>
          <option value="normal">Normal</option>
          <option value="emergency">Emergency</option>
        </FilterSelect>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : changes.length === 0 ? (
            <EmptyState
              icon={GitPullRequest}
              title="No change requests"
              description="No changes match your filters. Create a change request to get started."
              actionLabel="New Change Request"
              onAction={() => setShowCreate(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {['Change', 'Type', 'Risk', 'Status', 'Window', 'Created'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {changes.map((cr) => (
                    <tr
                      key={cr.id}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => router.push(`/changes/${cr.id}`)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground">CR-{String(cr.number).padStart(4, '0')}</span>
                        <p className="mt-0.5 text-sm font-medium text-foreground">{cr.title}</p>
                        {cr.labels.length > 0 && (
                          <div className="mt-1 flex gap-1">
                            {cr.labels.slice(0, 3).map((l) => (
                              <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{l}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize', TYPE_COLORS[cr.type])}>
                          {cr.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', RISK_COLORS[cr.risk.score])}>
                          {cr.risk.score}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', STATUS_COLORS[cr.status] || 'bg-muted text-muted-foreground')}>
                          {cr.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {cr.implementation_window
                          ? new Date(cr.implementation_window.start).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(cr.created_at), { addSuffix: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogClose onClose={() => setShowCreate(false)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitPullRequest className="h-5 w-5" />
              New Change Request
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Title *</label>
              <Input placeholder="Brief description of the change" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Type</label>
                <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ChangeType }))}>
                  <option value="standard">Standard (pre-approved)</option>
                  <option value="normal">Normal (requires approval)</option>
                  <option value="emergency">Emergency (expedited)</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Risk Level</label>
                <Select value={form.risk_score} onChange={(e) => setForm((f) => ({ ...f, risk_score: e.target.value as RiskScore }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What is changing and why?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Justification</label>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Business justification for this change"
                value={form.justification}
                onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Rollback Plan</label>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="How to revert if things go wrong"
                value={form.rollback_plan}
                onChange={(e) => setForm((f) => ({ ...f, rollback_plan: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Requester</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  value={form.requester_id}
                  onChange={(e) => setForm((f) => ({ ...f, requester_id: e.target.value }))}
                >
                  <option value="">Same as creator</option>
                  {orgUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Change Owner</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  value={form.change_owner_id}
                  onChange={(e) => setForm((f) => ({ ...f, change_owner_id: e.target.value }))}
                >
                  <option value="">Not assigned</option>
                  {orgUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Roll Out Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={form.roll_out_date}
                onChange={(e) => setForm((f) => ({ ...f, roll_out_date: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || !form.title.trim()}>
                {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Create Change Request'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
