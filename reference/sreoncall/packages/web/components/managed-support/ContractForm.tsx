'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Trash2, Plus, X } from 'lucide-react';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';
import { useOnCallSchedules } from '@/lib/hooks/useOnCallSchedules';
import type {
  CoverageType,
  SupportContract,
  SupportSlaTarget,
  SupportTier,
} from '@/lib/hooks/useSupportContracts';

// Internal form state — supports multi-schedule per tier for follow-the-sun.
// Converted back to the API's single schedule_id on submit (first selection wins).
interface FormTier {
  level: 1 | 2 | 3;
  name: string;
  schedule_ids: string[];
  escalation_timeout_minutes: number | null;
  notify_channels: string[];
}

const DEFAULT_CUSTOM_SCHEDULE = [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' }));

const DEFAULT_SLA_TARGETS: SupportSlaTarget[] = [
  { severity: 1, response_minutes: 15, resolution_minutes: 240 },
  { severity: 2, response_minutes: 30, resolution_minutes: 480 },
  { severity: 3, response_minutes: 60, resolution_minutes: 1440 },
];

const SEVERITY_LABELS: Record<number, string> = {
  1: 'SEV1 — Critical',
  2: 'SEV2 — High',
  3: 'SEV3 — Medium',
  4: 'SEV4 — Low',
  5: 'SEV5 — Info',
};

export interface ContractFormPayload {
  consumer_tenant_id: string;
  name: string;
  coverage_window: SupportContract['coverage_window'];
  tiers: SupportTier[];
  sla_targets: SupportSlaTarget[];
  pricing: SupportContract['pricing'];
}

export interface ContractFormProps {
  mode: 'create' | 'edit';
  /** Initial values when editing. */
  initial?: Partial<ContractFormPayload>;
  /** When set, consumer dropdown is locked. */
  lockedConsumerId?: string;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (payload: ContractFormPayload) => Promise<void>;
  onCancel: () => void;
}

function tierFromInitial(t: any): FormTier {
  // Accept both legacy schedule_id (singular) and newer schedule_ids (array)
  const schedule_ids: string[] = Array.isArray(t?.schedule_ids) && t.schedule_ids.length
    ? t.schedule_ids
    : t?.schedule_id ? [t.schedule_id] : [];
  return {
    level: t?.level ?? 1,
    name: t?.name ?? `L${t?.level ?? 1} Support`,
    schedule_ids,
    escalation_timeout_minutes: t?.escalation_timeout_minutes ?? null,
    notify_channels: t?.notify_channels ?? ['in_app', 'email'],
  };
}

function formTierToApiTier(t: FormTier): SupportTier {
  return {
    level: t.level,
    name: t.name,
    schedule_ids: t.schedule_ids,
    schedule_id: t.schedule_ids[0] ?? null,
    schedule_name: null,
    escalation_timeout_minutes: t.escalation_timeout_minutes,
    notify_channels: (t.notify_channels ?? ['in_app', 'email']) as SupportTier['notify_channels'],
  };
}

export function ContractForm({
  mode,
  initial,
  lockedConsumerId,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: ContractFormProps) {
  const { data: consumers = [] } = useLinkedConsumers();
  const { data: schedules = [] } = useOnCallSchedules();

  const [consumerId, setConsumerId] = useState<string>(
    lockedConsumerId ?? initial?.consumer_tenant_id ?? '',
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [coverageType, setCoverageType] = useState<CoverageType>(
    initial?.coverage_window?.type ?? '8x5',
  );
  const [timezone, setTimezone] = useState(initial?.coverage_window?.timezone ?? 'UTC');

  const [tiers, setTiers] = useState<FormTier[]>(
    initial?.tiers && initial.tiers.length > 0
      ? initial.tiers.map(tierFromInitial)
      : [{ level: 1, name: 'L1 Support', schedule_ids: [], escalation_timeout_minutes: null, notify_channels: ['in_app', 'slack', 'voice'] }],
  );

  const [slaTargets, setSlaTargets] = useState<SupportSlaTarget[]>(
    initial?.sla_targets && initial.sla_targets.length > 0
      ? initial.sla_targets
      : DEFAULT_SLA_TARGETS,
  );

  const initialAmountDollars =
    initial?.pricing && typeof initial.pricing.amount_cents === 'number'
      ? (initial.pricing.amount_cents / 100).toFixed(2)
      : '500';
  const [amountDollars, setAmountDollars] = useState<string>(initialAmountDollars);
  const [currency, setCurrency] = useState(initial?.pricing?.currency ?? 'usd');
  const [providerSharePct, setProviderSharePct] = useState<number>(
    initial?.pricing?.provider_share_pct ?? 80,
  );

  const canSubmit =
    !!consumerId
    && name.trim().length > 0
    && tiers.length > 0
    && tiers.every((t) => !!t.name && t.schedule_ids.length > 0)
    && tiers.every((t) => new Set(t.schedule_ids).size === t.schedule_ids.length)
    && slaTargets.length > 0
    && slaTargets.every((t) => t.response_minutes < t.resolution_minutes)
    && providerSharePct >= 0 && providerSharePct <= 100;

  // Schedules that appear on more than one tier. Doesn't block submission
  // — sometimes the same primary covers multiple tiers — but escalating
  // to a tier whose schedules overlap L1 just re-pages the same people,
  // which usually means the tier system isn't doing useful work.
  const overlappingSchedules: { scheduleId: string; tiers: number[] }[] = (() => {
    const byScheduleId = new Map<string, number[]>();
    for (const t of tiers) {
      for (const sid of t.schedule_ids) {
        const list = byScheduleId.get(sid) ?? [];
        if (!list.includes(t.level)) list.push(t.level);
        byScheduleId.set(sid, list);
      }
    }
    return Array.from(byScheduleId.entries())
      .filter(([, levels]) => levels.length > 1)
      .map(([scheduleId, tiersList]) => ({ scheduleId, tiers: tiersList.sort() }));
  })();

  function addTier() {
    if (tiers.length >= 3) return;
    const nextLevel = (tiers.length + 1) as 1 | 2 | 3;
    setTiers([
      ...tiers,
      {
        level: nextLevel,
        name: `L${nextLevel} Support`,
        schedule_ids: [],
        escalation_timeout_minutes: nextLevel < 3 ? 60 : null,
        notify_channels: nextLevel === 2 ? ['in_app', 'whatsapp', 'voice'] : ['in_app', 'voice'],
      },
    ]);
  }
  function removeTier(level: number) {
    const next = tiers.filter((t) => t.level !== level);
    setTiers(
      next.map((t, i) => ({
        ...t,
        level: (i + 1) as 1 | 2 | 3,
        escalation_timeout_minutes: i < next.length - 1 ? (t.escalation_timeout_minutes ?? 60) : null,
      })),
    );
  }
  function updateTier(level: number, patch: Partial<FormTier>) {
    setTiers(tiers.map((t) => (t.level === level ? { ...t, ...patch } : t)));
  }
  function toggleTierSchedule(level: number, scheduleId: string) {
    setTiers(tiers.map((t) => {
      if (t.level !== level) return t;
      const has = t.schedule_ids.includes(scheduleId);
      return {
        ...t,
        schedule_ids: has ? t.schedule_ids.filter((s) => s !== scheduleId) : [...t.schedule_ids, scheduleId],
      };
    }));
  }

  function addSlaRow() {
    const used = new Set(slaTargets.map((s) => s.severity));
    const next = [1, 2, 3, 4, 5].find((s) => !used.has(s as any)) as 1 | 2 | 3 | 4 | 5 | undefined;
    if (!next) return;
    setSlaTargets([...slaTargets, { severity: next, response_minutes: 60, resolution_minutes: 480 }]);
  }
  function removeSlaRow(severity: number) {
    setSlaTargets(slaTargets.filter((s) => s.severity !== severity));
  }
  function updateSlaRow(severity: number, patch: Partial<SupportSlaTarget>) {
    setSlaTargets(slaTargets.map((s) => (s.severity === severity ? { ...s, ...patch } : s)));
  }

  async function handleSubmit() {
    const schedule = coverageType === 'custom' ? DEFAULT_CUSTOM_SCHEDULE : [];
    // Provider tiers can all have timeouts — customer manages further tiers (L3+)
    const normalizedTiers: SupportTier[] = tiers.map((t) => formTierToApiTier(t));
    await onSubmit({
      consumer_tenant_id: consumerId,
      name: name.trim(),
      coverage_window: { type: coverageType, timezone, schedule },
      tiers: normalizedTiers,
      sla_targets: slaTargets,
      pricing: {
        amount_cents: Math.round(parseFloat(amountDollars || '0') * 100),
        currency: currency.toLowerCase(),
        provider_share_pct: providerSharePct,
        platform_share_pct: 100 - providerSharePct,
      },
    });
  }

  const consumerLocked = mode === 'edit' || !!lockedConsumerId;

  return (
    <div className="space-y-6">
      {/* Contract basics */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Contract</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Consumer</label>
            <Select
              value={consumerId}
              onChange={(e) => setConsumerId(e.target.value)}
              disabled={consumerLocked}
            >
              <option value="">Select a consumer…</option>
              {consumers.map((c) => (
                <option key={c._id} value={c.consumer?._id}>
                  {c.consumer?.name}
                </option>
              ))}
            </Select>
            {consumerLocked && (
              <p className="text-[11px] text-muted-foreground">Consumer cannot be changed on an existing contract.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Contract name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp L1+L2 24x7" />
          </div>
        </div>
      </section>

      {/* Coverage window */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Coverage Window</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Coverage type</label>
            <Select value={coverageType} onChange={(e) => setCoverageType(e.target.value as CoverageType)}>
              <option value="8x5">8x5 (business hours, Mon–Fri)</option>
              <option value="24x7">24x7 (always covered)</option>
              <option value="custom">Custom (defaults to Mon–Fri 09:00–17:00)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Timezone</label>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. Asia/Kolkata, UTC" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Outside the coverage window, the consumer&apos;s own on-call handles incidents — no bridge is created.
        </p>
      </section>

      {/* Tiers */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Escalation Tiers</h2>
          <Button size="sm" variant="ghost" onClick={addTier} disabled={tiers.length >= 3}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add tier
          </Button>
        </div>
        <div className="space-y-3">
          {tiers.map((tier, idx) => {
            const isLast = idx === tiers.length - 1;
            return (
              <div key={tier.level} className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[60px_1fr_1fr_auto] items-center">
                  <div className="flex items-center justify-center rounded bg-[rgba(255,107,43,0.1)] px-2 py-1 text-sm font-bold text-primary md:w-[60px]">
                    L{tier.level}
                  </div>
                  <Input
                    value={tier.name}
                    onChange={(e) => updateTier(tier.level, { name: e.target.value })}
                    placeholder="Tier name"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={tier.escalation_timeout_minutes ?? ''}
                    placeholder="Timeout (min)"
                    onChange={(e) => {
                      const v = e.target.value;
                      updateTier(tier.level, { escalation_timeout_minutes: v === '' ? null : parseInt(v, 10) });
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeTier(tier.level)}
                    disabled={tiers.length === 1}
                    aria-label={`Remove L${tier.level}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Schedules <span className="text-[10px] font-normal">(select one or more — pages the union of on-call users)</span>
                  </label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {schedules.map((s) => {
                      const active = tier.schedule_ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleTierSchedule(tier.level, s.id)}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                          }`}
                        >
                          {active && <X className="mr-1 inline h-3 w-3" />}
                          {s.name}
                        </button>
                      );
                    })}
                    {schedules.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">No on-call schedules found for this tenant.</p>
                    )}
                  </div>
                  {tier.schedule_ids.length === 0 && (
                    <p className="mt-1 text-[11px] text-[#A16207]">Pick at least one schedule for L{tier.level}.</p>
                  )}
                </div>
                {/* Notify channels */}
                <div className="border-t border-border pt-2.5">
                  <label className="text-xs font-medium text-muted-foreground">Notify via</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(['in_app', 'slack', 'voice', 'whatsapp', 'sms', 'email'] as const).map((ch) => {
                      const active = tier.notify_channels.includes(ch);
                      const labels: Record<string, string> = { in_app: 'In-App', slack: 'Slack', voice: 'Voice', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => {
                            const next = active
                              ? tier.notify_channels.filter((c) => c !== ch)
                              : [...tier.notify_channels, ch];
                            updateTier(tier.level, { notify_channels: next.length > 0 ? next : ['in_app'] });
                          }}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                          }`}
                        >
                          {labels[ch]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {overlappingSchedules.length > 0 && (
          <div className="rounded-md border border-[#F59E0B]/30 bg-[#FEF3C7]/30 px-3 py-2 text-[11px] text-[#92400E] dark:bg-[#451A03]/30 dark:text-[#FCD34D]">
            <p className="font-semibold">Heads-up: schedules used on more than one tier</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {overlappingSchedules.map((o) => {
                const sched = schedules.find((s) => s.id === o.scheduleId);
                return (
                  <li key={o.scheduleId}>
                    <span className="font-medium">{sched?.name ?? o.scheduleId}</span> appears on tier{o.tiers.length > 1 ? 's' : ''}{' '}
                    {o.tiers.map((l) => `L${l}`).join(', ')}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1">
              Escalating to a tier whose schedules overlap with an earlier tier re-pages the same people. Consider giving each tier different schedules so escalation actually reaches new responders.
            </p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          If a tier doesn&apos;t resolve within its timeout, the incident auto-escalates to the next tier. The customer can add further tiers (L3+) on their side. Pick multiple schedules per tier to model follow-the-sun (e.g. AMER + EMEA + APAC).
        </p>
      </section>

      {/* SLA targets */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">SLA Targets</h2>
          <Button size="sm" variant="ghost" onClick={addSlaRow} disabled={slaTargets.length >= 5}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add severity
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Response (min)</th>
                <th className="px-3 py-2 font-medium">Resolution (min)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {[...slaTargets].sort((a, b) => a.severity - b.severity).map((row) => (
                <tr key={row.severity} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{SEVERITY_LABELS[row.severity]}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-28 px-2 text-[13px]"
                      value={row.response_minutes}
                      onChange={(e) => updateSlaRow(row.severity, { response_minutes: parseInt(e.target.value || '0', 10) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-28 px-2 text-[13px]"
                      value={row.resolution_minutes}
                      onChange={(e) => updateSlaRow(row.severity, { resolution_minutes: parseInt(e.target.value || '0', 10) })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="icon" variant="ghost" onClick={() => removeSlaRow(row.severity)} disabled={slaTargets.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Pricing</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Monthly amount</label>
            <Input type="number" min={0} step="0.01" value={amountDollars} onChange={(e) => setAmountDollars(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Currency</label>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="usd">USD</option>
              <option value="inr">INR</option>
              <option value="eur">EUR</option>
              <option value="gbp">GBP</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Provider share (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={providerSharePct}
              onChange={(e) => setProviderSharePct(Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10))))}
            />
            <p className="text-[11px] text-muted-foreground">Platform keeps {100 - providerSharePct}%</p>
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
