'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { GitBranch, Plus, Trash2, Loader2, X, Pencil, Lock, Info, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useEscalationPolicies,
  useCreateEscalationPolicy,
  useUpdateEscalationPolicy,
  useDeleteEscalationPolicy,
  type EscalationStep,
  type EscalationPolicy,
  type NotifyChannel,
} from '@/lib/hooks/useEscalationPolicies';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTeams } from '@/lib/hooks/useTeams';
import { useOnCallSchedules } from '@/lib/hooks/useOnCallSchedules';
import { useConsumerSupportContract, useConsumerManagedTiers, useAddConsumerTier, useUpdateConsumerTier, useDeleteConsumerTier, type TierNotifyChannel } from '@/lib/hooks/useSupportContracts';

const ALL_NOTIFY_CHANNELS: { value: NotifyChannel; label: string }[] = [
  { value: 'in_app', label: 'In-App' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'voice', label: 'Voice Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
  { value: 'teams', label: 'Teams' },
];

interface StepRow {
  delay_minutes: number;
  note: string;
  notify_channels: NotifyChannel[];
  targets: string[];
  target_type: 'user' | 'team' | 'schedule' | 'provider_escalation';
}

function EPStatusBadge({ status }: { status: 'active' | 'disabled' }) {
  return status === 'active' ? (
    <span className="inline-flex items-center rounded-full bg-[#F0FDF4] px-2 py-0.5 text-xs font-medium text-[#16A34A] border border-[#BBF7D0]">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 border border-slate-200">
      Disabled
    </span>
  );
}

// ─── EP Form Dialog (shared for create + edit) ─────────────────────────────

function EPFormDialog({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy?: EscalationPolicy | null;
}) {
  const isEdit = !!policy;
  const createMutation = useCreateEscalationPolicy();
  const updateMutation = useUpdateEscalationPolicy();
  const { data: users } = useUsers({ status: 'active' });
  const { data: teams = [] } = useTeams();
  const { data: schedules = [] } = useOnCallSchedules();

  const [name, setName] = useState(policy?.name ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [status, setStatus] = useState<'active' | 'disabled'>(policy?.status ?? 'active');
  const [repeatCount, setRepeatCount] = useState(policy?.repeat_count ?? 0);
  const [repeatInterval, setRepeatInterval] = useState(policy?.repeat_interval_minutes ?? 30);
  const [steps, setSteps] = useState<StepRow[]>(
    policy?.steps?.map((s) => ({
      delay_minutes: s.delay_minutes,
      note: s.note ?? '',
      notify_channels: s.notify_channels ?? ['in_app', 'email'],
      targets: s.targets ?? [],
      target_type: (s.target_type as StepRow['target_type']) ?? 'user',
    })) ?? [{ delay_minutes: 5, note: '', notify_channels: ['in_app', 'email'], targets: [], target_type: 'user' as const }]
  );

  const [lastPolicy, setLastPolicy] = useState(policy);
  if (policy !== lastPolicy) {
    setLastPolicy(policy);
    setName(policy?.name ?? '');
    setDescription(policy?.description ?? '');
    setStatus(policy?.status ?? 'active');
    setRepeatCount(policy?.repeat_count ?? 0);
    setRepeatInterval(policy?.repeat_interval_minutes ?? 30);
    setSteps(
      policy?.steps?.map((s) => ({
        delay_minutes: s.delay_minutes,
        note: s.note ?? '',
        notify_channels: s.notify_channels ?? ['in_app', 'email'],
        targets: s.targets ?? [],
        target_type: (s.target_type as StepRow['target_type']) ?? 'user',
      })) ?? [{ delay_minutes: 5, note: '', notify_channels: ['in_app', 'email'], targets: [], target_type: 'user' as const }]
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, { delay_minutes: 5, note: '', notify_channels: ['in_app', 'email'], targets: [], target_type: 'user' }]);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStep(idx: number, field: keyof StepRow, value: string | number | NotifyChannel[]) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  }

  function toggleChannel(idx: number, channel: NotifyChannel) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const channels = s.notify_channels.includes(channel)
          ? s.notify_channels.filter((c) => c !== channel)
          : [...s.notify_channels, channel];
        return { ...s, notify_channels: channels.length > 0 ? channels : ['in_app'] };
      })
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const policySteps: EscalationStep[] = steps.map((s) => ({
      delay_minutes: s.delay_minutes,
      note: s.note || undefined,
      notify_channels: s.notify_channels,
      targets: s.targets,
      target_type: s.target_type,
    }));
    try {
      if (isEdit && policy) {
        await updateMutation.mutateAsync({
          id: policy._id,
          input: {
            name: name.trim(),
            description: description.trim() || undefined,
            steps: policySteps,
            status,
            repeat_count: repeatCount,
            repeat_interval_minutes: repeatInterval,
          },
        });
        toast.success('Escalation policy updated');
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          steps: policySteps,
          repeat_count: repeatCount,
          repeat_interval_minutes: repeatInterval,
        });
        toast.success('Escalation policy created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save escalation policy');
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Escalation Policy' : 'Create Escalation Policy'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input placeholder="e.g. On-Call Escalation" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="When is this policy used?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {isEdit && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Status</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Steps</label>
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-6 shrink-0">{idx + 1}.</span>
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        className="w-20"
                        value={step.delay_minutes}
                        onChange={(e) => updateStep(idx, 'delay_minutes', parseInt(e.target.value) || 1)}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">min delay</span>
                      <Input
                        placeholder="Note (optional)"
                        value={step.note}
                        onChange={(e) => updateStep(idx, 'note', e.target.value)}
                        className="flex-1"
                      />
                    </div>
                    {steps.length > 1 && (
                      <button type="button" onClick={() => removeStep(idx)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="pl-6">
                    <span className="text-xs text-muted-foreground mb-1 block">Notify via:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_NOTIFY_CHANNELS.map((ch) => (
                        <button
                          key={ch.value}
                          type="button"
                          onClick={() => toggleChannel(idx, ch.value)}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                            step.notify_channels.includes(ch.value)
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                          }`}
                        >
                          {ch.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pl-6">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">Notify:</span>
                      {(['user', 'team', 'schedule', 'provider_escalation'] as const).map((tt) => (
                        <button
                          key={tt}
                          type="button"
                          onClick={() => {
                            updateStep(idx, 'target_type', tt);
                            if (tt === 'provider_escalation') {
                              setSteps((prev) => prev.map((s, i) => i === idx ? { ...s, targets: [] } : s));
                            }
                          }}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                            step.target_type === tt
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                          }`}
                        >
                          {tt === 'user'
                            ? 'Users'
                            : tt === 'team'
                              ? 'Team'
                              : tt === 'schedule'
                                ? 'On-Call Schedule'
                                : 'Provider Escalation'}
                        </button>
                      ))}
                    </div>
                    {step.target_type === 'provider_escalation' ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                        <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                        <p className="text-[11px] text-primary">
                          Escalates to your linked provider (AlyGroup). No target selection needed — the provider&apos;s on-call will be paged automatically.
                        </p>
                      </div>
                    ) : step.target_type === 'schedule' ? (
                      <div className="flex flex-wrap gap-1.5">
                        {schedules.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSteps((prev) =>
                                prev.map((st, i) => {
                                  if (i !== idx) return st;
                                  const targets = st.targets.includes(s.id)
                                    ? st.targets.filter((t) => t !== s.id)
                                    : [...st.targets, s.id];
                                  return { ...st, targets };
                                })
                              );
                            }}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                              step.targets.includes(s.id)
                                ? 'bg-info/10 text-info border-info/30'
                                : 'bg-muted text-muted-foreground border-border hover:border-info/30'
                            }`}
                          >
                            {s.name}
                          </button>
                        ))}
                        {schedules.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">No on-call schedules found</p>
                        )}
                      </div>
                    ) : step.target_type === 'team' ? (
                      <div className="flex flex-wrap gap-1.5">
                        {teams.map((t) => {
                          const teamId = t.id ?? t._id;
                          return (
                            <button
                              key={teamId}
                              type="button"
                              onClick={() => {
                                setSteps((prev) =>
                                  prev.map((st, i) => {
                                    if (i !== idx) return st;
                                    const targets = st.targets.includes(teamId)
                                      ? st.targets.filter((t2) => t2 !== teamId)
                                      : [...st.targets, teamId];
                                    return { ...st, targets };
                                  })
                                );
                              }}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                                step.targets.includes(teamId)
                                  ? 'bg-primary/10 text-primary border-primary/30'
                                  : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                              }`}
                            >
                              {t.name}
                            </button>
                          );
                        })}
                        {teams.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">No teams found</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(users || []).map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setSteps((prev) =>
                                prev.map((s, i) => {
                                  if (i !== idx) return s;
                                  const targets = s.targets.includes(u.id)
                                    ? s.targets.filter((t) => t !== u.id)
                                    : [...s.targets, u.id];
                                  return { ...s, targets };
                                })
                              );
                            }}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                              step.targets.includes(u.id)
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                            }`}
                          >
                            {u.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {step.target_type !== 'provider_escalation' && step.targets.length === 0 && (
                      <p className="text-[11px] text-[#A16207] mt-1">
                        Select at least one {step.target_type === 'schedule' ? 'schedule' : step.target_type === 'team' ? 'team' : 'user'} to notify
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addStep}>
              <Plus className="mr-1 h-3 w-3" />
              Add Step
            </Button>
          </div>

          {/* Repeat settings */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="text-sm font-medium text-foreground">Repeat Policy</label>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground">Repeat</label>
                <Input
                  type="number"
                  min={0}
                  className="w-16"
                  value={repeatCount}
                  onChange={(e) => setRepeatCount(parseInt(e.target.value) || 0)}
                />
                <span className="text-xs text-muted-foreground">time(s)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground">every</label>
                <Input
                  type="number"
                  min={1}
                  className="w-16"
                  value={repeatInterval}
                  onChange={(e) => setRepeatInterval(parseInt(e.target.value) || 30)}
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              After all steps are exhausted, repeat the entire policy. Set to 0 to disable.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEdit ? 'Saving...' : 'Creating...'}</>
              ) : (
                isEdit ? 'Save Changes' : 'Create Policy'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function EscalationPoliciesPage() {
  const [showForm, setShowForm] = useState(false);
  const [editPolicy, setEditPolicy] = useState<EscalationPolicy | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType || 'standalone';
  const isConsumer = tenantType === 'consumer';

  const { data: policies, isLoading } = useEscalationPolicies();
  const { data: pageUsers } = useUsers({ status: 'active' });
  const { data: pageTeams = [] } = useTeams();
  const { data: managedContract } = useConsumerSupportContract();
  const { data: consumerTiers = [] } = useConsumerManagedTiers();
  const { data: ownSchedules = [] } = useOnCallSchedules();
  const addTierMutation = useAddConsumerTier();
  const updateTierMutation = useUpdateConsumerTier();
  const deleteTierMutation = useDeleteConsumerTier();
  const deleteMutation = useDeleteEscalationPolicy();

  const [showAddTier, setShowAddTier] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [tierForm, setTierForm] = useState<{ name: string; schedule_id: string; notify_channels: TierNotifyChannel[]; escalation_timeout_minutes: number | null }>({ name: '', schedule_id: '', notify_channels: ['in_app', 'voice'], escalation_timeout_minutes: null });

  const ALL_TIER_CHANNELS: { value: TierNotifyChannel; label: string }[] = [
    { value: 'in_app', label: 'In-App' }, { value: 'voice', label: 'Voice' },
    { value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' },
    { value: 'email', label: 'Email' }, { value: 'slack', label: 'Slack' },
  ];

  async function handleSaveConsumerTier() {
    if (!tierForm.name || !tierForm.schedule_id) return;
    try {
      if (editingTierId) {
        await updateTierMutation.mutateAsync({ id: editingTierId, ...tierForm });
        toast.success('Tier updated');
      } else {
        await addTierMutation.mutateAsync(tierForm);
        toast.success('Tier added');
      }
      setShowAddTier(false);
      setEditingTierId(null);
      setTierForm({ name: '', schedule_id: '', notify_channels: ['in_app', 'voice'], escalation_timeout_minutes: null });
    } catch { toast.error('Failed to save tier'); }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Policy deleted');
      setDeleteConfirm(null);
    } catch {
      toast.error('Failed to delete policy');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Escalation Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define how alerts escalate when on-call responders don&apos;t respond
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Policy
        </Button>
      </div>

      {/* Managed Support card — consumer tenants only */}
      {isConsumer && managedContract && managedContract.status === 'active' && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch className="h-4 w-4 text-primary" />
                Managed Support — {managedContract.provider_name ?? 'Provider'}
                <span className="inline-flex items-center rounded-full bg-[#F0FDF4] px-2 py-0.5 text-xs font-medium text-[#16A34A] border border-[#BBF7D0]">Active</span>
              </CardTitle>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Escalation policy managed with {managedContract.provider_name ?? 'your provider'} · {managedContract.coverage_window.type.toUpperCase()} coverage
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Provider tiers — locked */}
            {managedContract.tiers.map((tier) => (
              <div key={tier.level} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[rgba(255,107,43,0.12)] text-sm font-bold text-primary shrink-0">L{tier.level}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{tier.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0" />
                    {tier.schedule_name ?? '—'}
                    <span className="text-muted-foreground/50">·</span>
                    {tier.escalation_timeout_minutes ? `${tier.escalation_timeout_minutes}m timeout` : 'Final tier'}
                  </p>
                  <div className="flex gap-1 mt-1 flex-wrap">{(tier.notify_channels ?? []).map((ch) => <span key={ch} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">{ch.replace('_', '-')}</span>)}</div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary shrink-0">
                  <Lock className="h-3 w-3" />
                  Provider managed
                </span>
              </div>
            ))}

            {/* Consumer-managed tiers — editable */}
            {consumerTiers.map((tier) => (
              <div key={tier.id} className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
                {editingTierId === tier.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-[rgba(255,107,43,0.1)] text-xs font-bold text-primary shrink-0">L{tier.level}</div>
                      <input className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm" value={tierForm.name} onChange={(e) => setTierForm((p) => ({ ...p, name: e.target.value }))} placeholder="Tier name" />
                    </div>
                    <select className="w-full rounded border border-input bg-background px-2 py-1 text-sm" value={tierForm.schedule_id} onChange={(e) => setTierForm((p) => ({ ...p, schedule_id: e.target.value }))}>
                      <option value="">Select your schedule…</option>
                      {ownSchedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} className="w-36 rounded border border-input bg-background px-2 py-1 text-sm" placeholder="Escalation timeout (min)" value={tierForm.escalation_timeout_minutes ?? ''} onChange={(e) => setTierForm((p) => ({ ...p, escalation_timeout_minutes: e.target.value ? parseInt(e.target.value) : null }))} />
                      <span className="text-xs text-muted-foreground">min</span>
                      <span title="min timeout (leave blank = final tier)" aria-label="min timeout (leave blank = final tier)" className="inline-flex text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">{ALL_TIER_CHANNELS.map((ch) => <button key={ch.value} type="button" onClick={() => setTierForm((p) => ({ ...p, notify_channels: p.notify_channels.includes(ch.value) ? p.notify_channels.filter((c) => c !== ch.value) : [...p.notify_channels, ch.value] }))} className={`rounded-full px-2 py-0.5 text-[11px] border transition-colors ${tierForm.notify_channels.includes(ch.value) ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-muted-foreground border-border'}`}>{ch.label}</button>)}</div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={handleSaveConsumerTier} disabled={updateTierMutation.isPending}>Save</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingTierId(null); setTierForm({ name: '', schedule_id: '', notify_channels: ['in_app', 'voice'], escalation_timeout_minutes: null }); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-[rgba(255,107,43,0.1)] text-xs font-bold text-primary shrink-0">L{tier.level}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{tier.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <Clock className="h-3 w-3 shrink-0" />
                        {ownSchedules.find((s) => s.id === tier.schedule_id)?.name ?? tier.schedule_id}
                        <span className="text-muted-foreground/50">·</span>
                        {tier.escalation_timeout_minutes ? `${tier.escalation_timeout_minutes}m timeout` : 'Final tier'}
                      </p>
                      <div className="flex gap-1 mt-0.5 flex-wrap">{tier.notify_channels.map((ch) => <span key={ch} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{ch}</span>)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label="Edit tier"
                        title="Edit tier"
                        onClick={() => { setEditingTierId(tier.id); setTierForm({ name: tier.name, schedule_id: tier.schedule_id, notify_channels: tier.notify_channels, escalation_timeout_minutes: tier.escalation_timeout_minutes }); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-background text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete tier"
                        title="Delete tier"
                        onClick={async () => { try { await deleteTierMutation.mutateAsync(tier.id); toast.success('Tier removed'); } catch { toast.error('Failed'); } }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add consumer tier */}
            {showAddTier ? (
              <div className="rounded-lg border border-dashed border-primary/40 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">New tier (L{(managedContract.tiers.length + consumerTiers.length) + 1})</p>
                <input className="w-full rounded border border-input bg-background px-2 py-1 text-sm" value={tierForm.name} onChange={(e) => setTierForm((p) => ({ ...p, name: e.target.value }))} placeholder="Tier name (e.g. L3 Escalation)" />
                <select className="w-full rounded border border-input bg-background px-2 py-1 text-sm" value={tierForm.schedule_id} onChange={(e) => setTierForm((p) => ({ ...p, schedule_id: e.target.value }))}>
                  <option value="">Select your on-call schedule…</option>
                  {ownSchedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} className="w-44 rounded border border-input bg-background px-2 py-1 text-sm" placeholder="Timeout in minutes" value={tierForm.escalation_timeout_minutes ?? ''} onChange={(e) => setTierForm((p) => ({ ...p, escalation_timeout_minutes: e.target.value ? parseInt(e.target.value) : null }))} />
                  <button type="button" tabIndex={-1} aria-label="min timeout (leave blank = final tier)" title="min timeout (leave blank = final tier)" className="inline-flex text-muted-foreground/60 hover:text-muted-foreground transition-colors p-0 border-0 bg-transparent cursor-default">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">{ALL_TIER_CHANNELS.map((ch) => <button key={ch.value} type="button" onClick={() => setTierForm((p) => ({ ...p, notify_channels: p.notify_channels.includes(ch.value) ? p.notify_channels.filter((c) => c !== ch.value) : [...p.notify_channels, ch.value] }))} className={`rounded-full px-2 py-0.5 text-[11px] border transition-colors ${tierForm.notify_channels.includes(ch.value) ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-muted-foreground border-border'}`}>{ch.label}</button>)}</div>
                <div className="flex gap-2"><Button size="sm" className="h-7 text-xs" onClick={handleSaveConsumerTier} disabled={addTierMutation.isPending || !tierForm.name || !tierForm.schedule_id}>{addTierMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add Tier'}</Button><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAddTier(false); setTierForm({ name: '', schedule_id: '', notify_channels: ['in_app', 'voice'], escalation_timeout_minutes: null }); }}>Cancel</Button></div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setShowAddTier(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add your own tier (L{(managedContract.tiers.length + consumerTiers.length) + 1})
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !policies || policies.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No escalation policies"
          description="Create your first escalation policy to define how alerts are routed."
          actionLabel="New Policy"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {policies.map((policy) => (
            <Card key={policy._id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    {policy.name}
                    <EPStatusBadge status={policy.status ?? 'active'} />
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditPolicy(policy)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm(policy._id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {policy.description && (
                  <p className="mb-3 text-sm text-muted-foreground">{policy.description}</p>
                )}
                {/* Escalation Flow Visualization */}
                {policy.steps?.length > 0 && (
                  <div className="flex items-center gap-0 flex-wrap mb-3">
                    {policy.steps.map((step, idx) => {
                      const targetNames = step.target_type === 'provider_escalation'
                        ? 'Provider SRE Team'
                        : step.target_type === 'schedule'
                          ? (step.targets?.length ? 'On-Call Schedule' : 'On-Call Schedule')
                          : step.target_type === 'team'
                            ? step.targets?.map((tid: string) => {
                                const t = pageTeams.find((t) => (t.id ?? t._id) === tid);
                                return t?.name || 'Team';
                              }).join(', ') || 'No targets'
                            : step.targets?.map((tid: string) => {
                                const u = (pageUsers || []).find((u) => u.id === tid);
                                return u?.name || 'User';
                              }).join(', ') || 'No targets';
                      return (
                        <div key={idx} className="flex items-center">
                          <div className="flex flex-col items-center">
                            <div className={`rounded-lg border px-3 py-2 text-center min-w-[100px] ${idx === 0 ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase">L{idx + 1}</p>
                              <p className="text-xs font-medium text-foreground truncate max-w-[120px]">{targetNames}</p>
                              <p className="text-[10px] text-muted-foreground">{step.delay_minutes}m delay</p>
                              <div className="flex gap-1 justify-center mt-1">
                                {step.notify_channels?.slice(0, 3).map((ch: string) => (
                                  <span key={ch} className="rounded bg-muted px-1 py-0.5 text-[8px] text-muted-foreground">{ch}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                          {idx < (policy.steps?.length ?? 0) - 1 && (
                            <div className="flex items-center px-1">
                              <div className="w-6 h-px bg-border" />
                              <div className="text-muted-foreground text-[10px]">&rarr;</div>
                              <div className="w-6 h-px bg-border" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {policy.steps?.length ?? 0} {(policy.steps?.length ?? 0) === 1 ? 'step' : 'steps'}
                  </span>
                  {(policy.repeat_count ?? 0) > 0 && (
                    <span className="inline-flex items-center rounded-full bg-[#A16207]/10 px-2.5 py-0.5 text-xs font-medium text-[#A16207]">
                      Repeats {policy.repeat_count}x every {policy.repeat_interval_minutes}m
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <EPFormDialog
        open={showForm || !!editPolicy}
        onClose={() => { setShowForm(false); setEditPolicy(null); }}
        policy={editPolicy}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogClose onClose={() => setDeleteConfirm(null)} />
          <DialogHeader>
            <DialogTitle>Delete Policy</DialogTitle>
          </DialogHeader>
          <p className="px-6 text-sm text-muted-foreground">
            Are you sure you want to delete this escalation policy? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-4 px-6 pb-6">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting...</>
              ) : (
                'Delete'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
