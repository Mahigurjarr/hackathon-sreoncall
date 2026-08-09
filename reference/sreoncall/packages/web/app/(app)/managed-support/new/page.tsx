'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';
import { useOnCallSchedules } from '@/lib/hooks/useOnCallSchedules';
import { useCreateSupportContract, type CoverageType, type SupportTier, type SupportSlaTarget } from '@/lib/hooks/useSupportContracts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ArrowLeft, Trash2, Plus } from 'lucide-react';

const DEFAULT_8X5_SCHEDULE = [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' }));

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

export default function NewContractPage() {
  const router = useRouter();
  const { data: consumers = [] } = useLinkedConsumers();
  const { data: schedules = [] } = useOnCallSchedules();
  const create = useCreateSupportContract();

  const [consumerId, setConsumerId] = useState('');
  const [name, setName] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>('8x5');
  const [timezone, setTimezone] = useState('UTC');

  const [tiers, setTiers] = useState<SupportTier[]>([
    { level: 1, name: 'L1 Support', schedule_id: '', schedule_ids: [], schedule_name: null, escalation_timeout_minutes: 30, notify_channels: ['in_app', 'slack', 'voice'] },
  ]);

  const [slaTargets, setSlaTargets] = useState<SupportSlaTarget[]>(DEFAULT_SLA_TARGETS);

  const [amountDollars, setAmountDollars] = useState('500');
  const [currency, setCurrency] = useState('usd');
  const [providerSharePct, setProviderSharePct] = useState(80);

  const canSubmit =
    !!consumerId
    && name.trim().length > 0
    && tiers.length > 0
    && tiers.every((t) => !!t.name && !!t.schedule_id)
    && (tiers[tiers.length - 1].escalation_timeout_minutes === null || tiers.length === 3)
    && (tiers.slice(0, -1).every((t) => t.escalation_timeout_minutes != null && t.escalation_timeout_minutes > 0))
    && slaTargets.length > 0
    && slaTargets.every((t) => t.response_minutes < t.resolution_minutes)
    && providerSharePct >= 0 && providerSharePct <= 100;

  function addTier() {
    if (tiers.length >= 3) return;
    const nextLevel = (tiers.length + 1) as 1 | 2 | 3;
    const defaultChannels: Record<number, SupportTier['notify_channels']> = {
      2: ['in_app', 'whatsapp', 'voice'],
      3: ['in_app', 'voice'],
    };
    setTiers([
      ...tiers,
      { level: nextLevel, name: `L${nextLevel} Support`, schedule_id: '', schedule_ids: [], schedule_name: null, escalation_timeout_minutes: nextLevel < 3 ? 60 : null, notify_channels: defaultChannels[nextLevel] ?? ['in_app', 'voice'] },
    ]);
  }
  function removeTier(level: number) {
    const next = tiers.filter((t) => t.level !== level);
    // re-level contiguously
    setTiers(next.map((t, i) => ({ ...t, level: (i + 1) as 1 | 2 | 3, escalation_timeout_minutes: i < next.length - 1 ? (t.escalation_timeout_minutes ?? 60) : null })));
  }
  function updateTier(level: number, patch: Partial<SupportTier>) {
    setTiers(tiers.map((t) => (t.level === level ? { ...t, ...patch } : t)));
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
    const schedule = coverageType === 'custom' ? DEFAULT_8X5_SCHEDULE : [];
    try {
      const res = await create.mutateAsync({
        consumer_tenant_id: consumerId,
        name: name.trim(),
        coverage_window: { type: coverageType, timezone, schedule },
        tiers,
        sla_targets: slaTargets,
        pricing: {
          amount_cents: Math.round(parseFloat(amountDollars || '0') * 100),
          currency: currency.toLowerCase(),
          provider_share_pct: providerSharePct,
          platform_share_pct: 100 - providerSharePct,
        },
      });
      router.push(`/managed-support/${res.id}`);
    } catch (err) {
      alert((err as Error).message || 'Failed to create contract');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Support Contract</h1>
          <p className="text-sm text-muted-foreground">Define coverage, tiers, SLA targets, and pricing</p>
        </div>
      </div>

      {/* Contract basics */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Contract</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Consumer</label>
            <Select value={consumerId} onChange={(e) => setConsumerId(e.target.value)}>
              <option value="">Select a consumer…</option>
              {consumers.map((c) => (
                <option key={c._id} value={c.consumer?._id}>
                  {c.consumer?.name}
                </option>
              ))}
            </Select>
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
                {/* Fields row */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[60px_1fr_2fr_1fr_auto]">
                  <div className="flex items-center justify-center rounded bg-[rgba(255,107,43,0.1)] text-sm font-bold text-primary md:w-[60px]">
                    L{tier.level}
                  </div>
                  <Input
                    value={tier.name}
                    onChange={(e) => updateTier(tier.level, { name: e.target.value })}
                    placeholder="Tier name"
                  />
                  <Select
                    value={tier.schedule_id ?? ''}
                    onChange={(e) => updateTier(tier.level, { schedule_id: e.target.value })}
                  >
                    <option value="">Select schedule…</option>
                    {schedules.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={tier.escalation_timeout_minutes ?? ''}
                    placeholder={isLast ? 'No timeout' : 'Timeout (min)'}
                    disabled={isLast && tiers.length === 3}
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
                {/* Notify channels */}
                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Notify via:</span>
                  {(['slack', 'voice', 'whatsapp', 'sms', 'email', 'in_app'] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={tier.notify_channels.includes(ch)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...tier.notify_channels, ch]
                            : tier.notify_channels.filter((c) => c !== ch);
                          updateTier(tier.level, { notify_channels: next });
                        }}
                        className="rounded border-border"
                      />
                      {ch === 'in_app' ? 'In-App' : ch.charAt(0).toUpperCase() + ch.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          If a tier doesn&apos;t resolve within its timeout, the incident auto-escalates to the next tier. The last tier has no timeout.
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
              {slaTargets.sort((a, b) => a.severity - b.severity).map((row) => (
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
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create contract (draft)'}
        </Button>
      </div>
    </div>
  );
}
