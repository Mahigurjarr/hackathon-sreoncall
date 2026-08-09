'use client';

import { useState, useRef, useEffect } from 'react';
import {
  FolderKanban, Plus, Loader2, Pencil, Trash2, Search, X,
  Server, TicketCheck, ChevronDown, ChevronUp, Flag, Calendar,
  Users, UserMinus, Lock, Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  useBoardMembers,
  useBoardInvites,
  useInviteToBoard,
  useRevokeBoardInvite,
  useRemoveBoardMember,
  useUpdateBoardVisibility,
  type Project,
  type BoardMember,
  type BoardInvite,
} from '@/lib/hooks/useProjects';
import { useServices, type Service } from '@/lib/hooks/useServices';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTickets } from '@/lib/hooks/useTickets';
import {
  useMilestones,
  useMilestoneProgress,
  useCreateMilestone,
  useUpdateMilestone,
  useDeleteMilestone,
  type Milestone,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from '@/lib/hooks/useMilestones';
import { cn, formatTicketNumber } from '@/lib/utils';

// ─── Project dialog ─────────────────────────────────────────────────────────

function ProjectDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project | null;
}) {
  const isEdit = !!project;
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const inviteToBoard = useInviteToBoard();
  const { data: orgUsers = [] } = useUsers();

  const [form, setForm] = useState({ name: project?.name ?? '', description: project?.description ?? '', visibility: project?.visibility ?? 'org' as 'org' | 'private' });
  const [inviteSearch, setInviteSearch] = useState('');
  const [invitePickerOpen, setInvitePickerOpen] = useState(false);
  const [selectedInvitees, setSelectedInvitees] = useState<{ id: string; name: string; email: string }[]>([]);
  const invitePickerRef = useRef<HTMLDivElement>(null);

  const [lastProject, setLastProject] = useState(project);
  if (project !== lastProject) {
    setLastProject(project);
    setForm({ name: project?.name ?? '', description: project?.description ?? '', visibility: project?.visibility ?? 'org' });
    setSelectedInvitees([]);
    setInviteSearch('');
  }

  useEffect(() => {
    if (!invitePickerOpen) return;
    function onDown(e: MouseEvent) {
      if (invitePickerRef.current?.contains(e.target as Node)) return;
      setInvitePickerOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [invitePickerOpen]);

  const selectedIds = new Set(selectedInvitees.map((u) => u.id));
  const filteredInviteUsers = orgUsers.filter(
    (u) =>
      !selectedIds.has(u.id) &&
      (inviteSearch.trim()
        ? u.name.toLowerCase().includes(inviteSearch.toLowerCase()) ||
          u.email.toLowerCase().includes(inviteSearch.toLowerCase())
        : true),
  );

  function addInvitee(u: { id: string; name: string; email: string }) {
    setSelectedInvitees((prev) => [...prev, u]);
    setInviteSearch('');
    setInvitePickerOpen(false);
  }

  function removeInvitee(id: string) {
    setSelectedInvitees((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    try {
      if (isEdit && project) {
        await updateProject.mutateAsync({ id: project.id, input: { ...form, visibility: form.visibility } });
        toast.success('Project updated');
      } else {
        const created = await createProject.mutateAsync({ ...form, visibility: form.visibility });
        if (form.visibility === 'private' && selectedInvitees.length > 0) {
          await Promise.all(
            selectedInvitees.map((u) =>
              inviteToBoard.mutateAsync({ projectId: created.id, email: u.email, role: 'member' }).catch(() => {}),
            ),
          );
        }
        toast.success('Project created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save project');
    }
  }

  const isPending = createProject.isPending || updateProject.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" />
            {isEdit ? 'Edit Project' : 'New Project'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input
              placeholder="e.g. Payment Platform"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Brief description of this project"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Access</label>
            <div className="flex rounded-lg border border-input overflow-hidden">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, visibility: 'org' }))}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm transition-colors',
                  form.visibility === 'org'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                <Globe className="h-4 w-4" />
                Organization
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, visibility: 'private' }))}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm transition-colors',
                  form.visibility === 'private'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                <Lock className="h-4 w-4" />
                Private (invite only)
              </button>
            </div>
            {form.visibility === 'private' && (
              <p className="text-xs text-muted-foreground">Only invited members can see this board and its tickets.</p>
            )}
          </div>

          {/* Invite members — shown when creating or editing a private board */}
          {form.visibility === 'private' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Invite Members</label>
              {/* Selected chips */}
              {selectedInvitees.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedInvitees.map((u) => (
                    <span
                      key={u.id}
                      className="flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {u.name}
                      <button
                        type="button"
                        onClick={() => removeInvitee(u.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* Search picker */}
              <div className="relative" ref={invitePickerRef}>
                <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
                <input
                  type="text"
                  placeholder="Search people to invite…"
                  value={inviteSearch}
                  onChange={(e) => { setInviteSearch(e.target.value); setInvitePickerOpen(true); }}
                  onFocus={() => setInvitePickerOpen(true)}
                  className="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {invitePickerOpen && filteredInviteUsers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-card shadow-lg max-h-44 overflow-y-auto">
                    {filteredInviteUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); addInvitee(u); }}
                        className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-muted transition-colors"
                      >
                        <span className="text-sm font-medium text-foreground">{u.name}</span>
                        <span className="text-xs text-muted-foreground">{u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
                {invitePickerOpen && filteredInviteUsers.length === 0 && inviteSearch && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-card shadow-lg px-3 py-3 text-xs text-muted-foreground">
                    No matching members
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Project'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Milestone status badge colors ──────────────────────────────────────────

const MILESTONE_STATUS_COLORS: Record<string, string> = {
  planned: 'bg-[#EFF6FF] text-[#2563EB]',
  active: 'bg-[#FFF7ED] text-[#EA580C]',
  completed: 'bg-[#F0FDF4] text-[#16A34A]',
  cancelled: 'bg-[#F1F5F9] text-[#64748B]',
};

// ─── Milestone Dialog (Create / Edit) ───────────────────────────────────────

function MilestoneDialog({
  open,
  onClose,
  projectId,
  milestone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  milestone?: Milestone | null;
}) {
  const isEdit = !!milestone;
  const createMilestone = useCreateMilestone();
  const updateMilestone = useUpdateMilestone();

  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    name: milestone?.name ?? '',
    description: milestone?.description ?? '',
    status: milestone?.status ?? 'planned',
    start_date: milestone?.start_date?.slice(0, 10) ?? today,
    target_date: milestone?.target_date?.slice(0, 10) ?? '',
  });

  const [lastMilestone, setLastMilestone] = useState(milestone);
  if (milestone !== lastMilestone) {
    setLastMilestone(milestone);
    setForm({
      name: milestone?.name ?? '',
      description: milestone?.description ?? '',
      status: milestone?.status ?? 'planned',
      start_date: milestone?.start_date?.slice(0, 10) ?? today,
      target_date: milestone?.target_date?.slice(0, 10) ?? '',
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.target_date) { toast.error('Target date is required'); return; }
    try {
      if (isEdit && milestone) {
        await updateMilestone.mutateAsync({
          id: milestone.id,
          input: {
            name: form.name,
            description: form.description,
            status: form.status,
            start_date: form.start_date,
            target_date: form.target_date,
          },
        });
        toast.success('Milestone updated');
      } else {
        await createMilestone.mutateAsync({
          project_id: projectId,
          name: form.name,
          description: form.description,
          status: form.status,
          start_date: form.start_date,
          target_date: form.target_date,
        });
        toast.success('Milestone created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save milestone');
    }
  }

  const isPending = createMilestone.isPending || updateMilestone.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            {isEdit ? 'Edit Milestone' : 'New Milestone'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input
              placeholder="e.g. Q1 Release"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Brief description of this milestone"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Start Date</label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Target Date *</label>
              <Input
                type="date"
                value={form.target_date}
                onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Status</label>
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'planned' | 'active' | 'completed' | 'cancelled' }))}
            >
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Milestone'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Milestone Card with progress ───────────────────────────────────────────

function MilestoneCard({
  milestone,
  onEdit,
  onDelete,
}: {
  milestone: Milestone;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data: progress, isLoading: progressLoading } = useMilestoneProgress(milestone.id);
  const [expanded, setExpanded] = useState(false);
  const { data: ticketsData } = useTickets(
    expanded ? { milestone_id: milestone.id, page_size: 20 } : { milestone_id: undefined, page_size: 0 },
  );
  const tickets = expanded ? (ticketsData?.items ?? []) : [];

  const isOverdue = progress?.overdue ?? (new Date(milestone.target_date) < new Date() && milestone.status !== 'completed' && milestone.status !== 'cancelled');
  const pct = progress?.pct_complete ?? 0;

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{milestone.name}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', MILESTONE_STATUS_COLORS[milestone.status] ?? MILESTONE_STATUS_COLORS.planned)}>
              {milestone.status}
            </span>
          </div>
          <div className={cn('flex items-center gap-2 mt-1 text-xs', isOverdue ? 'text-[#DC2626]' : 'text-muted-foreground')}>
            <Calendar className="h-3 w-3" />
            {milestone.start_date?.slice(0, 10)} → {milestone.target_date?.slice(0, 10)}
            {isOverdue && <span className="font-semibold">(Overdue)</span>}
          </div>
          {/* Progress bar */}
          {!progressLoading && progress && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>{progress.completed_tickets}/{progress.total_tickets} tickets</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-primary')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {(progress.estimated_hours > 0 || progress.actual_hours > 0) && (
                <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                  <span>Est: {progress.estimated_hours.toFixed(1)}h</span>
                  <span>Actual: {progress.actual_hours.toFixed(1)}h</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {expanded && tickets.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          {tickets.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-xs py-1">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-muted-foreground mr-1.5">{formatTicketNumber(t.number, t.project_key)}</span>
                <span className="text-foreground">{t.title}</span>
              </div>
              <span className="text-muted-foreground capitalize shrink-0 ml-2">{t.status.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
      {expanded && tickets.length === 0 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          No tickets linked to this milestone.
        </div>
      )}
    </div>
  );
}

// ─── Milestone Section ──────────────────────────────────────────────────────

function MilestoneSection({ projectId }: { projectId: string }) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showDialog, setShowDialog] = useState(false);
  const [editMilestone, setEditMilestone] = useState<Milestone | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filters: { project_id: string; status?: string } = { project_id: projectId };
  if (statusFilter) filters.status = statusFilter;

  const { data, isLoading } = useMilestones(filters);
  const deleteMilestone = useDeleteMilestone();

  const milestones = data?.data ?? [];

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteMilestone.mutateAsync(deleteId);
      toast.success('Milestone deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete milestone');
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Flag className="h-4 w-4 text-muted-foreground" />
          Milestones
        </h3>
        <div className="flex items-center gap-2">
          <FilterSelect
            label="Status"
            icon={<Flag />}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </FilterSelect>
          <Button size="sm" variant="outline" onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Milestone
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">No milestones in this project.</p>
      ) : (
        <div className="space-y-2">
          {milestones.map((m) => (
            <MilestoneCard
              key={m.id}
              milestone={m}
              onEdit={() => { setEditMilestone(m); setShowDialog(true); }}
              onDelete={() => setDeleteId(m.id)}
            />
          ))}
        </div>
      )}

      <MilestoneDialog
        open={showDialog}
        onClose={() => { setShowDialog(false); setEditMilestone(null); }}
        projectId={projectId}
        milestone={editMilestone}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Milestone"
        description="Are you sure you want to delete this milestone? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </>
  );
}

// ─── Role badge colors ───────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-[#EFF6FF] text-[#2563EB]',
  member: 'bg-[#F0FDF4] text-[#16A34A]',
  viewer: 'bg-[#F1F5F9] text-[#64748B]',
};

// ─── Members & Access Section ────────────────────────────────────────────────

function MembersSection({ project }: { project: Project }) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const pickerRef = useRef<HTMLDivElement>(null);

  const visibility = project.visibility ?? 'org';

  const { data: membersData, isLoading: membersLoading } = useBoardMembers(project.id);
  const { data: invitesData, isLoading: invitesLoading } = useBoardInvites(project.id);
  const { data: orgUsers = [] } = useUsers();

  const members = membersData?.data ?? [];
  const invites = invitesData?.data ?? [];

  const inviteToBoard = useInviteToBoard();
  const revokeBoardInvite = useRevokeBoardInvite();
  const removeBoardMember = useRemoveBoardMember();
  const updateBoardVisibility = useUpdateBoardVisibility();

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current?.contains(e.target as Node)) return;
      setPickerOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const memberUserIds = new Set(
    members.map((m) => {
      const userObj = typeof m.user_id === 'object' ? (m.user_id as any) : null;
      return String(userObj?._id ?? m.user_id);
    }),
  );
  const pendingEmails = new Set(
    invites.filter((i) => i.status === 'pending').map((i) => i.email.toLowerCase()),
  );
  const eligibleUsers = orgUsers.filter(
    (u) => !memberUserIds.has(u.id) && !pendingEmails.has(u.email.toLowerCase()),
  );
  const filteredUsers = memberSearch.trim()
    ? eligibleUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
          u.email.toLowerCase().includes(memberSearch.toLowerCase()),
      )
    : eligibleUsers;
  const selectedUser = orgUsers.find((u) => u.id === selectedUserId);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const user = orgUsers.find((u) => u.id === selectedUserId);
    if (!user) { toast.error('Select a member to invite'); return; }
    try {
      await inviteToBoard.mutateAsync({ projectId: project.id, email: user.email, role: inviteRole });
      toast.success('Invitation sent');
      setSelectedUserId('');
      setMemberSearch('');
      setInviteRole('member');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send invitation');
    }
  }

  async function handleRevoke(inviteId: string) {
    try {
      await revokeBoardInvite.mutateAsync({ projectId: project.id, inviteId });
      toast.success('Invitation revoked');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to revoke invitation');
    }
  }

  async function handleRemoveMember(userId: string) {
    try {
      await removeBoardMember.mutateAsync({ projectId: project.id, userId });
      toast.success('Member removed');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to remove member');
    }
  }

  async function handleVisibilityChange(newVisibility: 'org' | 'private') {
    try {
      await updateBoardVisibility.mutateAsync({ projectId: project.id, visibility: newVisibility });
      toast.success(`Board visibility set to ${newVisibility === 'org' ? 'Organization' : 'Private'}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update visibility');
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" />
          Members &amp; Access
        </h3>
        {/* Visibility toggle */}
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors',
              visibility === 'org'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-muted',
            )}
            onClick={() => handleVisibilityChange('org')}
            disabled={updateBoardVisibility.isPending}
          >
            <Globe className="h-3 w-3" />
            Organization
          </button>
          <button
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors',
              visibility === 'private'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-muted',
            )}
            onClick={() => handleVisibilityChange('private')}
            disabled={updateBoardVisibility.isPending}
          >
            <Lock className="h-3 w-3" />
            Private
          </button>
        </div>
      </div>

      {visibility === 'org' ? (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          All organization members can access this board.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Invite form */}
          <form onSubmit={handleInvite} className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0" ref={pickerRef}>
              <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
              <input
                type="text"
                placeholder="Search member…"
                value={selectedUser ? selectedUser.name : memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  setSelectedUserId('');
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                className="flex h-8 w-full rounded-[8px] border-[1.5px] border-border bg-card pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary transition-[border-color] duration-150"
              />
              {pickerOpen && filteredUsers.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-[8px] border border-border bg-card shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-h-48 overflow-y-auto">
                  {filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedUserId(u.id);
                        setMemberSearch('');
                        setPickerOpen(false);
                      }}
                      className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-muted transition-colors"
                    >
                      <span className="text-[13px] font-medium text-foreground">{u.name}</span>
                      <span className="text-[11px] text-muted-foreground">{u.email}</span>
                    </button>
                  ))}
                </div>
              )}
              {pickerOpen && filteredUsers.length === 0 && memberSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-[8px] border border-border bg-card shadow-[0_4px_16px_rgba(0,0,0,0.12)] px-3 py-3 text-[12.5px] text-muted-foreground">
                  No matching members
                </div>
              )}
            </div>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
              className="!w-32 h-8 text-sm shrink-0"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </Select>
            <Button type="submit" size="sm" disabled={inviteToBoard.isPending} className="h-8 shrink-0">
              {inviteToBoard.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : 'Invite'
              }
            </Button>
          </form>

          {/* Members list */}
          {membersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading members...
            </div>
          ) : members.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Members</p>
              {members.map((member) => {
                const userObj = typeof member.user_id === 'object' ? member.user_id : null;
                const displayName = userObj?.name ?? String(member.user_id);
                const displayEmail = userObj?.email;
                const userId = userObj?._id ?? String(member.user_id);
                return (
                  <div
                    key={member._id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground">{displayName}</span>
                      {displayEmail && (
                        <span className="text-xs text-muted-foreground ml-2">{displayEmail}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', ROLE_COLORS[member.role] ?? ROLE_COLORS.viewer)}>
                        {member.role}
                      </span>
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleRemoveMember(userId)}
                        title="Remove member"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Pending invites list */}
          {invitesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading invites...
            </div>
          ) : invites.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending Invites</p>
              {invites.map((invite) => (
                <div
                  key={invite._id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-foreground">{invite.email}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', ROLE_COLORS[invite.role] ?? ROLE_COLORS.viewer)}>
                      {invite.role}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize">{invite.status}</span>
                    {invite.status === 'pending' && (
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleRevoke(invite._id)}
                        title="Revoke invite"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

// ─── Expanded detail panel ──────────────────────────────────────────────────

function ProjectDetail({ project }: { project: Project }) {
  const { data: servicesData, isLoading: servicesLoading } = useServices({ project_id: project.id });
  const { data: ticketsData, isLoading: ticketsLoading } = useTickets({ project_id: project.id, page_size: 5 });

  const services = servicesData?.data ?? [];
  const tickets = ticketsData?.items ?? [];

  const STATUS_COLORS: Record<string, string> = {
    operational: 'bg-[#F0FDF4] text-[#16A34A]',
    degraded: 'bg-[#FEFCE8] text-[#A16207]',
    partial_outage: 'bg-[#FFF7ED] text-[#EA580C]',
    major_outage: 'bg-[#FEF2F2] text-[#DC2626]',
    maintenance: 'bg-[#EFF6FF] text-[#2563EB]',
    unknown: 'bg-[#F1F5F9] text-[#64748B]',
  };

  const PRIORITY_COLORS: Record<string, string> = {
    P1: 'bg-[#FEF2F2] text-[#DC2626]',
    P2: 'bg-[#FFF7ED] text-[#EA580C]',
    P3: 'bg-[#FEFCE8] text-[#A16207]',
    P4: 'bg-[#EFF6FF] text-[#2563EB]',
    P5: 'bg-[#F1F5F9] text-[#64748B]',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Services section */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Server className="h-4 w-4 text-muted-foreground" />
            Services
          </h3>
          {servicesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services in this project.</p>
          ) : (
            <div className="space-y-1.5">
              {services.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <span className="text-sm font-medium text-foreground">{s.name}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[s.current_status] ?? STATUS_COLORS.unknown)}>
                    {s.current_status.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Work Tickets section */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TicketCheck className="h-4 w-4 text-muted-foreground" />
            Recent Work Tickets
          </h3>
          {ticketsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No work tickets in this project.</p>
          ) : (
            <div className="space-y-1.5">
              {tickets.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-mono text-muted-foreground mr-2">TK-{String(t.number).padStart(4, '0')}</span>
                    <span className="text-sm text-foreground">{t.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.P3)}>
                      {t.priority}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{t.status.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Milestones section */}
      <div className="space-y-2">
        <MilestoneSection projectId={project.id} />
      </div>

      {/* Members & Access section */}
      <div className="space-y-2">
        <MembersSection project={project} />
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useProjects({ search: search || undefined });
  const deleteProject = useDeleteProject();

  const projects = data?.data ?? [];
  const total = data?.pagination.total ?? 0;

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteProject.mutateAsync(deleteId);
      toast.success('Project deleted');
      setDeleteId(null);
      if (expandedId === deleteId) setExpandedId(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete project');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize services and work tickets under projects
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Search */}
      <SearchInput
        containerClassName="flex-1 sm:max-w-xs"
        placeholder="Search projects..."
        value={search}
        onChange={setSearch}
      />

      {/* Project cards */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects found"
          description={search ? 'No projects match your search.' : 'Create your first project to get started.'}
          actionLabel="New Project"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const isExpanded = expandedId === project.id;
            return (
              <Card key={project.id} className="transition-shadow hover:shadow-md">
                <CardHeader
                  className="cursor-pointer pb-2"
                  onClick={() => setExpandedId(isExpanded ? null : project.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <CardTitle className="text-base truncate">{project.name}</CardTitle>
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                    </div>
                    <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setEditProject(project)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteId(project.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {project.description && (
                    <p className="text-sm text-muted-foreground mb-3">{project.description}</p>
                  )}
                  {isExpanded && <ProjectDetail project={project} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectDialog
        open={showCreate || !!editProject}
        onClose={() => { setShowCreate(false); setEditProject(null); }}
        project={editProject}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Project"
        description="Are you sure you want to delete this project? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
