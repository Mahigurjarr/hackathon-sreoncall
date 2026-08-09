import { ObservabilityConnection } from '../models/observability-connection.model';
import { logger } from '../utils/logger';
import { getDefaultLabels, mergeLabels } from '../services/observability-labels.service';

/**
 * Supabase Logs Poller
 *
 * Free-tier / no-drain alternative to Supabase Log Drains. Polls the
 * Management API every 60s and forwards new log events to Loki.
 *
 *   GET https://api.supabase.com/v1/projects
 *   GET https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs.all
 *       ?sql=<query>&iso_timestamp_start=<ISO>&iso_timestamp_end=<ISO>
 *
 * Uses the Personal Access Token already captured during observability-connection
 * setup (config.credentials.access_token). Cursor is persisted on the connection
 * at config.last_log_cursor_ms so we only fetch new events each tick.
 *
 * Log sources polled per project (all plans including free):
 *   - edge_logs      → HTTP request/response logs (also used for metrics)
 *   - postgres_logs  → DB query errors, connection failures, slow queries
 *   - auth_logs      → sign-in failures, token errors, session issues
 *   - function_edge_logs → Edge Function crashes, timeouts, unhandled errors
 */

const POLL_INTERVAL_MS = 60_000;
const MAX_LOOKBACK_MS = 15 * 60_000; // cap so a long-paused worker doesn't flood
const MANAGED_LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const SUPABASE_API = 'https://api.supabase.com';

// Each entry is fetched independently per project per tick.
// edge_logs is also the source for HTTP request metrics (status codes).
const LOG_SOURCES = [
  { table: 'edge_logs',     service: 'edge',      limit: 200, isMetricSource: true  },
  { table: 'postgres_logs', service: 'postgres',  limit: 100, isMetricSource: false },
  { table: 'auth_logs',     service: 'auth',      limit: 100, isMetricSource: false },
  { table: 'function_edge_logs', service: 'functions', limit: 100, isMetricSource: false },
] as const;

let timer: NodeJS.Timeout | null = null;
let running = false;

interface SupabaseProject {
  id: string;
  ref: string;
  name: string;
  region?: string;
  status?: string;
}

interface SupabaseLogRow {
  id?: string;
  timestamp?: number | string;
  event_message?: string;
  metadata?: Array<Record<string, any>> | Record<string, any>;
}

async function supabaseFetch<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.debug('Supabase API non-2xx', { path, status: res.status });
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    logger.debug('Supabase API fetch failed', { path, error: err.message });
    return null;
  }
}

function buildLogsQuery(table: string, limit: number): string {
  return `select id, timestamp, event_message, metadata from ${table} order by timestamp desc limit ${limit}`;
}

function extractPollerStatusCode(row: SupabaseLogRow): number | null {
  const meta = Array.isArray(row.metadata) ? row.metadata[0] : row.metadata || {};
  const m = meta as Record<string, any>;
  const direct = m?.status_code ?? m?.response?.status_code ?? m?.response?.[0]?.status_code;
  if (typeof direct === 'number') return direct;
  if (typeof direct === 'string') return parseInt(direct, 10) || null;
  return null;
}

interface PollerMetricPoint {
  projectRef: string;
  service: string;
  statusClass: string;
  timestamp: number;
}

function extractPollerMetrics(projectRef: string, rows: SupabaseLogRow[]): PollerMetricPoint[] {
  const points: PollerMetricPoint[] = [];
  for (const row of rows) {
    const statusCode = extractPollerStatusCode(row);
    if (statusCode === null) continue;
    const meta = Array.isArray(row.metadata) ? row.metadata[0] : (row.metadata || {}) as Record<string, any>;
    const service = String(meta?.service || meta?.product || 'edge');
    const statusClass =
      statusCode >= 500 ? '5xx' :
      statusCode >= 400 ? '4xx' :
      statusCode >= 300 ? '3xx' : '2xx';
    const tsRaw = row.timestamp;
    const tsMs =
      typeof tsRaw === 'number' && tsRaw > 1e14 ? Math.floor(tsRaw / 1000) :
      typeof tsRaw === 'number' ? tsRaw :
      typeof tsRaw === 'string' ? new Date(tsRaw).getTime() : Date.now();
    points.push({ projectRef, service, statusClass, timestamp: tsMs });
  }
  return points;
}

async function pushMetricsToMimir(tenantId: string, points: PollerMetricPoint[]): Promise<void> {
  if (points.length === 0) return;

  // Group by projectRef → metricName → dataPoints
  const byProject = new Map<string, PollerMetricPoint[]>();
  for (const p of points) {
    if (!byProject.has(p.projectRef)) byProject.set(p.projectRef, []);
    byProject.get(p.projectRef)!.push(p);
  }

  const resourceMetrics = [];
  for (const [projectRef, pts] of byProject) {
    // Group by (service, statusClass) for batched data points
    const byKey = new Map<string, PollerMetricPoint[]>();
    for (const p of pts) {
      const key = `${p.service}::${p.statusClass}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(p);
    }

    const otlpDataPoints = Array.from(byKey.values()).map((group) => ({
      attributes: [
        { key: 'project_ref', value: { stringValue: projectRef } },
        { key: 'service', value: { stringValue: group[0].service } },
        { key: 'status_class', value: { stringValue: group[0].statusClass } },
        { key: 'source', value: { stringValue: 'supabase' } },
        { key: 'source_type', value: { stringValue: 'api_poller' } },
        { key: 'tenant_id', value: { stringValue: tenantId } },
      ],
      timeUnixNano: String(group[group.length - 1].timestamp * 1_000_000),
      asDouble: group.length,
    }));

    resourceMetrics.push({
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: `supabase/${projectRef}` } },
          { key: 'source', value: { stringValue: 'supabase' } },
          { key: 'tenant_id', value: { stringValue: tenantId } },
        ],
      },
      scopeMetrics: [{ metrics: [{ name: 'supabase_requests_total', gauge: { dataPoints: otlpDataPoints } }] }],
    });
  }

  await fetch(`${MANAGED_MIMIR_URL}/otlp/v1/metrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Scope-OrgID': tenantId,
    },
    body: JSON.stringify({ resourceMetrics }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err: any) => {
    logger.warn('Failed to push Supabase metrics to Mimir', { error: err.message, tenantId });
  });
}

function extractSeverity(row: SupabaseLogRow, service: string): string {
  const meta = Array.isArray(row.metadata) ? row.metadata[0] : row.metadata || {};
  const m = meta as Record<string, any>;

  // postgres_logs uses error_severity (FATAL, PANIC, ERROR, WARNING, LOG, INFO, DEBUG)
  if (service === 'postgres') {
    const sev = String(m?.error_severity || '').toLowerCase();
    if (sev === 'fatal' || sev === 'panic' || sev === 'error') return 'error';
    if (sev === 'warning') return 'warn';
    return 'info';
  }

  // auth_logs and function_edge_logs use a level field directly
  if (service === 'auth' || service === 'functions') {
    const lvl = String(m?.level || '').toLowerCase();
    if (lvl === 'error' || lvl === 'fatal') return 'error';
    if (lvl === 'warn' || lvl === 'warning') return 'warn';
    return 'info';
  }

  // edge_logs: derive from HTTP response status code
  const status = m?.response?.status_code ?? m?.response?.[0]?.status_code;
  if (typeof status === 'number') {
    if (status >= 500) return 'error';
    if (status >= 400) return 'warn';
  }
  return 'info';
}

async function pushLogsToLoki(
  tenantId: string,
  projectRef: string,
  projectName: string,
  service: string,
  rows: SupabaseLogRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const customLabels = await getDefaultLabels(tenantId, 'supabase');
  const streamsByLevel = new Map<string, { stream: Record<string, string>; values: [string, string][] }>();

  for (const row of rows) {
    const level = extractSeverity(row, service);
    const tsRaw = row.timestamp;
    const tsMs =
      typeof tsRaw === 'number' && tsRaw > 1e14
        ? Math.floor(tsRaw / 1000) // Supabase sends microseconds
        : typeof tsRaw === 'number'
          ? tsRaw
          : typeof tsRaw === 'string'
            ? new Date(tsRaw).getTime()
            : Date.now();
    const tsNano = `${tsMs * 1_000_000}`;
    const line = row.event_message || JSON.stringify(row);

    const key = `${service}:${level}:${projectRef}`;
    if (!streamsByLevel.has(key)) {
      streamsByLevel.set(key, {
        stream: mergeLabels(
          {
            source: 'supabase',
            service_name: `${projectRef || projectName}/${service}`,
            service,
            project_ref: projectRef,
            project: projectName,
            level,
            source_type: 'api_poller',
            tenant_id: tenantId,
            job: 'supabase',
          },
          customLabels,
        ),
        values: [],
      });
    }
    streamsByLevel.get(key)!.values.push([tsNano, String(line)]);
  }

  const streams = Array.from(streamsByLevel.values());

  await fetch(`${MANAGED_LOKI_URL}/loki/api/v1/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Scope-OrgID': tenantId,
    },
    body: JSON.stringify({ streams }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    logger.warn('Failed to push Supabase logs to Loki', { error: err.message, tenantId });
  });
}

async function pollConnection(conn: any): Promise<void> {
  const tenantId = String(conn.tenant_id);
  const connectionId = String(conn._id);
  const token = conn.config?.credentials?.access_token as string | undefined;
  if (!token) return;

  const now = Date.now();
  const lastCursor = (conn.config?.last_log_cursor_ms as number) || now - POLL_INTERVAL_MS;
  const sinceMs = Math.max(lastCursor, now - MAX_LOOKBACK_MS);
  const sinceISO = new Date(sinceMs).toISOString();
  const untilISO = new Date(now).toISOString();

  const projectsRes = await supabaseFetch<SupabaseProject[]>('/v1/projects', token);
  if (!projectsRes || !Array.isArray(projectsRes)) return;

  let totalRows = 0;
  const allMetricPoints: PollerMetricPoint[] = [];

  for (const project of projectsRes) {
    if (!project?.ref) continue;
    // Only poll healthy projects — paused/inactive projects return no logs
    if (project.status && project.status !== 'ACTIVE_HEALTHY') continue;

    for (const source of LOG_SOURCES) {
      const sql = encodeURIComponent(buildLogsQuery(source.table, source.limit));
      const qs = `sql=${sql}&iso_timestamp_start=${encodeURIComponent(sinceISO)}&iso_timestamp_end=${encodeURIComponent(untilISO)}`;
      const path = `/v1/projects/${project.ref}/analytics/endpoints/logs.all?${qs}`;
      const res = await supabaseFetch<{ result?: SupabaseLogRow[]; error?: string | null }>(
        path,
        token,
      );
      const rows = res?.result ?? [];
      if (rows.length > 0) {
        await pushLogsToLoki(tenantId, project.ref, project.name, source.service, rows);
        if (source.isMetricSource) {
          allMetricPoints.push(...extractPollerMetrics(project.ref, rows));
        }
        totalRows += rows.length;
      }
    }
  }

  // Push aggregated request metrics to Mimir
  await pushMetricsToMimir(tenantId, allMetricPoints);

  await ObservabilityConnection.updateOne(
    { _id: connectionId },
    {
      $set: {
        'config.last_log_cursor_ms': now,
        last_health_check_at: new Date(now),
        health_check_message: `Polled ${projectsRes.length} projects, ${totalRows} events`,
      },
    },
  ).catch(() => {});

  if (totalRows > 0) {
    logger.debug('Supabase poller pushed events', {
      tenantId,
      projects: projectsRes.length,
      events: totalRows,
    });
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const connections = await ObservabilityConnection.find({
      vendor: 'supabase',
      status: 'connected',
    }).lean();

    for (const conn of connections) {
      try {
        await pollConnection(conn);
      } catch (err: any) {
        logger.warn('Supabase poller failed for connection', {
          connectionId: String(conn._id),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Supabase logs poller tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

export function startSupabaseLogsPollerWorker(): void {
  logger.info('Starting Supabase logs poller (interval: 60s)');
  setTimeout(() => {
    tick().catch(() => {});
    timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
  }, 45_000);
}

export function stopSupabaseLogsPollerWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logger.info('Supabase logs poller stopped');
}
