'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  BellRing,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Search,
  ArrowRight,
  FileText,
  BarChart3,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  useAlertRules,
  useCreateSilence,
  type AlertRule,
} from '@/lib/hooks/useAlertRules';
import { toast } from 'sonner';

const SEVERITY_COLORS: Record<string, { stripe: string; text: string; bg: string }> = {
  critical: { stripe: 'border-l-[#DC2626]', text: 'text-[#DC2626] dark:text-red-400', bg: 'bg-[#DC2626]/10' },
  high:     { stripe: 'border-l-primary', text: 'text-primary', bg: 'bg-primary/10' },
  medium:   { stripe: 'border-l-[#EAB308]', text: 'text-[#A16207] dark:text-yellow-400', bg: 'bg-[#EAB308]/10' },
  low:      { stripe: 'border-l-[#2563EB]', text: 'text-[#2563EB] dark:text-blue-400', bg: 'bg-[#2563EB]/10' },
};

const STATE_BADGE: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  firing:  { label: 'FIRING', cls: 'bg-[#DC2626]/10 text-[#DC2626] dark:text-red-400 border-[#DC2626]/20', icon: AlertCircle },
  ok:      { label: 'OK', cls: 'bg-[#16A34A]/10 text-[#16A34A] dark:text-emerald-400 border-[#16A34A]/20', icon: CheckCircle2 },
  no_data: { label: 'NO DATA', cls: 'bg-muted text-muted-foreground border-border', icon: HelpCircle },
};

const SOURCE_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  managed_promql: { label: 'PromQL', cls: 'bg-[#7C3AED]/10 text-[#7C3AED] dark:text-purple-400 border-[#7C3AED]/20' },
  managed_logql:  { label: 'LogQL', cls: 'bg-[#2563EB]/10 text-[#2563EB] dark:text-blue-400 border-[#2563EB]/20' },
  byos_webhook:   { label: 'Webhook', cls: 'bg-[#EA580C]/10 text-[#EA580C] dark:text-amber-400 border-[#EA580C]/20' },
  synthetic:      { label: 'Synthetic', cls: 'bg-[#06B6D4]/10 text-[#06B6D4] dark:text-teal-400 border-[#06B6D4]/20' },
};

function formatTimestamp(ts: string | null) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type FilterTab = 'all' | 'firing' | 'ok' | 'no_data';

export default function AlertsOverviewPage() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useAlertRules();
  const rules = data?.data ?? [];
  const activeRules = rules.filter((r) => r.status === 'active');

  // Severity counts (only active + firing)
  const criticalCount = activeRules.filter((r) => r.alert_state === 'firing' && r.severity === 'critical').length;
  const highCount = activeRules.filter((r) => r.alert_state === 'firing' && r.severity === 'high').length;
  const mediumCount = activeRules.filter((r) => r.alert_state === 'firing' && r.severity === 'medium').length;
  const lowCount = activeRules.filter((r) => r.alert_state === 'firing' && r.severity === 'low').length;

  // Tab counts
  const firingCount = activeRules.filter((r) => r.alert_state === 'firing').length;
  const okCount = activeRules.filter((r) => r.alert_state === 'ok').length;
  const noDataCount = activeRules.filter((r) => r.alert_state === 'no_data').length;

  const filtered = useMemo(() => {
    let result = activeRules;
    if (filter === 'firing') result = result.filter((r) => r.alert_state === 'firing');
    else if (filter === 'ok') result = result.filter((r) => r.alert_state === 'ok');
    else if (filter === 'no_data') result = result.filter((r) => r.alert_state === 'no_data');
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
    }
    return result;
  }, [activeRules, filter, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live alert status across all services
          </p>
        </div>
        <Link href="/observability/alerts">
          <Button variant="outline" size="sm">
            Manage Alert Rules
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </Link>
      </div>

      {/* Severity stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Critical', count: criticalCount, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
          { label: 'High', count: highCount, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
          { label: 'Medium', count: mediumCount, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
          { label: 'Low', count: lowCount, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
        ].map((s) => (
          <Card key={s.label} className={cn('border', s.border)}>
            <CardContent className="p-4 pt-4 sm:p-5 sm:pt-5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{s.label} Firing</p>
              <p className={cn('text-2xl font-bold mt-1.5', s.count > 0 ? s.color : 'text-muted-foreground')}>{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Firing banner */}
      {firingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[13px] font-bold text-red-400">
            {firingCount} alert{firingCount > 1 ? 's' : ''} currently FIRING
          </span>
        </div>
      )}

      {/* Filter tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {([
            { key: 'all' as const, label: `All (${activeRules.length})` },
            { key: 'firing' as const, label: `Firing (${firingCount})` },
            { key: 'ok' as const, label: `OK (${okCount})` },
            { key: 'no_data' as const, label: `No Data (${noDataCount})` },
          ]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors',
                filter === f.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search alerts..."
            className="w-full rounded-lg border border-border bg-background pl-8 pr-8 py-1.5 text-[12px] text-foreground outline-none focus:border-primary"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span className="text-[12px] text-red-400">{(error as Error).message}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && activeRules.length === 0 && (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <BellRing className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No active alerts</h3>
            <p className="text-[12px] text-muted-foreground mb-4 max-w-sm">
              Create alert rules to monitor your infrastructure and get notified when things go wrong.
            </p>
            <Link href="/observability/alerts">
              <Button size="sm">
                Manage Alert Rules
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* No results for current filter */}
      {!isLoading && activeRules.length > 0 && filtered.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">No alerts match your current filters.</p>
        </div>
      )}

      {/* Alert cards */}
      <div className="space-y-3">
        {filtered.map((rule) => (
          <AlertCard key={rule.id} rule={rule} />
        ))}
      </div>

      {/* Footer link */}
      {activeRules.length > 0 && (
        <div className="text-center pt-2">
          <Link
            href="/observability/alerts"
            className="text-[12px] font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            Manage Alert Rules <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function AlertCard({ rule }: { rule: AlertRule }) {
  const sev = SEVERITY_COLORS[rule.severity] || SEVERITY_COLORS.medium;
  const state = STATE_BADGE[rule.alert_state] || STATE_BADGE.ok;
  const StateIcon = state.icon;
  const srcType = SOURCE_TYPE_LABEL[rule.source_type] || SOURCE_TYPE_LABEL.managed_promql;
  const activeSilenceCount = (rule.active_silences || []).filter((s) => new Date(s.end) > new Date()).length;

  const createSilence = useCreateSilence();
  const [showSilenceForm, setShowSilenceForm] = useState(false);
  const [silenceHours, setSilenceHours] = useState('2');
  const [silenceReason, setSilenceReason] = useState('');

  return (
    <Card className={cn('border-l-[3px]', sev.stripe)}>
      <CardContent className="p-4 pt-4 sm:p-6 sm:pt-6">
        {/* Title + actions row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <StateIcon className={cn('h-4 w-4 shrink-0', state.cls.split(' ').find((c) => c.startsWith('text-')))} />
            <span className="text-sm font-semibold text-foreground">{rule.name}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', sev.bg, sev.text)}>
              {rule.severity}
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold border', state.cls)}>
              {state.label}
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold border', srcType.cls)}>
              {srcType.label}
            </span>
            {activeSilenceCount > 0 && (
              <span className="rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 text-[10px] font-bold">
                SILENCED
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Silence"
              onClick={() => setShowSilenceForm(!showSilenceForm)}
            >
              <BellRing className="h-3.5 w-3.5" />
            </button>
            <Link href="/observability/alerts">
              <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="View Rule">
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </Link>
          </div>
        </div>

        {/* Service + query */}
        <div className="mt-3 space-y-2">
          {rule.service && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Resource:</span>
              <span className="text-[11px] font-semibold text-foreground/80">{rule.service.name}</span>
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
                rule.service.current_status === 'operational' ? 'bg-emerald-500/10 text-emerald-400' :
                rule.service.current_status === 'degraded' ? 'bg-yellow-500/10 text-yellow-400' :
                'bg-red-500/10 text-red-400',
              )}>
                {rule.service.current_status}
              </span>
            </div>
          )}
          {(rule.query || rule.condition.metric) && (
            <div className="rounded-lg bg-muted/50 border border-border p-3 sm:p-4">
              <code className="text-[11px] font-mono text-primary break-all leading-relaxed">
                {rule.query || rule.condition.metric}
              </code>
            </div>
          )}
        </div>

        {/* Drill-down links */}
        {(rule.query || rule.condition.metric) && (
          <div className="flex items-center gap-2 mt-2">
            {rule.source_type === 'managed_logql' && rule.query ? (
              <Link href={`/observability/logs?q=${encodeURIComponent(rule.query)}`}>
                <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2 gap-1 text-blue-400 hover:text-blue-300">
                  <FileText className="h-3 w-3" />
                  View Logs
                </Button>
              </Link>
            ) : (
              <Link href={`/observability/metrics?q=${encodeURIComponent(rule.query || rule.condition.metric)}`}>
                <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2 gap-1 text-purple-400 hover:text-purple-300">
                  <BarChart3 className="h-3 w-3" />
                  View Metrics
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-muted-foreground">
          <span>Last evaluated: {formatTimestamp(rule.last_triggered_at || rule.updated_at)}</span>
          {rule.last_value !== null && rule.last_value !== undefined && (
            <span>
              Value: <span className="font-mono font-medium text-foreground/70">{rule.last_value.toFixed(4)}</span>
            </span>
          )}
          {rule.trigger_count > 0 && (
            <span>Triggered: <span className="font-medium text-foreground/70">{rule.trigger_count}x</span></span>
          )}
        </div>

        {/* Inline silence form */}
        {showSilenceForm && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4 space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-medium text-muted-foreground">Duration (hours)</label>
              <input
                type="number" min="1" max="720" value={silenceHours}
                onChange={(e) => setSilenceHours(e.target.value)}
                className="w-20 rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] text-foreground"
              />
            </div>
            <input
              value={silenceReason} onChange={(e) => setSilenceReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] text-foreground"
            />
            <div className="flex gap-2">
              <Button size="sm" className="text-[11px] h-7" onClick={() => {
                const now = new Date();
                const end = new Date(now.getTime() + parseInt(silenceHours) * 3600000);
                createSilence.mutate({ ruleId: rule.id, start: now.toISOString(), end: end.toISOString(), reason: silenceReason }, {
                  onSuccess: () => { toast.success('Silence created'); setShowSilenceForm(false); setSilenceReason(''); },
                  onError: (e) => toast.error(e.message),
                });
              }} disabled={createSilence.isPending}>
                {createSilence.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Silence
              </Button>
              <Button size="sm" variant="ghost" className="text-[11px] h-7" onClick={() => setShowSilenceForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
