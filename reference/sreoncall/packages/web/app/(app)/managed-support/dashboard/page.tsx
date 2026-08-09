'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useProviderSupportDashboard, type AtRiskEntry, type ConsumerRollup, type RecentBreach, type TierCounts } from '@/lib/hooks/useSupportContracts';
import { AlertTriangle, Activity, ShieldCheck, Users2, Clock, Flame, ExternalLink, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEADLINE_LABELS: Record<AtRiskEntry['deadline_kind'], string> = {
  tier: 'Tier timeout',
  response: 'Response SLA',
  resolution: 'Resolution SLA',
};

function formatMinutes(mins: number): string {
  const abs = Math.abs(mins);
  if (abs < 1) return `${Math.round(abs * 60)}s`;
  if (abs < 60) return `${Math.round(abs * 10) / 10}m`;
  return `${Math.round((abs / 60) * 10) / 10}h`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ManagedSupportDashboardPage() {
  const { data, isLoading } = useProviderSupportDashboard();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Managed Support Operations</h1>
          <p className="text-sm text-muted-foreground">Live view of active incidents across your L1/L2/L3 tiers</p>
        </div>
        <span className="text-[11px] text-muted-foreground">Refreshes every 30s</span>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <SummaryTiles totals={data.totals} />

          <AtRiskSection entries={data.at_risk} now={now} />

          <ConsumersSection rows={data.consumers} />

          <RecentBreachesSection rows={data.recent_breaches} />
        </>
      )}
    </div>
  );
}

// ─── Summary tiles ─────────────────────────────────────────────────────

function SummaryTiles({
  totals,
}: {
  totals: { active_contracts: number; open_incidents: number; breaches_last_24h: number; active_by_tier: TierCounts };
}) {
  const tiers = totals.active_by_tier;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <Tile icon={ShieldCheck} label="Active contracts" value={String(totals.active_contracts)} sub="providers you manage" />
      <Tile icon={Activity} label="Open incidents" value={String(totals.open_incidents)} sub="across all consumers" />
      <TierTile counts={tiers} />
      <Tile
        icon={Flame}
        label="Breaches last 24h"
        value={String(totals.breaches_last_24h)}
        sub="response or resolution"
        accent={totals.breaches_last_24h > 0 ? 'warn' : undefined}
      />
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: 'warn';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={cn('mt-1.5 text-2xl font-bold', accent === 'warn' && 'text-[#DC2626]')}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function TierTile({ counts }: { counts: TierCounts }) {
  const total = counts.L1 + counts.L2 + counts.L3;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users2 className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wide">Active by tier</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(['L1', 'L2', 'L3'] as const).map((k) => (
          <div key={k} className="rounded-lg bg-background/60 p-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="text-lg font-bold text-primary">{counts[k]}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{total} total open</p>
    </div>
  );
}

// ─── At-risk section ───────────────────────────────────────────────────

function AtRiskSection({ entries, now }: { entries: AtRiskEntry[]; now: Date }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#A16207]" />
          <h2 className="text-sm font-semibold">At risk</h2>
          <span className="rounded-full bg-[rgba(161,98,7,0.1)] px-2 py-0.5 text-[11px] font-medium text-[#A16207]">
            {entries.length}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">Tier deadlines within 15m · SLA deadlines within 30m</p>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <CheckCircle2 className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No incidents approaching deadline</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const deadline = new Date(e.deadline_at);
            const liveMins = (deadline.getTime() - now.getTime()) / 60_000;
            const breached = liveMins < 0;
            const urgent = liveMins >= 0 && liveMins < 5;
            return (
              <div key={e.state_id} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded bg-[rgba(255,107,43,0.1)] text-xs font-bold text-primary">
                  L{e.current_tier}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {e.severity != null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        SEV{e.severity}
                      </span>
                    )}
                    <Link
                      href={`/consumers/incidents?highlight=${e.consumer_incident_id}`}
                      className="truncate text-sm font-medium hover:text-primary transition-colors"
                    >
                      {e.incident_title || `Incident ${e.consumer_incident_id.slice(-6)}`}
                    </Link>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {e.consumer_name || 'Unknown consumer'} · {DEADLINE_LABELS[e.deadline_kind]}
                  </p>
                </div>
                <div className="flex-none text-right">
                  <p
                    className={cn(
                      'font-mono text-sm font-bold',
                      breached && 'text-[#DC2626]',
                      !breached && urgent && 'text-[#A16207] animate-pulse',
                      !breached && !urgent && 'text-foreground',
                    )}
                  >
                    {breached ? `-${formatMinutes(liveMins)}` : formatMinutes(liveMins)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">due {formatClock(e.deadline_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Per-consumer rollup ────────────────────────────────────────────────

function ConsumersSection({ rows }: { rows: ConsumerRollup[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Users2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Per consumer</h2>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No active managed-support contracts</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Consumer</th>
                <th className="px-3 py-2 font-medium">Contract</th>
                <th className="px-3 py-2 font-medium">Coverage</th>
                <th className="px-3 py-2 font-medium text-center">L1</th>
                <th className="px-3 py-2 font-medium text-center">L2</th>
                <th className="px-3 py-2 font-medium text-center">L3</th>
                <th className="px-3 py-2 font-medium text-center">Open</th>
                <th className="px-3 py-2 font-medium text-center">Resp 7d</th>
                <th className="px-3 py-2 font-medium text-center">Res 7d</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contract_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">{r.consumer_name || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[220px]">{r.contract_name}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" /> {r.coverage_type.toUpperCase()}
                    </span>
                  </td>
                  <TierCell value={r.active_by_tier.L1} />
                  <TierCell value={r.active_by_tier.L2} />
                  <TierCell value={r.active_by_tier.L3} />
                  <td className="px-3 py-2 text-center font-mono">{r.open_total}</td>
                  <td className="px-3 py-2 text-center font-mono">
                    <ComplianceCell value={r.response_compliance_pct} sample={r.total_recent_incidents} />
                  </td>
                  <td className="px-3 py-2 text-center font-mono">
                    <ComplianceCell value={r.resolution_compliance_pct} sample={r.total_recent_incidents} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/managed-support/${r.contract_id}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      Details <ExternalLink className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TierCell({ value }: { value: number }) {
  return (
    <td className="px-3 py-2 text-center">
      <span
        className={cn(
          'inline-block min-w-[28px] rounded px-1.5 py-0.5 text-xs font-mono',
          value > 0 ? 'bg-[rgba(255,107,43,0.1)] text-primary font-semibold' : 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    </td>
  );
}

function ComplianceCell({ value, sample }: { value: number; sample: number }) {
  if (sample === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const good = value >= 95;
  const warn = value < 90;
  return (
    <span
      className={cn(
        'text-xs',
        good && 'text-[#16A34A]',
        warn && 'text-[#DC2626]',
        !good && !warn && 'text-[#A16207]',
      )}
    >
      {value}%
    </span>
  );
}

// ─── Recent breaches ────────────────────────────────────────────────────

function RecentBreachesSection({ rows }: { rows: RecentBreach[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-[#DC2626]" />
        <h2 className="text-sm font-semibold">Recent breaches (last 24h)</h2>
      </div>
      <div className="space-y-2">
        {rows.map((b, i) => (
          <div key={`${b.state_id}-${b.kind}-${i}`} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
            <span className="rounded bg-[rgba(220,38,38,0.15)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#DC2626]">
              {b.kind}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/consumers/incidents?highlight=${b.consumer_incident_id}`}
                className="truncate text-sm font-medium hover:text-primary transition-colors"
              >
                {b.incident_title || `Incident ${b.consumer_incident_id.slice(-6)}`}
              </Link>
              <p className="text-[11px] text-muted-foreground truncate">{b.consumer_name || 'Unknown consumer'}</p>
            </div>
            <div className="flex-none text-right">
              <p className="text-[11px] text-muted-foreground">deadline was {formatClock(b.deadline_at)}</p>
              <p className="text-[11px] text-muted-foreground">breached {new Date(b.breached_at).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
