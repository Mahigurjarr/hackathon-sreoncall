'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { ProviderMetricsContent, AccessDialog } from '../_provider-obs';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Play,
  Save,
  Plus,
  Loader2,
  AlertCircle,
  Trash2,
  Bookmark,
  Share2,
  History,
  ChevronDown,
  ChevronRight,
  X,
  Code,
  Blocks,
  Crosshair,
  RefreshCw,
  BarChart3,
  TrendingUp,
  Layers,
  Search,
  Table2,
  Download,
  Copy,
  Check,
  GitCompare,
  Image as ImageIcon,
  Settings2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  Brush,
} from 'recharts';
import {
  useMetricsRangeQuery,
  useMetricsQuery,
  useMetricLabels,
  useMetricNames,
  useMetricLabelValues,
  useMetricsExemplars,
} from '@/lib/hooks/useObservabilityProxy';
import { TimeRangeSelector, TimeRangeValue } from '@/components/ui/TimeRangeSelector';
import { useFeatureFlag } from '@/lib/hooks/useFeatureFlag';
import { MetricsExploreV2 } from '@/components/observability/MetricsExploreV2';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useProviderObservabilityConsumers } from '@/lib/hooks/useProviderObservability';

// ── Constants ────────────────────────────────────────────────────────

const QUICK_QUERIES = [
  { label: 'CPU usage %',     query: '100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)', unit: 'percent' },
  { label: 'Memory usage %',  query: '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100',       unit: 'percent' },
  { label: 'Disk usage %',    query: '(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100', unit: 'percent' },
  { label: 'Network RX rate', query: 'rate(node_network_receive_bytes_total{device!="lo"}[5m])',                       unit: 'bytes_per_sec' },
  { label: 'Load average (1m)', query: 'node_load1',                                                                  unit: 'number' },
  { label: 'Up targets',      query: 'up',                                                                            unit: 'status' },
];

const METRICS_PRESETS = [
  { label: '5m', ms: 5 * 60_000 },
  { label: '15m', ms: 15 * 60_000 },
  { label: '1h', ms: 3600_000 },
  { label: '6h', ms: 6 * 3600_000 },
  { label: '24h', ms: 24 * 3600_000 },
  { label: '7d', ms: 7 * 24 * 3600_000 },
];

/** Compute a reasonable step given range duration in seconds */
function computeStep(rangeSec: number): string {
  if (rangeSec <= 300) return '5s';
  if (rangeSec <= 900) return '15s';
  if (rangeSec <= 3600) return '15s';
  if (rangeSec <= 6 * 3600) return '60s';
  if (rangeSec <= 24 * 3600) return '300s';
  if (rangeSec <= 7 * 86400) return '1800s';
  if (rangeSec <= 30 * 86400) return '3600s';
  return '7200s';
}

const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Off', ms: 0 },
  { label: '15s', ms: 15_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
];

const SAVED_QUERIES_KEY = 'sreoncall:metrics:savedQueries';
const QUERY_HISTORY_KEY = 'sreoncall:metrics:queryHistory';
const MAX_HISTORY = 20;
const COLORS = ['#FF6B2B', '#3B82F6', '#16A34A', '#EAB308', '#7C3AED', '#DC2626', '#06B6D4', '#EC4899', '#8B5CF6', '#14B8A6'];
const COMPARE_COLORS = ['#F472B6', '#A78BFA', '#34D399', '#FBBF24', '#FB923C', '#38BDF8', '#E879F9', '#4ADE80', '#FACC15', '#F87171'];

type ChartType = 'area' | 'line' | 'stacked';

// ── Helpers ──────────────────────────────────────────────────────────

interface SavedQuery { id: string; name: string; query: string; }
interface QueryHistoryEntry { query: string; timestamp: number; }

function loadSavedQueries(): SavedQuery[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || '[]'); } catch { return []; }
}
function persistSavedQueries(queries: SavedQuery[]) {
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries));
}
function loadQueryHistory(): QueryHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(QUERY_HISTORY_KEY) || '[]'); } catch { return []; }
}
function persistQueryHistory(history: QueryHistoryEntry[]) {
  localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(history));
}

/** Format a numeric value. Explicit unit takes priority over query inference. */
function formatValue(v: number, query: string, unit?: string): string {
  if (!isFinite(v)) return String(v);

  // Explicit unit from preset — never falls through to query inference
  if (unit === 'percent') return `${v.toFixed(2)}%`;
  if (unit === 'bytes_per_sec') {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB/s`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MB/s`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB/s`;
    return `${v.toFixed(0)} B/s`;
  }
  if (unit === 'status') return v === 1 ? 'Up' : 'Down';
  if (unit === 'number') return v.toFixed(v < 10 ? 2 : 0);

  // Query-based inference for ad-hoc PromQL
  // Detect percentage — must come before bytes check because ratio queries like
  // (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100
  // contain "bytes" in the query string but produce a 0-100 percentage result.
  if (/\*\s*100\b/.test(query) || /\b100\s*\*/.test(query)) {
    return `${v.toFixed(2)}%`;
  }
  if (/bytes|byte_/i.test(query)) {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MB`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB`;
    return `${v.toFixed(0)} B`;
  }
  if (/seconds|latency|duration/i.test(query) && !query.includes('total')) {
    if (v < 0.001) return `${(v * 1e6).toFixed(0)} \u00B5s`;
    if (v < 1) return `${(v * 1000).toFixed(1)} ms`;
    return `${v.toFixed(2)} s`;
  }
  if (/rate\(/i.test(query)) {
    if (v < 1) return v.toFixed(4);
    return `${v.toFixed(2)}/s`;
  }
  if (v < 0.01 && v !== 0) return v.toExponential(2);
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(v < 10 ? 4 : 2);
}

/** Check if all values in the result are binary (0 or 1) — used for `up` and similar metrics */
function isBinaryResult(data: any): boolean {
  if (!data?.data?.result?.length) return false;
  return data.data.result.every((series: any) => {
    const vals = series.values || (series.value ? [series.value] : []);
    return vals.length > 0 && vals.every(([_ts, v]: [number, string]) => {
      const n = parseFloat(v);
      return n === 0 || n === 1;
    });
  });
}

// ── Builder Types ────────────────────────────────────────────────────

const AGGREGATION_OPTIONS = ['none', 'rate', 'sum', 'avg', 'min', 'max', 'count', 'histogram_quantile'] as const;
const WINDOW_OPTIONS = ['1m', '5m', '15m', '30m', '1h'] as const;
const MATCH_OPERATORS = ['=', '!=', '=~', '!~'] as const;

interface LabelFilter {
  id: string;
  label: string;
  op: typeof MATCH_OPERATORS[number];
  value: string;
}

interface BuilderState {
  metric: string;
  filters: LabelFilter[];
  aggregation: typeof AGGREGATION_OPTIONS[number];
  window: typeof WINDOW_OPTIONS[number];
  groupBy: string;
}

function buildPromQL(state: BuilderState): string {
  const { metric, filters, aggregation, window: win, groupBy } = state;
  if (!metric) return '';

  const labelMatchers = filters
    .filter((f) => f.label && f.value)
    .map((f) => `${f.label}${f.op}"${f.value}"`)
    .join(', ');
  const metricWithLabels = labelMatchers ? `${metric}{${labelMatchers}}` : metric;

  if (aggregation === 'none') return metricWithLabels;
  if (aggregation === 'rate') {
    const expr = `rate(${metricWithLabels}[${win}])`;
    return groupBy ? `sum by(${groupBy})(${expr})` : expr;
  }
  if (aggregation === 'histogram_quantile') {
    const inner = `rate(${metricWithLabels}[${win}])`;
    return groupBy
      ? `histogram_quantile(0.95, sum by(le, ${groupBy})(${inner}))`
      : `histogram_quantile(0.95, sum by(le)(${inner}))`;
  }
  const byClause = groupBy ? ` by(${groupBy})` : '';
  return `${aggregation}${byClause}(${metricWithLabels})`;
}

// ── Metric Search Dropdown ───────────────────────────────────────────

function MetricSearchDropdown({
  value,
  onChange,
  metricNames,
}: {
  value: string;
  onChange: (v: string) => void;
  metricNames: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return metricNames.slice(0, 50);
    const lower = search.toLowerCase();
    return metricNames.filter((m) => m.toLowerCase().includes(lower)).slice(0, 50);
  }, [metricNames, search]);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-stretch rounded-lg border border-border bg-muted/50 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setSearch(e.target.value); }}
          onFocus={() => setOpen(true)}
          className="flex-1 bg-transparent px-3 py-2 text-[12.5px] font-mono text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder="e.g. http_requests_total"
        />
        <button
          onClick={() => setOpen(!open)}
          className="px-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {filtered.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-muted/50 transition-colors truncate"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PromQL Autocomplete Input ────────────────────────────────────────

function PromQLAutocomplete({
  value,
  onChange,
  onRun,
  metricNames,
  isLoading,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  metricNames: string[];
  isLoading: boolean;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Show suggestions only when text looks like a bare metric name (no complex PromQL syntax)
  const isBareName = value.length > 0 && !/[({[\]})=!~+\-*/,]/.test(value);
  const suggestions = useMemo(() => {
    if (!isBareName || !value) return [];
    const lower = value.toLowerCase();
    return metricNames.filter((m) => m.toLowerCase().includes(lower)).slice(0, 15);
  }, [metricNames, value, isBareName]);

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="flex items-stretch rounded-xl border border-border overflow-hidden bg-muted focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
        <div className="flex items-center gap-1.5 px-3 border-r border-border bg-primary/5 text-primary text-[11px] font-semibold font-mono whitespace-nowrap">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          PromQL
        </div>
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !showSuggestions || suggestions.length === 0)) {
              onRun();
              setShowSuggestions(false);
            }
            if (e.key === 'Escape') setShowSuggestions(false);
          }}
          className="flex-1 bg-transparent px-3 py-2.5 text-[12.5px] font-mono text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder="Enter PromQL expression..."
        />
        <div className="flex items-center px-2 text-[10px] text-muted-foreground/40 font-mono">
          {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+\u21B5
        </div>
        <button
          onClick={() => { onRun(); setShowSuggestions(false); }}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run
        </button>
      </div>

      {/* Autocomplete suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
          {suggestions.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setShowSuggestions(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-muted/50 transition-colors truncate"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Series Legend ─────────────────────────────────────────────────────

function SeriesLegend({
  series,
  hiddenSeries,
  onToggle,
  activeQuery,
  activeUnit,
}: {
  series: { name: string; value: number }[];
  hiddenSeries: Set<string>;
  onToggle: (name: string) => void;
  activeQuery: string;
  activeUnit?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (series.length === 0) return null;

  const COLLAPSE_THRESHOLD = 6;
  const shouldCollapse = series.length > COLLAPSE_THRESHOLD;
  const visibleSeries = shouldCollapse && !expanded ? series.slice(0, COLLAPSE_THRESHOLD) : series;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {visibleSeries.map((s, i) => {
          const hidden = hiddenSeries.has(s.name);
          return (
            <button
              key={s.name}
              onClick={() => onToggle(s.name)}
              className={cn(
                'flex items-center gap-1.5 text-[11px] font-mono transition-opacity',
                hidden ? 'opacity-30' : 'opacity-100',
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="text-muted-foreground truncate max-w-[200px]">{s.name}</span>
              <span className="font-bold text-foreground">{formatValue(s.value, activeQuery, activeUnit)}</span>
            </button>
          );
        })}
      </div>
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {expanded ? 'Show less' : `Show all ${series.length} series`}
        </button>
      )}
    </div>
  );
}

// ── Instant Table ────────────────────────────────────────────────────

function InstantTable({
  result,
  activeQuery,
  activeUnit,
}: {
  result: { metric: Record<string, string>; value?: [number, string] }[];
  activeQuery: string;
  activeUnit?: string;
}) {
  const labelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of result) {
      for (const k of Object.keys(r.metric)) keys.add(k);
    }
    return Array.from(keys).sort();
  }, [result]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border">
            {labelKeys.map((k) => (
              <th key={k} className="text-left py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wider">{k}</th>
            ))}
            <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wider">Value</th>
          </tr>
        </thead>
        <tbody>
          {result.map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              {labelKeys.map((k) => (
                <td key={k} className="py-1.5 px-3 font-mono text-foreground">{r.metric[k] || ''}</td>
              ))}
              <td className="py-1.5 px-3 font-mono font-bold text-foreground text-right">
                {r.value ? formatValue(parseFloat(r.value[1]), activeQuery, activeUnit) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Status Grid (for binary metrics like `up`) ──────────────────────

function StatusGrid({ result }: { result: any[] }) {
  const grouped = useMemo(() => {
    // Build flat target list
    const flat = result.map((series) => {
      const job = series.metric.job || '';
      const instance = series.metric.instance || '';
      const allLabels = Object.entries(series.metric)
        .filter(([k]) => k !== '__name__')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      const displayName = instance || job || allLabels;
      const lastValue = series.values
        ? parseFloat(series.values[series.values.length - 1]?.[1] ?? '0')
        : series.value ? parseFloat(series.value[1]) : 0;
      return { displayName, allLabels, isUp: lastValue === 1, job, instance };
    });

    // Group by instance (case-insensitive) so kubmaster/KubMaster merge
    const byInstance = new Map<string, { displayName: string; jobs: { job: string; isUp: boolean }[]; allLabels: string[] }>();
    for (const t of flat) {
      const key = (t.instance || t.displayName).toLowerCase();
      let group = byInstance.get(key);
      if (!group) {
        group = { displayName: t.instance || t.displayName, jobs: [], allLabels: [] };
        byInstance.set(key, group);
      }
      group.jobs.push({ job: t.job, isUp: t.isUp });
      group.allLabels.push(t.allLabels);
    }

    return Array.from(byInstance.values()).map((g) => ({
      displayName: g.displayName,
      jobs: g.jobs,
      allLabels: g.allLabels.join('\n'),
      isUp: g.jobs.every((j) => j.isUp),
      jobCount: g.jobs.length,
    }));
  }, [result]);

  const upCount = grouped.filter((t) => t.isUp).length;
  const downCount = grouped.filter((t) => !t.isUp).length;
  const totalTargets = grouped.reduce((sum, g) => sum + g.jobCount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          <span className="text-green-400">{upCount} up</span>
        </div>
        {downCount > 0 && (
          <div className="flex items-center gap-1.5 text-[12px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="text-red-400">{downCount} down</span>
          </div>
        )}
        <span className="text-[11px] text-muted-foreground">
          {grouped.length} {grouped.length === 1 ? 'node' : 'nodes'} · {totalTargets} targets total
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {grouped.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors',
              t.isUp
                ? 'bg-green-500/5 border-green-500/20 hover:bg-green-500/10'
                : 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full shrink-0', t.isUp ? 'bg-green-400' : 'bg-red-400 animate-pulse')} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono text-foreground truncate" title={t.allLabels}>
                {t.displayName}
              </div>
              <div className="text-[10px] text-muted-foreground/60 truncate">
                {t.jobs.map((j) => j.job).filter(Boolean).join(', ') || `${t.jobCount} target${t.jobCount === 1 ? '' : 's'}`}
              </div>
            </div>
            <span className={cn(
              'text-[10px] font-bold shrink-0',
              t.isUp ? 'text-green-400' : 'text-red-400',
            )}>
              {t.isUp ? 'UP' : 'DOWN'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export default function MetricsExplorer() {
  const { data: session } = useSession();
  const isProvider = (session?.user as any)?.tenantType === 'provider';
  // Flag-gated Explore rail (C1). Off by default → page renders exactly as before.
  const exploreEnabled = useFeatureFlag('observability_discovery_enabled');
  const { data: currentUserForExplore } = useCurrentUser();
  // v12 customer switcher: real provider consumers (only fetched for provider tenants).
  const { data: obsConsumers } = useProviderObservabilityConsumers(isProvider && exploreEnabled);
  const [selectedConsumer, setSelectedConsumer] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'own' | 'customer'>('own');
  const [accessOpen, setAccessOpen] = useState(false);

  const searchParams = useSearchParams();

  const initialQuery = searchParams.get('q') || 'up';

  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [activeUnit, setActiveUnit] = useState<string | undefined>(
    QUICK_QUERIES.find((q) => q.query === initialQuery)?.unit,
  );
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => {
    const now = Date.now();
    return { start: now - 3600_000, end: now, preset: '1h' };
  });
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [queryMode, setQueryMode] = useState<'promql' | 'builder'>('promql');
  const [builder, setBuilder] = useState<BuilderState>({
    metric: '', filters: [], aggregation: 'none', window: '5m', groupBy: '',
  });
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [exemplarsEnabled, setExemplarsEnabled] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('area');
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [runCounter, setRunCounter] = useState(0);

  // Compare query state
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareQueryText, setCompareQueryText] = useState('');
  const [activeCompareQuery, setActiveCompareQuery] = useState('');

  // Export state
  const [exportCopied, setExportCopied] = useState(false);

  // Chart container ref for PNG export
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const generatedPromQL = useMemo(() => buildPromQL(builder), [builder]);

  // Load saved queries and history
  useEffect(() => {
    setSavedQueries(loadSavedQueries());
    setQueryHistory(loadQueryHistory());
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const id = setInterval(() => setRunCounter((c) => c + 1), refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval]);

  // Metric names for autocomplete
  const { data: metricNamesData } = useMetricNames();
  const metricNames = metricNamesData?.data ?? [];

  // Labels for builder
  const { data: labelsData } = useMetricLabels();
  const labels = labelsData?.data ?? [];

  // Time range calculation
  const now = useMemo(() => Math.floor(Date.now() / 1000), [activeQuery, timeRange, runCounter]);
  const start = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.start / 1000));
    const preset = METRICS_PRESETS.find(p => p.label === timeRange.preset);
    return String(now - (preset ? preset.ms / 1000 : 3600));
  }, [now, timeRange]);
  const end = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.end / 1000));
    return String(now);
  }, [now, timeRange]);
  const step = useMemo(() => computeStep(Number(end) - Number(start)), [start, end]);

  // Main range query
  const { data: metricsData, isLoading, error } = useMetricsRangeQuery(
    activeQuery, start, end, step, !!activeQuery,
  );

  // Compare range query (always called, enabled controlled by flag)
  const { data: compareData } = useMetricsRangeQuery(
    activeCompareQuery, start, end, step, compareEnabled && !!activeCompareQuery,
  );

  // Also run an instant query for table view of vector results
  const { data: instantData } = useMetricsQuery(activeQuery, end, !!activeQuery);
  const isInstantVector = instantData?.data?.resultType === 'vector';

  // Exemplars
  const { data: exemplarsData } = useMetricsExemplars(
    activeQuery, start, end, exemplarsEnabled && !!activeQuery,
  );

  // Label values for selected builder filter labels
  const activeFilterLabel = builder.filters.find((f) => f.label && !f.value)?.label || '';
  const { data: labelValuesData } = useMetricLabelValues(activeFilterLabel, !!activeFilterLabel);
  const _labelValues = labelValuesData?.data ?? [];

  // Detect binary metrics
  const isBinary = useMemo(() => isBinaryResult(metricsData), [metricsData]);

  // Handlers
  const handleSaveQuery = useCallback(() => {
    if (!saveName.trim() || !activeQuery.trim()) return;
    const newQuery: SavedQuery = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: saveName.trim(), query: activeQuery };
    const updated = [...savedQueries, newQuery];
    setSavedQueries(updated);
    persistSavedQueries(updated);
    setSaveName('');
    setSaveDialogOpen(false);
  }, [saveName, activeQuery, savedQueries]);

  const handleDeleteSavedQuery = useCallback((id: string) => {
    const updated = savedQueries.filter((q) => q.id !== id);
    setSavedQueries(updated);
    persistSavedQueries(updated);
  }, [savedQueries]);

  const handleLoadSavedQuery = useCallback((q: SavedQuery) => {
    setQuery(q.query); setActiveQuery(q.query); setHiddenSeries(new Set());
  }, []);

  function handleRun() {
    const q = queryMode === 'builder' ? generatedPromQL : query;
    if (!q.trim()) return;
    if (queryMode === 'builder') setQuery(q);
    setActiveQuery(q);
    // Clear preset unit for ad-hoc queries; keep it if the typed query matches a preset
    setActiveUnit(QUICK_QUERIES.find((p) => p.query === q)?.unit);
    setHiddenSeries(new Set());
    setRunCounter((c) => c + 1);
    const entry: QueryHistoryEntry = { query: q, timestamp: Date.now() };
    const updated = [entry, ...queryHistory.filter((h) => h.query !== q)].slice(0, MAX_HISTORY);
    setQueryHistory(updated);
    persistQueryHistory(updated);
  }

  function handleRunCompare() {
    if (!compareQueryText.trim()) return;
    setActiveCompareQuery(compareQueryText);
    setRunCounter((c) => c + 1);
  }

  function handleShare() {
    const url = window.location.origin + '/observability/metrics?q=' + encodeURIComponent(activeQuery) + '&range=' + timeRange;
    navigator.clipboard.writeText(url).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); });
  }

  function handleModeSwitch(mode: 'promql' | 'builder') {
    if (mode === 'promql' && queryMode === 'builder' && generatedPromQL) setQuery(generatedPromQL);
    setQueryMode(mode);
  }

  function toggleSeries(name: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Export handlers
  function handleExportCSV() {
    if (!chartData.length || !seriesNames.length) return;
    const header = ['timestamp', 'datetime', ...seriesNames].join(',');
    const rows = chartData.map((d: any) => {
      const dt = new Date(d.ts * 1000).toISOString();
      return [d.ts, dt, ...seriesNames.map((n) => d[n] ?? '')].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metrics-${activeQuery.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJSON() {
    if (!metricsData?.data?.result?.length) return;
    const blob = new Blob([JSON.stringify(metricsData.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metrics-${activeQuery.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadPNG() {
    const container = chartContainerRef.current;
    if (!container) return;
    const svgEl = container.querySelector('.recharts-wrapper svg');
    if (!svgEl) return;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement('canvas');
    const rect = svgEl.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);

    const img = new window.Image();
    img.onload = () => {
      ctx.fillStyle = '#0D1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `metrics-chart-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }

  // Transform chart data
  const chartData = useMemo(() => {
    if (!metricsData?.data?.result?.length) return [];
    const allSeries = metricsData.data.result;
    if (metricsData.data.resultType === 'matrix' && allSeries[0]?.values) {
      const timeMap = new Map<number, Record<string, number>>();
      allSeries.forEach((series: any, idx: number) => {
        const seriesName = Object.entries(series.metric)
          .filter(([k]) => k !== '__name__')
          .map(([k, v]) => `${k}=${v}`)
          .join(', ') || series.metric.__name__ || `series_${idx}`;
        series.values?.forEach(([ts, val]: [number, string]) => {
          if (!timeMap.has(ts)) timeMap.set(ts, {});
          timeMap.get(ts)![seriesName] = parseFloat(val);
        });
      });

      // Merge compare data if available
      if (compareEnabled && compareData?.data?.result?.length) {
        compareData.data.result.forEach((series: any, idx: number) => {
          const seriesName = '\u24B6 ' + (Object.entries(series.metric)
            .filter(([k]) => k !== '__name__')
            .map(([k, v]) => `${k}=${v}`)
            .join(', ') || series.metric.__name__ || `cmp_${idx}`);
          series.values?.forEach(([ts, val]: [number, string]) => {
            if (!timeMap.has(ts)) timeMap.set(ts, {});
            timeMap.get(ts)![seriesName] = parseFloat(val);
          });
        });
      }

      return Array.from(timeMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([ts, vals]) => ({
          time: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          ts,
          ...vals,
        }));
    }
    return [];
  }, [metricsData, compareEnabled, compareData]);

  const seriesNames = useMemo(() => {
    const names: string[] = [];
    if (metricsData?.data?.result?.length) {
      metricsData.data.result.forEach((s: any, idx: number) => {
        names.push(
          Object.entries(s.metric).filter(([k]) => k !== '__name__').map(([k, v]) => `${k}=${v}`).join(', ') || s.metric.__name__ || `series_${idx}`,
        );
      });
    }
    // Add compare series
    if (compareEnabled && compareData?.data?.result?.length) {
      compareData.data.result.forEach((s: any, idx: number) => {
        names.push(
          '\u24B6 ' + (Object.entries(s.metric).filter(([k]) => k !== '__name__').map(([k, v]) => `${k}=${v}`).join(', ') || s.metric.__name__ || `cmp_${idx}`),
        );
      });
    }
    return names;
  }, [metricsData, compareEnabled, compareData]);

  // Color assignment: primary series use COLORS, compare series use COMPARE_COLORS
  const primaryCount = metricsData?.data?.result?.length ?? 0;
  const getSeriesColor = useCallback((idx: number) => {
    if (idx < primaryCount) return COLORS[idx % COLORS.length];
    return COMPARE_COLORS[(idx - primaryCount) % COMPARE_COLORS.length];
  }, [primaryCount]);

  const latestValues = useMemo(() => {
    if (!chartData.length || !seriesNames.length) return [];
    const last = chartData[chartData.length - 1] as Record<string, unknown>;
    return seriesNames.map((name) => ({ name, value: (last[name] as number) ?? 0 }));
  }, [chartData, seriesNames]);

  // Y-axis formatter
  const yAxisFormatter = useCallback((v: number) => formatValue(v, activeQuery, activeUnit), [activeQuery, activeUnit]);

  // Flag ON → the full v12 "no-PromQL" Explore experience. Flag OFF → existing page below.
  if (exploreEnabled) {
    const v2Consumers = (obsConsumers ?? []).map((c) => ({
      id: c.consumer_id,
      name: c.consumer_name ?? c.consumer_slug ?? c.consumer_id,
      obs: true,
    }));
    const selectedName = v2Consumers.find((c) => c.id === selectedConsumer)?.name;
    return (
      <MetricsExploreV2
        consumers={v2Consumers.length ? v2Consumers : undefined}
        consumerId={selectedConsumer}
        onConsumerChange={setSelectedConsumer}
        customerName={selectedName ?? currentUserForExplore?.tenant?.name}
      />
    );
  }

  return (
    <>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Metrics Explorer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            PromQL &middot; Managed LGTM (Mimir)
            {metricNames.length > 0 && <> &middot; {metricNames.length} metrics available</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'own' && (
            <Link href="/observability/logs">
              <Button variant="ghost" size="sm">&rarr; Logs</Button>
            </Link>
          )}
          {isProvider && (
            <>
              <div className="flex items-center rounded-lg border border-border bg-muted/20 p-0.5">
                <button
                  onClick={() => setViewMode('own')}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-all',
                    viewMode === 'own' ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Own
                </button>
                <button
                  onClick={() => setViewMode('customer')}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-all',
                    viewMode === 'customer' ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Customer
                </button>
              </div>
              {viewMode === 'customer' && (
                <Button variant="ghost" size="sm" onClick={() => setAccessOpen(true)} className="gap-1.5 text-muted-foreground hover:text-foreground">
                  <Settings2 className="h-3.5 w-3.5" />
                  Manage access
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {viewMode === 'own' ? (<>
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => handleModeSwitch('promql')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-colors', queryMode === 'promql' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50')}
          >
            <Code className="h-3 w-3" /> PromQL
          </button>
          <button
            onClick={() => handleModeSwitch('builder')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-colors border-l border-border', queryMode === 'builder' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50')}
          >
            <Blocks className="h-3 w-3" /> Builder
          </button>
        </div>
      </div>

      {/* PromQL input with autocomplete */}
      {queryMode === 'promql' && (
        <div className="space-y-2">
          <PromQLAutocomplete
            value={query}
            onChange={setQuery}
            onRun={handleRun}
            metricNames={metricNames}
            isLoading={isLoading}
          />

          {/* Compare query input */}
          {compareEnabled && (
            <div className="flex items-stretch rounded-xl border border-purple-500/30 overflow-hidden bg-muted focus-within:border-purple-500/60 focus-within:ring-1 focus-within:ring-purple-500/20 transition-all">
              <div className="flex items-center gap-1.5 px-3 border-r border-purple-500/30 bg-purple-500/5 text-purple-400 text-[11px] font-semibold font-mono whitespace-nowrap">
                <GitCompare className="h-3 w-3" />
                Compare
              </div>
              <input
                value={compareQueryText}
                onChange={(e) => setCompareQueryText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRunCompare(); }}
                className="flex-1 bg-transparent px-3 py-2.5 text-[12.5px] font-mono text-foreground outline-none placeholder:text-muted-foreground/40"
                placeholder="Enter second PromQL expression to overlay..."
              />
              <button
                onClick={handleRunCompare}
                className="flex items-center gap-1.5 px-4 bg-purple-600 text-white text-[12px] font-bold hover:bg-purple-600/90 transition-colors"
              >
                <Play className="h-3 w-3" /> Run
              </button>
            </div>
          )}
        </div>
      )}

      {/* Builder mode */}
      {queryMode === 'builder' && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Metric</label>
              <MetricSearchDropdown
                value={builder.metric}
                onChange={(v) => setBuilder((prev) => ({ ...prev, metric: v }))}
                metricNames={metricNames}
              />
            </div>

            {/* Label filters with operators */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Label Filters</label>
                <button
                  onClick={() => setBuilder((prev) => ({ ...prev, filters: [...prev.filters, { id: Date.now().toString(36), label: '', op: '=', value: '' }] }))}
                  className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Add filter
                </button>
              </div>
              {builder.filters.length === 0 && (
                <p className="text-[11px] text-muted-foreground/60">No filters. Click &ldquo;Add filter&rdquo; to add label matchers.</p>
              )}
              <div className="space-y-2">
                {builder.filters.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <input
                      value={f.label}
                      onChange={(e) => setBuilder((prev) => ({ ...prev, filters: prev.filters.map((x) => x.id === f.id ? { ...x, label: e.target.value } : x) }))}
                      className="flex-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/40"
                      placeholder="label"
                      list={`labels-${f.id}`}
                    />
                    <datalist id={`labels-${f.id}`}>
                      {labels.filter((l) => !l.startsWith('__')).map((l) => <option key={l} value={l} />)}
                    </datalist>
                    <select
                      value={f.op}
                      onChange={(e) => setBuilder((prev) => ({ ...prev, filters: prev.filters.map((x) => x.id === f.id ? { ...x, op: e.target.value as typeof MATCH_OPERATORS[number] } : x) }))}
                      className="w-14 rounded-md border border-border bg-muted/50 px-1.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:border-primary text-center"
                    >
                      {MATCH_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                    </select>
                    <input
                      value={f.value}
                      onChange={(e) => setBuilder((prev) => ({ ...prev, filters: prev.filters.map((x) => x.id === f.id ? { ...x, value: e.target.value } : x) }))}
                      className="flex-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/40"
                      placeholder="value"
                    />
                    <button
                      onClick={() => setBuilder((prev) => ({ ...prev, filters: prev.filters.filter((x) => x.id !== f.id) }))}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Aggregation + Window + Group By */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Aggregation</label>
                <select
                  value={builder.aggregation}
                  onChange={(e) => setBuilder((prev) => ({ ...prev, aggregation: e.target.value as typeof AGGREGATION_OPTIONS[number] }))}
                  className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary"
                >
                  {AGGREGATION_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Window</label>
                <select
                  value={builder.window}
                  onChange={(e) => setBuilder((prev) => ({ ...prev, window: e.target.value as typeof WINDOW_OPTIONS[number] }))}
                  disabled={builder.aggregation === 'none'}
                  className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary disabled:opacity-40"
                >
                  {WINDOW_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Group By</label>
                <input
                  value={builder.groupBy}
                  onChange={(e) => setBuilder((prev) => ({ ...prev, groupBy: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/40"
                  placeholder="e.g. job, instance"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Generated PromQL</label>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[12px] font-mono text-foreground/80 min-h-[36px]">
                {generatedPromQL || <span className="text-muted-foreground/40">Select a metric to generate a query...</span>}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleRun}
                disabled={isLoading || !generatedPromQL}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick queries + time range + chart type + refresh + exemplars + compare + export + share */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_QUERIES.map((q) => (
            <button
              key={q.label}
              onClick={() => { setQuery(q.query); setActiveQuery(q.query); setActiveUnit(q.unit); setHiddenSeries(new Set()); setRunCounter((c) => c + 1); }}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Time ranges */}
          <TimeRangeSelector
            presets={METRICS_PRESETS}
            value={timeRange}
            onChange={setTimeRange}
          />

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Chart type */}
          {[
            { type: 'area' as const, icon: TrendingUp, label: 'Area' },
            { type: 'line' as const, icon: BarChart3, label: 'Line' },
            { type: 'stacked' as const, icon: Layers, label: 'Stacked' },
          ].map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              title={label}
              className={cn('rounded-md p-1.5 transition-colors', chartType === type ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50')}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Refresh interval */}
          <div className="relative">
            <button
              onClick={() => setRefreshOpen(!refreshOpen)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                refreshInterval > 0 ? 'bg-green-500/10 text-green-500' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              <RefreshCw className={cn('h-3 w-3', refreshInterval > 0 && 'animate-spin')} style={refreshInterval > 0 ? { animationDuration: '3s' } : undefined} />
              {refreshInterval > 0 ? REFRESH_OPTIONS.find((r) => r.ms === refreshInterval)?.label : 'Auto'}
            </button>
            {refreshOpen && (
              <div className="absolute z-50 mt-1 right-0 rounded-lg border border-border bg-card shadow-lg py-1">
                {REFRESH_OPTIONS.map((opt) => (
                  <button
                    key={opt.ms}
                    onClick={() => { setRefreshInterval(opt.ms); setRefreshOpen(false); }}
                    className={cn('block w-full text-left px-4 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/50', refreshInterval === opt.ms ? 'text-primary' : 'text-foreground')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Exemplars */}
          <button
            onClick={() => setExemplarsEnabled((prev) => !prev)}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors', exemplarsEnabled ? 'bg-purple-500/10 text-purple-500' : 'text-muted-foreground hover:bg-muted/50')}
          >
            <Crosshair className="h-3 w-3" /> Exemplars
          </button>

          {/* Compare toggle */}
          <button
            onClick={() => { setCompareEnabled(!compareEnabled); if (compareEnabled) { setActiveCompareQuery(''); setCompareQueryText(''); } }}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors', compareEnabled ? 'bg-purple-500/10 text-purple-400' : 'text-muted-foreground hover:bg-muted/50')}
          >
            <GitCompare className="h-3 w-3" /> Compare
          </button>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Export dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
              <Download className="h-3 w-3" /> Export
            </button>
            <div className="absolute z-50 mt-1 right-0 rounded-lg border border-border bg-card shadow-lg py-1 hidden group-hover:block min-w-[140px]">
              <button
                onClick={handleExportCSV}
                className="block w-full text-left px-4 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                Export CSV
              </button>
              <button
                onClick={handleExportJSON}
                className="block w-full text-left px-4 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                Export JSON
              </button>
              <button
                onClick={handleDownloadPNG}
                className="flex items-center gap-1.5 w-full text-left px-4 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <ImageIcon className="h-3 w-3" /> Download PNG
              </button>
            </div>
          </div>

          {/* Share */}
          <button
            onClick={handleShare}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors', shareCopied ? 'bg-green-500/10 text-green-500' : 'text-muted-foreground hover:bg-muted/50')}
          >
            <Share2 className="h-3 w-3" /> {shareCopied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span className="text-[12px] text-red-400">{(error as Error).message}</span>
        </div>
      )}

      {/* Main chart / Status grid */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-foreground">
                {activeQuery.length > 80 ? activeQuery.slice(0, 80) + '...' : activeQuery}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {isBinary ? (
                  <>{metricsData?.data?.result?.length ?? 0} targets &middot; status view</>
                ) : (
                  <>
                    {seriesNames.length} series &middot; {chartData.length} data points
                    {exemplarsEnabled && exemplarsData?.data?.length ? (
                      <> &middot; {exemplarsData.data.reduce((sum: number, s: any) => sum + (s.exemplars?.length ?? 0), 0)} exemplars</>
                    ) : null}
                  </>
                )}
                {' '}&middot; {timeRange.preset === 'custom' ? 'custom range' : timeRange.preset} window
                {refreshInterval > 0 && <> &middot; auto-refresh {REFRESH_OPTIONS.find((r) => r.ms === refreshInterval)?.label}</>}
                {compareEnabled && activeCompareQuery && <> &middot; <span className="text-purple-400">comparing</span></>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Table toggle for instant results */}
              {isInstantVector && !isBinary && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Table2 className="h-3 w-3" /> Instant vector — see table below
                </span>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isBinary && metricsData?.data?.result?.length ? (
            /* Binary metric (like `up`) — show status grid instead of chart */
            <StatusGrid result={metricsData.data.result} />
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
              <span className="text-sm">No time-series data returned.</span>
              {isInstantVector && <span className="text-xs mt-1">Scroll down for the instant results table.</span>}
            </div>
          ) : (
            <div ref={chartContainerRef}>
              <ResponsiveContainer width="100%" height={280}>
                {chartType === 'line' ? (
                  <LineChart data={chartData} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, className: 'fill-muted-foreground' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, className: 'fill-muted-foreground' }} tickLine={false} axisLine={false} width={60} tickFormatter={yAxisFormatter} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, color: 'hsl(var(--foreground))' }}
                      formatter={(v: number) => formatValue(v, activeQuery, activeUnit)}
                    />
                    {seriesNames.map((name, i) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={getSeriesColor(i)}
                        strokeWidth={1.5}
                        dot={false}
                        hide={hiddenSeries.has(name)}
                      />
                    ))}
                    <Brush dataKey="time" height={24} stroke="hsl(var(--border))" fill="transparent" travellerWidth={8} />
                  </LineChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}
                    stackOffset={chartType === 'stacked' ? 'none' : undefined}
                  >
                    <defs>
                      {seriesNames.map((name, i) => (
                        <linearGradient key={name} id={`grad_${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={getSeriesColor(i)} stopOpacity={chartType === 'stacked' ? 0.6 : 0.25} />
                          <stop offset="100%" stopColor={getSeriesColor(i)} stopOpacity={chartType === 'stacked' ? 0.1 : 0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, className: 'fill-muted-foreground' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, className: 'fill-muted-foreground' }} tickLine={false} axisLine={false} width={60} tickFormatter={yAxisFormatter} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, color: 'hsl(var(--foreground))' }}
                      formatter={(v: number) => formatValue(v, activeQuery, activeUnit)}
                    />
                    {seriesNames.map((name, i) => (
                      <Area
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={getSeriesColor(i)}
                        strokeWidth={1.5}
                        fill={`url(#grad_${i})`}
                        stackId={chartType === 'stacked' ? 'stack' : undefined}
                        hide={hiddenSeries.has(name)}
                      />
                    ))}
                    <Brush dataKey="time" height={24} stroke="hsl(var(--border))" fill="transparent" travellerWidth={8} />
                  </AreaChart>
                )}
              </ResponsiveContainer>

              {/* Unified series legend */}
              <SeriesLegend
                series={latestValues}
                hiddenSeries={hiddenSeries}
                onToggle={toggleSeries}
                activeQuery={activeQuery}
                activeUnit={activeUnit}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instant vector table */}
      {isInstantVector && !isBinary && instantData?.data?.result?.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Table2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                Instant Results ({instantData.data.result.length} series)
              </h3>
            </div>
            <InstantTable result={instantData.data.result} activeQuery={activeQuery} activeUnit={activeUnit} />
          </CardContent>
        </Card>
      )}

      {/* Query History */}
      {queryHistory.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <button onClick={() => setHistoryOpen(!historyOpen)} className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[#2563EB]" />
                <h3 className="text-sm font-semibold text-foreground">Query History</h3>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{queryHistory.length}</span>
              </div>
              <div className="flex items-center gap-2">
                {historyOpen && (
                  <span onClick={(e) => { e.stopPropagation(); setQueryHistory([]); persistQueryHistory([]); }} className="text-[11px] font-medium text-red-400 hover:text-red-300 cursor-pointer transition-colors">Clear History</span>
                )}
                {historyOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>
            {historyOpen && (
              <div className="space-y-1 mt-3 max-h-60 overflow-y-auto">
                {queryHistory.map((entry, idx) => (
                  <div
                    key={`${entry.timestamp}-${idx}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => { setQuery(entry.query); setActiveQuery(entry.query); setHiddenSeries(new Set()); if (queryMode === 'builder') setQueryMode('promql'); }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-mono text-foreground truncate">{entry.query}</div>
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap shrink-0">
                      {new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Saved Queries */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Saved Queries</h3>
              {savedQueries.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{savedQueries.length}</span>
              )}
            </div>
            {!saveDialogOpen ? (
              <Button variant="ghost" size="sm" onClick={() => { setSaveName(''); setSaveDialogOpen(true); }} className="text-[11px] gap-1.5">
                <Save className="h-3 w-3" /> Save Current
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveQuery()} placeholder="Query name..." autoFocus className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-[12px] font-medium text-foreground outline-none focus:border-primary w-48" />
                <Button size="sm" onClick={handleSaveQuery} disabled={!saveName.trim()} className="text-[11px]">Save</Button>
                <Button variant="ghost" size="sm" onClick={() => setSaveDialogOpen(false)} className="text-[11px]">Cancel</Button>
              </div>
            )}
          </div>
          {saveDialogOpen && (
            <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
              Saving: <span className="font-mono text-foreground">{activeQuery.length > 80 ? activeQuery.slice(0, 80) + '...' : activeQuery}</span>
            </div>
          )}
          {savedQueries.length === 0 && !saveDialogOpen ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bookmark className="h-6 w-6 mb-2 opacity-20" />
              <span className="text-[12px]">No saved queries yet. Run a query and click &ldquo;Save Current&rdquo; to save it.</span>
            </div>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {savedQueries.map((sq) => (
                <div key={sq.id} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => handleLoadSavedQuery(sq)}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-foreground">{sq.name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 truncate">{sq.query}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteSavedQuery(sq.id); }} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Labels — clickable to insert */}
      {labels.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Available Labels ({labels.length})</h3>
            <div className="flex flex-wrap gap-1.5">
              {labels.filter((l) => !l.startsWith('__')).slice(0, 60).map((label) => (
                <button
                  key={label}
                  onClick={() => {
                    if (queryMode === 'builder') {
                      setBuilder((prev) => ({ ...prev, filters: [...prev.filters, { id: Date.now().toString(36), label, op: '=', value: '' }] }));
                    } else {
                      setQuery((prev) => prev.includes('{') ? prev.replace('}', `, ${label}=""}`) : prev + `{${label}=""}`);
                    }
                  }}
                  className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
                >
                  {label}
                </button>
              ))}
              {labels.filter((l) => !l.startsWith('__')).length > 60 && (
                <span className="text-[10px] text-muted-foreground">+{labels.filter((l) => !l.startsWith('__')).length - 60} more</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      </>) : (
        <ProviderMetricsContent />
      )}
    </div>

    {isProvider && <AccessDialog open={accessOpen} onClose={() => setAccessOpen(false)} />}
    </>
  );
}
