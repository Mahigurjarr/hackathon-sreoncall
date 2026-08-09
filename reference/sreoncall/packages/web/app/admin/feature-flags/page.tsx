'use client';

import { useState } from 'react';
import {
  useFeatureFlags,
  useCreateFeatureFlag,
  useUpdateFeatureFlag,
  useDeleteFeatureFlag,
  useAdminTenants,
  type FeatureFlag,
} from '@/lib/hooks/useAdmin';
import { Plus, Trash2, Flag, ChevronDown, ChevronRight, Building2, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { toast } from 'sonner';

export default function FeatureFlagsPage() {
  const { data: flags, isLoading } = useFeatureFlags();
  const { data: tenants } = useAdminTenants();
  const createFlag = useCreateFeatureFlag();
  const updateFlag = useUpdateFeatureFlag();
  const deleteFlag = useDeleteFeatureFlag();
  const [showCreate, setShowCreate] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: '', description: '', default_value: false });
  const [expandedFlag, setExpandedFlag] = useState<string | null>(null);
  const [addOverrideFor, setAddOverrideFor] = useState<string | null>(null);
  const [overrideTenantId, setOverrideTenantId] = useState('');
  const [overrideValue, setOverrideValue] = useState(false);

  async function handleCreate() {
    if (!newFlag.key) return;
    try {
      await createFlag.mutateAsync(newFlag);
      setShowCreate(false);
      setNewFlag({ key: '', description: '', default_value: false });
      toast.success('Feature flag created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create flag');
    }
  }

  async function handleToggle(flag: FeatureFlag) {
    try {
      await updateFlag.mutateAsync({ id: flag._id, input: { default_value: !flag.default_value } });
      toast.success(`Flag ${flag.default_value ? 'disabled' : 'enabled'} globally`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update flag');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this feature flag?')) return;
    try {
      await deleteFlag.mutateAsync(id);
      toast.success('Flag deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete flag');
    }
  }

  async function handleAddOverride(flag: FeatureFlag) {
    if (!overrideTenantId) return;
    const existing = flag.tenant_overrides.filter((o) => o.tenant_id !== overrideTenantId);
    const newOverrides = [...existing, { tenant_id: overrideTenantId, value: overrideValue }];
    try {
      await updateFlag.mutateAsync({ id: flag._id, input: { tenant_overrides: newOverrides } });
      toast.success('Tenant override added');
      setAddOverrideFor(null);
      setOverrideTenantId('');
      setOverrideValue(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to add override');
    }
  }

  async function handleRemoveOverride(flag: FeatureFlag, tenantId: string) {
    const newOverrides = flag.tenant_overrides.filter((o) => o.tenant_id !== tenantId);
    try {
      await updateFlag.mutateAsync({ id: flag._id, input: { tenant_overrides: newOverrides } });
      toast.success('Tenant override removed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove override');
    }
  }

  function getTenantName(tenantId: string): string {
    const t = tenants?.find((t) => t._id === tenantId);
    return t ? `${t.name} (${t.slug})` : tenantId;
  }

  // Filter out tenants already overridden
  function getAvailableTenants(flag: FeatureFlag) {
    const overriddenIds = new Set(flag.tenant_overrides.map((o) => o.tenant_id));
    return (tenants || []).filter((t) => !overriddenIds.has(t._id) && !t.is_platform_tenant);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Feature Flags</h1>
          <p className="text-sm text-muted-foreground">Toggle features globally or per-tenant</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Flag
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowCreate(false)} />
          <DialogHeader>
            <DialogTitle>Create Feature Flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Key</label>
              <Input
                placeholder="e.g. ai_agents_enabled"
                value={newFlag.key}
                onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Description</label>
              <Input
                placeholder="What does this flag control?"
                value={newFlag.description}
                onChange={(e) => setNewFlag({ ...newFlag, description: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newFlag.default_value}
                onChange={(e) => setNewFlag({ ...newFlag, default_value: e.target.checked })}
                className="rounded"
              />
              Default enabled
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createFlag.isPending || !newFlag.key}>
                {createFlag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !flags?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Flag className="mb-3 h-10 w-10 opacity-50" />
          <p>No feature flags configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => {
            const isExpanded = expandedFlag === flag._id;
            return (
              <div key={flag._id} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Flag row */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => setExpandedFlag(isExpanded ? null : flag._id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-sm font-medium">{flag.key}</p>
                        {flag.tenant_overrides.length > 0 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {flag.tenant_overrides.length} override{flag.tenant_overrides.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{flag.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Global</span>
                      <button
                        onClick={() => handleToggle(flag)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          flag.default_value ? 'bg-[#16A34A]' : 'bg-[#334155]'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${flag.default_value ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <button onClick={() => handleDelete(flag._id)} className="text-muted-foreground hover:text-[#DC2626] transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded: per-tenant overrides */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" /> Tenant Overrides
                      </h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAddOverrideFor(flag._id);
                          setOverrideTenantId('');
                          setOverrideValue(!flag.default_value);
                        }}
                      >
                        <Plus className="mr-1.5 h-3 w-3" /> Add Override
                      </Button>
                    </div>

                    {flag.tenant_overrides.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No per-tenant overrides. All tenants use the global default ({flag.default_value ? 'enabled' : 'disabled'}).
                      </p>
                    ) : (
                      <div className="divide-y divide-border rounded-lg border border-border bg-card">
                        {flag.tenant_overrides.map((override) => (
                          <div key={override.tenant_id} className="flex items-center justify-between px-3 py-2">
                            <span className="text-sm text-foreground">{getTenantName(override.tenant_id)}</span>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium ${override.value ? 'text-green-600' : 'text-red-500'}`}>
                                {override.value ? 'Enabled' : 'Disabled'}
                              </span>
                              <button
                                onClick={() => handleRemoveOverride(flag, override.tenant_id)}
                                className="text-muted-foreground hover:text-[#DC2626] transition-colors"
                                title="Remove override"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add override dialog */}
                    {addOverrideFor === flag._id && (
                      <div className="mt-3 rounded-lg border border-border bg-card p-3 space-y-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-foreground">Tenant</label>
                          <select
                            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                            value={overrideTenantId}
                            onChange={(e) => setOverrideTenantId(e.target.value)}
                          >
                            <option value="">Select a tenant...</option>
                            {getAvailableTenants(flag).map((t) => (
                              <option key={t._id} value={t._id}>{t.name} ({t.slug})</option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={overrideValue}
                            onChange={(e) => setOverrideValue(e.target.checked)}
                            className="rounded"
                          />
                          {overrideValue ? 'Enable' : 'Disable'} for this tenant
                        </label>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleAddOverride(flag)}
                            disabled={!overrideTenantId || updateFlag.isPending}
                          >
                            {updateFlag.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setAddOverrideFor(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
