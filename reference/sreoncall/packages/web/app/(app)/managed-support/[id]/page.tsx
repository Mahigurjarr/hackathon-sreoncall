'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useProviderSupportContract, useContractSlaReport, useActivateSupportContract, useCancelSupportContract } from '@/lib/hooks/useSupportContracts';
import { useOnCallSchedules } from '@/lib/hooks/useOnCallSchedules';
import { useUsers } from '@/lib/hooks/useUsers';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, ShieldCheck, Clock, Target, DollarSign, Pencil, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-[rgba(234,179,8,0.15)] text-[#EAB308]',
  active:   'bg-[rgba(22,163,74,0.15)] text-[#16A34A]',
  amended:  'bg-[rgba(37,99,235,0.15)] text-[#2563EB]',
  expired:  'bg-[rgba(100,116,139,0.15)] text-[#64748B]',
  canceled: 'bg-[rgba(220,38,38,0.15)] text-[#DC2626]',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatAmount(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60 * 10) / 10}h`;
  return `${Math.round(mins / 1440 * 10) / 10}d`;
}

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: contract, isLoading } = useProviderSupportContract(id);
  const { data: slaReport } = useContractSlaReport(id);
  const { data: schedules = [] } = useOnCallSchedules();
  const { data: allUsers = [] } = useUsers();
  const scheduleMap = new Map(schedules.map((s) => [s.id, s.name]));

  // Build a map of userId → phone_number for readiness checks
  const userPhoneMap = new Map(allUsers.map((u) => [u.id, u.phone_number]));

  // For each tier, compute how many on-call members are missing phone
  function getTierPhoneWarning(tier: { schedule_ids?: string[]; schedule_id?: string | null; notify_channels?: string[] }) {
    const needsPhone = (tier.notify_channels ?? []).some((ch) => ['voice', 'whatsapp', 'sms'].includes(ch));
    if (!needsPhone) return null;
    const schedIds = (tier.schedule_ids ?? []).length > 0 ? tier.schedule_ids! : tier.schedule_id ? [tier.schedule_id] : [];
    const memberIds = new Set<string>();
    for (const sid of schedIds) {
      const sched = schedules.find((s) => s.id === sid);
      sched?.layers.forEach((l) => l.users.forEach((uid) => memberIds.add(uid)));
    }
    if (memberIds.size === 0) return null;
    const missing = [...memberIds].filter((uid) => !userPhoneMap.get(uid)).length;
    return missing > 0 ? { missing, total: memberIds.size } : null;
  }

  const activate = useActivateSupportContract();
  const cancel = useCancelSupportContract();

  if (isLoading || !contract) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => router.push('/managed-support')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">{contract.name}</h1>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', STATUS_COLORS[contract.status] || '')}>
              {contract.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground truncate">{contract.consumer_name || 'Unknown consumer'}</p>
        </div>
        <div className="flex gap-2">
          {(contract.status === 'active' || contract.status === 'draft') && (
            <Button size="sm" variant="outline" onClick={() => router.push(`/managed-support/${contract.id}/edit`)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          {contract.status === 'draft' && (
            <Button size="sm" variant="info" disabled={activate.isPending} onClick={() => activate.mutate(contract.id)}>
              Activate
            </Button>
          )}
          {(contract.status === 'active' || contract.status === 'draft') && (
            <Button
              size="sm"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                if (confirm(`Cancel "${contract.name}"?`)) cancel.mutate(contract.id, { onSuccess: () => router.push('/managed-support') });
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryTile icon={Clock} label="Coverage" value={contract.coverage_window.type.toUpperCase()} sub={contract.coverage_window.timezone} />
        <SummaryTile icon={ShieldCheck} label="Tiers" value={`${contract.tiers.length}`} sub={contract.tiers.map((t) => `L${t.level}`).join(' · ')} />
        <SummaryTile icon={Target} label="SLA severities" value={`${contract.sla_targets.length}`} sub={`Fastest: ${formatMinutes(Math.min(...contract.sla_targets.map((t) => t.response_minutes)))} response`} />
        <SummaryTile icon={DollarSign} label="Monthly" value={formatAmount(contract.pricing.amount_cents, contract.pricing.currency)} sub={`${contract.pricing.provider_share_pct}% / ${contract.pricing.platform_share_pct}% split`} />
      </div>

      {/* Coverage schedule */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Coverage Window</h2>
        {contract.coverage_window.type === '24x7' ? (
          <p className="text-sm text-muted-foreground">Always covered — every day, all hours ({contract.coverage_window.timezone}).</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            {DAYS.map((label, dayIdx) => {
              const s = contract.coverage_window.schedule.find((r) => r.day === dayIdx);
              return (
                <div key={label} className="rounded-lg border border-border p-2.5 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xs font-mono">{s ? `${s.start}–${s.end}` : '—'}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tiers */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Escalation Tiers</h2>
        <div className="space-y-2">
          {contract.tiers.map((t) => {
              const phoneWarning = getTierPhoneWarning(t);
              return (
                <div key={t.level} className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded bg-[rgba(255,107,43,0.1)] text-sm font-bold text-primary shrink-0">
                      L{t.level}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.schedule_name ?? (t.schedule_id ? scheduleMap.get(t.schedule_id) : null) ?? '—'}
                      </p>
                      {t.notify_channels && t.notify_channels.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.notify_channels.map((ch) => (
                            <span key={ch} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                              {ch === 'in_app' ? 'In-App' : ch}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Timeout</p>
                      <p className="text-sm font-mono">
                        {t.escalation_timeout_minutes ? formatMinutes(t.escalation_timeout_minutes) : '—'}
                      </p>
                    </div>
                  </div>
                  {/* Warn if no schedule linked — escalation will find no one on-call */}
                  {!t.schedule_name && !t.schedule_id && !(t.schedule_ids?.length) && (
                    <div className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                      <p className="text-xs text-red-700 dark:text-red-300">
                        <span className="font-semibold">No on-call schedule linked.</span>{' '}
                        Escalations to this tier will find no one on-call. Edit the contract to assign a schedule.
                      </p>
                    </div>
                  )}
                  {phoneWarning && (
                    <div className="flex items-center gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        <span className="font-semibold">{phoneWarning.missing} of {phoneWarning.total} members</span> have no phone number — Voice / WhatsApp / SMS will be skipped for them.
                        {' '}Ask them to add their phone in Settings → Profile.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </section>

      {/* SLA targets */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">SLA Targets</h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Response</th>
                <th className="px-3 py-2 font-medium">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {[...contract.sla_targets].sort((a, b) => a.severity - b.severity).map((t) => (
                <tr key={t.severity} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">SEV{t.severity}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatMinutes(t.response_minutes)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatMinutes(t.resolution_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SLA compliance report */}
      {slaReport && slaReport.total_incidents > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">SLA Compliance (all time)</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryTile label="Total incidents" value={String(slaReport.total_incidents)} sub="managed-support" />
            <SummaryTile label="Active" value={String(slaReport.active_count)} sub={`${slaReport.resolved_count} resolved`} />
            <SummaryTile label="Response met" value={`${slaReport.response_compliance_pct}%`} sub={`${slaReport.response_breach_count} breached`} accent={slaReport.response_compliance_pct >= 95 ? 'good' : 'warn'} />
            <SummaryTile label="Resolution met" value={`${slaReport.resolution_compliance_pct}%`} sub={`${slaReport.resolution_breach_count} breached`} accent={slaReport.resolution_compliance_pct >= 95 ? 'good' : 'warn'} />
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: 'good' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn(
          'mt-1.5 text-lg font-bold',
          accent === 'good' && 'text-[#16A34A]',
          accent === 'warn' && 'text-[#DC2626]',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
