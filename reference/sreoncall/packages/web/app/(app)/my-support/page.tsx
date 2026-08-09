'use client';

import { useEffect, useState } from 'react';
import { useConsumerSupportContract, useConsumerSlaStatus, type SlaStatus } from '@/lib/hooks/useSupportContracts';
import { ShieldCheck, Clock, Target, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60 * 10) / 10}h`;
  return `${Math.round(mins / 1440 * 10) / 10}d`;
}

function formatCountdown(deadline: Date, now: Date): { label: string; urgent: boolean; breached: boolean } {
  const diffMs = deadline.getTime() - now.getTime();
  const breached = diffMs < 0;
  const absSec = Math.floor(Math.abs(diffMs) / 1000);
  const h = Math.floor(absSec / 3600);
  const m = Math.floor((absSec % 3600) / 60);
  const s = absSec % 60;
  const base = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return {
    label: breached ? `-${base}` : base,
    urgent: diffMs > 0 && diffMs < 5 * 60_000,
    breached,
  };
}

export default function MySupportPage() {
  const { data: contract, isLoading } = useConsumerSupportContract();
  const { data: slaStates } = useConsumerSlaStatus();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Managed Support</h1>
          <p className="text-sm text-muted-foreground">Your active support contract with the provider</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-muted-foreground">
          <ShieldCheck className="mb-3 h-10 w-10 opacity-50" />
          <p>No managed support contract is currently active.</p>
          <p className="mt-1 text-xs">Ask your provider to set one up if you need L1/L2/L3 coverage.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Managed Support</h1>
        <p className="text-sm text-muted-foreground">
          Active contract with <span className="font-medium text-foreground">{contract.provider_name || 'your provider'}</span>
        </p>
      </div>

      {/* Contract overview */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{contract.name}</p>
            <p className="text-xs text-muted-foreground">
              Effective from {contract.effective_from ? new Date(contract.effective_from).toLocaleDateString() : '—'}
            </p>
          </div>
          <span className="rounded-full bg-[rgba(22,163,74,0.15)] px-2.5 py-1 text-[11px] font-medium text-[#16A34A] uppercase tracking-wide">
            Active
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <OverviewCell icon={Clock} label="Coverage" value={contract.coverage_window.type.toUpperCase()} sub={contract.coverage_window.timezone} />
          <OverviewCell icon={ShieldCheck} label="Tiers" value={contract.tiers.map((t) => `L${t.level}`).join(' · ')} sub={`${contract.tiers.length} tier(s)`} />
          <OverviewCell icon={Target} label="SLA severities" value={String(contract.sla_targets.length)} sub={`Fastest: ${formatMinutes(Math.min(...contract.sla_targets.map((t) => t.response_minutes)))} response`} />
        </div>

        {contract.coverage_window.type !== '24x7' && contract.coverage_window.schedule?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Weekly schedule</p>
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
          </div>
        )}
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

      {/* Live SLA timers */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Open Managed Incidents</h2>
          <span className="text-[11px] text-muted-foreground">Refreshes every 30s · countdown every 1s</span>
        </div>
        {!slaStates || slaStates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <CheckCircle2 className="mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">No active managed incidents right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {slaStates.map((s: SlaStatus) => (
              <IncidentSlaRow key={s.id} state={s} now={now} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewCell({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function IncidentSlaRow({ state, now }: { state: SlaStatus; now: Date }) {
  const response = formatCountdown(new Date(state.response_deadline), now);
  const resolution = formatCountdown(new Date(state.resolution_deadline), now);
  const responseDone = !!state.response_met_at;

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded bg-[rgba(255,107,43,0.1)] px-2 py-0.5 text-[11px] font-bold text-primary">
            L{state.current_tier}
          </span>
          <a
            href={`/incidents/${state.consumer_incident_id}`}
            className="text-sm font-medium hover:text-primary transition-colors truncate"
          >
            Incident {state.consumer_incident_id.slice(-6)}
          </a>
        </div>
        {(state.response_breached || state.resolution_breached) && (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(220,38,38,0.15)] px-2 py-0.5 text-[11px] font-medium text-[#DC2626]">
            <AlertTriangle className="h-3 w-3" /> SLA breach
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <SlaTimer
          label="Response"
          countdown={response}
          done={responseDone}
          breached={state.response_breached}
        />
        <SlaTimer
          label="Resolution"
          countdown={resolution}
          done={false}
          breached={state.resolution_breached}
        />
      </div>

      {state.tier_history.length > 1 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Escalated through {state.tier_history.map((h) => `L${h.level}`).join(' → ')}
        </p>
      )}
    </div>
  );
}

function SlaTimer({
  label,
  countdown,
  done,
  breached,
}: {
  label: string;
  countdown: { label: string; urgent: boolean; breached: boolean };
  done: boolean;
  breached: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded border border-border bg-card px-2.5 py-2">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            'font-mono text-sm font-bold',
            done && 'text-[#16A34A]',
            !done && breached && 'text-[#DC2626]',
            !done && !breached && countdown.urgent && 'text-[#A16207] animate-pulse',
            !done && !breached && !countdown.urgent && 'text-foreground',
          )}
        >
          {done ? 'Met' : breached ? `Breached ${countdown.label}` : countdown.label}
        </p>
      </div>
      {done && <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />}
      {!done && breached && <AlertTriangle className="h-4 w-4 text-[#DC2626]" />}
    </div>
  );
}
