/**
 * LGTM Query Service
 *
 * Shared utility for querying the LGTM observability stack (Mimir, Loki, Tempo)
 * from ICC services and workers. Handles multi-tenancy via X-Scope-OrgID,
 * endpoint resolution (managed vs BYOS), and graceful fallbacks when the
 * stack is unreachable.
 */

import { ObservabilityConnection } from '../models/observability-connection.model';
import { logger } from '../utils/logger';
import { assertUrlSafe } from '../utils/ssrf-guard';

// ─── Defaults ────────────────────────────────────────────────────────────────

const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';
const MANAGED_TEMPO_URL = process.env.MANAGED_TEMPO_URL  || 'http://10.10.1.21:3200';
const QUERY_TIMEOUT_MS  = 30_000;

// ─── Return types ────────────────────────────────────────────────────────────

export interface MetricSample {
  metric: Record<string, string>;
  values: Array<[number, string]>; // [unixTimestamp, value]
}

export interface LogEntry {
  timestamp: string; // nano-epoch string
  line: string;
  labels: Record<string, string>;
}

export interface TraceSearchResult {
  traceID: string;
  rootServiceName: string;
  rootTraceName: string;
  startTimeUnixNano: string;
  durationMs: number;
  spanSets?: Array<{
    spans: Array<{
      spanID: string;
      startTimeUnixNano: string;
      durationNanos: string;
      attributes: Array<{ key: string; value: { stringValue?: string } }>;
    }>;
  }>;
}

export interface ServiceHealth {
  error_rate_percent: number | null;
  latency_p99_ms: number | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  last_updated_at: string | null;
}

export interface TrafficEdge {
  source: string;
  target: string;
  request_count: number;
  avg_latency_ms: number;
  error_count: number;
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface LGTMEndpoints {
  metrics_url: string;
  logs_url: string;
  traces_url: string;
  orgId: string;
}

async function resolveEndpoints(tenantId: string): Promise<LGTMEndpoints> {
  try {
    const conn = await ObservabilityConnection.findOne({
      tenant_id: tenantId,
      status: { $in: ['connected', 'pending'] },
    }).sort({ created_at: -1 });

    if (conn && conn.mode === 'byos' && conn.endpoints) {
      return {
        metrics_url: conn.endpoints.metrics_url || MANAGED_MIMIR_URL,
        logs_url:    conn.endpoints.logs_url    || MANAGED_LOKI_URL,
        traces_url:  conn.endpoints.traces_url  || MANAGED_TEMPO_URL,
        orgId: tenantId,
      };
    }
  } catch (err: any) {
    logger.warn('lgtm-query: failed to resolve endpoints, using managed defaults', { error: err.message });
  }

  return {
    metrics_url: MANAGED_MIMIR_URL,
    logs_url:    MANAGED_LOKI_URL,
    traces_url:  MANAGED_TEMPO_URL,
    orgId: tenantId,
  };
}

async function lgtmFetch(url: string, orgId: string): Promise<any> {
  // SSRF protection: validate BYOS URLs before fetching
  const isManagedUrl = [MANAGED_MIMIR_URL, MANAGED_LOKI_URL, MANAGED_TEMPO_URL].some(
    (m) => url.startsWith(m),
  );
  if (!isManagedUrl) {
    await assertUrlSafe(url);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        'X-Scope-OrgID': orgId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`LGTM upstream ${resp.status}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Query Mimir with PromQL over a time range.
 * Returns metric samples or an empty array if unreachable.
 */
export async function queryMetrics(
  tenantId: string,
  promql: string,
  startTime: number, // unix seconds
  endTime: number,   // unix seconds
  step = '60s',
): Promise<MetricSample[]> {
  try {
    const ep = await resolveEndpoints(tenantId);
    const params = new URLSearchParams({
      query: promql,
      start: String(startTime),
      end:   String(endTime),
      step,
    });
    const data = await lgtmFetch(
      `${ep.metrics_url}/prometheus/api/v1/query_range?${params}`,
      ep.orgId,
    );
    if (data?.data?.result) {
      return data.data.result.map((r: any) => ({
        metric: r.metric || {},
        values: r.values || [],
      }));
    }
    return [];
  } catch (err: any) {
    logger.warn('lgtm-query: queryMetrics failed', { tenantId, error: err.message });
    return [];
  }
}

/**
 * Instant PromQL query (single point in time).
 * Returns the scalar numeric value of the first result, or null.
 */
export async function queryMetricInstant(
  tenantId: string,
  promql: string,
  time?: number, // unix seconds, defaults to now
): Promise<number | null> {
  try {
    const ep = await resolveEndpoints(tenantId);
    const params = new URLSearchParams({ query: promql });
    if (time) params.set('time', String(time));
    const data = await lgtmFetch(
      `${ep.metrics_url}/prometheus/api/v1/query?${params}`,
      ep.orgId,
    );
    const result = data?.data?.result?.[0];
    if (result?.value?.[1] !== undefined) {
      const val = parseFloat(result.value[1]);
      return isNaN(val) ? null : val;
    }
    return null;
  } catch (err: any) {
    logger.warn('lgtm-query: queryMetricInstant failed', { tenantId, error: err.message });
    return null;
  }
}

/**
 * Query Loki with LogQL over a time range.
 * Returns log entries or an empty array if unreachable.
 */
export async function queryLogs(
  tenantId: string,
  logql: string,
  startTime: number, // unix seconds
  endTime: number,   // unix seconds
  limit = 500,
): Promise<LogEntry[]> {
  try {
    const ep = await resolveEndpoints(tenantId);
    // Loki expects nanosecond timestamps for start/end
    const params = new URLSearchParams({
      query:     logql,
      start:     String(startTime * 1_000_000_000),
      end:       String(endTime * 1_000_000_000),
      limit:     String(limit),
      direction: 'backward',
    });
    const data = await lgtmFetch(
      `${ep.logs_url}/loki/api/v1/query_range?${params}`,
      ep.orgId,
    );
    const entries: LogEntry[] = [];
    const streams = data?.data?.result || [];
    for (const stream of streams) {
      const labels: Record<string, string> = stream.stream || {};
      for (const [ts, line] of stream.values || []) {
        entries.push({ timestamp: ts, line, labels });
      }
    }
    return entries;
  } catch (err: any) {
    logger.warn('lgtm-query: queryLogs failed', { tenantId, error: err.message });
    return [];
  }
}

/**
 * Search Tempo for traces matching optional TraceQL / service filter.
 * Returns trace summaries or an empty array if unreachable.
 */
export async function queryTraces(
  tenantId: string,
  options: {
    traceql?: string;
    serviceName?: string;
    startTime: number; // unix seconds
    endTime: number;   // unix seconds
    limit?: number;
    minDurationMs?: number;
  },
): Promise<TraceSearchResult[]> {
  try {
    const ep = await resolveEndpoints(tenantId);
    const params = new URLSearchParams();
    if (options.traceql) {
      params.set('q', options.traceql);
    } else if (options.serviceName) {
      params.set('q', `{resource.service.name="${options.serviceName}"}`);
    }
    params.set('start', String(options.startTime));
    params.set('end', String(options.endTime));
    params.set('limit', String(options.limit || 100));
    if (options.minDurationMs) {
      params.set('minDuration', `${options.minDurationMs}ms`);
    }

    const data = await lgtmFetch(
      `${ep.traces_url}/api/search?${params}`,
      ep.orgId,
    );
    return (data?.traces || []).map((t: any) => ({
      traceID: t.traceID,
      rootServiceName: t.rootServiceName || '',
      rootTraceName: t.rootTraceName || '',
      startTimeUnixNano: t.startTimeUnixNano || '0',
      durationMs: t.durationMs || 0,
      spanSets: t.spanSets || [],
    }));
  } catch (err: any) {
    logger.warn('lgtm-query: queryTraces failed', { tenantId, error: err.message });
    return [];
  }
}

/**
 * Convenience: query error rate, latency p99, CPU, and memory for a service.
 * Returns null-filled health if LGTM is unreachable.
 */
export async function getServiceHealth(
  tenantId: string,
  serviceName: string,
): Promise<ServiceHealth> {
  const fallback: ServiceHealth = {
    error_rate_percent: null,
    latency_p99_ms: null,
    cpu_percent: null,
    memory_percent: null,
    last_updated_at: null,
  };

  try {
    // Query metrics using OTel-compatible metric names and labels.
    // OTel Java agent emits: http_server_request_duration_seconds_* with label service_name.
    // Also try legacy Prometheus metric names as fallback (service label).
    const svcFilter = `service_name="${serviceName}"`;
    const svcFilterLegacy = `service="${serviceName}"`;

    const [errorRate, latencyP99, cpu, memory] = await Promise.all([
      // Error rate: try OTel metric first, then legacy
      queryMetricInstant(
        tenantId,
        `100 * sum(rate(http_server_request_duration_seconds_count{${svcFilter},http_response_status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_server_request_duration_seconds_count{${svcFilter}}[5m])), 1)`,
      ).then((v) => v ?? queryMetricInstant(
        tenantId,
        `100 * sum(rate(http_requests_total{${svcFilterLegacy},status=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total{${svcFilterLegacy}}[5m])), 1)`,
      )),
      // P99 latency
      queryMetricInstant(
        tenantId,
        `histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds_bucket{${svcFilter}}[5m])) by (le)) * 1000`,
      ).then((v) => v ?? queryMetricInstant(
        tenantId,
        `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{${svcFilterLegacy}}[5m])) by (le)) * 1000`,
      )),
      // CPU: try OTel JVM CPU utilization ratio, then process_cpu
      queryMetricInstant(
        tenantId,
        `100 * avg(jvm_cpu_recent_utilization_ratio{${svcFilter}})`,
      ).then((v) => v ?? queryMetricInstant(
        tenantId,
        `100 * avg(process_runtime_jvm_cpu_utilization{${svcFilter}})`,
      )).then((v) => v ?? queryMetricInstant(
        tenantId,
        `100 * avg(rate(process_cpu_seconds_total{${svcFilter}}[5m]))`,
      )),
      // Memory: JVM heap used / committed (OTel uses jvm_memory_type, legacy uses type or area)
      queryMetricInstant(
        tenantId,
        `100 * sum(jvm_memory_used_bytes{${svcFilter},jvm_memory_type="heap"}) / clamp_min(sum(jvm_memory_committed_bytes{${svcFilter},jvm_memory_type="heap"}), 1)`,
      ).then((v) => v ?? queryMetricInstant(
        tenantId,
        `100 * sum(jvm_memory_used_bytes{${svcFilter},type="heap"}) / clamp_min(sum(jvm_memory_committed_bytes{${svcFilter},type="heap"}), 1)`,
      )).then((v) => v ?? queryMetricInstant(
        tenantId,
        `100 * sum(jvm_memory_used_bytes{${svcFilter},area="heap"}) / clamp_min(sum(jvm_memory_committed_bytes{${svcFilter},area="heap"}), 1)`,
      )),
    ]);

    const hasData = errorRate !== null || latencyP99 !== null || cpu !== null || memory !== null;

    return {
      error_rate_percent: errorRate,
      latency_p99_ms: latencyP99,
      cpu_percent: cpu,
      memory_percent: memory,
      last_updated_at: hasData ? new Date().toISOString() : null,
    };
  } catch (err: any) {
    logger.warn('lgtm-query: getServiceHealth failed', { tenantId, serviceName, error: err.message });
    return fallback;
  }
}

/**
 * Batch-fetch health metrics for many services in exactly 4 parallel Prometheus
 * instant queries (one per metric dimension), rather than N×4 sequential calls.
 *
 * Resolves endpoints once, builds a single service_name regex covering all
 * requested names, and returns a Map<serviceName, ServiceHealth> so callers
 * can do O(1) lookups without any additional round-trips.
 */
export async function getBulkServiceHealth(
  tenantId: string,
  serviceNames: string[],
): Promise<Map<string, ServiceHealth>> {
  const healthMap = new Map<string, ServiceHealth>();
  if (serviceNames.length === 0) return healthMap;

  // Pre-populate with null-filled entries so the topology always has a value
  for (const name of serviceNames) {
    healthMap.set(name, {
      error_rate_percent: null,
      latency_p99_ms: null,
      cpu_percent: null,
      memory_percent: null,
      last_updated_at: null,
    });
  }

  try {
    // Resolve endpoints once for the whole batch
    const ep = await resolveEndpoints(tenantId);
    const now = new Date().toISOString();

    // Build a regex that matches all service names.
    // Escape Prometheus regex metacharacters in each name.
    const escapedNames = serviceNames.map((n) =>
      n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    const svcRegex  = escapedNames.join('|');
    const svcFilter = `service_name=~"${svcRegex}"`;

    // Fire a single instant query and return all (service_name → value) pairs.
    // Uses the already-resolved endpoint directly to avoid per-call resolveEndpoints.
    const batchInstant = async (
      promql: string,
    ): Promise<Array<{ name: string; value: number }>> => {
      try {
        const params = new URLSearchParams({ query: promql });
        const data = await lgtmFetch(
          `${ep.metrics_url}/prometheus/api/v1/query?${params}`,
          ep.orgId,
        );
        const out: Array<{ name: string; value: number }> = [];
        for (const r of data?.data?.result ?? []) {
          const svcName = r.metric?.service_name as string | undefined;
          if (!svcName) continue;
          const val = parseFloat(r.value?.[1]);
          if (!isNaN(val)) out.push({ name: svcName, value: val });
        }
        return out;
      } catch {
        return [];
      }
    };

    // 4 queries in parallel — one per metric dimension
    const [errorRates, latencies, cpus, memories] = await Promise.all([
      batchInstant(
        `100 * sum by (service_name) (rate(http_server_request_duration_seconds_count{${svcFilter},http_response_status_code=~"5.."}[5m]))` +
        ` / clamp_min(sum by (service_name) (rate(http_server_request_duration_seconds_count{${svcFilter}}[5m])), 1)`,
      ),
      batchInstant(
        `histogram_quantile(0.99, sum by (service_name, le) (rate(http_server_request_duration_seconds_bucket{${svcFilter}}[5m]))) * 1000`,
      ),
      batchInstant(
        `100 * avg by (service_name) (jvm_cpu_recent_utilization_ratio{${svcFilter}})`,
      ),
      batchInstant(
        `100 * sum by (service_name) (jvm_memory_used_bytes{${svcFilter},jvm_memory_type="heap"})` +
        ` / clamp_min(sum by (service_name) (jvm_memory_committed_bytes{${svcFilter},jvm_memory_type="heap"}), 1)`,
      ),
    ]);

    for (const { name, value } of errorRates) {
      const h = healthMap.get(name);
      if (h) { h.error_rate_percent = value; h.last_updated_at = now; }
    }
    for (const { name, value } of latencies) {
      const h = healthMap.get(name);
      if (h) { h.latency_p99_ms = value; h.last_updated_at = now; }
    }
    for (const { name, value } of cpus) {
      const h = healthMap.get(name);
      if (h) { h.cpu_percent = value; h.last_updated_at = now; }
    }
    for (const { name, value } of memories) {
      const h = healthMap.get(name);
      if (h) { h.memory_percent = value; h.last_updated_at = now; }
    }
  } catch (err: any) {
    logger.warn('lgtm-query: getBulkServiceHealth failed', { tenantId, error: err.message });
  }

  return healthMap;
}

/**
 * Query Tempo for service-to-service span relationships within a time window.
 * Extracts unique edges from trace data for dependency auto-discovery.
 */
export async function getServiceTrafficEdges(
  tenantId: string,
  windowHours = 72,
): Promise<TrafficEdge[]> {
  try {
    const ep = await resolveEndpoints(tenantId);
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - windowHours * 3600;

    // Search for all traces in the window (paginate up to 10k)
    const params = new URLSearchParams({
      start: String(startTime),
      end:   String(endTime),
      limit: '5000',
    });

    const data = await lgtmFetch(
      `${ep.traces_url}/api/search?${params}`,
      ep.orgId,
    );

    const traces: any[] = data?.traces || [];

    // For each trace, fetch full trace data and extract edges
    const edgeMap = new Map<string, { request_count: number; total_latency_ms: number; error_count: number }>();

    // Process traces in batches to avoid overwhelming Tempo
    const BATCH_SIZE = 50;
    const traceIds = traces.map((t: any) => t.traceID).slice(0, 500); // cap at 500 traces

    for (let i = 0; i < traceIds.length; i += BATCH_SIZE) {
      const batch = traceIds.slice(i, i + BATCH_SIZE);
      const traceResults = await Promise.allSettled(
        batch.map((traceId: string) =>
          lgtmFetch(`${ep.traces_url}/api/traces/${traceId}`, ep.orgId),
        ),
      );

      for (const result of traceResults) {
        if (result.status !== 'fulfilled') continue;
        const traceData = result.value;

        // Parse OTLP/Tempo trace format — extract spans grouped by service
        const spanServiceMap = new Map<string, string>(); // spanId -> serviceName
        const spanParentMap = new Map<string, string>();   // spanId -> parentSpanId
        const spanStatusMap = new Map<string, boolean>();   // spanId -> isError
        const spanDurationMap = new Map<string, number>(); // spanId -> durationMs

        const batches = traceData?.batches || traceData?.resourceSpans || [];
        for (const batch of batches) {
          const resource = batch.resource || {};
          const attrs = resource.attributes || [];
          let serviceName = '';
          for (const attr of attrs) {
            if (attr.key === 'service.name') {
              serviceName = attr.value?.stringValue || attr.value?.Value?.StringValue || '';
              break;
            }
          }
          if (!serviceName) continue;

          const scopeSpans = batch.instrumentationLibrarySpans || batch.scopeSpans || [];
          for (const scope of scopeSpans) {
            for (const span of scope.spans || []) {
              const spanId = span.spanId || span.spanID || '';
              const parentSpanId = span.parentSpanId || span.parentSpanID || '';
              spanServiceMap.set(spanId, serviceName);
              if (parentSpanId) spanParentMap.set(spanId, parentSpanId);

              const statusCode = span.status?.code || 0;
              spanStatusMap.set(spanId, statusCode === 2); // STATUS_CODE_ERROR = 2

              const startNano = parseInt(span.startTimeUnixNano || '0', 10);
              const endNano = parseInt(span.endTimeUnixNano || '0', 10);
              spanDurationMap.set(spanId, (endNano - startNano) / 1_000_000);
            }
          }
        }

        // Build edges from parent-child relationships across services
        for (const [spanId, parentSpanId] of spanParentMap) {
          const childService = spanServiceMap.get(spanId);
          const parentService = spanServiceMap.get(parentSpanId);
          if (childService && parentService && childService !== parentService) {
            const edgeKey = `${parentService}→${childService}`;
            const existing = edgeMap.get(edgeKey) || { request_count: 0, total_latency_ms: 0, error_count: 0 };
            existing.request_count++;
            existing.total_latency_ms += spanDurationMap.get(spanId) || 0;
            if (spanStatusMap.get(spanId)) existing.error_count++;
            edgeMap.set(edgeKey, existing);
          }
        }
      }
    }

    // Convert map to array
    const edges: TrafficEdge[] = [];
    for (const [key, stats] of edgeMap) {
      const [source, target] = key.split('→');
      edges.push({
        source,
        target,
        request_count: stats.request_count,
        avg_latency_ms: stats.request_count > 0 ? Math.round(stats.total_latency_ms / stats.request_count) : 0,
        error_count: stats.error_count,
      });
    }

    return edges;
  } catch (err: any) {
    logger.warn('lgtm-query: getServiceTrafficEdges failed', { tenantId, error: err.message });
    return [];
  }
}

/**
 * Instant PromQL query that returns the full vector result set (all label
 * combinations), not just the first scalar.  Useful for `group by (label)
 * (metric)` style queries that enumerate label values.
 */
export async function queryInstantVector(
  tenantId: string,
  promql: string,
  time?: number,
): Promise<Array<{ metric: Record<string, string>; value: number }>> {
  try {
    const ep = await resolveEndpoints(tenantId);
    const params = new URLSearchParams({ query: promql });
    if (time) params.set('time', String(time));
    const data = await lgtmFetch(
      `${ep.metrics_url}/prometheus/api/v1/query?${params}`,
      ep.orgId,
    );
    const results: Array<{ metric: Record<string, string>; value: number }> = [];
    for (const r of data?.data?.result || []) {
      const val = parseFloat(r.value?.[1]);
      results.push({
        metric: r.metric || {},
        value: isNaN(val) ? 0 : val,
      });
    }
    return results;
  } catch (err: any) {
    logger.warn('lgtm-query: queryInstantVector failed', { tenantId, error: err.message });
    return [];
  }
}

/**
 * Query Mimir's series endpoint.  Returns the label sets of all series
 * matching the given selector(s).
 */
export async function querySeries(
  tenantId: string,
  match: string,
  startTime?: number,
  endTime?: number,
): Promise<Record<string, string>[]> {
  try {
    const ep = await resolveEndpoints(tenantId);
    const params = new URLSearchParams({ 'match[]': match });
    if (startTime) params.set('start', String(startTime));
    if (endTime) params.set('end', String(endTime));
    const data = await lgtmFetch(
      `${ep.metrics_url}/prometheus/api/v1/series?${params}`,
      ep.orgId,
    );
    return (data?.data || []) as Record<string, string>[];
  } catch (err: any) {
    logger.warn('lgtm-query: querySeries failed', { tenantId, error: err.message });
    return [];
  }
}
