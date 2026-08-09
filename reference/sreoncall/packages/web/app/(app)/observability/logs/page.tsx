'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Play,
  Pause,
  Search,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Radio,
  Clock,
  Copy,
  Check,
  Download,
  WrapText,
  Tag,
  Star,
  X,
  Hash,
  CornerDownLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useLogsQuery, useLogLabels, useLogLabelValues, useLogVolume, fetchLogs } from '@/lib/hooks/useObservabilityProxy';
import { TimeRangeSelector, TimeRangeValue } from '@/components/ui/TimeRangeSelector';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';
import { useSession } from 'next-auth/react';
import { ProviderLogsContent, AccessDialog } from '../_provider-obs';
import { useFeatureFlag } from '@/lib/hooks/useFeatureFlag';
import { LogsExploreV2 } from '@/components/observability/LogsExploreV2';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useProviderObservabilityConsumers } from '@/lib/hooks/useProviderObservability';

const LOG_PRESETS = [
  { label: '5m', ms: 5 * 60_000 },
  { label: '15m', ms: 15 * 60_000 },
  { label: '1h', ms: 3600_000 },
  { label: '6h', ms: 6 * 3600_000 },
  { label: '24h', ms: 24 * 3600_000 },
  { label: '3d', ms: 3 * 24 * 3600_000 },
  { label: '7d', ms: 7 * 24 * 3600_000 },
];

const LEVEL_FILTERS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

const LEVEL_CHIP_STYLES: Record<string, { active: string; inactive: string }> = {
  ERROR: {
    active: 'bg-red-500/20 text-[#DC2626] border-red-500/40',
    inactive: 'bg-transparent text-muted-foreground border-border hover:border-red-500/30 hover:text-[#DC2626]',
  },
  WARN: {
    active: 'bg-yellow-500/20 text-[#A16207] border-yellow-500/40',
    inactive: 'bg-transparent text-muted-foreground border-border hover:border-yellow-500/30 hover:text-[#A16207]',
  },
  INFO: {
    active: 'bg-blue-500/20 text-[#2563EB] border-blue-500/40',
    inactive: 'bg-transparent text-muted-foreground border-border hover:border-blue-500/30 hover:text-[#2563EB]',
  },
  DEBUG: {
    active: 'bg-muted/50 text-foreground border-border',
    inactive: 'bg-transparent text-muted-foreground border-border hover:bg-muted/30 hover:text-foreground',
  },
};

const HISTOGRAM_LEVEL_COLORS: Record<string, string> = {
  error: '#ef4444',
  warn: '#eab308',
  info: '#3b82f6',
  debug: '#6b7280',
};

const LEVEL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  error: { text: 'text-[#DC2626]', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  warn: { text: 'text-[#A16207]', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  warning: { text: 'text-[#A16207]', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  info: { text: 'text-[#2563EB]', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  debug: { text: 'text-muted-foreground', bg: 'bg-muted/30', border: 'border-border' },
};

function getLevelColor(line: string, streamLabels: Record<string, string>) {
  // 1. Check stream labels first (most reliable)
  const streamLevel = (streamLabels.level || streamLabels.severity || streamLabels.log_level || streamLabels.loglevel || '').toLowerCase();
  if (streamLevel) {
    if (streamLevel === 'error' || streamLevel === 'err' || streamLevel === 'fatal' || streamLevel === 'critical' || streamLevel === 'crit')
      return { level: 'ERROR', ...LEVEL_COLORS.error };
    if (streamLevel === 'warn' || streamLevel === 'warning')
      return { level: 'WARN', ...LEVEL_COLORS.warn };
    if (streamLevel === 'debug' || streamLevel === 'trace')
      return { level: 'DEBUG', ...LEVEL_COLORS.debug };
    if (streamLevel === 'info' || streamLevel === 'information' || streamLevel === 'notice')
      return { level: 'INFO', ...LEVEL_COLORS.info };
    if (LEVEL_COLORS[streamLevel]) return { level: streamLevel.toUpperCase(), ...LEVEL_COLORS[streamLevel] };
  }

  // 2. Try parsing JSON log lines for level/severity fields
  if (line.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(line);
      const jsonLevel = (parsed.level || parsed.severity || parsed.loglevel || parsed.log_level || parsed.lvl || parsed.Level || parsed.Severity || '').toString().toLowerCase();
      if (jsonLevel) {
        if (jsonLevel === 'error' || jsonLevel === 'err' || jsonLevel === 'fatal' || jsonLevel === 'critical' || jsonLevel === 'crit' || jsonLevel === '50' || jsonLevel === '60')
          return { level: 'ERROR', ...LEVEL_COLORS.error };
        if (jsonLevel === 'warn' || jsonLevel === 'warning' || jsonLevel === '40')
          return { level: 'WARN', ...LEVEL_COLORS.warn };
        if (jsonLevel === 'debug' || jsonLevel === 'trace' || jsonLevel === '10' || jsonLevel === '20')
          return { level: 'DEBUG', ...LEVEL_COLORS.debug };
        if (jsonLevel === 'info' || jsonLevel === 'information' || jsonLevel === 'notice' || jsonLevel === '30')
          return { level: 'INFO', ...LEVEL_COLORS.info };
      }
    } catch {
      // Not valid JSON, fall through to text matching
    }
  }

  // 3. Text pattern matching — strict patterns to avoid false positives
  //    Match: [ERROR], level=error, "level":"error", ERROR:, | ERROR |, leading ERROR
  //    Do NOT match: "error" appearing in normal message text
  const levelPattern = line.match(
    /\[(ERROR|ERR|FATAL|CRITICAL|CRIT|WARN(?:ING)?|DEBUG|TRACE|INFO)\]|(?:level|severity|lvl)\s*[=:]\s*"?(error|err|fatal|critical|crit|warn(?:ing)?|debug|trace|info)"?|\b(ERROR|ERR|FATAL|CRITICAL|CRIT|WARN(?:ING)?|DEBUG|TRACE)\s*[:\-|]/i,
  );
  if (levelPattern) {
    const matched = (levelPattern[1] || levelPattern[2] || levelPattern[3] || '').toLowerCase();
    if (matched === 'error' || matched === 'err' || matched === 'fatal' || matched === 'critical' || matched === 'crit')
      return { level: 'ERROR', ...LEVEL_COLORS.error };
    if (matched === 'warn' || matched === 'warning')
      return { level: 'WARN', ...LEVEL_COLORS.warn };
    if (matched === 'debug' || matched === 'trace')
      return { level: 'DEBUG', ...LEVEL_COLORS.debug };
    if (matched === 'info')
      return { level: 'INFO', ...LEVEL_COLORS.info };
  }
  return { level: 'INFO', ...LEVEL_COLORS.info };
}

function JsonValue({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="text-[#16A34A]">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="text-[#2563EB]">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-[#A16207]">{String(value)}</span>;
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (Array.isArray(value)) return <span className="text-foreground/70">{JSON.stringify(value)}</span>;
  if (typeof value === 'object') return <span className="text-foreground/70">{JSON.stringify(value)}</span>;
  return <span className="text-foreground/70">{String(value)}</span>;
}

function tryParseJson(msg: string): Record<string, unknown> | null {
  const trimmed = msg.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ── Saved Queries (localStorage) ─────────────────────────────────────
const SAVED_QUERIES_KEY = 'sreoncall:log-saved-queries';
const RECENT_QUERIES_KEY = 'sreoncall:log-recent-queries';
const MAX_RECENT = 8;

function getSavedQueries(): string[] {
  try { return JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || '[]'); } catch { return []; }
}
function saveSavedQueries(queries: string[]) {
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries));
}
function getRecentQueries(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY) || '[]'); } catch { return []; }
}
function pushRecentQuery(q: string) {
  const recent = getRecentQueries().filter((r) => r !== q);
  recent.unshift(q);
  localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export default function LogViewer() {
  const { data: session } = useSession();
  const isProvider = (session?.user as any)?.tenantType === 'provider';
  // Flag-gated LogsExploreV2. Off by default → page renders exactly as before.
  const exploreEnabled = useFeatureFlag('observability_discovery_enabled');
  const { data: currentUserForExplore } = useCurrentUser();
  // v12 customer switcher: real provider consumers (only fetched for provider tenants).
  const { data: obsConsumers } = useProviderObservabilityConsumers(isProvider && exploreEnabled);
  const [selectedConsumer, setSelectedConsumer] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'own' | 'customer'>('own');
  const [accessOpen, setAccessOpen] = useState(false);

  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '{job=~".+"}';
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [searchText, setSearchText] = useState('');
  const [limitOverride, setLimitOverride] = useState<string | null>(null);
  const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(500);
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [liveTail, setLiveTail] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => {
    const now = Date.now();
    return { start: now - 3600_000, end: now, preset: '1h' };
  });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [wrapLines, setWrapLines] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [savedQueries, setSavedQueries] = useState<string[]>([]);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [showQueryHistory, setShowQueryHistory] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load saved/recent queries on mount
  useEffect(() => {
    setSavedQueries(getSavedQueries());
    setRecentQueries(getRecentQueries());
  }, []);

  const toggleLevel = useCallback((level: string) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const startNs = useMemo(() => {
    if (timeRange.preset === 'custom') return String(timeRange.start * 1e6);
    return String((Date.now() - (LOG_PRESETS.find(p => p.label === timeRange.preset)?.ms ?? 3600_000)) * 1e6);
  }, [activeQuery, timeRange, refreshCounter]);
  const nowNs = useMemo(() => {
    if (timeRange.preset === 'custom') return String(timeRange.end * 1e6);
    return String(Date.now() * 1e6);
  }, [activeQuery, timeRange, refreshCounter]);

  // Auto-scale limit based on time range duration
  const limit = useMemo(() => {
    if (limitOverride) return limitOverride;
    const rangeMs = timeRange.end - timeRange.start;
    const hours = rangeMs / 3600_000;
    if (hours <= 1) return '500';
    if (hours <= 6) return '1000';
    if (hours <= 24) return '2000';
    if (hours <= 72) return '3000';
    return '5000';
  }, [timeRange, limitOverride]);

  const { data: logsData, isLoading, error } = useLogsQuery(
    activeQuery, startNs, nowNs, limit, 'backward', !!activeQuery
  );

  // Accumulated older entries from pagination
  const [olderEntries, setOlderEntries] = useState<typeof logsData | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);

  // Reset older entries when query/time range changes
  useEffect(() => {
    setOlderEntries(null);
    setHasMoreOlder(true);
  }, [activeQuery, startNs, nowNs]);

  // Volume query for histogram — uses count_over_time so we get counts across full range
  const volumeStep = useMemo(() => {
    const rangeMs = timeRange.end - timeRange.start;
    const hours = rangeMs / 3600_000;
    if (hours <= 1) return '1m';
    if (hours <= 6) return '5m';
    if (hours <= 24) return '15m';
    if (hours <= 72) return '1h';
    return '2h';
  }, [timeRange]);
  const { data: volumeData } = useLogVolume(activeQuery, startNs, nowNs, volumeStep, !!activeQuery);

  const { data: labelsData } = useLogLabels();
  const availableLabels = labelsData?.data ?? [];

  function handleRun() {
    setActiveQuery(query);
    pushRecentQuery(query);
    setRecentQueries(getRecentQueries());
    setShowQueryHistory(false);
  }

  const handleCopy = useCallback((text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  }, []);

  const toggleSavedQuery = useCallback((q: string) => {
    setSavedQueries((prev) => {
      const next = prev.includes(q) ? prev.filter((x) => x !== q) : [...prev, q];
      saveSavedQueries(next);
      return next;
    });
  }, []);

  // Live Tail: recalculate time window every 2 seconds
  useEffect(() => {
    if (!liveTail) return;
    const interval = setInterval(() => { setRefreshCounter((c) => c + 1); }, 2000);
    return () => clearInterval(interval);
  }, [liveTail]);

  useEffect(() => {
    if (liveTail && logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [liveTail, logsData]);

  const addFieldFilter = useCallback((label: string, value: string, exclude: boolean) => {
    const operator = exclude ? '!=' : '=';
    const filter = `${label}${operator}"${value}"`;
    setQuery((prev) => {
      const match = prev.match(/^(\{)(.*?)(\}.*)$/);
      if (match) {
        const existing = match[2].trim();
        const newSelector = existing ? `${existing}, ${filter}` : filter;
        return `${match[1]}${newSelector}${match[3]}`;
      }
      return `{${filter}}`;
    });
  }, []);

  const addLevelFilter = useCallback((level: string, exclude: boolean) => {
    const operator = exclude ? '!=' : '=';
    setQuery((prev) => {
      const match = prev.match(/^(\{)(.*?)(\}.*)$/);
      if (match) {
        const existing = match[2].trim();
        const filter = `level${operator}"${level.toLowerCase()}"`;
        const newSelector = existing ? `${existing}, ${filter}` : filter;
        return `${match[1]}${newSelector}${match[3]}`;
      }
      return `{level${operator}"${level.toLowerCase()}"}`;
    });
  }, []);

  // Flatten log streams into a flat list of entries
  type LogEntry = { ts: string; tsRaw: string; level: string; src: string; msg: string; lc: typeof LEVEL_COLORS.error; streamLabels: Record<string, string> };

  const flattenStreams = useCallback((data: typeof logsData): LogEntry[] => {
    if (!data?.data?.result?.length) return [];
    const entries: LogEntry[] = [];
    const rangeMs = timeRange.end - timeRange.start;
    const showDate = rangeMs > 24 * 3600_000;

    for (const stream of data.data.result) {
      const src = stream.stream.job || stream.stream.app || stream.stream.container || stream.stream.filename || Object.values(stream.stream).join('/');
      for (const [nsTs, line] of stream.values) {
        const date = new Date(parseInt(nsTs) / 1e6);
        const { level, ...lc } = getLevelColor(line, stream.stream);
        const tsFormat = showDate
          ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any);
        entries.push({ ts: tsFormat, tsRaw: nsTs, level, src, msg: line, lc, streamLabels: stream.stream });
      }
    }
    return entries;
  }, [timeRange]);

  const logEntries = useMemo(() => {
    const main = flattenStreams(logsData);
    const older = olderEntries ? flattenStreams(olderEntries) : [];
    const all = [...main, ...older];

    // Deduplicate by tsRaw (same nanosecond timestamp = same entry)
    const seen = new Set<string>();
    const deduped = all.filter((e) => {
      if (seen.has(e.tsRaw)) return false;
      seen.add(e.tsRaw);
      return true;
    });

    deduped.sort((a, b) => {
      const aBig = BigInt(a.tsRaw);
      const bBig = BigInt(b.tsRaw);
      return aBig > bBig ? -1 : aBig < bBig ? 1 : 0;
    });

    return deduped;
  }, [logsData, olderEntries, flattenStreams]);

  // Load older entries (pagination)
  const loadOlderEntries = useCallback(async () => {
    if (!activeQuery || !logEntries.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      // Use the oldest entry's timestamp as the new "end" to fetch the previous page
      const oldestTs = logEntries[logEntries.length - 1].tsRaw;
      // Subtract 1 nanosecond to avoid duplicate — safe string math for ns timestamps
      const olderEnd = String(BigInt(oldestTs) - BigInt(1));
      const data = await fetchLogs(activeQuery, startNs, olderEnd, limit, 'backward');
      const newEntries = flattenStreams(data);
      if (newEntries.length === 0) {
        setHasMoreOlder(false);
      } else {
        setOlderEntries((prev) => {
          if (!prev) return data;
          // Merge streams
          const merged = { ...data };
          merged.data = {
            ...data.data,
            result: [...(prev.data?.result || []), ...(data.data?.result || [])],
          };
          return merged;
        });
      }
    } catch (err) {
      console.error('Failed to load older entries', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [activeQuery, logEntries, startNs, limit, loadingOlder, flattenStreams]);

  // Compute level distribution ratios from loaded log entries
  const levelRatios = useMemo(() => {
    const total = logEntries.length;
    if (total === 0) return { error: 0, warn: 0, info: 1, debug: 0 };
    let err = 0, wrn = 0, dbg = 0, inf = 0;
    for (const e of logEntries) {
      const lvl = e.level.toLowerCase();
      if (lvl === 'error') err++;
      else if (lvl === 'warn' || lvl === 'warning') wrn++;
      else if (lvl === 'debug') dbg++;
      else inf++;
    }
    return { error: err / total, warn: wrn / total, info: inf / total, debug: dbg / total };
  }, [logEntries]);

  // Build histogram: use volume data for full range, split by level ratios from log entries
  const histogramData = useMemo(() => {
    const rangeMs = timeRange.end - timeRange.start;
    const showDate = rangeMs > 24 * 3600_000;
    const fmtTime = (ms: number) => {
      const d = new Date(ms);
      return showDate
        ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const hasFilter = activeLevels.size > 0;

    // Use volume data for full-range coverage (from Loki count_over_time)
    const volResult = (volumeData as any)?.data?.result;
    if (volResult?.length) {
      // Check if Loki returned per-level streams
      const hasLevelBreakdown = volResult.length > 1 || !!(volResult[0]?.metric?.level || volResult[0]?.stream?.level);

      if (hasLevelBreakdown) {
        // Loki has level labels — use them directly
        const timeBuckets = new Map<number, { error: number; warn: number; info: number; debug: number; total: number }>();
        for (const stream of volResult) {
          const lvl = (stream.metric?.level || stream.stream?.level || '').toLowerCase();
          const values: [number, string][] = stream.values || [];
          for (const [ts, val] of values) {
            const tsMs = ts * 1000;
            let bucket = timeBuckets.get(tsMs);
            if (!bucket) { bucket = { error: 0, warn: 0, info: 0, debug: 0, total: 0 }; timeBuckets.set(tsMs, bucket); }
            const count = parseFloat(val) || 0;
            bucket.total += count;
            if (lvl === 'error' || lvl === 'err' || lvl === 'fatal' || lvl === 'critical') bucket.error += count;
            else if (lvl === 'warn' || lvl === 'warning') bucket.warn += count;
            else if (lvl === 'debug' || lvl === 'trace') bucket.debug += count;
            else bucket.info += count;
          }
        }
        if (timeBuckets.size > 0) {
          return Array.from(timeBuckets.entries()).sort(([a], [b]) => a - b)
            .map(([tsMs, b]) => {
              const e = hasFilter && !activeLevels.has('ERROR') ? 0 : b.error;
              const w = hasFilter && !activeLevels.has('WARN') ? 0 : b.warn;
              const inf = hasFilter && !activeLevels.has('INFO') ? 0 : b.info;
              const d = hasFilter && !activeLevels.has('DEBUG') ? 0 : b.debug;
              return { time: fmtTime(tsMs), tsMs, error: e, warn: w, info: inf, debug: d, total: e + w + inf + d };
            });
        }
      } else {
        // Single stream without level — split totals using level ratios from log entries
        const stream = volResult[0];
        const values: [number, string][] = stream.values || [];
        if (values.length) {
          return values.map(([ts, val]: [number, string]) => {
            const tsMs = ts * 1000;
            const total = parseFloat(val) || 0;
            const rawE = Math.round(total * levelRatios.error);
            const rawW = Math.round(total * levelRatios.warn);
            const rawD = Math.round(total * levelRatios.debug);
            const rawI = total - rawE - rawW - rawD;
            const e = hasFilter && !activeLevels.has('ERROR') ? 0 : rawE;
            const w = hasFilter && !activeLevels.has('WARN') ? 0 : rawW;
            const inf = hasFilter && !activeLevels.has('INFO') ? 0 : rawI;
            const d = hasFilter && !activeLevels.has('DEBUG') ? 0 : rawD;
            return { time: fmtTime(tsMs), tsMs, error: e, warn: w, info: inf, debug: d, total: e + w + inf + d };
          });
        }
      }
    }

    // Fallback: derive from raw log entries (when no volume data available)
    if (!logEntries.length) return [];
    const rangeStart = timeRange.start;
    const bucketCount = 40;
    const bucketSize = Math.max(60_000, Math.floor(rangeMs / bucketCount));
    const buckets: Map<number, { error: number; warn: number; info: number; debug: number }> = new Map();

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = rangeStart + i * bucketSize;
      const minuteKey = Math.floor(bucketStart / bucketSize) * bucketSize;
      buckets.set(minuteKey, { error: 0, warn: 0, info: 0, debug: 0 });
    }

    for (const entry of logEntries) {
      const tsMs = parseInt(entry.tsRaw) / 1e6;
      if (tsMs < rangeStart) continue;
      const minuteKey = Math.floor(tsMs / bucketSize) * bucketSize;
      let bucket = buckets.get(minuteKey);
      if (!bucket) { bucket = { error: 0, warn: 0, info: 0, debug: 0 }; buckets.set(minuteKey, bucket); }
      const lvl = entry.level.toLowerCase();
      if (lvl === 'error') bucket.error++;
      else if (lvl === 'warn' || lvl === 'warning') bucket.warn++;
      else if (lvl === 'debug') bucket.debug++;
      else bucket.info++;
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([minuteKey, counts]) => {
        const e = hasFilter && !activeLevels.has('ERROR') ? 0 : counts.error;
        const w = hasFilter && !activeLevels.has('WARN') ? 0 : counts.warn;
        const inf = hasFilter && !activeLevels.has('INFO') ? 0 : counts.info;
        const d = hasFilter && !activeLevels.has('DEBUG') ? 0 : counts.debug;
        return { time: fmtTime(minuteKey), tsMs: minuteKey, error: e, warn: w, info: inf, debug: d, total: e + w + inf + d };
      });
  }, [logEntries, volumeData, timeRange, activeLevels, levelRatios]);

  // Click on histogram bar → zoom into that time window
  const handleHistogramClick = useCallback((data: any) => {
    if (!data?.activePayload?.[0]?.payload?.tsMs) return;
    const clickedTs = data.activePayload[0].payload.tsMs;
    // Zoom to a window around the clicked bucket
    const rangeMs = timeRange.end - timeRange.start;
    const bucketMs = rangeMs / Math.max(histogramData.length, 1);
    const zoomStart = clickedTs;
    const zoomEnd = clickedTs + bucketMs;
    setTimeRange({ start: zoomStart, end: zoomEnd, preset: 'custom' });
    setActiveQuery(query);
  }, [timeRange, histogramData, query]);

  const filteredLogs = useMemo(() => {
    let result = logEntries;
    if (activeLevels.size > 0) {
      result = result.filter((e) => {
        const normalized = e.level === 'WARNING' ? 'WARN' : e.level;
        return activeLevels.has(normalized);
      });
    }
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter((e) => e.msg.toLowerCase().includes(lower) || e.src.toLowerCase().includes(lower));
    }
    return result;
  }, [logEntries, searchText, activeLevels]);

  const handleExport = useCallback(() => {
    const data = filteredLogs.map((e) => ({ timestamp: e.ts, level: e.level, source: e.src, message: e.msg }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

  const displayedLogs = useMemo(() => filteredLogs.slice(0, visibleCount), [filteredLogs, visibleCount]);

  // Time span covered by loaded entries
  const entriesTimeSpan = useMemo(() => {
    if (!logEntries.length) return null;
    const newest = parseInt(logEntries[0].tsRaw) / 1e6;
    const oldest = parseInt(logEntries[logEntries.length - 1].tsRaw) / 1e6;
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    return { oldest, newest, label: `${fmt(oldest)} – ${fmt(newest)}` };
  }, [logEntries]);

  const errorCount = logEntries.filter((e) => e.level === 'ERROR').length;
  const warnCount = logEntries.filter((e) => e.level === 'WARN' || e.level === 'WARNING').length;
  const infoCount = logEntries.filter((e) => e.level === 'INFO').length;

  // Top sources by count
  const topSources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of logEntries) { counts[e.src] = (counts[e.src] || 0) + 1; }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 5);
  }, [logEntries]);

  // Flag ON → the full v12 "no-LogQL" Explore experience. Flag OFF → existing page below.
  if (exploreEnabled) {
    const v2Consumers = (obsConsumers ?? []).map((c) => ({
      id: c.consumer_id,
      name: c.consumer_name ?? c.consumer_slug ?? c.consumer_id,
      obs: true,
    }));
    const selectedName = v2Consumers.find((c) => c.id === selectedConsumer)?.name;
    return (
      <LogsExploreV2
        consumers={v2Consumers.length ? v2Consumers : undefined}
        consumerId={selectedConsumer}
        onConsumerChange={setSelectedConsumer}
        customerName={selectedName ?? currentUserForExplore?.tenant?.name}
      />
    );
  }

  return (
    <>
    <div className="flex gap-4">
      {/* Label explorer sidebar */}
      {viewMode === 'own' && showLabels && (
        <div className="w-64 shrink-0 space-y-3">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-[12px] font-semibold text-foreground">Labels</h3>
                </div>
                <button
                  onClick={() => setShowLabels(false)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
                {availableLabels.length === 0 && (
                  <div className="p-4 text-[11px] text-muted-foreground text-center">No labels found</div>
                )}
                {availableLabels.map((label) => (
                  <LabelRow
                    key={label}
                    label={label}
                    onAddFilter={(val, exclude) => {
                      addFieldFilter(label, val, exclude);
                    }}
                    onSelectLabel={() => {
                      setQuery(`{${label}=~".+"}`);
                      setActiveQuery(`{${label}=~".+"}`);
                    }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Log Explorer</h1>
            <p className="text-sm text-muted-foreground mt-1">
              LogQL &middot; {logEntries.length > 0 ? `${logEntries.length} entries loaded` : 'Query your centralized logs'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {viewMode === 'own' && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLabels((p) => !p)}
                  title="Toggle label explorer"
                >
                  {showLabels ? <PanelLeftClose className="h-3.5 w-3.5 mr-1" /> : <PanelLeftOpen className="h-3.5 w-3.5 mr-1" />}
                  Labels
                </Button>
                <Button
                  variant={liveTail ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setLiveTail((prev) => !prev)}
                  className={cn(liveTail && 'bg-emerald-600 hover:bg-emerald-700 text-white')}
                >
                  {liveTail ? (
                    <>
                      <span className="relative flex h-2 w-2 mr-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                      </span>
                      LIVE
                      <Pause className="h-3 w-3 ml-1.5" />
                    </>
                  ) : (
                    <>
                      <Radio className="h-3 w-3 mr-1" />
                      Live Tail
                    </>
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRefreshCounter((c) => c + 1)}>
                  <Play className="h-3 w-3 mr-1" /> Refresh
                </Button>
              </>
            )}
            {isProvider && (
              <>
                <div className="h-4 w-px bg-border mx-1" />
                <div className="flex items-center rounded-lg border border-border bg-muted/20 p-0.5">
                  <button
                    onClick={() => setViewMode('own')}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-all',
                      viewMode === 'own'
                        ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Own
                  </button>
                  <button
                    onClick={() => setViewMode('customer')}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-all',
                      viewMode === 'customer'
                        ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50'
                        : 'text-muted-foreground hover:text-foreground',
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
        {/* Query bar with history dropdown */}
        <div className="relative">
          <div className="flex items-stretch rounded-xl border border-border overflow-hidden bg-muted focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <div className="flex items-center gap-1.5 px-3 border-r border-border bg-primary/5 text-primary text-[11px] font-semibold font-mono whitespace-nowrap">
              LogQL
            </div>
            <div className="flex-1" onKeyDown={(e) => e.key === 'Enter' && handleRun()}>
            <QueryEditor
              value={query}
              onChange={setQuery}
              onFocus={() => setShowQueryHistory(true)}
              language="logql"
              height="42px"
              placeholder='Enter LogQL expression... e.g. {job="varlogs"}'
            />
            </div>
            {query && (
              <button
                onClick={() => toggleSavedQuery(query)}
                className={cn(
                  'flex items-center px-2 transition-colors',
                  savedQueries.includes(query) ? 'text-[#A16207]' : 'text-muted-foreground/40 hover:text-[#A16207]',
                )}
                title={savedQueries.includes(query) ? 'Remove from saved' : 'Save query'}
              >
                <Star className={cn('h-3.5 w-3.5', savedQueries.includes(query) && 'fill-current')} />
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-4 bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
              <kbd className="ml-1 hidden sm:inline-flex items-center rounded bg-white/20 px-1 py-0.5 text-[9px] font-mono">
                <CornerDownLeft className="h-2 w-2" />
              </kbd>
            </button>
          </div>

          {/* Query history dropdown */}
          {showQueryHistory && (savedQueries.length > 0 || recentQueries.length > 0) && (
            <div
              className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-xl max-h-64 overflow-y-auto"
              onMouseDown={(e) => e.preventDefault()}
            >
              {savedQueries.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border flex items-center gap-1.5">
                    <Star className="h-2.5 w-2.5 fill-[#A16207] text-[#A16207]" /> Saved
                  </div>
                  {savedQueries.map((q) => (
                    <button
                      key={q}
                      className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-mono text-foreground/80 hover:bg-muted/50 transition-colors"
                      onClick={() => { setQuery(q); setActiveQuery(q); setShowQueryHistory(false); }}
                    >
                      <span className="truncate">{q}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSavedQuery(q); }}
                        className="p-0.5 text-muted-foreground/40 hover:text-[#DC2626]"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </button>
                  ))}
                </div>
              )}
              {recentQueries.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border flex items-center gap-1.5">
                    <Clock className="h-2.5 w-2.5" /> Recent
                  </div>
                  {recentQueries.map((q) => (
                    <button
                      key={q}
                      className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-mono text-foreground/80 hover:bg-muted/50 transition-colors"
                      onClick={() => { setQuery(q); setActiveQuery(q); setShowQueryHistory(false); }}
                    >
                      <span className="truncate">{q}</span>
                      <Star
                        className={cn(
                          'h-3 w-3 shrink-0 ml-2',
                          savedQueries.includes(q) ? 'fill-[#A16207] text-[#A16207]' : 'text-muted-foreground/20 hover:text-[#A16207]',
                        )}
                        onClick={(e) => { e.stopPropagation(); toggleSavedQuery(q); }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Toolbar: quick queries + level filters + time range + controls */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Quick queries */}
            {[
              { label: 'All logs', q: '{job=~".+"}', levels: null },
              { label: 'System logs', q: '{job="varlogs"}', levels: null },
              { label: 'Errors only', q: '{job=~".+"}', levels: new Set(['ERROR']) },
              { label: 'API logs', q: '{job="sreoncall-api"}', levels: null },
            ].map((qq) => (
              <button
                key={qq.label}
                onClick={() => { setQuery(qq.q); setActiveQuery(qq.q); if (qq.levels) setActiveLevels(qq.levels); else setActiveLevels(new Set()); pushRecentQuery(qq.q); setRecentQueries(getRecentQueries()); }}
                className={cn(
                  'rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  activeQuery === qq.q && (qq.levels ? activeLevels.size === qq.levels.size && [...qq.levels].every(l => activeLevels.has(l)) : activeLevels.size === 0)
                    ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {qq.label}
              </button>
            ))}
            <span className="w-px h-5 bg-border mx-1" />
            {/* Level filters inline */}
            {LEVEL_FILTERS.map((level) => {
              const isActive = activeLevels.has(level);
              const styles = LEVEL_CHIP_STYLES[level];
              const count = logEntries.filter((e) => {
                const normalized = e.level === 'WARNING' ? 'WARN' : e.level;
                return normalized === level;
              }).length;
              return (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[10px] font-semibold font-mono transition-all',
                    isActive ? styles.active : styles.inactive,
                  )}
                >
                  {level}
                  {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
                </button>
              );
            })}
            {activeLevels.size > 0 && (
              <button
                onClick={() => setActiveLevels(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-0.5 underline underline-offset-2 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Time range */}
            <TimeRangeSelector
              presets={LOG_PRESETS}
              value={timeRange}
              onChange={(v) => { setTimeRange(v); setActiveQuery(query); }}
              compact
            />
            {/* Limit selector */}
            <select
              value={limitOverride || ''}
              onChange={(e) => setLimitOverride(e.target.value || null)}
              className="rounded-lg border border-border bg-muted px-2 py-1 text-[10px] text-foreground outline-none"
              title="Max log entries to fetch"
            >
              <option value="">Auto ({limit})</option>
              <option value="200">200</option>
              <option value="500">500</option>
              <option value="1000">1K</option>
              <option value="2000">2K</option>
              <option value="5000">5K</option>
            </select>
            {/* Wrap toggle */}
            <button
              onClick={() => setWrapLines((p) => !p)}
              className={cn(
                'rounded-lg border p-1.5 transition-colors',
                wrapLines ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
              title={wrapLines ? 'Disable line wrapping' : 'Enable line wrapping'}
            >
              <WrapText className="h-3.5 w-3.5" />
            </button>
            {/* Export */}
            {filteredLogs.length > 0 && (
              <button
                onClick={handleExport}
                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                title="Export logs as JSON"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Filter logs..."
                className="w-48 rounded-lg border border-border bg-background py-1.5 pl-8 pr-7 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              {searchText && (
                <button type="button" onClick={() => setSearchText('')} aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats strip (only when data loaded) */}
        {logEntries.length > 0 && !isLoading && (
          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span className="text-muted-foreground">{logEntries.length} entries</span>
            {errorCount > 0 && (
              <span className="flex items-center gap-1 text-[#DC2626]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
                {errorCount} errors ({((errorCount / logEntries.length) * 100).toFixed(1)}%)
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-1 text-[#A16207]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#A16207]" />
                {warnCount} warnings
              </span>
            )}
            {topSources.length > 0 && (
              <>
                <span className="w-px h-3.5 bg-border" />
                <span className="text-muted-foreground">Top:</span>
                {topSources.slice(0, 3).map(([src, count]) => (
                  <button
                    key={src}
                    onClick={() => { setQuery(`{job="${src}"}`); setActiveQuery(`{job="${src}"}`); }}
                    className="text-primary/80 hover:text-primary transition-colors"
                    title={`${count} entries`}
                  >
                    {src} ({count})
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Stacked log volume histogram */}
        {histogramData.length > 0 && !isLoading && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Log Volume ({timeRange.preset === 'custom' ? 'custom range' : `last ${timeRange.preset}`})
                </h3>
                <span className="text-[9px] text-muted-foreground/50">Click a bar to zoom in</span>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={histogramData} barCategoryGap={1} onClick={handleHistogramClick} style={{ cursor: 'pointer' }}>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '11px',
                      padding: '6px 10px',
                    }}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))', fontWeight: 600 }}
                    formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
                    cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }}
                    formatter={(value: string) => <span className="text-muted-foreground capitalize">{value}</span>}
                  />
                  <Bar dataKey="error" stackId="a" fill={HISTOGRAM_LEVEL_COLORS.error} radius={0} maxBarSize={12} />
                  <Bar dataKey="warn" stackId="a" fill={HISTOGRAM_LEVEL_COLORS.warn} radius={0} maxBarSize={12} />
                  <Bar dataKey="info" stackId="a" fill={HISTOGRAM_LEVEL_COLORS.info} radius={0} maxBarSize={12} />
                  <Bar dataKey="debug" stackId="a" fill={HISTOGRAM_LEVEL_COLORS.debug} radius={[2, 2, 0, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Error message */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-[#DC2626] shrink-0" />
            <span className="text-[12px] text-[#DC2626]">{(error as Error).message}</span>
          </div>
        )}

        {/* Log stream */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
                <span className="text-sm">No log entries found</span>
                <span className="text-[11px] mt-1 opacity-60">Check your LogQL query or verify data is being ingested</span>
              </div>
            ) : (
              <>
                <div ref={logContainerRef} className="max-h-[70vh] overflow-y-auto divide-y divide-border">
                  {displayedLogs.map((log, i) => {
                    const isSelected = selectedLogIndex === i;
                    const jsonParsed = tryParseJson(log.msg);
                    const contextBefore = isSelected ? filteredLogs.slice(Math.max(0, i - 5), i) : [];
                    const contextAfter = isSelected ? filteredLogs.slice(i + 1, Math.min(filteredLogs.length, i + 6)) : [];

                    return (
                      <div key={`${log.tsRaw}-${i}`}>
                        <div
                          onClick={() => setSelectedLogIndex(isSelected ? null : i)}
                          className={cn(
                            'grid grid-cols-[28px_16px_95px_50px_120px_1fr] gap-2 px-4 py-2 text-[12px] font-mono hover:bg-muted/20 transition-colors cursor-pointer select-none',
                            log.level === 'ERROR' && 'bg-red-500/[0.03]',
                            isSelected && 'bg-muted/30 border-l-2 border-l-primary',
                          )}
                        >
                          {/* Line number */}
                          <span className="text-[10px] text-muted-foreground/30 text-right tabular-nums pt-0.5">{i + 1}</span>
                          <ChevronRight className={cn('h-3 w-3 mt-0.5 text-muted-foreground/50 transition-transform', isSelected && 'rotate-90')} />
                          <span className="text-muted-foreground/60 truncate">{log.ts}</span>
                          {/* Level badge */}
                          <span className="relative group">
                            <span className={cn('inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold', log.lc.bg, log.lc.text)}>
                              {log.level}
                            </span>
                            <span className="absolute -right-8 top-0 hidden group-hover:inline-flex items-center gap-0.5 z-10">
                              <button
                                onClick={(e) => { e.stopPropagation(); addLevelFilter(log.level, false); }}
                                className="rounded p-0.5 hover:bg-emerald-500/20 text-[#16A34A]"
                                title={`Include level=${log.level}`}
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); addLevelFilter(log.level, true); }}
                                className="rounded p-0.5 hover:bg-red-500/20 text-[#DC2626]"
                                title={`Exclude level=${log.level}`}
                              >
                                <Minus className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          </span>
                          {/* Source */}
                          <span className="relative group truncate" title={log.src}>
                            <span className="text-primary/80">{log.src}</span>
                            <span className="absolute -right-8 top-0 hidden group-hover:inline-flex items-center gap-0.5 z-10">
                              <button
                                onClick={(e) => { e.stopPropagation(); addFieldFilter('job', log.src, false); }}
                                className="rounded p-0.5 hover:bg-emerald-500/20 text-[#16A34A]"
                                title={`Include job="${log.src}"`}
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); addFieldFilter('job', log.src, true); }}
                                className="rounded p-0.5 hover:bg-red-500/20 text-[#DC2626]"
                                title={`Exclude job="${log.src}"`}
                              >
                                <Minus className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          </span>
                          {/* Message */}
                          <span className={cn(
                            'text-foreground/90 group/line relative',
                            wrapLines ? 'break-all whitespace-pre-wrap' : 'truncate',
                          )}>
                            {log.msg}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCopy(log.msg, i); }}
                              className="absolute right-0 top-0 hidden group-hover/line:inline-flex p-0.5 rounded bg-card hover:bg-muted/50 text-muted-foreground/40 hover:text-foreground transition-colors"
                              title="Copy log line"
                            >
                              {copiedIndex === i ? <Check className="h-3 w-3 text-[#16A34A]" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </span>
                        </div>

                        {/* Expanded section */}
                        {isSelected && (
                          <div className="bg-muted/30 border-l-2 border-l-primary/40">
                            {/* Context before */}
                            {contextBefore.length > 0 && (
                              <div className="border-b border-border/50">
                                {contextBefore.map((ctx, ci) => (
                                  <div
                                    key={`ctx-before-${ci}`}
                                    className="grid grid-cols-[28px_16px_95px_50px_120px_1fr] gap-2 px-4 py-1.5 text-[11px] font-mono opacity-50 border-l-2 border-l-muted-foreground/20"
                                  >
                                    <span />
                                    <span />
                                    <span className="text-muted-foreground/40 truncate">{ctx.ts}</span>
                                    <span className={cn('inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-bold', ctx.lc.bg, ctx.lc.text)}>
                                      {ctx.level}
                                    </span>
                                    <span className="text-primary/50 truncate">{ctx.src}</span>
                                    <span className="text-foreground/50 break-all whitespace-pre-wrap">{ctx.msg}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Stream labels */}
                            {Object.keys(log.streamLabels).length > 0 && (
                              <div className="px-8 py-3 border-b border-border/50">
                                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Stream Labels</h4>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(log.streamLabels).map(([k, v]) => (
                                    <span
                                      key={k}
                                      className="inline-flex items-center gap-1 rounded-md bg-muted/40 border border-border px-2 py-0.5 text-[10px] font-mono group/label cursor-pointer"
                                      onClick={(e) => { e.stopPropagation(); addFieldFilter(k, v, false); }}
                                      title={`Add ${k}="${v}" to query`}
                                    >
                                      <span className="text-primary">{k}</span>
                                      <span className="text-muted-foreground">=</span>
                                      <span className="text-foreground">{v}</span>
                                      <Plus className="h-2 w-2 text-muted-foreground/30 group-hover/label:text-[#16A34A] transition-colors" />
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* JSON structured fields */}
                            {jsonParsed && (
                              <div className="px-8 py-3 border-b border-border/50">
                                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Structured Fields</h4>
                                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px] font-mono">
                                  {Object.entries(jsonParsed).map(([key, value]) => (
                                    <div key={key} className="contents">
                                      <span className="text-primary font-semibold">{key}</span>
                                      <JsonValue value={value} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Context after */}
                            {contextAfter.length > 0 && (
                              <div className="border-b border-border/50">
                                {contextAfter.map((ctx, ci) => (
                                  <div
                                    key={`ctx-after-${ci}`}
                                    className="grid grid-cols-[28px_16px_95px_50px_120px_1fr] gap-2 px-4 py-1.5 text-[11px] font-mono opacity-50 border-l-2 border-l-muted-foreground/20"
                                  >
                                    <span />
                                    <span />
                                    <span className="text-muted-foreground/40 truncate">{ctx.ts}</span>
                                    <span className={cn('inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-bold', ctx.lc.bg, ctx.lc.text)}>
                                      {ctx.level}
                                    </span>
                                    <span className="text-primary/50 truncate">{ctx.src}</span>
                                    <span className="text-foreground/50 break-all whitespace-pre-wrap">{ctx.msg}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Load more (in-page) */}
                {visibleCount < filteredLogs.length && (
                  <div className="flex items-center justify-center border-t border-border px-5 py-2">
                    <button
                      onClick={() => setVisibleCount((prev) => prev + 200)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      <ChevronDown className="h-3 w-3" />
                      Show more ({filteredLogs.length - visibleCount} remaining in memory)
                    </button>
                  </div>
                )}
                {/* Load older logs from Loki */}
                {hasMoreOlder && (
                  <div className="flex items-center justify-center border-t border-border px-5 py-2">
                    <button
                      onClick={loadOlderEntries}
                      disabled={loadingOlder}
                      className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {loadingOlder ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
                      {loadingOlder ? 'Loading older logs...' : 'Load older logs'}
                    </button>
                  </div>
                )}
                {/* Footer */}
                <div className="flex items-center justify-between border-t border-border px-5 py-3">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {displayedLogs.length} of {filteredLogs.length} entries {(searchText || activeLevels.size > 0) && `(filtered from ${logEntries.length})`}
                    {entriesTimeSpan && <span className="ml-2 text-muted-foreground/70">| Covering: {entriesTimeSpan.label}</span>}
                  </span>
                  <div className="flex items-center gap-3">
                    {errorCount > 0 && <span className="text-[10.5px] font-mono text-[#DC2626]">{errorCount} errors</span>}
                    {warnCount > 0 && <span className="text-[10.5px] font-mono text-[#A16207]">{warnCount} warnings</span>}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        </>) : (
          <ProviderLogsContent />
        )}
      </div>

      {/* Click-away handler for query history */}
      {viewMode === 'own' && showQueryHistory && (
        <div className="fixed inset-0 z-40" onClick={() => setShowQueryHistory(false)} />
      )}
    </div>

    {isProvider && <AccessDialog open={accessOpen} onClose={() => setAccessOpen(false)} />}
  </>
  );
}

// ── Label Explorer Row ──────────────────────────────────────────────

function LabelRow({
  label,
  onAddFilter,
  onSelectLabel,
}: {
  label: string;
  onAddFilter: (value: string, exclude: boolean) => void;
  onSelectLabel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useLogLabelValues(label, expanded);
  const values = data?.data ?? [];

  return (
    <div>
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-[11px] font-mono hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <ChevronRight className={cn('h-3 w-3 text-muted-foreground/50 transition-transform shrink-0', expanded && 'rotate-90')} />
        <Tag className="h-3 w-3 text-primary/60 shrink-0" />
        <span className="text-foreground truncate text-left flex-1">{label}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onSelectLabel(); }}
          className="p-0.5 text-muted-foreground/30 hover:text-primary transition-colors"
          title={`Query {${label}=~".+"}`}
        >
          <Search className="h-2.5 w-2.5" />
        </button>
      </button>
      {expanded && (
        <div className="pl-9 pr-3 pb-2">
          {isLoading && (
            <div className="flex items-center gap-1.5 py-1">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Loading values...</span>
            </div>
          )}
          {!isLoading && values.length === 0 && (
            <span className="text-[10px] text-muted-foreground/60">No values</span>
          )}
          {!isLoading && values.map((val) => (
            <div
              key={val}
              className="flex items-center justify-between py-0.5 group/val"
            >
              <span className="text-[10px] font-mono text-foreground/70 truncate">{val}</span>
              <span className="hidden group-hover/val:inline-flex items-center gap-0.5">
                <button
                  onClick={() => onAddFilter(val, false)}
                  className="rounded p-0.5 hover:bg-emerald-500/20 text-[#16A34A]"
                  title={`Include ${label}="${val}"`}
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={() => onAddFilter(val, true)}
                  className="rounded p-0.5 hover:bg-red-500/20 text-[#DC2626]"
                  title={`Exclude ${label}="${val}"`}
                >
                  <Minus className="h-2.5 w-2.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
