'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminTenant, useUpdateTenant, type TenantType } from '@/lib/hooks/useAdmin';
import {
  useDeleteTenant,
  useHardDeleteTenant,
  type CascadeDeleteResult,
} from '@/lib/hooks/usePlatformAdmin';
import { ArrowLeft, Users, Siren, TicketCheck, Trash2, AlertTriangle, Loader2, CheckCircle2, XCircle, Clock, Database, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TYPE_COLORS: Record<string, string> = {
  standalone: 'bg-[rgba(148,163,184,0.15)] text-[#94A3B8]',
  provider: 'bg-[rgba(124,58,237,0.15)] text-[#7C3AED]',
  consumer: 'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
};

export default function TenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: tenant, isLoading } = useAdminTenant(id);
  const updateTenant = useUpdateTenant();
  const deleteMutation = useDeleteTenant();
  const hardDeleteMutation = useHardDeleteTenant();

  const [editType, setEditType] = useState<TenantType | ''>('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'soft' | 'hard'>('soft');
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [cascadeResult, setCascadeResult] = useState<CascadeDeleteResult | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!tenant) {
    return <div className="py-20 text-center text-muted-foreground">Tenant not found</div>;
  }

  async function handleTypeChange(type: TenantType) {
    try {
      await updateTenant.mutateAsync({ id, input: { type } });
      setEditType('');
      toast.success('Tenant type updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update type');
    }
  }

  async function handleStatusToggle() {
    const newStatus = tenant!.status === 'active' ? 'suspended' : 'active';
    try {
      await updateTenant.mutateAsync({ id, input: { status: newStatus } });
      toast.success(`Tenant ${newStatus === 'active' ? 'reactivated' : 'suspended'}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  }

  function openDeleteDialog() {
    setDeleteOpen(true);
    setDeleteMode('soft');
    setDeleteConfirmSlug('');
    setCascadeResult(null);
  }

  function handleDeleteConfirm() {
    if (!tenant) return;

    if (deleteMode === 'hard') {
      hardDeleteMutation.mutate(id, {
        onSuccess: (result) => {
          setCascadeResult(result);
          toast.success(`Tenant "${tenant.slug}" permanently deleted`);
        },
        onError: (err) => toast.error(err.message),
      });
    } else {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          toast.success(`Tenant "${tenant.slug}" soft-deleted`);
          setDeleteOpen(false);
          router.push('/admin/tenants');
        },
        onError: (err) => toast.error(err.message),
      });
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/admin/tenants')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Tenants
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStatusToggle}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              tenant.status === 'active'
                ? 'bg-[rgba(234,179,8,0.15)] text-[#EAB308] hover:bg-[rgba(234,179,8,0.25)]'
                : 'bg-[rgba(22,163,74,0.15)] text-[#16A34A] hover:bg-[rgba(22,163,74,0.25)]',
            )}
          >
            {tenant.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
          <button
            onClick={openDeleteDialog}
            className="rounded-lg bg-[rgba(220,38,38,0.15)] p-2 text-[#DC2626] hover:bg-[rgba(220,38,38,0.25)] transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div
          className="rounded-xl border border-border bg-card p-4 flex items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => router.push(`/admin/tenants/${id}/users`)}
        >
          <Users className="h-8 w-8 text-[#2563EB] opacity-70" />
          <div>
            <p className="text-xs text-muted-foreground">Users</p>
            <p className="text-lg font-bold">{tenant.stats.user_count}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <Siren className="h-8 w-8 text-[#DC2626] opacity-70" />
          <div>
            <p className="text-xs text-muted-foreground">Open Incidents</p>
            <p className="text-lg font-bold">{tenant.stats.open_incidents}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <Siren className="h-8 w-8 text-muted-foreground opacity-50" />
          <div>
            <p className="text-xs text-muted-foreground">Total Incidents</p>
            <p className="text-lg font-bold">{tenant.stats.total_incidents}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <TicketCheck className="h-8 w-8 text-[#FF6B2B] opacity-70" />
          <div>
            <p className="text-xs text-muted-foreground">Total Tickets</p>
            <p className="text-lg font-bold">{tenant.stats.total_tickets}</p>
          </div>
        </div>
      </div>

      {/* Tenant Info */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Details</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Tenant ID</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(tenant._id);
                  toast.success('Tenant ID copied to clipboard');
                }}
                className="font-mono text-xs bg-muted/50 hover:bg-muted px-2 py-1 rounded cursor-pointer transition-colors"
                title="Click to copy"
              >
                {tenant._id}
              </button>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="capitalize font-medium">{tenant.plan}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize font-medium">{tenant.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(tenant.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform Tenant</span>
              <span>{tenant.is_platform_tenant ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>

        {/* Type Selector */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Tenant Type</h2>
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', TYPE_COLORS[tenant.type])}>
              {tenant.type}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['standalone', 'provider', 'consumer'] as TenantType[])
              .filter((t) => t !== tenant.type)
              .map((t) => (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  disabled={updateTenant.isPending}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  Change to {t}
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => !hardDeleteMutation.isPending && setDeleteOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogClose onClose={() => !hardDeleteMutation.isPending && setDeleteOpen(false)} />
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
                  You are about to delete <span className="font-mono font-semibold text-foreground">{tenant.slug}</span>.
                  Choose the deletion mode:
                </p>

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

                {deleteMode === 'hard' && (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-xs text-destructive font-medium">
                      Type the tenant slug to confirm permanent deletion:
                    </p>
                    <Input
                      placeholder={tenant.slug}
                      value={deleteConfirmSlug}
                      onChange={(e) => setDeleteConfirmSlug(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteMutation.isPending || hardDeleteMutation.isPending}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteConfirm}
                    disabled={
                      deleteMutation.isPending ||
                      hardDeleteMutation.isPending ||
                      (deleteMode === 'hard' && deleteConfirmSlug !== tenant.slug)
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
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <p className="text-sm text-green-700 dark:text-green-400">
                    Tenant <span className="font-mono font-semibold">{cascadeResult.tenant_slug}</span> permanently deleted.
                    {' '}<span className="font-semibold">{cascadeResult.total_documents_deleted.toLocaleString()}</span> documents removed.
                  </p>
                </div>

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
                  <Button onClick={() => { setDeleteOpen(false); setCascadeResult(null); router.push('/admin/tenants'); }}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
