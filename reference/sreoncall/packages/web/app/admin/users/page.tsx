'use client';

import { useState } from 'react';
import {
  Users,
  Search,
  Loader2,
  Pencil,
  CircleDot,
  Shield,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Select';
import { FilterSelect } from '@/components/ui/FilterSelect';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  usePlatformUsers,
  useUpdatePlatformUser,
  type PlatformUser,
} from '@/lib/hooks/usePlatformAdmin';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const ROLE_COLORS: Record<string, string> = {
  platform_admin: 'bg-red-100 text-red-700',
  tenant_admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  agent: 'bg-green-100 text-green-700',
  viewer: 'bg-slate-100 text-slate-700',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  invited: 'bg-blue-100 text-blue-700',
  disabled: 'bg-red-100 text-red-700',
};

export default function AllUsersPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser, setEditUser] = useState<PlatformUser | null>(null);

  // Edit form
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState('');

  const { data, isLoading } = usePlatformUsers({
    search: search || undefined,
    status: statusFilter || undefined,
    role: roleFilter || undefined,
    limit: 50,
  });

  const updateMutation = useUpdatePlatformUser();

  const users = data?.data || [];

  function openEdit(user: PlatformUser) {
    setEditUser(user);
    setEditName(user.name);
    setEditRole(user.roles[0] || 'agent');
    setEditStatus(user.status);
  }

  function handleUpdate() {
    if (!editUser) return;
    updateMutation.mutate(
      {
        id: editUser.id,
        data: { name: editName, roles: [editRole], status: editStatus },
      },
      {
        onSuccess: () => {
          toast.success('User updated');
          setEditUser(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">All Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-tenant user management
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              containerClassName="flex-1 min-w-[200px]"
              placeholder="Search users by name or email..."
              value={search}
              onChange={setSearch}
            />
            <FilterSelect label="Status" icon={<CircleDot />} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </FilterSelect>
            <FilterSelect label="Role" icon={<Shield />} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All</option>
              <option value="platform_admin">Platform Admin</option>
              <option value="tenant_admin">Tenant Admin</option>
              <option value="manager">Manager</option>
              <option value="agent">Agent</option>
              <option value="viewer">Viewer</option>
            </FilterSelect>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>
            {data?.pagination?.total !== undefined
              ? `${data.pagination.total} users`
              : 'Users'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users found"
              description="No users match your current filters."
            />
          ) : (
            <div className="divide-y divide-border">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt=""
                          className="h-8 w-8 rounded-full"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {user.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-foreground">{user.name}</span>
                        <span className="ml-2 text-sm text-muted-foreground">{user.email}</span>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-10">
                      {user.roles.map((role) => (
                        <Badge key={role} className={ROLE_COLORS[role] || ''}>
                          {role.replace('_', ' ')}
                        </Badge>
                      ))}
                      <Badge className={STATUS_COLORS[user.status] || ''}>{user.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Tenant: {user.tenant_id}
                      </span>
                      {user.last_login_at && (
                        <span className="text-xs text-muted-foreground">
                          Last login{' '}
                          {formatDistanceToNow(new Date(user.last_login_at), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onClose={() => setEditUser(null)}>
        <DialogContent>
          <DialogClose onClose={() => setEditUser(null)} />
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 px-6 pb-6">
              <p className="text-sm text-muted-foreground">{editUser.email}</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Name</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Role</label>
                <Select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  <option value="platform_admin">Platform Admin</option>
                  <option value="tenant_admin">Tenant Admin</option>
                  <option value="manager">Manager</option>
                  <option value="agent">Agent</option>
                  <option value="viewer">Viewer</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
                <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="invited">Invited</option>
                  <option value="disabled">Disabled</option>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditUser(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdate}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
