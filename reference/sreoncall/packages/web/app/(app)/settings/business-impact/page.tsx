'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Plus,
  Pencil,
  Trash2,
  DollarSign,
  Users,
  Activity,
  BarChart3,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import {
  useBusinessImpactConfigs,
  type BusinessImpactConfig,
  type CustomerTier,
} from '@/lib/hooks/useICCExtras';
import { useServices } from '@/lib/hooks/useServices';

const USER_SCOPES: { value: BusinessImpactConfig['affected_user_scope']; label: string }[] = [
  { value: 'all', label: 'All users' },
  { value: 'subset', label: 'Subset of users' },
  { value: 'internal_only', label: 'Internal only' },
];

interface FormData {
  service_id: string;
  revenue_per_request_cents: string;
  avg_requests_per_minute: string;
  affected_user_scope: BusinessImpactConfig['affected_user_scope'];
  estimated_users_affected_percent: string;
  total_user_count: string;
  support_escalation_threshold_minutes: string;
  notes: string;
  customer_tiers: CustomerTier[];
}

const EMPTY_FORM: FormData = {
  service_id: '',
  revenue_per_request_cents: '',
  avg_requests_per_minute: '',
  affected_user_scope: 'all',
  estimated_users_affected_percent: '100',
  total_user_count: '',
  support_escalation_threshold_minutes: '',
  notes: '',
  customer_tiers: [],
};

/** Parse a numeric input string to a number, or null when blank. */
function numOrNull(v: string): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function BusinessImpactSettingsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [newTier, setNewTier] = useState({ tier: '', count: '', sla_commitment: '' });

  const { data: configs = [], isLoading } = useBusinessImpactConfigs();
  const { data: servicesRes } = useServices();
  const services = servicesRes?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (editingId) {
        return api.patch(`/api/v1/business-impact-configs/${editingId}`, payload);
      }
      return api.post('/api/v1/business-impact-configs', payload);
    },
    onSuccess: () => {
      toast.success(editingId ? 'Configuration updated' : 'Configuration created');
      queryClient.invalidateQueries({ queryKey: ['business-impact-configs'] });
      closeDialog();
    },
    onError: () => {
      toast.error('Failed to save configuration');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/business-impact-configs/${id}`),
    onSuccess: () => {
      toast.success('Configuration deleted');
      queryClient.invalidateQueries({ queryKey: ['business-impact-configs'] });
    },
    onError: () => {
      toast.error('Failed to delete configuration');
    },
  });

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setNewTier({ tier: '', count: '', sla_commitment: '' });
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(config: BusinessImpactConfig) {
    setEditingId(config.id);
    setForm({
      service_id: config.service_id ?? '',
      revenue_per_request_cents: config.revenue_per_request_cents?.toString() ?? '',
      avg_requests_per_minute: config.avg_requests_per_minute?.toString() ?? '',
      affected_user_scope: config.affected_user_scope ?? 'all',
      estimated_users_affected_percent:
        config.estimated_users_affected_percent?.toString() ?? '100',
      total_user_count: config.total_user_count?.toString() ?? '',
      support_escalation_threshold_minutes:
        config.support_escalation_threshold_minutes?.toString() ?? '',
      notes: config.notes ?? '',
      customer_tiers: (config.customer_tiers ?? []).map((t) => ({ ...t })),
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!editingId && !form.service_id) {
      toast.error('Please select a service');
      return;
    }

    const payload: Record<string, unknown> = {
      revenue_per_request_cents: numOrNull(form.revenue_per_request_cents),
      avg_requests_per_minute: numOrNull(form.avg_requests_per_minute),
      affected_user_scope: form.affected_user_scope,
      estimated_users_affected_percent:
        numOrNull(form.estimated_users_affected_percent) ?? 100,
      total_user_count: numOrNull(form.total_user_count),
      support_escalation_threshold_minutes: numOrNull(
        form.support_escalation_threshold_minutes,
      ),
      notes: form.notes.trim() || null,
      customer_tiers: form.customer_tiers,
    };
    // service_id is immutable on the backend; only send it when creating.
    if (!editingId) payload.service_id = form.service_id;

    saveMutation.mutate(payload);
  }

  function addTier() {
    const count = numOrNull(newTier.count);
    if (!newTier.tier.trim() || count == null) return;
    setForm((f) => ({
      ...f,
      customer_tiers: [
        ...f.customer_tiers,
        {
          tier: newTier.tier.trim(),
          count,
          sla_commitment: newTier.sla_commitment.trim() || null,
        },
      ],
    }));
    setNewTier({ tier: '', count: '', sla_commitment: '' });
  }

  function removeTier(index: number) {
    setForm((f) => ({
      ...f,
      customer_tiers: f.customer_tiers.filter((_, i) => i !== index),
    }));
  }

  // Services that already have a config (exclude from create dropdown)
  const configuredServiceIds = new Set(configs.map((c) => c.service_id));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Business Impact Configuration
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Map revenue, user impact, and customer tiers to services for incident prioritization
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Config
        </Button>
      </div>

      {/* Configs Table */}
      <Card>
        <CardContent className="p-0">
          {configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <DollarSign className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">
                No business impact configurations
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add revenue and user impact data for your services to enable intelligent incident prioritization
              </p>
              <Button className="mt-4" size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Config
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Service
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Revenue / req
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Requests / min
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      User Scope
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Customer Tiers
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {configs.map((config) => (
                    <tr
                      key={config.id}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-foreground">
                          {config.service?.name ?? '--'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">
                          {config.revenue_per_request_cents != null
                            ? `$${(config.revenue_per_request_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '--'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">
                          {config.avg_requests_per_minute != null
                            ? config.avg_requests_per_minute.toLocaleString()
                            : '--'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="info">
                          {USER_SCOPES.find((s) => s.value === config.affected_user_scope)?.label ??
                            config.affected_user_scope}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-muted-foreground">
                          {config.customer_tiers?.length ?? 0} tier
                          {(config.customer_tiers?.length ?? 0) !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(config)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm('Delete this configuration?')) {
                                deleteMutation.mutate(config.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Business Impact Config' : 'Add Business Impact Config'}
            </DialogTitle>
            <DialogClose onClose={closeDialog} />
          </DialogHeader>

          <div className="max-h-[65vh] overflow-y-auto space-y-5 px-6 py-5">
            {/* Service Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Service</label>
              <Select
                value={form.service_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, service_id: e.target.value }))
                }
                disabled={!!editingId}
              >
                <option value="">Select a service...</option>
                {services.map((svc) => (
                  <option
                    key={svc.id}
                    value={svc.id}
                    disabled={!editingId && configuredServiceIds.has(svc.id)}
                  >
                    {svc.name}
                    {!editingId && configuredServiceIds.has(svc.id)
                      ? ' (configured)'
                      : ''}
                  </option>
                ))}
              </Select>
            </div>

            {/* Revenue per Request */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                Revenue per Request (cents)
              </label>
              <Input
                type="number"
                step="1"
                min="0"
                placeholder="e.g. 250"
                value={form.revenue_per_request_cents}
                onChange={(e) =>
                  setForm((f) => ({ ...f, revenue_per_request_cents: e.target.value }))
                }
              />
            </div>

            {/* Avg Requests per Minute */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                Average Requests per Minute
              </label>
              <Input
                type="number"
                min="0"
                placeholder="e.g. 12000"
                value={form.avg_requests_per_minute}
                onChange={(e) =>
                  setForm((f) => ({ ...f, avg_requests_per_minute: e.target.value }))
                }
              />
            </div>

            {/* Affected User Scope */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Affected User Scope
              </label>
              <Select
                value={form.affected_user_scope}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    affected_user_scope: e.target
                      .value as BusinessImpactConfig['affected_user_scope'],
                  }))
                }
              >
                {USER_SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Estimated Users Affected % */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Estimated Users Affected (%)
              </label>
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="0 - 100"
                value={form.estimated_users_affected_percent}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    estimated_users_affected_percent: e.target.value,
                  }))
                }
              />
            </div>

            {/* Total User Count */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Total User Count
              </label>
              <Input
                type="number"
                min="0"
                placeholder="e.g. 50000"
                value={form.total_user_count}
                onChange={(e) =>
                  setForm((f) => ({ ...f, total_user_count: e.target.value }))
                }
              />
            </div>

            {/* Support Escalation Threshold */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Support Escalation Threshold (minutes)
              </label>
              <Input
                type="number"
                min="0"
                placeholder="e.g. 30"
                value={form.support_escalation_threshold_minutes}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    support_escalation_threshold_minutes: e.target.value,
                  }))
                }
              />
            </div>

            {/* Customer Tiers */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Customer Tiers
              </label>
              {form.customer_tiers.length > 0 && (
                <div className="space-y-2">
                  {form.customer_tiers.map((tier, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <span className="flex-1 text-foreground">
                        {tier.tier}: {tier.count.toLocaleString()} customer
                        {tier.count !== 1 ? 's' : ''}
                        {tier.sla_commitment ? ` (SLA: ${tier.sla_commitment})` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Tier (e.g. Enterprise)"
                  value={newTier.tier}
                  onChange={(e) =>
                    setNewTier((t) => ({ ...t, tier: e.target.value }))
                  }
                  className="flex-1"
                />
                <Input
                  type="number"
                  min="0"
                  placeholder="Count"
                  value={newTier.count}
                  onChange={(e) =>
                    setNewTier((t) => ({ ...t, count: e.target.value }))
                  }
                  className="w-24"
                />
                <Input
                  placeholder="SLA (e.g. 99.9%)"
                  value={newTier.sla_commitment}
                  onChange={(e) =>
                    setNewTier((t) => ({ ...t, sla_commitment: e.target.value }))
                  }
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTier}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Notes</label>
              <textarea
                className="flex min-h-[70px] w-full rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated px-4 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/12 transition-[border-color,box-shadow] duration-150"
                placeholder="Optional context about this service's business impact..."
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {editingId ? 'Update' : 'Create'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
