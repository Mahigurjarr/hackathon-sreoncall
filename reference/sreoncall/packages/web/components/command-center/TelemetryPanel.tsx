'use client';

import { useMemo } from 'react';
import { BarChart3, Search, FileText, Loader2, AlertCircle } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  useMetricsRangeQuery,
  useLogsQuery,
  useLogLabels,
  useTraceSearch,
  type MetricResult,
  type LogResult,
} from '@/lib/hooks/useObservabilityProxy';

interface TelemetryPanelProps {
  type: 'metrics' | 'traces' | 'logs';
  serviceName: string;
  incidentId?: string;
}

/* ─── Time helpers ──────────────────────────────────────────────────── */

function now() {
  return Math.floor(Date.now() / 1000);
}

function thirtyMinAgo() {
  return now() - 30 * 60;
}

function formatTime(tick: number): string {
  const d = new Date(tick * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
}

/* ─── Prometheus result → chart data ───────────────────────────────── */

function matrixToChartData(result: MetricResult | undefined): { time: number; value: number }[] {
  if (!result?.data?.result?.length) return [];
  const series = result.data.result[0];
  const values = series.values ?? (series.value ? [series.value] : []);
  return values.map(([ts, val]) => ({
    time: typeof ts === 'number' ? ts : Number(ts),
    value: parseFloat(val) || 0,
  }));
}

/* ─── Mini metric chart ─────────────────────────────────────────────── */

function MiniChart({
  title,
  unit,
  data,
  isLoading,
  isError,
  color,
}: {
  title: string;
  unit: string;
  data: { time: number; value: number }[];
  isLoading: boolean;
  isError: boolean;
  color: string;
}) {
  if (isLoading) {
    return (
      <div className="flex-1 min-w-[180px] rounded-lg border border-border bg-muted/20 p-3 flex items-center justify-center min-h-[140px]">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 min-w-[180px] rounded-lg border border-border bg-muted/20 p-3 flex flex-col items-center justify-center min-h-[140px]">
        <AlertCircle className="h-4 w-4 text-muted-foreground mb-1" />
        <span className="text-[10px] text-muted-foreground">Query failed</span>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex-1 min-w-[180px] rounded-lg border border-border bg-muted/20 p-3 flex flex-col items-center justify-center min-h-[140px]">
        <span className="text-[11px] text-muted-foreground font-medium">{title}</span>
        <span className="text-[10px] text-muted-foreground/60 mt-1">No data available</span>
      </div>
    );
  }

  const latest = data[data.length - 1]?.value ?? 0;

  return (
    <div className="flex-1 min-w-[180px] rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-muted-foreground font-medium">{title}</span>
        <span className="text-[13px] font-bold text-foreground">
          {formatValue(latest)}
          <span className="text-[10px] text-muted-foreground ml-0.5">{unit}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.2} />
          <XAxis
            dataKey="time"
            tickFormatter={formatTime}
            tick={{ fontSize: 8, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={formatValue}
            tick={{ fontSize: 8, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 10,
            }}
            labelFormatter={(ts) => formatTimeFull(ts as number)}
            formatter={(v: number) => [formatValue(v) + unit, title]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Metrics Tab ──────────────────────────────────────────────────── */

function MetricsPanel({ serviceName }: { serviceName: string }) {
  const start = String(thirtyMinAgo());
  const end = String(now());
  const step = '15s';
  const enabled = !!serviceName;

  // Use regex to match service names flexibly (handles both service_name and job labels)
  const svcFilter = `service_name=~".*${serviceName}.*"`;
  // Use metrics that always have data: raw counters, JVM memory, connections
  // rate() returns 0 when there's no active traffic, so also query absolute metrics
  const requestCountQuery = `sum(http_server_request_duration_seconds_count{${svcFilter}})`;
  const jvmMemoryQuery = `sum(jvm_memory_used_bytes{${svcFilter}}) / 1024 / 1024`;
  const dbConnectionsQuery = `sum(db_client_connections_usage{${svcFilter}})`;

  const requestCount = useMetricsRangeQuery(requestCountQuery, start, end, step, enabled);
  const jvmMemory = useMetricsRangeQuery(jvmMemoryQuery, start, end, step, enabled);
  const dbConnections = useMetricsRangeQuery(dbConnectionsQuery, start, end, step, enabled);

  const reqCountData = useMemo(() => matrixToChartData(requestCount.data), [requestCount.data]);
  const memoryData = useMemo(() => matrixToChartData(jvmMemory.data), [jvmMemory.data]);
  const dbData = useMemo(() => matrixToChartData(dbConnections.data), [dbConnections.data]);

  const allEmpty =
    !requestCount.isLoading &&
    !jvmMemory.isLoading &&
    !dbConnections.isLoading &&
    !reqCountData.length &&
    !memoryData.length &&
    !dbData.length;

  if (!serviceName) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-muted-foreground">
        No service selected — metrics unavailable
      </div>
    );
  }

  if (allEmpty) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[160px]">
        <BarChart3 className="h-6 w-6 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No metrics available for this service</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          Ensure <code className="font-mono text-[11px]">{serviceName}</code> is reporting to the observability stack
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-3 flex-wrap">
      <MiniChart
        title="Request Count"
        unit=""
        data={reqCountData}
        isLoading={requestCount.isLoading}
        isError={requestCount.isError}
        color="#2563EB"
      />
      <MiniChart
        title="JVM Memory"
        unit=" MB"
        data={memoryData}
        isLoading={jvmMemory.isLoading}
        isError={jvmMemory.isError}
        color="#7C3AED"
      />
      <MiniChart
        title="DB Connections"
        unit=""
        data={dbData}
        isLoading={dbConnections.isLoading}
        isError={dbConnections.isError}
        color="#16A34A"
      />
    </div>
  );
}

/* ─── Traces Tab ───────────────────────────────────────────────────── */

function TracesPanel({ serviceName }: { serviceName: string }) {
  const start = String(thirtyMinAgo());
  const end = String(now());
  const traceQL = serviceName ? `{resource.service.name="${serviceName}"}` : undefined;

  const { data, isLoading, isError } = useTraceSearch(
    traceQL,
    start,
    end,
    '10',
    !!serviceName,
  );

  if (!serviceName) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-muted-foreground">
        No service selected — traces unavailable
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[160px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[160px]">
        <AlertCircle className="h-5 w-5 text-muted-foreground mb-1" />
        <p className="text-sm text-muted-foreground">Failed to fetch traces</p>
      </div>
    );
  }

  const traces: any[] = (data as any)?.traces ?? (data as any)?.data?.result ?? [];

  if (!traces.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[160px]">
        <Search className="h-6 w-6 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No traces available</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          No recent traces found for <code className="font-mono text-[11px]">{serviceName}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[1fr_100px_80px_160px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5">
        <span>Trace ID</span>
        <span>Duration</span>
        <span>Status</span>
        <span>Timestamp</span>
      </div>
      {/* Rows */}
      {traces.map((trace: any, i: number) => {
        const traceID = trace.traceID ?? trace.traceId ?? trace.rootTraceName ?? `trace-${i}`;
        const durationMs = trace.durationMs ?? (trace.durationNanos ? trace.durationNanos / 1e6 : null);
        const rootName = trace.rootServiceName ?? trace.rootTraceName ?? '';
        const startTime = trace.startTimeUnixNano
          ? new Date(Number(trace.startTimeUnixNano) / 1e6).toLocaleString()
          : trace.startTime
            ? new Date(trace.startTime).toLocaleString()
            : '--';
        const hasError =
          trace.statusCode === 'STATUS_CODE_ERROR' || trace.statusCode === 2;

        return (
          <div
            key={traceID + i}
            className="grid grid-cols-[1fr_100px_80px_160px] gap-2 text-[11px] px-2 py-1.5 rounded hover:bg-muted/40 transition-colors"
          >
            <span className="font-mono text-foreground truncate" title={traceID}>
              {traceID.slice(0, 16)}...
            </span>
            <span className="text-foreground">
              {durationMs != null ? `${durationMs.toFixed(1)}ms` : '--'}
            </span>
            <span
              className={cn(
                'font-medium',
                hasError ? 'text-error' : 'text-success',
              )}
            >
              {hasError ? 'Error' : 'OK'}
            </span>
            <span className="text-muted-foreground">{startTime}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Logs Tab ─────────────────────────────────────────────────────── */

/**
 * Efficient Loki service-label detection.
 *
 * Problem: log sources use different labels (service_name, service, job,
 * app, container). We need to pick the right one without wasting queries.
 *
 * Strategy — optimistic-then-correct:
 *   1. Fire the log query IMMEDIATELY with service_name (correct ~90% of
 *      the time — OTel standard). No waiting, no blocking.
 *   2. In parallel, fetch /labels ONCE (shared cache, all panels reuse).
 *   3. If the optimistic query returned empty AND /labels reveals a
 *      different label exists, re-query with the correct label. This rare
 *      path happens at most once per session.
 *   4. Cache the resolved label in a module-level variable — survives
 *      re-renders, no API calls on subsequent mounts.
 *
 * Cost:
 *   Common case (service_name correct): 1 query, zero latency penalty.
 *   Uncommon case (Heroku/PaaS): 2 queries on first panel, then cached.
 *   /labels call: 1 per 60s shared across entire app (React Query dedup).
 */
const LOG_LABEL_CANDIDATES = ['service_name', 'service', 'job', 'app', 'container'];

// Module-level cache — persists across renders and panels for the entire
// browser session. Reset only on full page reload.
let _resolvedServiceLabel: string | null = null;

function LogsPanel({ serviceName }: { serviceName: string }) {
  const startNs = String(thirtyMinAgo() * 1e9);
  const endNs = String(now() * 1e9);
  const baseName = serviceName.replace(/-service$/, '');
  const valuePattern = `${serviceName}|${baseName}|.*${baseName}.*`;

  // Use cached label if already resolved from a prior panel/render.
  // Otherwise optimistic default: service_name.
  const optimisticLabel = _resolvedServiceLabel ?? 'service_name';
  const logQuery = serviceName ? `{${optimisticLabel}=~"${valuePattern}"}` : '';

  // Fire log query immediately — don't wait for /labels.
  const { data, isLoading, isError } = useLogsQuery(
    logQuery,
    startNs,
    endNs,
    '50',
    'backward',
    !!serviceName,
  );

  // In parallel, fetch /labels (shared cache, 1 call per 60s app-wide).
  const { data: labelsData } = useLogLabels(!!serviceName);

  // Detect if we need to correct the label.
  const allStreams = data?.data?.result ?? [];
  const hasLines = allStreams.some((s: any) => (s.values?.length ?? 0) > 0);

  const correctedLabel = useMemo(() => {
    if (!labelsData?.data?.length) return null;
    const available = new Set(labelsData.data);
    return LOG_LABEL_CANDIDATES.find((l) => available.has(l)) ?? 'service_name';
  }, [labelsData]);

  // Cache the resolved label for all future panels.
  if (correctedLabel && !_resolvedServiceLabel) {
    _resolvedServiceLabel = correctedLabel;
  }

  // If optimistic query returned empty but a better label exists, re-query.
  const needsCorrection = !isLoading && !hasLines && correctedLabel && correctedLabel !== optimisticLabel;
  const correctedQuery = needsCorrection
    ? `{${correctedLabel}=~"${valuePattern}"}`
    : '';

  const { data: correctedData, isLoading: correctedLoading } = useLogsQuery(
    correctedQuery,
    startNs,
    endNs,
    '50',
    'backward',
    !!needsCorrection,
  );

  // If correction fired and succeeded, update the module cache so no
  // future panel ever hits the wrong label again.
  if (needsCorrection && correctedData?.data?.result?.length) {
    _resolvedServiceLabel = correctedLabel;
  }

  // Use corrected data if available, otherwise use optimistic data.
  const finalData = needsCorrection ? correctedData : data;
  const finalLoading = needsCorrection ? correctedLoading : isLoading;

  if (!serviceName) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-muted-foreground">
        No service selected — logs unavailable
      </div>
    );
  }

  if (finalLoading) {
    return (
      <div className="flex items-center justify-center min-h-[160px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError && !needsCorrection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[160px]">
        <AlertCircle className="h-5 w-5 text-muted-foreground mb-1" />
        <p className="text-sm text-muted-foreground">Failed to fetch logs</p>
      </div>
    );
  }

  const finalStreams = finalData?.data?.result ?? [];
  const lines: { ts: string; line: string }[] = [];

  for (const stream of finalStreams) {
    for (const [nsTs, line] of stream.values ?? []) {
      const tsMs = Number(nsTs) / 1e6;
      const ts = new Date(tsMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      lines.push({ ts, line });
    }
  }

  // Sort newest first (already backward from Loki, but ensure)
  lines.sort((a, b) => (b.ts > a.ts ? 1 : -1));

  if (!lines.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[160px]">
        <FileText className="h-6 w-6 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No logs available</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          No recent logs found for <code className="font-mono text-[11px]">{serviceName}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="font-mono text-[11px] leading-relaxed max-h-[300px] overflow-y-auto bg-muted/20 rounded-lg border border-border p-2 space-y-0.5">
      {lines.slice(0, 50).map((entry, i) => (
        <div key={i} className="flex gap-2 hover:bg-muted/30 px-1 rounded">
          <span className="text-muted-foreground shrink-0 select-none">{entry.ts}</span>
          <span className="text-foreground break-all">{entry.line}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Export ───────────────────────────────────────────────────── */

export function TelemetryPanel({ type, serviceName, incidentId }: TelemetryPanelProps) {
  switch (type) {
    case 'metrics':
      return <MetricsPanel serviceName={serviceName} />;
    case 'traces':
      return <TracesPanel serviceName={serviceName} />;
    case 'logs':
      return <LogsPanel serviceName={serviceName} />;
  }
}
