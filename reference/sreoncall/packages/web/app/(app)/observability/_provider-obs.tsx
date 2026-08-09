'use client';

import { useState, useMemo } from 'react';
import {
  Play, Loader2, AlertCircle, ChevronDown,
  BarChart3, ScrollText, Network, Eye, CheckSquare, Square,
  Clock, Zap, TrendingUp, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { TimeRangeSelector, TimeRangeValue } from '@/components/ui/TimeRangeSelector';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';
import { cn } from '@/lib/utils';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';
import {
  useProviderObservabilityConsumers,
  useProviderMetricsRangeQuery,
  useProviderLogsQuery,
  useProviderLogVolume,
  useProviderTraceSearch,
  useProviderTraceById,
  useUpdateConsumerScope,
  type ProviderObsConsumer,
  type ConsumerScope,
} from '@/lib/hooks/useProviderObservability';

// ── Constants ────────────────────────────────────────────────────────

export const PROVIDER_TIME_PRESETS = [
  { label: '15m', ms: 15 * 60_000 },
  { label: '1h',  ms: 3_600_000 },
  { label: '6h',  ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d',  ms: 7 * 24 * 3_600_000 },
];

const QUICK_QUERIES = [
  { label: 'CPU %',       query: '100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)', icon: Activity },
  { label: 'Memory %',    query: '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100', icon: Zap },
  { label: 'HTTP req/s',  query: 'sum(rate(http_requests_total[5m]))', icon: TrendingUp },
  { label: 'HTTP errors', query: 'sum(rate(http_requests_total{status_code=~"5.."}[5m]))', icon: AlertCircle },
  { label: 'p99 latency', query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))', icon: Clock },
];

const LEVEL_FILTERS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
const LEVEL_STYLES: Record<string, { active: string; inactive: string; dot: string }> = {
  ERROR: { active: 'bg-red-500/20 text-[#DC2626] border-red-500/40',       inactive: 'border-border text-muted-foreground hover:border-red-500/30',    dot: '#DC2626' },
  WARN:  { active: 'bg-yellow-500/20 text-[#A16207] border-yellow-500/40', inactive: 'border-border text-muted-foreground hover:border-yellow-500/30', dot: '#CA8A04' },
  INFO:  { active: 'bg-blue-500/20 text-[#2563EB] border-blue-500/40',     inactive: 'border-border text-muted-foreground hover:border-blue-500/30',   dot: '#2563EB' },
  DEBUG: { active: 'bg-muted text-muted-foreground border-border',          inactive: 'border-border text-muted-foreground hover:border-border',         dot: '#6B7280' },
};
const SERIES_COLORS = ['#7C3AED', '#2563EB', '#16A34A', '#DC2626', '#A16207', '#0891B2', '#DB2777'];

function computeStep(rangeMs: number): string {
  if (rangeMs <= 5 * 60_000)          return '15s';
  if (rangeMs <= 15 * 60_000)         return '30s';
  if (rangeMs <= 3_600_000)           return '60s';
  if (rangeMs <= 6 * 3_600_000)       return '5m';
  if (rangeMs <= 24 * 3_600_000)      return '15m';
  if (rangeMs <= 7 * 24 * 3_600_000)  return '1h';
  return '6h';
}

function detectLevel(line: string): string {
  const l = line.toLowerCase();
  if (l.includes('error') || l.includes('fatal') || l.includes('crit')) return 'ERROR';
  if (l.includes('warn')) return 'WARN';
  if (l.includes('debug')) return 'DEBUG';
  return 'INFO';
}

function formatTs(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNs(ns: string): string {
  return formatTs(Math.floor(Number(ns) / 1e6));
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Shared UI helpers ────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
      {children}
    </span>
  );
}

function ResultBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[#DC2626]">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
        <Icon className="h-6 w-6 opacity-50" />
      </div>
      <p className="text-sm font-medium text-foreground/60">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground/60">{subtitle}</p>}
    </div>
  );
}

// ── Access management dialog ─────────────────────────────────────────

export function AccessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: allConsumers } = useLinkedConsumers();
  const updateScope = useUpdateConsumerScope();

  function toggle(consumerId: string, currentScope: string[]) {
    const has = currentScope.includes('observability');
    const next = has
      ? currentScope.filter((s) => s !== 'observability')
      : [...currentScope, 'observability'];
    updateScope.mutate({ consumerId, scope: next as ConsumerScope[] });
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Observability Access</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          Enable observability scope to include a customer in cross-tenant queries.
        </p>
        {!allConsumers?.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No linked customers found.</p>
        ) : (
          <div className="space-y-2">
            {allConsumers.map((item) => {
              if (!item.consumer) return null;
              const has = item.scope.includes('observability');
              const pending = updateScope.isPending;
              return (
                <div
                  key={item._id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => !pending && toggle(item.consumer!._id, item.scope)}
                >
                  <div>
                    <p className="text-sm font-medium">{item.consumer.name}</p>
                    <p className="text-xs text-muted-foreground">{item.consumer.slug}</p>
                  </div>
                  {has
                    ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    : <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Consumer selector ────────────────────────────────────────────────

export function ConsumerSelector({
  consumers,
  value,
  onChange,
}: {
  consumers: ProviderObsConsumer[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const managed = consumers.filter(c => c.included_in_cross_tenant_query);
  return (
    <div className="relative">
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
        className="appearance-none rounded-lg border border-border bg-card px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">All customers ({managed.length})</option>
        {managed.map(c => (
          <option key={c.consumer_id} value={c.consumer_id}>
            {c.consumer_name ?? c.consumer_slug ?? c.consumer_id}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}


// ── Metrics tab ──────────────────────────────────────────────────────

function MetricsTab({ consumerId, tenantIdToName }: { consumerId?: string; tenantIdToName: Record<string, string> }) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [runCounter, setRunCounter] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => ({
    start: Date.now() - 3_600_000, end: Date.now(), preset: '1h',
  }));

  const rangeMs = timeRange.preset === 'custom'
    ? timeRange.end - timeRange.start
    : (PROVIDER_TIME_PRESETS.find(p => p.label === timeRange.preset)?.ms ?? 3_600_000);
  const step = computeStep(rangeMs);

  const startSec = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.start / 1000));
    return String(Math.floor(Date.now() / 1000) - rangeMs / 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, runCounter, timeRange]);

  const endSec = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.end / 1000));
    return String(Math.floor(Date.now() / 1000));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, runCounter, timeRange]);

  const { data, isLoading, error } = useProviderMetricsRangeQuery(
    activeQuery, consumerId, startSec, endSec, step, !!activeQuery,
  );

  function run() {
    setActiveQuery(query);
    setRunCounter(c => c + 1);
  }

  const chartData = useMemo(() => {
    const series = data?.data?.result ?? [];
    if (!series.length) return [];
    const tsSet = new Set<number>();
    series.forEach(s => s.values?.forEach(([ts]) => tsSet.add(Number(ts))));
    const timestamps = Array.from(tsSet).sort((a, b) => a - b);
    return timestamps.map(ts => {
      const pt: Record<string, any> = { time: ts * 1000 };
      series.forEach((s, i) => {
        const found = s.values?.find(([t]) => Number(t) === ts);
        pt[`s${i}`] = found ? parseFloat(found[1]) : null;
      });
      return pt;
    });
  }, [data]);

  const seriesLabels = useMemo(() =>
    (data?.data?.result ?? []).map((s, i) => {
      const metric = s.metric ?? {};
      const tenantId = metric.__tenant_id__ || metric.tenant_id || metric.__org_id__ || null;
      const tenantName = tenantId
        ? (tenantIdToName[tenantId] ?? tenantId.slice(-8))
        : consumerId ? (tenantIdToName[consumerId] ?? null) : null;
      const tenantSuffix = tenantName ? ` [${tenantName}]` : '';
      const primary = metric.instance || metric.job || metric.__name__ || null;
      if (primary) return `${primary}${tenantSuffix}`;
      const publicLabels = Object.entries(metric).filter(([k]) => !k.startsWith('__'));
      if (publicLabels.length > 0) return publicLabels.map(([k, v]) => `${k}="${v}"`).join(', ') + tenantSuffix;
      return `series ${i}${tenantSuffix}`;
    }),
  [data, tenantIdToName, consumerId]);

  const seriesCount = data?.data?.result?.length ?? 0;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <SectionLabel>PromQL</SectionLabel>
            </div>
            <div className="h-4 w-px bg-border" />
            <TimeRangeSelector presets={PROVIDER_TIME_PRESETS} value={timeRange} onChange={setTimeRange} compact />
            <div className="h-4 w-px bg-border hidden sm:block" />
            <div className="flex flex-wrap gap-1.5">
              {QUICK_QUERIES.map(q => {
                const Icon = q.icon;
                const isActive = query === q.query;
                return (
                  <button
                    key={q.label}
                    onClick={() => { setQuery(q.query); setActiveQuery(q.query); setRunCounter(c => c + 1); }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all',
                      isActive
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground hover:bg-muted/40',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {q.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <QueryEditor
                value={query}
                onChange={setQuery}
                language="promql"
                placeholder='e.g. rate(http_requests_total[5m])'
                height="72px"
              />
            </div>
            <Button
              onClick={run}
              disabled={!query || isLoading}
              className="h-9 w-9 p-0 shrink-0"
            >
              {isLoading
                ? <Loader2 className="h-4 w-4 animate-spin text-white" />
                : <Play className="h-4 w-4 text-white" />
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <ErrorBanner message={(error as any).message || 'Query failed'} />}

      {chartData.length > 0 && (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground/80">Result</span>
            </div>
            <ResultBadge>{seriesCount} {seriesCount === 1 ? 'series' : 'series'}</ResultBadge>
          </div>
          <CardContent className="pt-4 pb-3">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  {(data?.data?.result ?? []).map((_, i) => (
                    <linearGradient key={i} id={`prov-grad${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatTs}
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  labelFormatter={(v) => formatTs(Number(v))}
                  formatter={(value, name) => {
                    const label = seriesLabels[parseInt((name as string).slice(1))] ?? name;
                    return [typeof value === 'number' ? value.toFixed(4) : value, label];
                  }}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}
                  cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                />
                <Legend
                  formatter={(v) => seriesLabels[parseInt(v.slice(1))] ?? v}
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                  iconType="circle"
                  iconSize={8}
                />
                {(data?.data?.result ?? []).map((_, i) => (
                  <Area
                    key={i}
                    type="monotone"
                    dataKey={`s${i}`}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    fill={`url(#prov-grad${i})`}
                    dot={false}
                    connectNulls
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {!isLoading && activeQuery && !chartData.length && !error && (
        <EmptyState icon={BarChart3} title="No data returned" subtitle="Try adjusting the query or time range" />
      )}
    </div>
  );
}

// ── Logs tab ─────────────────────────────────────────────────────────

function LogsTab({ consumerId, tenantIdToName }: { consumerId?: string; tenantIdToName: Record<string, string> }) {
  const [query, setQuery] = useState('{job=~".+"}');
  const [activeQuery, setActiveQuery] = useState('');
  const [runCounter, setRunCounter] = useState(0);
  const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set(LEVEL_FILTERS));
  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => ({
    start: Date.now() - 3_600_000, end: Date.now(), preset: '1h',
  }));

  const rangeMs = timeRange.preset === 'custom'
    ? timeRange.end - timeRange.start
    : (PROVIDER_TIME_PRESETS.find(p => p.label === timeRange.preset)?.ms ?? 3_600_000);

  const startNs = useMemo(() => {
    if (timeRange.preset === 'custom') return String(timeRange.start * 1e6);
    return String((Date.now() - rangeMs) * 1e6);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, runCounter, timeRange]);

  const endNs = useMemo(() => {
    if (timeRange.preset === 'custom') return String(timeRange.end * 1e6);
    return String(Date.now() * 1e6);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, runCounter, timeRange]);

  const step = computeStep(rangeMs);

  const { data, isLoading, error } = useProviderLogsQuery(
    activeQuery, consumerId, startNs, endNs, '200', 'backward', !!activeQuery,
  );

  const { data: volumeData } = useProviderLogVolume(
    activeQuery, consumerId, startNs, endNs, step, !!activeQuery,
  );

  function run() {
    setActiveQuery(query);
    setRunCounter(c => c + 1);
  }

  function toggleLevel(level: string) {
    setActiveLevels(prev => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  }

  const logLines = useMemo(() => {
    const streams = data?.data?.result ?? [];
    return streams
      .flatMap(stream =>
        stream.values.map(([ns, line]) => ({
          ns,
          ts: Math.floor(Number(ns) / 1e6),
          line,
          tenant: stream.stream.__tenant__ ?? stream.stream.tenant_id ?? consumerId ?? null,
          level: stream.stream.level ?? stream.stream.severity ?? detectLevel(line),
          streamLabels: stream.stream as Record<string, string>,
        }))
      )
      .sort((a, b) => b.ts - a.ts);
  }, [data, consumerId]);

  const visibleLines = useMemo(
    () => logLines.filter(l => activeLevels.has(l.level.toUpperCase())),
    [logLines, activeLevels],
  );

  const volumeChart = useMemo(() => {
    const series = volumeData?.data?.result ?? [];
    if (!series.length) return [];
    const tsSet = new Set<number>();
    series.forEach((s: any) => s.values?.forEach(([ts]: any) => tsSet.add(Number(ts))));
    const timestamps = Array.from(tsSet).sort((a, b) => a - b);
    return timestamps.map(ts => {
      const pt: Record<string, any> = { time: ts * 1000 };
      series.forEach((s: any) => {
        const level = (s.metric?.level ?? 'INFO').toUpperCase();
        const found = s.values?.find(([t]: any) => Number(t) === ts);
        pt[level] = (pt[level] ?? 0) + (found ? parseFloat(found[1]) : 0);
      });
      return pt;
    });
  }, [volumeData]);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <SectionLabel>LogQL</SectionLabel>
            </div>
            <div className="h-4 w-px bg-border" />
            <TimeRangeSelector presets={PROVIDER_TIME_PRESETS} value={timeRange} onChange={setTimeRange} compact />
            <div className="h-4 w-px bg-border" />
            <div className="flex gap-1">
              {LEVEL_FILTERS.map(level => (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-all',
                    activeLevels.has(level) ? LEVEL_STYLES[level].active : LEVEL_STYLES[level].inactive,
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <QueryEditor
                value={query}
                onChange={setQuery}
                language="logql"
                placeholder='{job=~".+"} |= "error"'
                height="72px"
              />
            </div>
            <Button
              onClick={run}
              disabled={!query || isLoading}
              className="h-9 w-9 p-0 shrink-0"
            >
              {isLoading
                ? <Loader2 className="h-4 w-4 animate-spin text-white" />
                : <Play className="h-4 w-4 text-white" />
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <ErrorBanner message={(error as any).message || 'Query failed'} />}

      {volumeChart.length > 0 && (
        <Card>
          <CardContent className="px-4 pt-3 pb-2">
            <ResponsiveContainer width="100%" height={72}>
              <BarChart data={volumeChart} barGap={0} barCategoryGap="8%" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="time"
                  tickFormatter={formatTs}
                  tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => formatTs(Number(v))}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 11,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}
                />
                {LEVEL_FILTERS.map(l => (
                  <Bar key={l} dataKey={l} stackId="a" fill={LEVEL_STYLES[l].dot} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {visibleLines.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground/80">Log stream</span>
            </div>
            <ResultBadge>{visibleLines.length >= 500 ? '500+' : visibleLines.length} lines</ResultBadge>
          </div>
          <div className="grid grid-cols-[16px_80px_46px_auto] gap-x-3 border-b border-border/50 bg-muted/20 px-4 py-1.5 font-mono">
            <span />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Time</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Level</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Message</span>
          </div>
          <div>
            {visibleLines.slice(0, 500).map((log, i) => {
              const key = `${log.ns}-${i}`;
              const isExpanded = expandedLogKey === key;
              let parsedJson: Record<string, any> | null = null;
              try { parsedJson = JSON.parse(log.line); } catch {}
              return (
                <div key={key} className="border-b border-border/40 last:border-0">
                  <div
                    onClick={() => setExpandedLogKey((prev: string | null) => prev === key ? null : key)}
                    className="grid grid-cols-[16px_80px_46px_auto] gap-x-3 px-4 py-1.5 hover:bg-muted/20 font-mono text-xs transition-colors cursor-pointer select-none"
                  >
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 transition-transform duration-150',
                        !isExpanded && '-rotate-90',
                      )}
                    />
                    <span className="shrink-0 text-muted-foreground/70 tabular-nums">{formatNs(log.ns)}</span>
                    <span
                      className="shrink-0 font-semibold"
                      style={{ color: LEVEL_STYLES[log.level.toUpperCase()]?.dot ?? '#6B7280' }}
                    >
                      {log.level.toUpperCase().slice(0, 5)}
                    </span>
                    <span className="flex items-start gap-2 min-w-0">
                      {log.tenant && (
                        <span className="shrink-0 mt-px rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary/80">
                          {tenantIdToName[log.tenant] ?? log.tenant.slice(-8)}
                        </span>
                      )}
                      <span className="break-all text-foreground/90 leading-relaxed">{log.line}</span>
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/30 bg-muted/10 px-5 py-3 space-y-3">
                      <div>
                        <SectionLabel>Stream Labels</SectionLabel>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {Object.entries(log.streamLabels).map(([k, v]) => (
                            <span key={k} className="font-mono text-[11px] rounded border border-border bg-muted/40 px-2 py-0.5">
                              <span className="text-muted-foreground">{k}=</span>
                              <span className="text-foreground/90">&quot;{String(v)}&quot;</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {parsedJson && typeof parsedJson === 'object' && (
                        <div>
                          <SectionLabel>Structured Fields</SectionLabel>
                          <div className="mt-1.5 divide-y divide-border/30 rounded-md border border-border/40 bg-muted/20 overflow-hidden">
                            {Object.entries(parsedJson).map(([k, v]) => (
                              <div key={k} className="flex items-start gap-3 px-3 py-1.5 font-mono text-[11px]">
                                <span className="shrink-0 min-w-[120px] text-muted-foreground">{k}</span>
                                <span className="text-foreground/90 break-all">
                                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!isLoading && activeQuery && !visibleLines.length && !error && (
        <EmptyState icon={ScrollText} title="No logs found" subtitle="Try a different query or wider time range" />
      )}
    </div>
  );
}

// ── Traces tab ───────────────────────────────────────────────────────

function TracesTab({ consumerId, tenantIdToName }: { consumerId?: string; tenantIdToName: Record<string, string> }) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [runCounter, setRunCounter] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => ({
    start: Date.now() - 3_600_000, end: Date.now(), preset: '1h',
  }));

  const rangeMs = timeRange.preset === 'custom'
    ? timeRange.end - timeRange.start
    : (PROVIDER_TIME_PRESETS.find(p => p.label === timeRange.preset)?.ms ?? 3_600_000);

  const startSec = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.start / 1000));
    return String(Math.floor(Date.now() / 1000) - rangeMs / 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, runCounter, timeRange]);

  const endSec = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.end / 1000));
    return String(Math.floor(Date.now() / 1000));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, runCounter, timeRange]);

  const { data: searchData, isLoading, error } = useProviderTraceSearch(
    activeQuery || undefined, consumerId, startSec, endSec, '20', true,
  );
  const { data: traceDetail } = useProviderTraceById(
    selectedTraceId ?? '', consumerId, !!selectedTraceId,
  );

  function run() {
    setActiveQuery(query);
    setRunCounter(c => c + 1);
    setSelectedTraceId(null);
  }

  const traces: any[] = searchData?.traces ?? searchData?.traceSummaries ?? [];

  const maxDuration = useMemo(
    () => traces.reduce((m, t) => Math.max(m, t.durationMs ?? 0), 0),
    [traces],
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              <SectionLabel>TraceQL</SectionLabel>
            </div>
            <div className="h-4 w-px bg-border" />
            <TimeRangeSelector presets={PROVIDER_TIME_PRESETS} value={timeRange} onChange={setTimeRange} compact />
          </div>

          <div className="flex gap-2 items-center">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder='{ .http.status_code = 500 }  ·  Enter to run'
              className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:bg-muted/50 transition-colors"
            />
            <Button
              onClick={run}
              disabled={isLoading}
              className="h-9 w-9 p-0 shrink-0"
            >
              {isLoading
                ? <Loader2 className="h-4 w-4 animate-spin text-white" />
                : <Play className="h-4 w-4 text-white" />
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <ErrorBanner message={(error as any).message || 'Search failed'} />}

      {traces.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Network className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground/80">Traces</span>
            </div>
            <ResultBadge>{traces.length} found</ResultBadge>
          </div>

          <div className="divide-y divide-border/40">
            {traces.map((t: any) => {
              const isSelected = selectedTraceId === t.traceID;
              const durationPct = maxDuration > 0 ? ((t.durationMs ?? 0) / maxDuration) * 100 : 0;
              const color = SERIES_COLORS[traces.indexOf(t) % SERIES_COLORS.length];

              const spans = isSelected && traceDetail
                ? (traceDetail.batches ?? []).flatMap((b: any) =>
                    (b.scopeSpans ?? []).flatMap((ss: any) =>
                      (ss.spans ?? []).map((span: any) => ({
                        ...span,
                        serviceName: b.resource?.attributes?.find((a: any) => a.key === 'service.name')?.value?.stringValue ?? '—',
                        durationMs: Math.round((span.endTimeUnixNano - span.startTimeUnixNano) / 1e6),
                      }))
                    )
                  ).slice(0, 20)
                : [];

              const maxSpanDuration = spans.reduce((m: number, s: any) => Math.max(m, s.durationMs), 0);

              return (
                <div key={t.traceID}>
                  <div
                    onClick={() => setSelectedTraceId(prev => prev === t.traceID ? null : t.traceID)}
                    className={cn(
                      'cursor-pointer px-4 py-3 transition-colors hover:bg-muted/20',
                      isSelected && 'bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <p className="truncate text-sm font-medium">
                            {t.rootTraceName || t.rootServiceName || 'Unknown trace'}
                          </p>
                        </div>
                        <p className="mt-0.5 pl-4 font-mono text-[11px] text-muted-foreground/60">
                          {t.traceID?.slice(0, 16)}…
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 text-xs">
                        {t.tenantID && (
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary/80">
                            {tenantIdToName[t.tenantID] ?? t.tenantID.slice(-8)}
                          </span>
                        )}
                        <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                          {t.rootServiceName}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatDuration(t.durationMs ?? 0)}
                        </span>
                        <span className="text-muted-foreground/60">
                          {t.spanSets?.length ?? 0} spans
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted/40 pl-4">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${durationPct}%`, backgroundColor: color, opacity: 0.6 }}
                      />
                    </div>
                  </div>

                  {isSelected && traceDetail && spans.length > 0 && (
                    <div className="border-t border-border/50 bg-muted/10 px-4 py-3">
                      <div className="mb-2.5 flex items-center gap-2">
                        <SectionLabel>Spans</SectionLabel>
                        <span className="text-[10px] text-muted-foreground/50">({spans.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {spans.map((span: any) => {
                          const pct = maxSpanDuration > 0 ? (span.durationMs / maxSpanDuration) * 100 : 0;
                          return (
                            <div key={span.spanId} className="flex items-center gap-3 font-mono text-xs">
                              <span className="w-36 shrink-0 truncate text-foreground/80">{span.name}</span>
                              <div className="flex flex-1 items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary/50"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
                                  {formatDuration(span.durationMs)}
                                </span>
                              </div>
                              <span className="w-28 shrink-0 truncate text-right text-muted-foreground/60">
                                {span.serviceName}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!isLoading && !traces.length && !error && (
        <EmptyState
          icon={Network}
          title={searchData ? 'No traces found for this time range' : 'Run a search to see traces'}
          subtitle={searchData ? 'Try a broader time range or remove filters' : 'Use TraceQL to filter by service, duration, or attributes'}
        />
      )}
    </div>
  );
}

// ── Public content components (used with page-level toggle) ─────────

function ProviderContent({ tab }: { tab: 'metrics' | 'logs' | 'traces' }) {
  const [selectedConsumer, setSelectedConsumer] = useState<string | undefined>();
  const { data: consumers, isLoading } = useProviderObservabilityConsumers();

  const all = consumers ?? [];
  const managed = all.filter((c: any) => c.included_in_cross_tenant_query);
  const byosCount = all.length - managed.length;

  const tenantIdToName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of managed) {
      m[c.consumer_id] = c.consumer_name ?? c.consumer_slug ?? c.consumer_id.slice(-8);
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumers]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!managed.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
            <Eye className="h-6 w-6 text-muted-foreground opacity-50" />
          </div>
          <h3 className="mb-1 text-sm font-semibold">No customers with observability access</h3>
          <p className="max-w-xs text-xs text-muted-foreground leading-relaxed">
            Use the Manage access button above to enable observability scope for linked customers.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <ConsumerSelector consumers={all} value={selectedConsumer} onChange={setSelectedConsumer} />
        {byosCount > 0 && (
          <span className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
            {byosCount} {byosCount === 1 ? 'customer' : 'customers'} excluded · BYOS
          </span>
        )}
      </div>
      {tab === 'metrics' && <MetricsTab consumerId={selectedConsumer} tenantIdToName={tenantIdToName} />}
      {tab === 'logs'    && <LogsTab    consumerId={selectedConsumer} tenantIdToName={tenantIdToName} />}
      {tab === 'traces'  && <TracesTab  consumerId={selectedConsumer} tenantIdToName={tenantIdToName} />}
    </div>
  );
}

export function ProviderMetricsContent() {
  return <ProviderContent tab="metrics" />;
}

export function ProviderLogsContent() {
  return <ProviderContent tab="logs" />;
}

export function ProviderTracesContent() {
  return <ProviderContent tab="traces" />;
}
