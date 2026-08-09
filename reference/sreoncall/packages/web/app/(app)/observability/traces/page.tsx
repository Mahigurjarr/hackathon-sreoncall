'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Search, Loader2, AlertCircle, GitBranch, ChevronRight, ExternalLink, Zap, Info, Network, GitCompare, RefreshCw, Settings2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useTraceSearch, useTraceById } from '@/lib/hooks/useObservabilityProxy';
import { TimeRangeSelector, TimeRangeValue } from '@/components/ui/TimeRangeSelector';
import { useSession } from 'next-auth/react';
import { ProviderTracesContent, AccessDialog } from '../_provider-obs';

const TRACE_PRESETS = [
  { label: '15m', ms: 15 * 60_000 },
  { label: '1h', ms: 3600_000 },
  { label: '6h', ms: 6 * 3600_000 },
  { label: '24h', ms: 24 * 3600_000 },
  { label: '3d', ms: 3 * 24 * 3600_000 },
  { label: '7d', ms: 7 * 24 * 3600_000 },
];

export default function TraceViewer() {
  const { data: session } = useSession();
  const isProvider = (session?.user as any)?.tenantType === 'provider';
  const [viewMode, setViewMode] = useState<'own' | 'customer'>('own');
  const [accessOpen, setAccessOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => {
    const now = Date.now();
    return { start: now - 3600_000, end: now, preset: '1h' };
  });
  const [resultLimit, setResultLimit] = useState('20');
  const [serviceFilter, setServiceFilter] = useState('');
  const [runCounter, setRunCounter] = useState(0);

  const now = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.end / 1000));
    return String(Math.floor(Date.now() / 1000));
  }, [activeQuery, runCounter, timeRange]);
  const startTime = useMemo(() => {
    if (timeRange.preset === 'custom') return String(Math.floor(timeRange.start / 1000));
    const preset = TRACE_PRESETS.find(p => p.label === timeRange.preset);
    return String(Math.floor(Date.now() / 1000) - (preset ? preset.ms / 1000 : 3600));
  }, [activeQuery, runCounter, timeRange]);

  const [platformScope, setPlatformScope] = useState(false);
  // When a trace is opened via the jump input, bypass scope so the backend auto-detects.
  const [traceFromJump, setTraceFromJump] = useState(false);

  const { data: searchData, isLoading, error, refetch } = useTraceSearch(
    activeQuery || undefined,
    startTime,
    now,
    resultLimit,
    true,
    platformScope ? 'platform' : undefined,
  );

  const traceScope = traceFromJump ? undefined : (platformScope ? 'platform' : undefined);
  const { data: traceDetail } = useTraceById(selectedTraceId || '', !!selectedTraceId, traceScope);

  function handleSearch() {
    setActiveQuery(query);
    setRunCounter((c) => c + 1);
  }

  // Parse trace search results
  const traces = useMemo(() => {
    if (!(searchData as any)?.traces) return [];
    return ((searchData as any).traces as any[]).map((t: any) => ({
      id: t.traceID || t.traceId || t.trace_id || '',
      rootService: t.rootServiceName || t.rootService || 'unknown',
      rootName: t.rootTraceName || t.rootName || '',
      duration: t.durationMs || Math.round((t.duration || 0) / 1000),
      spanCount: t.spanCount || t.spans || 0,
      startTime: t.startTimeUnixNano
        ? new Date(parseInt(t.startTimeUnixNano) / 1e6).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '',
      hasError: t.statusCode === 'ERROR' || t.hasError,
    }));
  }, [searchData]);

  // Unique services from search results for quick filter
  const uniqueServices = useMemo(() => {
    const set = new Set(traces.map((t: any) => t.rootService));
    return Array.from(set).sort();
  }, [traces]);

  // Filter traces by service
  const filteredTraces = useMemo(() => {
    if (!serviceFilter) return traces;
    return traces.filter((t: any) => t.rootService === serviceFilter);
  }, [traces, serviceFilter]);

  // Reusable span parser for trace detail data
  function parseTraceSpans(detail: any): any[] {
    if (!detail?.batches && !detail?.resourceSpans) return [];
    const allSpans: any[] = [];
    const batches = detail.resourceSpans || detail.batches || [];
    for (const batch of batches) {
      const scopeSpans = batch.scopeSpans || batch.instrumentationLibrarySpans || [];
      for (const scope of scopeSpans) {
        for (const span of (scope.spans || [])) {
          // Extract error message from status or events
          let errorMessage = span.status?.message || '';
          if (!errorMessage && span.events) {
            const exceptionEvent = span.events.find((e: any) => e.name === 'exception');
            if (exceptionEvent?.attributes) {
              const msgAttr = exceptionEvent.attributes.find((a: any) => a.key === 'exception.message');
              errorMessage = msgAttr?.value?.stringValue || '';
              if (!errorMessage) {
                const typeAttr = exceptionEvent.attributes.find((a: any) => a.key === 'exception.type');
                errorMessage = typeAttr?.value?.stringValue || '';
              }
            }
          }
          // Collect span attributes as key-value pairs
          const attributes: Record<string, string> = {};
          if (span.attributes) {
            for (const attr of span.attributes) {
              const val = attr.value?.stringValue || attr.value?.intValue?.toString() || attr.value?.boolValue?.toString() || attr.value?.doubleValue?.toString() || '';
              if (val) attributes[attr.key] = val;
            }
          }

          allSpans.push({
            name: span.name,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            startNano: parseInt(span.startTimeUnixNano || '0'),
            endNano: parseInt(span.endTimeUnixNano || '0'),
            durationMs: (parseInt(span.endTimeUnixNano || '0') - parseInt(span.startTimeUnixNano || '0')) / 1e6,
            hasError: span.status?.code === 'ERROR' || span.status?.code === 2,
            errorMessage,
            service: batch.resource?.attributes?.find((a: any) => a.key === 'service.name')?.value?.stringValue || 'unknown',
            attributes,
          });
        }
      }
    }
    allSpans.sort((a, b) => a.startNano - b.startNano);
    return allSpans;
  }

  // State for expanded span detail panel (any span, not just errors)
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

  const toggleSpanDetail = useCallback((spanId: string) => {
    setExpandedSpanId((prev) => (prev === spanId ? null : spanId));
  }, []);

  // Critical path toggle
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  // Service map toggle
  const [showServiceMap, setShowServiceMap] = useState(false);

  // Comparison mode
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonTraceId, setComparisonTraceId] = useState<string | null>(null);

  const { data: comparisonTraceDetail } = useTraceById(comparisonTraceId || '', !!comparisonTraceId && showComparison);

  // Parse selected trace spans
  const spans = useMemo(() => parseTraceSpans(traceDetail), [traceDetail]);

  // Parse comparison trace spans
  const comparisonSpans = useMemo(() => parseTraceSpans(comparisonTraceDetail), [comparisonTraceDetail]);

  const traceMinNano = spans.length > 0 ? spans[0].startNano : 0;
  const traceMaxNano = spans.length > 0 ? Math.max(...spans.map(s => s.endNano)) : 1;
  const traceDurationNano = traceMaxNano - traceMinNano || 1;

  // Build hierarchical span tree with depth for indentation
  const hierarchicalSpans = useMemo(() => {
    if (spans.length === 0) return [];

    // Build a map of spanId -> span
    const spanMap = new Map<string, any>();
    for (const span of spans) {
      spanMap.set(span.spanId, span);
    }

    // Build children map
    const childrenMap = new Map<string, any[]>();
    const roots: any[] = [];

    for (const span of spans) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        if (!childrenMap.has(span.parentSpanId)) {
          childrenMap.set(span.parentSpanId, []);
        }
        childrenMap.get(span.parentSpanId)!.push(span);
      } else {
        roots.push(span);
      }
    }

    // Flatten tree with depth via DFS
    const result: { span: any; depth: number }[] = [];
    function walk(node: any, depth: number) {
      result.push({ span: node, depth });
      const children = childrenMap.get(node.spanId) || [];
      // Sort children by start time
      children.sort((a: any, b: any) => a.startNano - b.startNano);
      for (const child of children) {
        walk(child, depth + 1);
      }
    }

    // Sort roots by start time
    roots.sort((a, b) => a.startNano - b.startNano);
    for (const root of roots) {
      walk(root, 0);
    }

    return result;
  }, [spans]);

  // Compute critical path: the longest chain of sequential spans from root to leaf
  const criticalPathSpanIds = useMemo(() => {
    if (spans.length === 0) return new Set<string>();

    // Build maps
    const spanMap = new Map<string, any>();
    const childrenMap = new Map<string, any[]>();
    const roots: any[] = [];

    for (const span of spans) {
      spanMap.set(span.spanId, span);
    }
    for (const span of spans) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        if (!childrenMap.has(span.parentSpanId)) {
          childrenMap.set(span.parentSpanId, []);
        }
        childrenMap.get(span.parentSpanId)!.push(span);
      } else {
        roots.push(span);
      }
    }

    // For each span, find the critical path by following the child that ends latest
    function findCriticalPath(span: any): any[] {
      const children = childrenMap.get(span.spanId) || [];
      if (children.length === 0) return [span];

      let longestPath: any[] = [];
      let latestEnd = 0;

      for (const child of children) {
        const path = findCriticalPath(child);
        const pathEnd = path[path.length - 1].endNano;
        if (pathEnd > latestEnd) {
          latestEnd = pathEnd;
          longestPath = path;
        }
      }

      return [span, ...longestPath];
    }

    // Start from the root that ends latest (or the single root)
    let bestPath: any[] = [];
    let bestEnd = 0;
    for (const root of roots) {
      const path = findCriticalPath(root);
      const pathEnd = path[path.length - 1].endNano;
      if (pathEnd > bestEnd) {
        bestEnd = pathEnd;
        bestPath = path;
      }
    }

    return new Set(bestPath.map((s: any) => s.spanId));
  }, [spans]);

  // Critical path duration: sum of durations of critical path spans
  const criticalPathDurationMs = useMemo(() => {
    if (criticalPathSpanIds.size === 0) return 0;
    let total = 0;
    for (const span of spans) {
      if (criticalPathSpanIds.has(span.spanId)) {
        total += span.durationMs;
      }
    }
    return total;
  }, [spans, criticalPathSpanIds]);

  // Generate time axis ticks
  const timeAxisTicks = useMemo(() => {
    if (spans.length === 0) return [];

    const totalMs = traceDurationNano / 1e6;
    // Choose a nice tick interval
    let interval: number;
    if (totalMs <= 10) interval = 2;
    else if (totalMs <= 50) interval = 10;
    else if (totalMs <= 200) interval = 50;
    else if (totalMs <= 500) interval = 100;
    else if (totalMs <= 2000) interval = 500;
    else if (totalMs <= 5000) interval = 1000;
    else if (totalMs <= 20000) interval = 5000;
    else interval = 10000;

    const ticks: { ms: number; pct: number; label: string }[] = [];
    for (let ms = 0; ms <= totalMs; ms += interval) {
      const pct = (ms / totalMs) * 100;
      let label: string;
      if (ms === 0) label = '0ms';
      else if (ms >= 1000 && ms % 1000 === 0) label = `${ms / 1000}s`;
      else if (ms >= 1000) label = `${(ms / 1000).toFixed(1)}s`;
      else label = `${ms}ms`;
      ticks.push({ ms, pct, label });
    }
    // Always add final tick at 100%
    const lastTick = ticks[ticks.length - 1];
    if (lastTick && lastTick.pct < 99) {
      const finalMs = totalMs;
      let label: string;
      if (finalMs >= 1000) label = `${(finalMs / 1000).toFixed(1)}s`;
      else label = `${Math.round(finalMs)}ms`;
      ticks.push({ ms: finalMs, pct: 100, label });
    }
    return ticks;
  }, [spans, traceDurationNano]);

  // Service map: extract nodes and edges from spans
  const serviceMap = useMemo(() => {
    if (spans.length === 0) return { nodes: [], edges: [] };

    const spanMap = new Map<string, any>();
    for (const span of spans) spanMap.set(span.spanId, span);

    // Aggregate per-service stats
    const serviceStats = new Map<string, { spanCount: number; hasError: boolean; totalDuration: number }>();
    for (const span of spans) {
      const existing = serviceStats.get(span.service);
      if (existing) {
        existing.spanCount++;
        existing.hasError = existing.hasError || span.hasError;
        existing.totalDuration += span.durationMs;
      } else {
        serviceStats.set(span.service, { spanCount: 1, hasError: span.hasError, totalDuration: span.durationMs });
      }
    }

    // Aggregate edges
    const edgeKey = (from: string, to: string) => `${from}|||${to}`;
    const edgeStats = new Map<string, { from: string; to: string; callCount: number; totalLatency: number }>();
    for (const span of spans) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        const parentService = spanMap.get(span.parentSpanId).service;
        if (parentService !== span.service) {
          const key = edgeKey(parentService, span.service);
          const existing = edgeStats.get(key);
          if (existing) {
            existing.callCount++;
            existing.totalLatency += span.durationMs;
          } else {
            edgeStats.set(key, { from: parentService, to: span.service, callCount: 1, totalLatency: span.durationMs });
          }
        }
      }
    }

    const nodes = Array.from(serviceStats.entries()).map(([service, stats]) => ({
      service,
      spanCount: stats.spanCount,
      hasError: stats.hasError,
      avgDuration: Math.round(stats.totalDuration / stats.spanCount),
    }));

    const edges = Array.from(edgeStats.values()).map((e) => ({
      from: e.from,
      to: e.to,
      callCount: e.callCount,
      avgLatency: Math.round(e.totalLatency / e.callCount),
    }));

    // BFS layering from root services
    const childServices = new Set(edges.map((e) => e.to));
    const rootServices = nodes.filter((n) => !childServices.has(n.service)).map((n) => n.service);
    if (rootServices.length === 0 && nodes.length > 0) rootServices.push(nodes[0].service);

    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      adjacency.get(e.from)!.push(e.to);
    }

    const depth = new Map<string, number>();
    const queue = rootServices.map((s) => { depth.set(s, 0); return s; });
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const d = depth.get(current)!;
      for (const neighbor of (adjacency.get(current) || [])) {
        if (!depth.has(neighbor) || depth.get(neighbor)! < d + 1) {
          depth.set(neighbor, d + 1);
          queue.push(neighbor);
        }
      }
    }
    // Assign depth 0 for any unvisited nodes
    for (const n of nodes) {
      if (!depth.has(n.service)) depth.set(n.service, 0);
    }

    // Sort nodes by depth then alphabetically
    nodes.sort((a, b) => (depth.get(a.service)! - depth.get(b.service)!) || a.service.localeCompare(b.service));

    // Attach depth to nodes for layout
    const nodesWithDepth = nodes.map((n) => ({ ...n, depth: depth.get(n.service)! }));

    return { nodes: nodesWithDepth, edges };
  }, [spans]);

  // Comparison trace metrics
  const comparisonMinNano = comparisonSpans.length > 0 ? comparisonSpans[0].startNano : 0;
  const comparisonMaxNano = comparisonSpans.length > 0 ? Math.max(...comparisonSpans.map((s: any) => s.endNano)) : 1;
  const comparisonDurationNano = comparisonMaxNano - comparisonMinNano || 1;

  // Build hierarchical spans for comparison trace
  const comparisonHierarchicalSpans = useMemo(() => {
    if (comparisonSpans.length === 0) return [];
    const spanMap = new Map<string, any>();
    for (const span of comparisonSpans) spanMap.set(span.spanId, span);
    const childrenMap = new Map<string, any[]>();
    const roots: any[] = [];
    for (const span of comparisonSpans) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        if (!childrenMap.has(span.parentSpanId)) childrenMap.set(span.parentSpanId, []);
        childrenMap.get(span.parentSpanId)!.push(span);
      } else {
        roots.push(span);
      }
    }
    const result: { span: any; depth: number }[] = [];
    function walk(node: any, d: number) {
      result.push({ span: node, depth: d });
      const children = childrenMap.get(node.spanId) || [];
      children.sort((a: any, b: any) => a.startNano - b.startNano);
      for (const child of children) walk(child, d + 1);
    }
    roots.sort((a, b) => a.startNano - b.startNano);
    for (const root of roots) walk(root, 0);
    return result;
  }, [comparisonSpans]);

  const [traceIdInput, setTraceIdInput] = useState('');

  function handleTraceIdJump(raw: string) {
    const id = raw.trim();
    if (!id) return;
    setTraceFromJump(true);
    setSelectedTraceId(id);
    setTraceIdInput('');
  }

  return (
    <>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trace Viewer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Distributed traces via Tempo &middot; TraceQL search
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'own' && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1 text-[11px] font-semibold">
              <button
                onClick={() => { setPlatformScope(false); setSelectedTraceId(null); setTraceFromJump(false); setRunCounter(c => c + 1); }}
                className={cn('px-3 py-1.5 rounded-md transition-colors', !platformScope ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                Tenant
              </button>
              <button
                onClick={() => { setPlatformScope(true); setSelectedTraceId(null); setTraceFromJump(false); setRunCounter(c => c + 1); }}
                className={cn('px-3 py-1.5 rounded-md transition-colors', platformScope ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                Platform
              </button>
            </div>
          )}
          {isProvider && (
            <>
              {viewMode === 'own' && <div className="h-4 w-px bg-border" />}
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
      {/* Jump-to-trace — paste a traceId from an error response to open it directly */}
      <div className="flex items-stretch rounded-xl border border-border overflow-hidden bg-muted/40 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
        <div className="flex items-center gap-1.5 px-3 border-r border-border bg-muted text-muted-foreground text-[11px] font-semibold font-mono whitespace-nowrap">
          Trace&nbsp;ID
        </div>
        <input
          value={traceIdInput}
          onChange={(e) => setTraceIdInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleTraceIdJump(traceIdInput)}
          className="flex-1 bg-transparent px-3 py-2 text-[12.5px] font-mono text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder="Paste a trace ID from an error response to jump directly…"
          spellCheck={false}
        />
        <button
          onClick={() => handleTraceIdJump(traceIdInput)}
          disabled={!traceIdInput.trim()}
          className="flex items-center gap-1.5 px-4 bg-muted border-l border-border text-foreground text-[12px] font-semibold hover:bg-accent transition-colors disabled:opacity-40"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
      </div>

      {/* Query bar */}
      <div className="flex items-stretch rounded-xl border border-border overflow-hidden bg-muted focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
        <div className="flex items-center gap-1.5 px-3 border-r border-border bg-primary/5 text-primary text-[11px] font-semibold font-mono whitespace-nowrap">
          TraceQL
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 bg-transparent px-3 py-2.5 text-[12.5px] font-mono text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder='Enter TraceQL expression... e.g. {span.http.status_code=503}'
        />
        <button
          onClick={handleSearch}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Search
        </button>
      </div>

      {/* Time range + service filter + refresh */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Time range */}
          <TimeRangeSelector
            presets={TRACE_PRESETS}
            value={timeRange}
            onChange={(v) => { setTimeRange(v); setRunCounter((c) => c + 1); }}
            compact
          />
          {/* Result limit */}
          <select
            value={resultLimit}
            onChange={(e) => { setResultLimit(e.target.value); setRunCounter((c) => c + 1); }}
            className="rounded-lg border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground outline-none"
          >
            <option value="20">20 results</option>
            <option value="50">50 results</option>
            <option value="100">100 results</option>
          </select>
          {/* Service filter */}
          {uniqueServices.length > 1 && (
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="rounded-lg border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground outline-none"
            >
              <option value="">All services</option>
              {uniqueServices.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => { refetch(); setRunCounter((c) => c + 1); }}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
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
      {!isLoading && traces.length === 0 && !error && (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <GitBranch className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No traces found</h3>
            <p className="text-[12px] text-muted-foreground mb-4 max-w-sm">
              {activeQuery
                ? 'No traces match your query. Try adjusting the TraceQL expression or time range.'
                : 'Connect a Tempo data source and instrument your services with OpenTelemetry to see distributed traces here.'}
            </p>
            {!activeQuery && (
              <Link href="/observability/connect">
                <Button size="sm">Connect Data Source</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* Two-column: trace list + waterfall */}
      {filteredTraces.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
          {/* Trace list */}
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Recent Traces ({filteredTraces.length}{serviceFilter ? ` of ${traces.length}` : ''})
                </div>
              </div>
              <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                {filteredTraces.map((trace) => (
                  <button
                    key={trace.id}
                    onClick={() => { setTraceFromJump(false); setSelectedTraceId(trace.id); }}
                    className={cn(
                      'w-full text-left px-4 py-3.5 hover:bg-muted/30 transition-colors',
                      selectedTraceId === trace.id && 'bg-primary/5 border-l-2 border-l-primary',
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-semibold text-foreground truncate">
                        {trace.rootService}: {trace.rootName || trace.id.slice(0, 8)}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                        {trace.startTime}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {trace.hasError && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-500/10 text-red-400">
                          ERROR
                        </span>
                      )}
                      <span
                        className={cn(
                          'text-[11px] font-mono font-bold',
                          trace.duration > 2000
                            ? 'text-red-400'
                            : trace.duration > 500
                              ? 'text-yellow-400'
                              : 'text-emerald-400',
                        )}
                      >
                        {trace.duration}ms
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {trace.spanCount} spans
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Waterfall */}
          <Card>
            <CardContent className="p-5">
              {selectedTraceId && spans.length > 0 ? (
                <>
                  <div className="mb-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[11px] text-primary font-bold">
                          {selectedTraceId.slice(0, 16)}
                        </span>
                        <span className="text-muted-foreground/50">&middot;</span>
                        <span className="font-mono text-[11px] text-foreground font-bold">
                          {Math.round(traceDurationNano / 1e6)}ms total
                        </span>
                        <span className="text-muted-foreground/50">&middot;</span>
                        <span className="text-[11px] text-muted-foreground">
                          {spans.length} spans
                        </span>
                        {showCriticalPath && (
                          <>
                            <span className="text-muted-foreground/50">&middot;</span>
                            <span className="font-mono text-[11px] text-primary font-bold">
                              Critical path: {Math.round(criticalPathDurationMs)}ms
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant={showCriticalPath ? 'default' : 'outline'}
                          onClick={() => setShowCriticalPath((v) => !v)}
                          className="h-7 text-[11px] gap-1.5"
                        >
                          <Zap className="h-3 w-3" />
                          Critical Path
                        </Button>
                        <Button
                          size="sm"
                          variant={showServiceMap ? 'default' : 'outline'}
                          onClick={() => setShowServiceMap((v) => !v)}
                          className="h-7 text-[11px] gap-1.5"
                        >
                          <Network className="h-3 w-3" />
                          Service Map
                        </Button>
                        <Button
                          size="sm"
                          variant={showComparison ? 'default' : 'outline'}
                          onClick={() => {
                            setShowComparison((v) => !v);
                            if (showComparison) setComparisonTraceId(null);
                          }}
                          className="h-7 text-[11px] gap-1.5"
                        >
                          <GitCompare className="h-3 w-3" />
                          Compare
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Service Map */}
                  {showServiceMap && serviceMap.nodes.length > 0 && (() => {
                    const maxDepth = Math.max(...serviceMap.nodes.map((n: any) => n.depth));
                    const columns = maxDepth + 1;
                    // Group nodes by depth
                    const layers = new Map<number, typeof serviceMap.nodes>();
                    for (const node of serviceMap.nodes) {
                      if (!layers.has(node.depth)) layers.set(node.depth, []);
                      layers.get(node.depth)!.push(node);
                    }
                    const maxNodesInLayer = Math.max(...Array.from(layers.values()).map((l) => l.length));
                    const nodeW = 160;
                    const nodeH = 56;
                    const colGap = 80;
                    const rowGap = 24;
                    const svgW = columns * nodeW + (columns - 1) * colGap + 60;
                    const svgH = maxNodesInLayer * nodeH + (maxNodesInLayer - 1) * rowGap + 40;

                    // Compute positions
                    const positions = new Map<string, { x: number; y: number }>();
                    for (let col = 0; col <= maxDepth; col++) {
                      const nodesInCol = layers.get(col) || [];
                      const totalH = nodesInCol.length * nodeH + (nodesInCol.length - 1) * rowGap;
                      const startY = (svgH - totalH) / 2;
                      nodesInCol.forEach((node, idx) => {
                        positions.set(node.service, {
                          x: 30 + col * (nodeW + colGap),
                          y: startY + idx * (nodeH + rowGap),
                        });
                      });
                    }

                    return (
                      <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3 overflow-x-auto">
                        <svg width={svgW} height={svgH} className="mx-auto">
                          <defs>
                            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                              <polygon points="0 0, 8 3, 0 6" className="fill-muted-foreground/50" />
                            </marker>
                          </defs>
                          {/* Edges */}
                          {serviceMap.edges.map((edge, i) => {
                            const fromPos = positions.get(edge.from);
                            const toPos = positions.get(edge.to);
                            if (!fromPos || !toPos) return null;
                            const x1 = fromPos.x + nodeW;
                            const y1 = fromPos.y + nodeH / 2;
                            const x2 = toPos.x;
                            const y2 = toPos.y + nodeH / 2;
                            const midX = (x1 + x2) / 2;
                            return (
                              <g key={`edge-${i}`}>
                                <path
                                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                                  fill="none"
                                  className="stroke-muted-foreground/40"
                                  strokeWidth={1.5}
                                  markerEnd="url(#arrowhead)"
                                />
                                <text
                                  x={midX}
                                  y={Math.min(y1, y2) + (Math.abs(y2 - y1) / 2) - 6}
                                  textAnchor="middle"
                                  className="fill-muted-foreground text-[9px] font-mono"
                                >
                                  {edge.callCount}x &middot; {edge.avgLatency}ms
                                </text>
                              </g>
                            );
                          })}
                          {/* Nodes */}
                          {serviceMap.nodes.map((node) => {
                            const pos = positions.get(node.service)!;
                            return (
                              <g key={node.service}>
                                <rect
                                  x={pos.x}
                                  y={pos.y}
                                  width={nodeW}
                                  height={nodeH}
                                  rx={8}
                                  className={cn(
                                    'fill-background',
                                    node.hasError
                                      ? 'stroke-red-500'
                                      : 'stroke-emerald-500',
                                  )}
                                  strokeWidth={2}
                                />
                                <text
                                  x={pos.x + nodeW / 2}
                                  y={pos.y + 22}
                                  textAnchor="middle"
                                  className="fill-foreground text-[11px] font-semibold"
                                >
                                  {node.service.length > 18 ? node.service.slice(0, 16) + '...' : node.service}
                                </text>
                                <text
                                  x={pos.x + nodeW / 2}
                                  y={pos.y + 40}
                                  textAnchor="middle"
                                  className="fill-muted-foreground text-[9px] font-mono"
                                >
                                  {node.spanCount} spans &middot; avg {node.avgDuration}ms
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    );
                  })()}

                  {/* Comparison trace selector */}
                  {showComparison && (
                    <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-center gap-3">
                        <label className="text-[11px] font-semibold text-muted-foreground shrink-0">
                          Compare with:
                        </label>
                        <select
                          value={comparisonTraceId || ''}
                          onChange={(e) => setComparisonTraceId(e.target.value || null)}
                          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-primary"
                        >
                          <option value="">Select a trace...</option>
                          {traces
                            .filter((t) => t.id !== selectedTraceId)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.rootService}: {t.rootName || t.id.slice(0, 8)} — {t.duration}ms ({t.spanCount} spans)
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Waterfall content — side-by-side when comparison mode is active */}
                  <div className={cn(showComparison && comparisonTraceId && comparisonSpans.length > 0 && 'grid grid-cols-2 gap-4')}>
                    {/* Primary waterfall column */}
                    <div>
                      {showComparison && comparisonTraceId && comparisonSpans.length > 0 && (
                        <div className="mb-2 pb-2 border-b border-border">
                          <span className="font-mono text-[11px] text-primary font-bold">{selectedTraceId?.slice(0, 16)}</span>
                          <span className="text-muted-foreground/50 mx-1">&middot;</span>
                          <span className="font-mono text-[11px] text-foreground font-bold">{Math.round(traceDurationNano / 1e6)}ms</span>
                          <span className="text-muted-foreground/50 mx-1">&middot;</span>
                          <span className="text-[11px] text-muted-foreground">{spans.length} spans</span>
                        </div>
                      )}

                      {/* Time axis ruler */}
                      <div className="flex items-end gap-3 mb-1">
                        <div className="w-[130px] shrink-0" />
                        <div className="flex-1 relative h-6 border-b border-border/50">
                          {timeAxisTicks.map((tick, i) => (
                            <div
                              key={i}
                              className="absolute bottom-0 flex flex-col items-center"
                              style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}
                            >
                              <span className="text-[9px] font-mono text-muted-foreground/70 mb-0.5 whitespace-nowrap">
                                {tick.label}
                              </span>
                              <div className="w-px h-2 bg-border" />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Spans (hierarchical) */}
                      <div className="space-y-1">
                        {hierarchicalSpans.map(({ span, depth }, i) => {
                          const startPct = ((span.startNano - traceMinNano) / traceDurationNano) * 100;
                          const widthPct = Math.max(((span.endNano - span.startNano) / traceDurationNano) * 100, 1);
                          const isExpanded = expandedSpanId === span.spanId;
                          const isOnCriticalPath = criticalPathSpanIds.has(span.spanId);
                          const isDimmed = showCriticalPath && !isOnCriticalPath;
                          return (
                            <div key={span.spanId || i}>
                              <div
                                className={cn(
                                  'flex items-center gap-3 rounded-md px-1 py-1 transition-colors cursor-pointer hover:bg-muted/30',
                                  isExpanded && (span.hasError ? 'bg-red-500/5' : 'bg-primary/5'),
                                  isDimmed && 'opacity-35',
                                  showCriticalPath && isOnCriticalPath && 'border-l-2 border-l-primary',
                                )}
                                onClick={() => toggleSpanDetail(span.spanId)}
                              >
                                <div
                                  className="shrink-0 text-right"
                                  style={{ width: `${130 + depth * 16}px` }}
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    {depth > 0 && (
                                      <span
                                        className="text-muted-foreground/30"
                                        style={{ paddingLeft: `${depth * 8}px` }}
                                      >
                                        {'└'}
                                      </span>
                                    )}
                                    <div className="truncate">
                                      <div className="text-[11px] font-semibold text-foreground truncate" title={span.name}>
                                        <ChevronRight
                                          className={cn(
                                            'inline h-3 w-3 mr-0.5 transition-transform',
                                            span.hasError ? 'text-red-400' : 'text-muted-foreground/50',
                                            isExpanded && 'rotate-90',
                                          )}
                                        />
                                        {span.name}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {span.service} &middot; {span.durationMs.toFixed(0)}ms
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex-1 h-6 relative rounded bg-border/30">
                                  <div
                                    className={cn(
                                      'absolute top-0.5 bottom-0.5 rounded',
                                      span.hasError
                                        ? 'bg-red-500'
                                        : showCriticalPath && isOnCriticalPath
                                          ? 'bg-primary ring-1 ring-primary/50'
                                          : 'bg-primary',
                                    )}
                                    style={{
                                      left: `${startPct}%`,
                                      width: `${Math.max(widthPct, 0.5)}%`,
                                    }}
                                  />
                                  {span.hasError && (
                                    <span
                                      className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold text-white"
                                      style={{ left: `${startPct + 1}%` }}
                                    >
                                      ERROR
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Span detail panel (any span) */}
                              {isExpanded && (
                                <div
                                  className={cn(
                                    'ml-4 mr-2 mt-1 mb-2 rounded-lg border p-4 space-y-3',
                                    span.hasError
                                      ? 'border-red-500/20 bg-red-500/5'
                                      : 'border-border bg-muted/30',
                                  )}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    {span.hasError ? (
                                      <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                                    ) : (
                                      <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                                    )}
                                    <span
                                      className={cn(
                                        'text-[12px] font-bold',
                                        span.hasError ? 'text-red-400' : 'text-foreground',
                                      )}
                                    >
                                      {span.hasError ? 'Span Error Details' : 'Span Details'}
                                    </span>
                                    {showCriticalPath && isOnCriticalPath && (
                                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-primary/10 text-primary">
                                        Critical Path
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                                    <div>
                                      <span className="text-muted-foreground">Service</span>
                                      <p className="font-semibold text-foreground">{span.service}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Operation</span>
                                      <p className="font-semibold text-foreground">{span.name}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Duration</span>
                                      <p
                                        className={cn(
                                          'font-mono font-bold',
                                          span.hasError ? 'text-red-400' : 'text-foreground',
                                        )}
                                      >
                                        {span.durationMs.toFixed(1)}ms
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Span ID</span>
                                      <p className="font-mono text-foreground">{span.spanId}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Parent Span ID</span>
                                      <p className="font-mono text-foreground">{span.parentSpanId || '—'}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Start Time</span>
                                      <p className="font-mono text-foreground">
                                        {new Date(span.startNano / 1e6).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit',
                                          fractionalSecondDigits: 3,
                                        } as Intl.DateTimeFormatOptions)}
                                      </p>
                                    </div>
                                    {span.hasError && (
                                      <div className="col-span-2">
                                        <span className="text-muted-foreground">Error Message</span>
                                        <p className="font-semibold text-red-400 mt-0.5">
                                          {span.errorMessage || `Error in ${span.name} (${span.service})`}
                                        </p>
                                      </div>
                                    )}
                                  </div>

                                  {/* Span attributes */}
                                  {span.attributes && Object.keys(span.attributes).length > 0 && (
                                    <div className="pt-2 border-t border-border/50">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Attributes
                                      </span>
                                      <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                                        {Object.entries(span.attributes).map(([key, value]) => (
                                          <div key={key} className="flex items-baseline gap-1.5 min-w-0">
                                            <span className="text-muted-foreground font-mono text-[10px] shrink-0">{key}</span>
                                            <span className="font-mono text-foreground truncate">{value as string}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className={cn('pt-2 border-t', span.hasError ? 'border-red-500/10' : 'border-border/50')}>
                                    <Link
                                      href={`/observability/logs?query=${encodeURIComponent(`{service_name="${span.service}"} | trace_id="${selectedTraceId}"`)}`}
                                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors"
                                    >
                                      View related logs
                                      <ExternalLink className="h-3 w-3" />
                                    </Link>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Comparison waterfall column */}
                    {showComparison && comparisonTraceId && comparisonSpans.length > 0 && (
                      <div>
                        <div className="mb-2 pb-2 border-b border-border">
                          <span className="font-mono text-[11px] text-primary font-bold">{comparisonTraceId.slice(0, 16)}</span>
                          <span className="text-muted-foreground/50 mx-1">&middot;</span>
                          <span className="font-mono text-[11px] text-foreground font-bold">{Math.round(comparisonDurationNano / 1e6)}ms</span>
                          <span className="text-muted-foreground/50 mx-1">&middot;</span>
                          <span className="text-[11px] text-muted-foreground">{comparisonSpans.length} spans</span>
                        </div>

                        {/* Comparison time axis */}
                        <div className="flex items-end gap-3 mb-1">
                          <div className="w-[130px] shrink-0" />
                          <div className="flex-1 relative h-6 border-b border-border/50">
                            {(() => {
                              const totalMs = comparisonDurationNano / 1e6;
                              let interval: number;
                              if (totalMs <= 10) interval = 2;
                              else if (totalMs <= 50) interval = 10;
                              else if (totalMs <= 200) interval = 50;
                              else if (totalMs <= 500) interval = 100;
                              else if (totalMs <= 2000) interval = 500;
                              else if (totalMs <= 5000) interval = 1000;
                              else if (totalMs <= 20000) interval = 5000;
                              else interval = 10000;
                              const ticks: { ms: number; pct: number; label: string }[] = [];
                              for (let ms = 0; ms <= totalMs; ms += interval) {
                                const pct = (ms / totalMs) * 100;
                                let label: string;
                                if (ms === 0) label = '0ms';
                                else if (ms >= 1000 && ms % 1000 === 0) label = `${ms / 1000}s`;
                                else if (ms >= 1000) label = `${(ms / 1000).toFixed(1)}s`;
                                else label = `${ms}ms`;
                                ticks.push({ ms, pct, label });
                              }
                              const lastTick = ticks[ticks.length - 1];
                              if (lastTick && lastTick.pct < 99) {
                                let label: string;
                                if (totalMs >= 1000) label = `${(totalMs / 1000).toFixed(1)}s`;
                                else label = `${Math.round(totalMs)}ms`;
                                ticks.push({ ms: totalMs, pct: 100, label });
                              }
                              return ticks.map((tick, i) => (
                                <div
                                  key={i}
                                  className="absolute bottom-0 flex flex-col items-center"
                                  style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}
                                >
                                  <span className="text-[9px] font-mono text-muted-foreground/70 mb-0.5 whitespace-nowrap">
                                    {tick.label}
                                  </span>
                                  <div className="w-px h-2 bg-border" />
                                </div>
                              ));
                            })()}
                          </div>
                        </div>

                        {/* Comparison spans */}
                        <div className="space-y-1">
                          {comparisonHierarchicalSpans.map(({ span, depth }, i) => {
                            const startPct = ((span.startNano - comparisonMinNano) / comparisonDurationNano) * 100;
                            const widthPct = Math.max(((span.endNano - span.startNano) / comparisonDurationNano) * 100, 1);
                            return (
                              <div key={span.spanId || i}>
                                <div
                                  className={cn(
                                    'flex items-center gap-3 rounded-md px-1 py-1 transition-colors',
                                  )}
                                >
                                  <div
                                    className="shrink-0 text-right"
                                    style={{ width: `${130 + depth * 16}px` }}
                                  >
                                    <div className="flex items-center justify-end gap-1">
                                      {depth > 0 && (
                                        <span
                                          className="text-muted-foreground/30"
                                          style={{ paddingLeft: `${depth * 8}px` }}
                                        >
                                          {'└'}
                                        </span>
                                      )}
                                      <div className="truncate">
                                        <div className="text-[11px] font-semibold text-foreground truncate" title={span.name}>
                                          {span.name}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">
                                          {span.service} &middot; {span.durationMs.toFixed(0)}ms
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex-1 h-6 relative rounded bg-border/30">
                                    <div
                                      className={cn(
                                        'absolute top-0.5 bottom-0.5 rounded',
                                        span.hasError ? 'bg-red-500' : 'bg-primary',
                                      )}
                                      style={{
                                        left: `${startPct}%`,
                                        width: `${Math.max(widthPct, 0.5)}%`,
                                      }}
                                    />
                                    {span.hasError && (
                                      <span
                                        className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold text-white"
                                        style={{ left: `${startPct + 1}%` }}
                                      >
                                        ERROR
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : selectedTraceId ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Select a trace to view its waterfall
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      </>) : (
        <ProviderTracesContent />
      )}
    </div>

    {isProvider && <AccessDialog open={accessOpen} onClose={() => setAccessOpen(false)} />}
    </>
  );
}
