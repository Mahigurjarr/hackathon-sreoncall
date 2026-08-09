'use client';

import { useState } from 'react';
import { useAdminPlans, useCreatePlan, useUpdatePlan, useDeletePlan, type PlanDefinition } from '@/lib/hooks/useAdmin';
import { Plus, Trash2, CreditCard, Pencil, X, Save, Star } from 'lucide-react';
import { toast } from 'sonner';

type StorageUnit = 'GB' | 'MB';

interface EditForm {
  display_name: string;
  description: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  sort_order: number;
  is_popular: boolean;
  features: string;
  storage_unit: StorageUnit;
  storage_value: number;
  limits: {
    // Team
    max_users: number;
    min_users: number;
    // Storage
    max_storage_gb: number;
    // API
    api_rate_limit: number;
    // Tickets & existing
    max_tickets_per_month: number;
    custom_fields: boolean;
    sla_management: boolean;
    custom_workflows: boolean;
    audit_log_retention_days: number;
    agents_enabled: boolean;
    max_agents: number;
    // Monthly limits
    max_incidents_per_month: number;
    max_notifications_per_day: number;
    // Capacity limits
    max_on_call_schedules: number;
    max_escalation_policies: number;
    max_synthetic_checks: number;
    max_status_pages: number;
    // Observability
    observability_retention_days: number;
    // v2 Communication
    max_sms_per_month: number;
    max_voice_per_month: number;
    max_whatsapp_per_month: number;
    // v2 Observability
    observability_log_ingestion_mbps: number;
    max_traces_per_day: number;
    observability_third_party_providers: number;
    // v2 Platform Config
    max_services: number;
    max_dashboards: number;
    max_alert_rules: number;
    max_slos: number;
    max_managed_tenants: number;
    // v2 AI
    max_ai_tokens_per_month: number;
    max_notetaker_minutes_per_month: number;
    // Feature toggles
    sso_enabled: boolean;
    scim_enabled: boolean;
    voice_whatsapp_enabled: boolean;
    white_label_enabled: boolean;
    ai_rca_enabled: boolean;
    ai_notetaker_enabled: boolean;
    byos_enabled: boolean;
    notification_channels: string[];
  };
}

function planToForm(plan: PlanDefinition): EditForm {
  const storageGb = plan.limits?.max_storage_gb ?? 1;
  const usesMb = storageGb < 1 || storageGb % 1 !== 0;
  return {
    display_name: plan.display_name,
    description: plan.description || '',
    price_monthly_cents: plan.price_monthly_cents,
    price_yearly_cents: plan.price_yearly_cents,
    sort_order: plan.sort_order,
    is_popular: (plan as any).is_popular ?? false,
    features: plan.features.join('\n'),
    storage_unit: usesMb ? 'MB' : 'GB',
    storage_value: usesMb ? Math.round(storageGb * 1024) : storageGb,
    limits: {
      max_users: plan.limits?.max_users ?? 5,
      min_users: (plan.limits as any)?.min_users ?? 0,
      max_tickets_per_month: plan.limits?.max_tickets_per_month ?? 100,
      max_storage_gb: storageGb,
      api_rate_limit: plan.limits?.api_rate_limit ?? 60,
      custom_fields: plan.limits?.custom_fields ?? false,
      sla_management: plan.limits?.sla_management ?? false,
      custom_workflows: plan.limits?.custom_workflows ?? false,
      audit_log_retention_days: plan.limits?.audit_log_retention_days ?? 7,
      agents_enabled: plan.limits?.agents_enabled ?? false,
      max_agents: plan.limits?.max_agents ?? 0,
      max_incidents_per_month: (plan.limits as any)?.max_incidents_per_month ?? 50,
      max_notifications_per_day: (plan.limits as any)?.max_notifications_per_day ?? 50,
      max_on_call_schedules: (plan.limits as any)?.max_on_call_schedules ?? 1,
      max_escalation_policies: (plan.limits as any)?.max_escalation_policies ?? 1,
      max_synthetic_checks: (plan.limits as any)?.max_synthetic_checks ?? 0,
      max_status_pages: (plan.limits as any)?.max_status_pages ?? 1,
      observability_retention_days: (plan.limits as any)?.observability_retention_days ?? 0,
      // v2 Communication
      max_sms_per_month: (plan.limits as any)?.max_sms_per_month ?? 0,
      max_voice_per_month: (plan.limits as any)?.max_voice_per_month ?? 0,
      max_whatsapp_per_month: (plan.limits as any)?.max_whatsapp_per_month ?? 0,
      // v2 Observability
      observability_log_ingestion_mbps: (plan.limits as any)?.observability_log_ingestion_mbps ?? 0,
      max_traces_per_day: (plan.limits as any)?.max_traces_per_day ?? 0,
      observability_third_party_providers: (plan.limits as any)?.observability_third_party_providers ?? 0,
      // v2 Platform Config
      max_services: (plan.limits as any)?.max_services ?? -1,
      max_dashboards: (plan.limits as any)?.max_dashboards ?? 3,
      max_alert_rules: (plan.limits as any)?.max_alert_rules ?? 5,
      max_slos: (plan.limits as any)?.max_slos ?? 0,
      max_managed_tenants: (plan.limits as any)?.max_managed_tenants ?? 0,
      // v2 AI
      max_ai_tokens_per_month: (plan.limits as any)?.max_ai_tokens_per_month ?? 0,
      max_notetaker_minutes_per_month: (plan.limits as any)?.max_notetaker_minutes_per_month ?? 0,
      // Feature toggles
      sso_enabled: (plan.limits as any)?.sso_enabled ?? false,
      scim_enabled: (plan.limits as any)?.scim_enabled ?? false,
      voice_whatsapp_enabled: (plan.limits as any)?.voice_whatsapp_enabled ?? false,
      white_label_enabled: (plan.limits as any)?.white_label_enabled ?? false,
      ai_rca_enabled: (plan.limits as any)?.ai_rca_enabled ?? false,
      ai_notetaker_enabled: (plan.limits as any)?.ai_notetaker_enabled ?? false,
      byos_enabled: (plan.limits as any)?.byos_enabled ?? false,
      notification_channels: (plan.limits as any)?.notification_channels ?? ['email'],
    },
  };
}

export default function PlansPage() {
  const { data: plans, isLoading, error } = useAdminPlans();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();
  const [showCreate, setShowCreate] = useState(false);
  const [newPlan, setNewPlan] = useState({ name: '', display_name: '', description: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  function startEditing(plan: PlanDefinition) {
    setEditingId(plan._id);
    setEditForm(planToForm(plan));
  }

  function cancelEditing() {
    setEditingId(null);
    setEditForm(null);
  }

  function setLimit<K extends keyof EditForm['limits']>(key: K, value: EditForm['limits'][K]) {
    if (!editForm) return;
    setEditForm({ ...editForm, limits: { ...editForm.limits, [key]: value } });
  }

  async function handleSave(planId: string) {
    if (!editForm) return;
    const features = editForm.features.split('\n').map((f) => f.trim()).filter(Boolean);
    const storageGb = editForm.storage_unit === 'MB' ? editForm.storage_value / 1024 : editForm.storage_value;
    try {
      await updatePlan.mutateAsync({
        id: planId,
        input: {
          display_name: editForm.display_name,
          description: editForm.description,
          price_monthly_cents: editForm.price_monthly_cents,
          price_yearly_cents: editForm.price_yearly_cents,
          sort_order: editForm.sort_order,
          is_popular: editForm.is_popular,
          features,
          limits: { ...editForm.limits, max_storage_gb: storageGb },
        },
      });
      toast.success('Plan updated');
      cancelEditing();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update plan');
    }
  }

  async function handleCreate() {
    if (!newPlan.name || !newPlan.display_name) return;
    try {
      await createPlan.mutateAsync(newPlan);
      setShowCreate(false);
      setNewPlan({ name: '', display_name: '', description: '' });
      toast.success('Plan created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create plan');
    }
  }

  async function handleToggleActive(plan: PlanDefinition) {
    try {
      await updatePlan.mutateAsync({ id: plan._id, input: { is_active: !plan.is_active } });
      toast.success(`Plan ${plan.is_active ? 'deactivated' : 'activated'}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update plan');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this plan definition?')) return;
    try {
      await deletePlan.mutateAsync(id);
      toast.success('Plan deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete plan');
    }
  }

  const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
  const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
  const checkboxLabelClass = 'flex items-center gap-2 text-xs text-muted-foreground';
  const sectionClass = 'mt-4 pt-4 border-t border-border';
  const sectionTitleClass = 'text-xs font-semibold text-foreground mb-3 uppercase tracking-wide';

  // Reusable number field with Unlimited checkbox
  function NumericLimitField({
    label,
    limitKey,
    supportsUnlimited = true,
  }: {
    label: string;
    limitKey: keyof EditForm['limits'];
    supportsUnlimited?: boolean;
  }) {
    if (!editForm) return null;
    const value = editForm.limits[limitKey] as number;
    const isUnlimited = value === -1;
    return (
      <div>
        <label className={labelClass}>{label}</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={-1}
            value={isUnlimited ? '' : value}
            disabled={isUnlimited}
            placeholder={isUnlimited ? '∞' : ''}
            onChange={(e) => setLimit(limitKey, parseInt(e.target.value) || 0 as any)}
            className={inputClass + (isUnlimited ? ' opacity-40' : '')}
          />
          {supportsUnlimited && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={isUnlimited}
                onChange={(e) => setLimit(limitKey, (e.target.checked ? -1 : 0) as any)}
                className="rounded border-border"
              />
              ∞
            </label>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Plan Definitions</h1>
          <p className="text-sm text-muted-foreground">Manage subscription plan tiers and feature limits</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Plan
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Create Plan</h3>
          <input
            placeholder="Plan name (e.g. pro)"
            value={newPlan.name}
            onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
            className={inputClass}
          />
          <input
            placeholder="Display name (e.g. Pro)"
            value={newPlan.display_name}
            onChange={(e) => setNewPlan({ ...newPlan, display_name: e.target.value })}
            className={inputClass}
          />
          <textarea
            placeholder="Description"
            value={newPlan.description}
            onChange={(e) => setNewPlan({ ...newPlan, description: e.target.value })}
            className={inputClass}
            rows={2}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={createPlan.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Create
            </button>
            <button onClick={() => setShowCreate(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#DC2626]/30 bg-[#DC2626]/5 p-5 text-sm">
          <p className="font-medium text-[#DC2626]">Failed to load plans</p>
          <p className="mt-1 text-muted-foreground">{error.message}</p>
        </div>
      ) : !plans?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <CreditCard className="mb-3 h-10 w-10 opacity-50" />
          <p>No plans defined yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) =>
            editingId === plan._id && editForm ? (
              <div key={plan._id} className="rounded-xl border-2 border-primary/50 bg-card p-5 space-y-4 sm:col-span-2 lg:col-span-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Editing: <span className="text-primary">{plan.name}</span></p>
                    <p className="text-xs text-muted-foreground">Slug cannot be changed. Use -1 or ∞ checkbox for unlimited.</p>
                  </div>
                  <button onClick={cancelEditing} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* ── Plan Info ─────────────────────────────────────── */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Display Name</label>
                    <input value={editForm.display_name} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Sort Order</label>
                    <input type="number" value={editForm.sort_order} onChange={(e) => setEditForm({ ...editForm, sort_order: parseInt(e.target.value) || 0 })} className={inputClass} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Description</label>
                    <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputClass} rows={2} />
                  </div>
                  <div>
                    <label className={labelClass}>Monthly Price (cents)</label>
                    <input type="number" min={0} value={editForm.price_monthly_cents} onChange={(e) => setEditForm({ ...editForm, price_monthly_cents: parseInt(e.target.value) || 0 })} className={inputClass} />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">${(editForm.price_monthly_cents / 100).toFixed(2)}/mo</p>
                  </div>
                  <div>
                    <label className={labelClass}>Yearly Price (cents)</label>
                    <input type="number" min={0} value={editForm.price_yearly_cents} onChange={(e) => setEditForm({ ...editForm, price_yearly_cents: parseInt(e.target.value) || 0 })} className={inputClass} />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">${(editForm.price_yearly_cents / 100).toFixed(2)}/yr</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Features (one per line)</label>
                    <textarea value={editForm.features} onChange={(e) => setEditForm({ ...editForm, features: e.target.value })} className={inputClass} rows={4} />
                  </div>
                  <div>
                    <label className={checkboxLabelClass}>
                      <input type="checkbox" checked={editForm.is_popular} onChange={(e) => setEditForm({ ...editForm, is_popular: e.target.checked })} className="rounded border-border" />
                      <Star className="h-3 w-3 text-yellow-500" />
                      Mark as "Most Popular"
                    </label>
                  </div>
                </div>

                {/* ── Team & Storage ──────────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Team & Storage</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="Max Users" limitKey="max_users" />
                    <NumericLimitField label="Min Users" limitKey="min_users" supportsUnlimited={false} />
                    <div>
                      <label className={labelClass}>Max Storage</label>
                      <div className="flex gap-1">
                        <input
                          type="number" min={0} value={editForm.storage_value}
                          onChange={(e) => setEditForm({ ...editForm, storage_value: parseInt(e.target.value) || 0 })}
                          className={inputClass + ' flex-1'}
                        />
                        <select
                          value={editForm.storage_unit}
                          onChange={(e) => {
                            const u = e.target.value as StorageUnit;
                            const v = u === 'MB' ? Math.round(editForm.storage_value * 1024) : parseFloat((editForm.storage_value / 1024).toFixed(2));
                            setEditForm({ ...editForm, storage_unit: u, storage_value: v });
                          }}
                          className="rounded-lg border border-border bg-background px-2 py-2 text-sm w-16"
                        >
                          <option value="MB">MB</option>
                          <option value="GB">GB</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>API Rate Limit (req/min)</label>
                      <input type="number" min={0} value={editForm.limits.api_rate_limit} onChange={(e) => setLimit('api_rate_limit', parseInt(e.target.value) || 0)} className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* ── Monthly Limits ──────────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Monthly Limits</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="Max Tickets/Month" limitKey="max_tickets_per_month" />
                    <NumericLimitField label="Max Incidents/Month" limitKey="max_incidents_per_month" />
                    <NumericLimitField label="Max Notifications/Day" limitKey="max_notifications_per_day" />
                    <div>
                      <label className={labelClass}>Audit Log Retention (days)</label>
                      <input type="number" min={0} value={editForm.limits.audit_log_retention_days} onChange={(e) => setLimit('audit_log_retention_days', parseInt(e.target.value) || 0)} className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* ── Capacity Limits ─────────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Capacity Limits</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="On-Call Schedules" limitKey="max_on_call_schedules" />
                    <NumericLimitField label="Escalation Policies" limitKey="max_escalation_policies" />
                    <NumericLimitField label="Synthetic Checks" limitKey="max_synthetic_checks" />
                    <NumericLimitField label="Status Pages" limitKey="max_status_pages" />
                    <NumericLimitField label="Max AI Agents" limitKey="max_agents" />
                    <div>
                      <label className={labelClass}>Observability Retention (days, 0=off)</label>
                      <input type="number" min={0} value={editForm.limits.observability_retention_days} onChange={(e) => setLimit('observability_retention_days', parseInt(e.target.value) || 0)} className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* ── Communication Limits ────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Communication Limits (monthly, -1 = unlimited)</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="Max SMS/month" limitKey="max_sms_per_month" />
                    <NumericLimitField label="Max Voice calls/month" limitKey="max_voice_per_month" />
                    <NumericLimitField label="Max WhatsApp/month" limitKey="max_whatsapp_per_month" />
                  </div>
                </div>

                {/* ── Observability Limits ────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Observability</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="Log ingestion (MB/s)" limitKey="observability_log_ingestion_mbps" supportsUnlimited={false} />
                    <NumericLimitField label="Max traces/day" limitKey="max_traces_per_day" />
                    <NumericLimitField label="3rd-party providers" limitKey="observability_third_party_providers" supportsUnlimited={false} />
                  </div>
                </div>

                {/* ── Platform Config Limits ───────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Platform Config</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="Max services" limitKey="max_services" />
                    <NumericLimitField label="Max dashboards" limitKey="max_dashboards" />
                    <NumericLimitField label="Max alert rules" limitKey="max_alert_rules" />
                    <NumericLimitField label="Max SLOs" limitKey="max_slos" />
                    <NumericLimitField label="Max managed tenants (MSP)" limitKey="max_managed_tenants" />
                  </div>
                </div>

                {/* ── AI Limits ────────────────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>AI</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumericLimitField label="Max AI tokens/month" limitKey="max_ai_tokens_per_month" />
                    <NumericLimitField label="Notetaker minutes/month" limitKey="max_notetaker_minutes_per_month" />
                  </div>
                </div>

                {/* ── Feature Toggles ─────────────────────────────────── */}
                <div className={sectionClass}>
                  <p className={sectionTitleClass}>Feature Toggles</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    {(
                      [
                        ['custom_fields', 'Custom Fields'],
                        ['sla_management', 'SLA Management'],
                        ['custom_workflows', 'Custom Workflows'],
                        ['agents_enabled', 'AI Agents Enabled'],
                        ['sso_enabled', 'SSO'],
                        ['scim_enabled', 'SCIM Provisioning'],
                        ['voice_whatsapp_enabled', 'Voice & WhatsApp'],
                        ['white_label_enabled', 'White-Label'],
                        ['ai_rca_enabled', 'AI RCA'],
                        ['ai_notetaker_enabled', 'AI Notetaker'],
                        ['byos_enabled', 'BYOS Integrations'],
                      ] as [keyof EditForm['limits'], string][]
                    ).map(([key, label]) => (
                      <label key={key} className={checkboxLabelClass}>
                        <input
                          type="checkbox"
                          checked={editForm.limits[key] as boolean}
                          onChange={(e) => setLimit(key, e.target.checked as any)}
                          className="rounded border-border"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-border">
                  <button onClick={() => handleSave(plan._id)} disabled={updatePlan.isPending}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    <Save className="h-3.5 w-3.5" /> Save Changes
                  </button>
                  <button onClick={cancelEditing} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={plan._id} className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-medium flex items-center gap-1">
                        {plan.display_name}
                        {(plan as any).is_popular && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                      </p>
                      <p className="text-xs text-muted-foreground">{plan.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEditing(plan)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(plan._id)} className="text-muted-foreground hover:text-[#DC2626] transition-colors p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{plan.description || 'No description'}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">${(plan.price_monthly_cents / 100).toFixed(2)}/mo</span>
                  <button onClick={() => handleToggleActive(plan)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${plan.is_active ? 'bg-[rgba(22,163,74,0.15)] text-[#16A34A]' : 'bg-[rgba(148,163,184,0.15)] text-[#94A3B8]'}`}>
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
                {/* Key limits summary */}
                <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                  {[
                    ['Users', plan.limits?.max_users],
                    ['Storage', `${plan.limits?.max_storage_gb ?? 1} GB`],
                    ['Incidents/mo', (plan.limits as any)?.max_incidents_per_month],
                    ['Notifs/day', (plan.limits as any)?.max_notifications_per_day],
                    ['Schedules', (plan.limits as any)?.max_on_call_schedules],
                    ['Agents', plan.limits?.max_agents],
                  ].map(([label, val]) => (
                    <span key={label as string}>
                      <span className="text-foreground/60">{label}:</span>{' '}
                      {val === -1 ? '∞' : val ?? '—'}
                    </span>
                  ))}
                </div>
                {plan.features.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {plan.features.map((f) => (
                      <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
