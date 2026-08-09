'use client';

import { useState, useEffect } from 'react';
import { Users2, Plus, Loader2, Pencil, Trash2, AlertTriangle, User, Crown, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { UserMultiSelect } from '@/components/shared/UserMultiSelect';
import { UserSelect } from '@/components/shared/UserSelect';
import {
  useTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useCheckMemberConflicts,
  type Team,
} from '@/lib/hooks/useTeams';
import { useUsers } from '@/lib/hooks/useUsers';

// ─── Member conflict warning ────────────────────────────────────────────────

function MemberConflictWarning({
  userIds,
  excludeTeamId,
}: {
  userIds: string[];
  excludeTeamId?: string;
}) {
  const { data: conflicts = [] } = useCheckMemberConflicts(userIds, excludeTeamId);

  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Member conflicts
      </div>
      {conflicts.map((c) => (
        <p key={`${c.user_id}-${c.team_id}`} className="text-xs text-amber-600 dark:text-amber-400">
          <span className="font-medium">{c.user_name}</span> is already in{' '}
          <span className="font-medium">{c.team_name}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Create team dialog ─────────────────────────────────────────────────────

function CreateTeamDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [teamLead, setTeamLead] = useState('');
  const [manager, setManager] = useState('');

  const { data: users = [] } = useUsers();
  const createMutation = useCreateTeam();

  function reset() {
    setName('');
    setDescription('');
    setMemberIds([]);
    setTeamLead('');
    setManager('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        members: memberIds.length > 0 ? memberIds : undefined,
        team_lead: teamLead || null,
        manager: manager || null,
      });
      toast.success('Team created');
      reset();
      onClose();
    } catch {
      toast.error('Failed to create team');
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input
              placeholder="e.g. Platform SRE"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="What does this team do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="relative">
            <UserMultiSelect
              users={users}
              selectedIds={memberIds}
              onChange={setMemberIds}
              label="Members"
            />
          </div>

          {memberIds.length > 0 && <MemberConflictWarning userIds={memberIds} />}

          <UserSelect
            users={users}
            value={teamLead}
            onChange={setTeamLead}
            label="Team Lead (optional)"
            placeholder="Select team lead\u2026"
          />

          <UserSelect
            users={users}
            value={manager}
            onChange={setManager}
            label="Manager (optional)"
            placeholder="Select manager\u2026"
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>
              ) : (
                'Create Team'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit team dialog ───────────────────────────────────────────────────────

function EditTeamDialog({
  team,
  open,
  onClose,
}: {
  team: Team;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(team.members.map((m) => m._id));
  const [teamLead, setTeamLead] = useState(team.team_lead?._id ?? '');
  const [manager, setManager] = useState(team.manager?._id ?? '');

  const { data: users = [] } = useUsers();
  const updateMutation = useUpdateTeam();

  // Reset when team prop changes
  const [lastId, setLastId] = useState(team._id);
  if (team._id !== lastId) {
    setLastId(team._id);
    setName(team.name);
    setDescription(team.description ?? '');
    setMemberIds(team.members.map((m) => m._id));
    setTeamLead(team.team_lead?._id ?? '');
    setManager(team.manager?._id ?? '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await updateMutation.mutateAsync({
        id: team._id,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          members: memberIds,
          team_lead: teamLead || null,
          manager: manager || null,
        },
      });
      toast.success('Team updated');
      onClose();
    } catch {
      toast.error('Failed to update team');
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Team</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input
              placeholder="e.g. Platform SRE"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="What does this team do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="relative">
            <UserMultiSelect
              users={users}
              selectedIds={memberIds}
              onChange={setMemberIds}
              label="Members"
            />
          </div>

          {memberIds.length > 0 && <MemberConflictWarning userIds={memberIds} excludeTeamId={team._id} />}

          <UserSelect
            users={users}
            value={teamLead}
            onChange={setTeamLead}
            label="Team Lead (optional)"
            placeholder="Select team lead\u2026"
          />

          <UserSelect
            users={users}
            value={manager}
            onChange={setManager}
            label="Manager (optional)"
            placeholder="Select manager\u2026"
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [deleteTeam, setDeleteTeam] = useState<Team | null>(null);

  const { data: teams, isLoading } = useTeams();
  const deleteMutation = useDeleteTeam();

  async function handleDelete() {
    if (!deleteTeam) return;
    try {
      await deleteMutation.mutateAsync(deleteTeam._id);
      toast.success(`Team "${deleteTeam.name}" deleted`);
      setDeleteTeam(null);
    } catch {
      toast.error('Failed to delete team');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your organization&apos;s teams</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Team
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !teams || teams.length === 0 ? (
        <EmptyState
          icon={Users2}
          title="No teams yet"
          description="Create your first team to start organizing members."
          actionLabel="New Team"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team._id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users2 className="h-4 w-4 text-muted-foreground" />
                    {team.name}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditTeam(team)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTeam(team)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {team.description && (
                  <p className="mb-3 text-sm text-muted-foreground">{team.description}</p>
                )}

                {/* Team lead & manager */}
                <div className="space-y-1 mb-3">
                  {team.team_lead && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Crown className="h-3 w-3 text-amber-500" />
                      <span>Lead: <span className="font-medium text-foreground">{team.team_lead.name}</span></span>
                    </div>
                  )}
                  {team.manager && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Briefcase className="h-3 w-3 text-blue-500" />
                      <span>Manager: <span className="font-medium text-foreground">{team.manager.name}</span></span>
                    </div>
                  )}
                </div>

                {/* Member count & pills */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{team.members?.length ?? 0}</span>
                  <span>{(team.members?.length ?? 0) === 1 ? 'member' : 'members'}</span>
                </div>
                {team.members && team.members.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {team.members.slice(0, 5).map((m) => (
                      <span
                        key={m._id}
                        className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
                      >
                        <User className="h-3 w-3 text-muted-foreground" />
                        {m.name}
                      </span>
                    ))}
                    {team.members.length > 5 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        +{team.members.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateTeamDialog open={showCreate} onClose={() => setShowCreate(false)} />
      {editTeam && (
        <EditTeamDialog
          team={editTeam}
          open={!!editTeam}
          onClose={() => setEditTeam(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleteTeam}
        onClose={() => setDeleteTeam(null)}
        onConfirm={handleDelete}
        title="Delete Team"
        description={`Are you sure you want to delete "${deleteTeam?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
