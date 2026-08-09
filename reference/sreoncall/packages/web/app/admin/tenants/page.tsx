'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Plus,
  Search,
  Loader2,
  MoreVertical,
  Pause,
  Trash2,
  LogIn,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Database,
  BarChart3,
  FileText,
  Radio,
  RotateCcw,
  CircleDot,
  CreditCard,
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
  usePlatformTenants,
  useCreateTenant,
  useUpdateTenant,
  useSuspendTenant,
  useDeleteTenant,
  useHardDeleteTenant,
  useImpersonateTenant,
  useDeletedTenants,
  useRestoreTenant,
  type PlatformTenant,
  type CascadeDeleteResult,
} from '@/lib/hooks/usePlatformAdmin';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-100 text-slate-700',
  startup: 'bg-blue-100 text-blue-700',
  growth: 'bg-emerald-100 text-emerald-700',
  enterprise: 'bg-amber-100 text-amber-700',
  // legacy aliases kept so existing tenants render correctly
  starter: 'bg-blue-100 text-blue-700',
  pro: 'bg-blue-100 text-blue-700',
  business: 'bg-amber-100 text-amber-700',
};

function MiniMeter({ label, current, limit }: { label: string; current: number; limit: number }) {
  const isUnlimited = limit === -1;
  const pct = isUnlimited ? 0 : Math.min(100, (current / limit) * 100);
  const color = pct >= 95 ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <div className="w-16 h-1 rounded-full bg-muted overflow-hidden shrink-0">
        {!isUnlimited && <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />}
      </div>
      <span>{label}: {current}/{isUnlimited ? '∞' : limit}</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  provisioning: 'bg-yellow-100 text-yellow-700',
};

export default function TenantsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'active' | 'deleted'>('active');
  const [search, setSearch] = useState('');
  const [deletedSearch, setDeletedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTenant, setEditTenant] = useState<PlatformTenant | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Form state
  const [formSlug, setFormSlug] = useState('');
  const [formName, setFormName] = useState('');
  const [formPlan, setFormPlan] = useState('free');
  const [editName, setEditName] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');

  const { data, isLoading } = usePlatformTenants({
    search: search || undefined,
    status: statusFilter || undefined,
    plan: planFilter || undefined,
    limit: 50,
  });

  const { data: deletedData, isLoading: deletedLoading } = useDeletedTenants({
    search: deletedSearch || undefined,
    limit: 50,
  });

  const [deleteTarget, setDeleteTarget] = useState<PlatformTenant | null>(null);
  const [deleteMode, setDeleteMode] = useState<'soft' | 'hard'>('soft');
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [cascadeResult, setCascadeResult] = useState<CascadeDeleteResult | null>(null);

  const createMutation = useCreateTenant();
  const updateMutation = useUpdateTenant();
  const suspendMutation = useSuspendTenant();
  const deleteMutation = useDeleteTenant();
  const hardDeleteMutation = useHardDeleteTenant();
  const impersonateMutation = useImpersonateTenant();
  const restoreMutation = useRestoreTenant();

  const tenants = data?.data || [];

  function handleCreate() {
    if (!formSlug || !formName) return;
    createMutation.mutate(
      { slug: formSlug, name: formName, plan: formPlan },
      {
        onSuccess: () => {
          toast.success('Tenant created successfully');
          setCreateOpen(false);
          setFormSlug('');
          setFormName('');
          setFormPlan('free');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function openEdit(tenant: PlatformTenant) {
    setEditTenant(tenant);
    setEditName(tenant.name);
    setEditPlan(tenant.plan);
    setEditStatus(tenant.status);
    setActionMenuId(null);
  }

  function handleUpdate() {
    if (!editTenant) return;
    updateMutation.mutate(
      {
        id: editTenant.id,
        data: { name: editName, plan: editPlan, status: editStatus },
      },
      {
        onSuccess: () => {
          toast.success('Tenant updated');
          setEditTenant(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleSuspend(id: string) {
    setActionMenuId(null);
    suspendMutation.mutate(id, {
      onSuccess: () => toast.success('Tenant suspended'),
      onError: (err) => toast.error(err.message),
    });
  }

  function openDeleteDialog(tenant: PlatformTenant) {
    setActionMenuId(null);
    setDeleteTarget(tenant);
    setDeleteMode('soft');
    setDeleteConfirmSlug('');
    setCascadeResult(null);
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;

    if (deleteMode === 'hard') {
      hardDeleteMutation.mutate(deleteTarget.id, {
        onSuccess: (result) => {
          setCascadeResult(result);
          toast.success(`Tenant "${deleteTarget.slug}" permanently deleted`);
        },
        onError: (err) => toast.error(err.message),
      });
    } else {
      deleteMutation.mutate(deleteTarget.id, {
        onSuccess: () => {
          toast.success(`Tenant "${deleteTarget.slug}" soft-deleted`);
          setDeleteTarget(null);
        },
        onError: (err) => toast.error(err.message),
      });
    }
  }

  function handleImpersonate(id: string) {
    setActionMenuId(null);
    impersonateMutation.mutate(id, {
      onSuccess: (result) => {
        toast.success(`Impersonating ${result.user.email} in ${result.tenant_slug}`);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleRestore(tenant: PlatformTenant) {
    setActionMenuId(null);
    restoreMutation.mutate(tenant.id, {
      onSuccess: () => toast.success(`Tenant "${tenant.slug}" restored to active`),
      onError: (err) => toast.error(err.message),
    });
  }

  function openHardDeleteDialog(tenant: PlatformTenant) {
    setActionMenuId(null);
    setDeleteTarget(tenant);
    setDeleteMode('hard');
    setDeleteConfirmSlug('');
    setCascadeResult(null);
  }

  const deletedTenants = deletedData?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage all tenants on the platform
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Tenant
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'active'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Active Tenants
          {data?.pagination?.total !== undefined && (
            <span className="ml-1.5 text-xs text-muted-foreground">({data.pagination.total})</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('deleted')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'deleted'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Deleted Tenants
          {deletedData?.pagination?.total !== undefined && deletedData.pagination.total > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({deletedData.pagination.total})</span>
          )}
        </button>
      </div>

      {activeTab === 'active' ? (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                  containerClassName="flex-1 min-w-[200px]"
                  placeholder="Search tenants..."
                  value={search}
                  onChange={setSearch}
                />
                <FilterSelect label="Status" icon={<CircleDot />} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="provisioning">Provisioning</option>
                </FilterSelect>
                <FilterSelect label="Plan" icon={<CreditCard />} value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="free">Free</option>
                  <option value="startup">Startup</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </FilterSelect>
              </div>
            </CardContent>
          </Card>

          {/* Tenants List */}
          <Card>
            <CardHeader>
              <CardTitle>
                {data?.pagination?.total !== undefined
                  ? `${data.pagination.total} tenants`
                  : 'Tenants'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : tenants.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No tenants found"
                  description="No tenants match your current filters."
                />
              ) : (
                <div className="divide-y divide-border">
                  {tenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between py-4 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors"
                      onClick={() => router.push(`/admin/tenants/${tenant.id}`)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{tenant.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {tenant.slug}
                          </span>
                          {tenant.is_platform_tenant && (
                            <Badge variant="outline" className="text-xs">Platform</Badge>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge className={PLAN_COLORS[tenant.plan] || ''}>{tenant.plan}</Badge>
                          <Badge className={STATUS_COLORS[tenant.status] || ''}>{tenant.status}</Badge>
                          <span className="text-xs text-muted-foreground">
                            Created {formatDistanceToNow(new Date(tenant.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {/* Usage summary — shows plan limits for quick reference */}
                        {tenant.plan_limits && (
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                            <MiniMeter label="users" current={tenant.user_count ?? 0} limit={tenant.plan_limits.max_users ?? 5} />
                            <MiniMeter label="services" current={tenant.service_count ?? 0} limit={tenant.plan_limits.max_services ?? 3} />
                          </div>
                        )}
                      </div>
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setActionMenuId(actionMenuId === tenant.id ? null : tenant.id)
                          }
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                        {actionMenuId === tenant.id && (
                          <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-card shadow-lg">
                            <button
                              onClick={() => openEdit(tenant)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            {!tenant.is_platform_tenant && (
                              <>
                                <button
                                  onClick={() => handleImpersonate(tenant.id)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                                >
                                  <LogIn className="h-3.5 w-3.5" /> Impersonate
                                </button>
                                {tenant.status === 'active' && (
                                  <button
                                    onClick={() => handleSuspend(tenant.id)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-yellow-600 hover:bg-muted"
                                  >
                                    <Pause className="h-3.5 w-3.5" /> Suspend
                                  </button>
                                )}
                                <button
                                  onClick={() => openDeleteDialog(tenant)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted"
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Delete
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Deleted Tenants Search */}
          <Card>
            <CardContent className="p-4">
              <SearchInput
                containerClassName="flex-1 min-w-[200px]"
                placeholder="Search deleted tenants..."
                value={deletedSearch}
                onChange={setDeletedSearch}
              />
            </CardContent>
          </Card>

          {/* Deleted Tenants List */}
          <Card>
            <CardHeader>
              <CardTitle>
                {deletedData?.pagination?.total !== undefined
                  ? `${deletedData.pagination.total} deleted tenants`
                  : 'Deleted Tenants'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {deletedLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : deletedTenants.length === 0 ? (
                <EmptyState
                  icon={Trash2}
                  title="No deleted tenants"
                  description="There are no soft-deleted tenants."
                />
              ) : (
                <div className="divide-y divide-border">
                  {deletedTenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between py-4 first:pt-0 last:pb-0 -mx-6 px-6"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{tenant.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {tenant.slug}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge className={PLAN_COLORS[tenant.plan] || ''}>{tenant.plan}</Badge>
                          <Badge className="bg-slate-100 text-slate-500">deleted</Badge>
                          <span className="text-xs text-muted-foreground">
                            Deleted {formatDistanceToNow(new Date(tenant.updated_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(tenant)}
                          disabled={restoreMutation.isPending}
                        >
                          {restoreMutation.isPending ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Restore
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openHardDeleteDialog(tenant)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Hard Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogContent>
          <DialogClose onClose={() => setCreateOpen(false)} />
          <DialogHeader>
            <DialogTitle>Create Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Slug</label>
              <Input
                placeholder="my-company"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lowercase alphanumeric with hyphens, 3-63 chars
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Name</label>
              <Input
                placeholder="My Company"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Plan</label>
              <Select value={formPlan} onChange={(e) => setFormPlan(e.target.value)}>
                <option value="free">Free</option>
                <option value="startup">Startup</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending || !formSlug || !formName}
              >
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onClose={() => !hardDeleteMutation.isPending && setDeleteTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogClose onClose={() => !hardDeleteMutation.isPending && setDeleteTarget(null)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Tenant
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            {!cascadeResult ? (
              <>
                <p className="text-sm text-muted-foreground">
                  You are about to delete <span className="font-mono font-semibold text-foreground">{deleteTarget?.slug}</span>.
                  Choose the deletion mode:
                </p>

                {/* Mode Selection */}
                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${deleteMode === 'soft' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'}`}
                    onClick={() => setDeleteMode('soft')}
                  >
                    <input type="radio" name="deleteMode" checked={deleteMode === 'soft'} onChange={() => setDeleteMode('soft')} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Soft Delete</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Marks the tenant as deleted. Data is preserved in the database but the tenant becomes inaccessible.
                        The slug <span className="font-semibold">cannot be reused</span>.
                      </p>
                    </div>
                  </label>
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${deleteMode === 'hard' ? 'border-destructive bg-destructive/5' : 'border-border hover:border-muted-foreground/30'}`}
                    onClick={() => setDeleteMode('hard')}
                  >
                    <input type="radio" name="deleteMode" checked={deleteMode === 'hard'} onChange={() => setDeleteMode('hard')} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-destructive">Hard Delete (Cascade)</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Permanently removes the tenant and <span className="font-semibold">all associated data</span> — users, tickets,
                        incidents, dashboards, alert rules, integrations, observability data, and more.
                        The slug <span className="font-semibold">can be reused</span>. This action is <span className="font-semibold">irreversible</span>.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Hard delete confirmation */}
                {deleteMode === 'hard' && (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-xs text-destructive font-medium">
                      Type the tenant slug to confirm permanent deletion:
                    </p>
                    <Input
                      placeholder={deleteTarget?.slug}
                      value={deleteConfirmSlug}
                      onChange={(e) => setDeleteConfirmSlug(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending || hardDeleteMutation.isPending}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteConfirm}
                    disabled={
                      deleteMutation.isPending ||
                      hardDeleteMutation.isPending ||
                      (deleteMode === 'hard' && deleteConfirmSlug !== deleteTarget?.slug)
                    }
                  >
                    {(deleteMutation.isPending || hardDeleteMutation.isPending) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {deleteMode === 'hard' ? 'Permanently Delete' : 'Soft Delete'}
                  </Button>
                </div>
              </>
            ) : (
              /* Cascade Delete Results */
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <p className="text-sm text-green-700 dark:text-green-400">
                    Tenant <span className="font-mono font-semibold">{cascadeResult.tenant_slug}</span> permanently deleted.
                    {' '}<span className="font-semibold">{cascadeResult.total_documents_deleted.toLocaleString()}</span> documents removed.
                  </p>
                </div>

                {/* Step-by-step cleanup */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" /> Database Cleanup
                  </h4>
                  <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {cascadeResult.steps
                      .filter((s) => s.deleted_count > 0 || s.status === 'error')
                      .map((step) => (
                        <div key={step.collection} className="flex items-center justify-between px-3 py-1.5 text-xs">
                          <span className="text-foreground">{step.label}</span>
                          <div className="flex items-center gap-1.5">
                            {step.status === 'success' ? (
                              <>
                                <span className="text-muted-foreground">{step.deleted_count.toLocaleString()}</span>
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              </>
                            ) : (
                              <>
                                <span className="text-destructive text-[10px]">{step.error}</span>
                                <XCircle className="h-3 w-3 text-destructive" />
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    {cascadeResult.steps.filter((s) => s.deleted_count === 0 && s.status === 'success').length > 0 && (
                      <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                        + {cascadeResult.steps.filter((s) => s.deleted_count === 0 && s.status === 'success').length} collections already empty
                      </div>
                    )}
                  </div>
                </div>

                {/* LGTM Cleanup */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" /> Observability (LGTM) Cleanup
                  </h4>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {cascadeResult.lgtm_cleanup.results.map((r) => (
                      <div key={r.service} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-foreground">{r.service}</span>
                        <div className="flex items-center gap-1.5">
                          {r.status === 'purged' ? (
                            <><span className="text-green-600 dark:text-green-400">Purged</span><CheckCircle2 className="h-3 w-3 text-green-500" /></>
                          ) : r.status === 'retention-based' ? (
                            <><span className="text-muted-foreground">Via retention</span><Clock className="h-3 w-3 text-muted-foreground" /></>
                          ) : (
                            <><span className="text-amber-500">{r.detail || r.status}</span><AlertTriangle className="h-3 w-3 text-amber-500" /></>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button onClick={() => { setDeleteTarget(null); setCascadeResult(null); }}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTenant} onClose={() => setEditTenant(null)}>
        <DialogContent>
          <DialogClose onClose={() => setEditTenant(null)} />
          <DialogHeader>
            <DialogTitle>Edit Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Plan</label>
              <Select value={editPlan} onChange={(e) => setEditPlan(e.target.value)}>
                <option value="free">Free</option>
                <option value="startup">Startup</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
              <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="provisioning">Provisioning</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditTenant(null)}>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
