'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus,
  MoreHorizontal,
  Mail,
  Shield,
  Loader2,
  Trash2,
  KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { api } from '@/lib/api';

interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  avatar_url: string | null;
  status: 'active' | 'invited' | 'disabled';
  last_active_at: string | null;
}

interface UsersResponse {
  data: OrgMember[];
  pagination: {
    total?: number;
    has_more: boolean;
    limit: number;
  };
}

function useOrgMembers() {
  return useQuery<UsersResponse>({
    queryKey: ['org-members'],
    queryFn: () => api.get<UsersResponse>('/api/v1/users', { limit: 100 }),
  });
}

export default function OrgMembersPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useOrgMembers();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [isInviting, setIsInviting] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<OrgMember | null>(null);
  const [memberToResetPassword, setMemberToResetPassword] = useState<OrgMember | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const members = data?.data || [];
  const total = data?.pagination?.total || members.length;

  async function handleInvite() {
    if (!inviteEmail.trim() || !inviteName.trim()) return;

    setIsInviting(true);
    try {
      await api.post('/api/v1/users/invite', {
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        roles: [inviteRole],
      });
      toast.success(`Invitation sent to ${inviteEmail}`);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('agent');
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send invitation');
    } finally {
      setIsInviting(false);
    }
  }

  async function handleRemoveMember() {
    if (!memberToRemove) return;

    try {
      await api.delete(`/api/v1/users/${memberToRemove.id}`);
      toast.success(`${memberToRemove.name} has been removed`);
      setMemberToRemove(null);
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove member');
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    try {
      // Roles are changed via the dedicated /roles endpoint. The main PATCH
      // no longer accepts a `roles` field (F-01 hardening 2026-04-21).
      await api.put(`/api/v1/users/${memberId}/roles`, { roles: [newRole] });
      toast.success('Role updated successfully');
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update role');
    }
  }

  async function handleResetPassword() {
    if (!memberToResetPassword || resetPassword.length < 8) return;

    setIsResettingPassword(true);
    try {
      await api.post(`/api/v1/users/${memberToResetPassword.id}/reset-password`, {
        password: resetPassword,
      });
      toast.success(`Password reset for ${memberToResetPassword.name}. They will be asked to change it on next login.`);
      setMemberToResetPassword(null);
      setResetPassword('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reset password');
    } finally {
      setIsResettingPassword(false);
    }
  }

  const roleLabels: Record<string, string> = {
    tenant_admin: 'Admin',
    manager: 'Manager',
    agent: 'Agent',
    viewer: 'Viewer',
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowInviteModal(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Org Members
            <Badge variant="secondary" className="ml-2">
              {total}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      name={member.name}
                      imageUrl={member.avatar_url}
                      size="md"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {member.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        member.status === 'active'
                          ? 'success'
                          : member.status === 'invited'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {member.status}
                    </Badge>

                    <Select
                      value={member.role}
                      onChange={(e) =>
                        handleRoleChange(member.id, e.target.value)
                      }
                      className="w-28"
                      disabled={member.role === 'platform_admin'}
                    >
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>

                    <div className="relative">
                      <button
                        onClick={() =>
                          setActiveMenu(
                            activeMenu === member.id ? null : member.id,
                          )
                        }
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                        disabled={member.role === 'platform_admin'}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>

                      {activeMenu === member.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-border bg-card py-1 shadow-lg">
                          <button
                            onClick={() => {
                              setActiveMenu(null);
                              setMemberToResetPassword(member);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            <KeyRound className="h-4 w-4" />
                            Reset Password
                          </button>
                          <button
                            onClick={() => {
                              setActiveMenu(null);
                              setMemberToRemove(member);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {members.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No org members yet. Invite someone to get started.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite Modal */}
      <Dialog
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Org Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                type="text"
                placeholder="John Doe"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Role
              </label>
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="agent">Agent</option>
                <option value="tenant_admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
              </Select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowInviteModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleInvite}
                disabled={isInviting || !inviteEmail.trim() || !inviteName.trim()}
              >
                {isInviting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Invitation'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog
        open={!!memberToResetPassword}
        onClose={() => {
          setMemberToResetPassword(null);
          setResetPassword('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              Set a new password for{' '}
              <span className="font-medium text-foreground">
                {memberToResetPassword?.name}
              </span>
              . They will be required to change it on their next login.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                New Password
              </label>
              <Input
                type="password"
                placeholder="Minimum 8 characters"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setMemberToResetPassword(null);
                  setResetPassword('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleResetPassword}
                disabled={isResettingPassword || resetPassword.length < 8}
              >
                {isResettingPassword ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  'Reset Password'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <ConfirmDialog
        open={!!memberToRemove}
        onClose={() => setMemberToRemove(null)}
        onConfirm={handleRemoveMember}
        title="Remove Org Member"
        description={
          memberToRemove
            ? `Are you sure you want to remove ${memberToRemove.name} from the organization? They will lose access immediately.`
            : ''
        }
        confirmLabel="Remove"
        variant="destructive"
      />
    </div>
  );
}
