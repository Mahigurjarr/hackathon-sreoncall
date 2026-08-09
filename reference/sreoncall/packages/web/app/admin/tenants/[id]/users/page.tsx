'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  usePlatformUsers,
  useCreateTenantUser,
  useUpdatePlatformUser,
  useResetUserPassword,
  useDisableUser,
  type PlatformUser,
} from '@/lib/hooks/usePlatformAdmin';
import { useAdminTenant } from '@/lib/hooks/useAdmin';
import { ArrowLeft, Search, UserPlus, Pencil, KeyRound, Ban, Users, CheckCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-[rgba(22,163,74,0.15)] text-[#16A34A]',
  invited: 'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
  disabled: 'bg-[rgba(220,38,38,0.15)] text-[#DC2626]',
};

const ROLE_OPTIONS = ['tenant_admin', 'manager', 'agent', 'viewer'] as const;

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    tenant_admin: 'bg-[rgba(124,58,237,0.15)] text-[#7C3AED]',
    manager: 'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
    agent: 'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
    viewer: 'bg-[rgba(148,163,184,0.15)] text-[#94A3B8]',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', colors[role] || colors.viewer)}>
      {role.replace('_', ' ')}
    </span>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function AddUserDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const createUser = useCreateTenantUser();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('agent');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createUser.mutateAsync({ tenantId, data: { email, name, password, roles: [role] } });
      toast.success('User created');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">Add User</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={createUser.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createUser.isPending ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </form>
    </DialogOverlay>
  );
}

function EditUserDialog({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const updateUser = useUpdatePlatformUser();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.roles[0] || 'agent');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateUser.mutateAsync({ id: user.id, data: { name, roles: [role] } });
      toast.success('User updated');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user');
    }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">Edit User</h2>
      <p className="text-xs text-muted-foreground mb-3">{user.email}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={updateUser.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {updateUser.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </DialogOverlay>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const resetPassword = useResetUserPassword();
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await resetPassword.mutateAsync({ id: user.id, password });
      toast.success('Password reset successfully');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset password');
    }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">Reset Password</h2>
      <p className="text-xs text-muted-foreground mb-3">{user.name} ({user.email})</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">New Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={resetPassword.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {resetPassword.isPending ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>
    </DialogOverlay>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function TenantUsersPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.id as string;

  const { data: tenant } = useAdminTenant(tenantId);
  const [search, setSearch] = useState('');
  const { data: usersData, isLoading } = usePlatformUsers({
    tenant_id: tenantId,
    search: search || undefined,
    limit: 100,
  });

  const disableUser = useDisableUser();
  const updateUser = useUpdatePlatformUser();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<PlatformUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<PlatformUser | null>(null);

  const users = usersData?.data || [];

  async function handleToggleStatus(user: PlatformUser) {
    if (user.status === 'active') {
      try {
        await disableUser.mutateAsync(user.id);
        toast.success('User disabled');
      } catch (err: any) {
        toast.error(err.message || 'Failed to disable user');
      }
    } else {
      try {
        await updateUser.mutateAsync({ id: user.id, data: { status: 'active' } });
        toast.success('User enabled');
      } catch (err: any) {
        toast.error(err.message || 'Failed to enable user');
      }
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push(`/admin/tenants/${tenantId}`)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Tenant
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{tenant?.name || 'Tenant'} — Users</h1>
          <p className="text-sm text-muted-foreground">Manage users for this tenant</p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" /> Add User
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-card pl-10 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !users.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Users className="mb-3 h-10 w-10 opacity-50" />
          <p>No users found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role(s)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Login</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{user.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((r) => <RoleBadge key={r} role={r} />)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[user.status] || '')}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditingUser(user)}
                        title="Edit"
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setResetPasswordUser(user)}
                        title="Reset Password"
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(user)}
                        title={user.status === 'active' ? 'Disable' : 'Enable'}
                        className={cn(
                          'rounded-lg p-1.5 transition-colors',
                          user.status === 'active'
                            ? 'text-muted-foreground hover:bg-[rgba(220,38,38,0.15)] hover:text-[#DC2626]'
                            : 'text-muted-foreground hover:bg-[rgba(22,163,74,0.15)] hover:text-[#16A34A]',
                        )}
                      >
                        {user.status === 'active' ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      {showAddDialog && <AddUserDialog tenantId={tenantId} onClose={() => setShowAddDialog(false)} />}
      {editingUser && <EditUserDialog user={editingUser} onClose={() => setEditingUser(null)} />}
      {resetPasswordUser && <ResetPasswordDialog user={resetPasswordUser} onClose={() => setResetPasswordUser(null)} />}
    </div>
  );
}
