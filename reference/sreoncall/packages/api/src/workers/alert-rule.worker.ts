import { Types } from 'mongoose';
import crypto from 'crypto';
import { AlertRule, IAlertRule } from '../models/alert-rule.model';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { Service } from '../models/service.model';
import { Incident } from '../models/incident.model';
import { User } from '../models/user.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import * as alertRuleService from '../services/alert-rule.service';
import * as notificationService from '../services/notification.service';
import * as incidentService from '../services/incident.service';
import { applyAlertStatusToService } from '../services/service.service';
import { publishAgentTrigger } from '../services/agent-trigger.service';
import { logger } from '../utils/logger';
import { QueryExecutionError, throwOnBadQuery, isBarePromqlSelector } from '../utils/query-error';

/**
 * Wrap a rule expression for range evaluation. Only bare metric selectors get
 * wrapped in `avg_over_time(...[window])`; anything already a complete PromQL
 * expression (comparison, arithmetic, function call) is used as-is — see
 * {@link isBarePromqlSelector} for why wrapping those would produce invalid PromQL.
 */
function toWindowedPromql(expr: string, windowMinutes: number): string {
  const trimmed = expr.trim();
  return isBarePromqlSelector(trimmed)
    ? `avg_over_time(${trimmed}[${windowMinutes}m])`
    : trimmed;
}

/**
 * Resolve the user attribution for a fired rule. Rules created by template
 * seeders or programmatic inserts often have created_by=null, which would
 * otherwise silently skip the notification + incident-creation paths below.
 * Cached per (tenantId) for the duration of the worker process.
 */
const tenantFallbackUserCache = new Map<string, Types.ObjectId | null>();
async function resolveRuleCreator(rule: IAlertRule): Promise<Types.ObjectId | null> {
  if (rule.created_by) return rule.created_by as unknown as Types.ObjectId;
  const tenantKey = (rule.tenant_id as any).toString();
  if (tenantFallbackUserCache.has(tenantKey)) return tenantFallbackUserCache.get(tenantKey)!;
  const admin = await User.findOne({ tenant_id: rule.tenant_id, status: 'active', roles: 'Admin' })
    .select('_id').lean();
  const fallback = admin
    ? (admin as any)._id as Types.ObjectId
    : ((await User.findOne({ tenant_id: rule.tenant_id, status: 'active' }).select('_id').lean()) as any)?._id ?? null;
  tenantFallbackUserCache.set(tenantKey, fallback);
  if (!rule.created_by) {
    logger.warn(`Rule "${rule.name}" has no created_by — falling back to ${fallback ?? 'null'}`, {
      ruleId: rule._id, tenantId: tenantKey,
    });
  }
  return fallback;
}

const POLL_INTERVAL_MS = Math.max(parseInt(process.env.ALERT_POLL_INTERVAL_MS || '', 10) || 60_000, 15_000);
const CONCURRENCY = 10;
const QUERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Alert deduplication / grouping
// ---------------------------------------------------------------------------
// Minimum floor of 5 minutes regardless of env var to prevent runaway
// incident creation from misconfigured test values leaking to production.
const DEDUP_COOLDOWN_MS = Math.max(parseInt(process.env.ALERT_DEDUP_COOLDOWN_MS || '', 10) || 5 * 60_000, 5 * 60_000);
const DEDUP_STALE_MS = 30 * 60 * 1000; // 30 min — stale entries are cleaned up
const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // run cleanup every 5 min

interface DedupEntry {
  firstFiredAt: number;
  lastNotifiedAt: number;
  lastSeenAt: number;
  count: number;
}

/** In-memory deduplication map: fingerprint → tracking entry */
const dedupMap = new Map<string, DedupEntry>();

/** Compute a stable fingerprint for an alert firing: hash(ruleId + sorted label key=value pairs) */
function computeFingerprint(ruleId: string, labels: Record<string, string>): string {
  const sortedLabels = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
  return crypto
    .createHash('sha256')
    .update(`${ruleId}|${sortedLabels}`)
    .digest('hex');
}

/** Remove stale fingerprints that have not been updated for DEDUP_STALE_MS */
function cleanupStaleDedupEntries(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [fp, entry] of dedupMap) {
    if (now - entry.lastSeenAt > DEDUP_STALE_MS) {
      dedupMap.delete(fp);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`Alert dedup cleanup: removed ${cleaned} stale fingerprints`);
  }
}

let cleanupTimer: NodeJS.Timeout | null = null;

// Central LGTM endpoints (same as observability-proxy)
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';
const MANAGED_TEMPO_URL = process.env.MANAGED_TEMPO_URL || 'http://10.10.1.21:3200';

let timer: NodeJS.Timeout | null = null;
let running = false;

// ---------------------------------------------------------------------------
// Alert → Incident correlation: enrich incidents with traces, metrics & logs
// ---------------------------------------------------------------------------

interface CorrelationData {
  description: string;
  timelineEntries: Array<{ message: string; type: string; metadata?: Record<string, unknown> }>;
}

/**
 * Correlate alert data: fetch error logs (with trace_ids), trace details from
 * Tempo, and a metrics snapshot from Mimir. Returns enriched description and
 * timeline entries to attach to the auto-created incident.
 */
async function correlateAlertData(
  rule: IAlertRule,
  alertValue: number,
  tenantId: string,
): Promise<CorrelationData> {
  const entries: CorrelationData['timelineEntries'] = [];
  const sections: string[] = [];

  const lokiUrl = await resolveLokiUrl(tenantId);
  const mimirUrl = await resolveMimirUrl(tenantId);
  const tempoUrl = await resolveTempoUrl(tenantId);

  // ── 1. Fetch recent error log lines (raw lines, NOT aggregation) ──
  const traceIds: string[] = [];
  let logSamples: string[] = [];
  let logStreamLabels: Record<string, string>[] = [];
  try {
    // For LogQL alert rules, extract the stream selector from the aggregation query
    // e.g., sum(count_over_time({job="docker", level=~"ERROR|WARN|FATAL"}[1m]))
    // → raw query: {job="docker", level=~"ERROR|WARN|FATAL"}
    let rawLogQuery = '{level=~"error|ERROR|WARN|FATAL"}';
    if (rule.source_type === 'managed_logql' && rule.query) {
      const selectorMatch = rule.query.match(/\{[^}]+\}/);
      if (selectorMatch) {
        rawLogQuery = selectorMatch[0];
      }
    }

    const now = Date.now();
    const start = now - 5 * 60_000;
    const params = new URLSearchParams({
      query: rawLogQuery,
      start: String(start * 1e6),
      end: String(now * 1e6),
      limit: '30',
      direction: 'backward',
    });
    const resp = await fetch(`${lokiUrl}/loki/api/v1/query_range?${params}`, {
      headers: { 'X-Scope-OrgID': tenantId, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const json: any = await resp.json();
      for (const stream of json.data?.result || []) {
        const labels = stream.metric || stream.stream || {};
        logStreamLabels.push(labels);
        for (const [ts, line] of stream.values || []) {
          const lineStr = typeof line === 'string' ? line : String(line);
          if (lineStr.length > 5 && lineStr !== String(Number(lineStr))) {
            // Skip pure numeric values (from aggregation queries)
            logSamples.push(lineStr.slice(0, 500));
            const traceMatch = lineStr.match(/trace_id[=: ]+"?([a-f0-9]{16,32})"?/i);
            if (traceMatch && !traceIds.includes(traceMatch[1])) {
              traceIds.push(traceMatch[1]);
            }
          }
        }
      }
    }
  } catch (err: any) {
    logger.debug('Correlation: failed to fetch error logs', { error: err.message });
  }

  if (logSamples.length > 0) {
    const uniqueSamples = [...new Set(logSamples)].slice(0, 8);
    const logBlock = uniqueSamples.join('\n');

    // Build human-readable source identifiers. Skip labels where the value
    // equals the key (e.g. app=app, job=job) — these are Heroku log drain
    // artefacts and add no information. Also skip internal routing labels
    // (job, service_name) in favour of service/app/namespace identifiers.
    const PREFERRED_LABEL_KEYS = ['app', 'namespace', 'container', 'pod', 'deployment'];
    const seenSources = new Set<string>();
    for (const l of logStreamLabels) {
      const parts = Object.entries(l)
        .filter(([k, v]) => PREFERRED_LABEL_KEYS.includes(k) && v && v !== k)
        .map(([, v]) => v as string);
      if (parts.length) seenSources.add(parts.join('/'));
    }
    const sourceStr = seenSources.size > 0 ? ` Source: **${[...seenSources].slice(0, 3).join(', ')}**` : '';

    sections.push(`### Error Logs (last 5 minutes)\n${uniqueSamples.length} error entries captured.${sourceStr}${traceIds.length > 0 ? ` | ${traceIds.length} trace(s) found.` : ''}\n\n\`\`\`\n${logBlock}\n\`\`\``);
    entries.push({
      type: 'ai_insight',
      message: `Correlated ${uniqueSamples.length} error log lines. ${traceIds.length > 0 ? `Trace IDs: ${traceIds.slice(0, 5).join(', ')}` : 'No trace IDs found.'}`,
      metadata: { trace_ids: traceIds.slice(0, 10), log_sample_count: uniqueSamples.length },
    });
  }

  // ── 2. Fetch trace details from Tempo ──
  const traceDetails: Array<{ traceId: string; rootService: string; rootName: string; durationMs: number; spanCount: number; errorSpans: string[] }> = [];
  for (const tid of traceIds.slice(0, 3)) {
    try {
      const resp = await fetch(`${tempoUrl}/api/traces/${tid}`, {
        headers: { 'X-Scope-OrgID': tenantId, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const traceJson: any = await resp.json();
        // Parse Tempo trace response (batches > scopeSpans > spans)
        let rootService = 'unknown';
        let rootName = 'unknown';
        let totalSpans = 0;
        let minStart = Infinity;
        let maxEnd = 0;
        const errors: string[] = [];

        for (const batch of traceJson.batches || traceJson.resourceSpans || []) {
          const svcAttr = (batch.resource?.attributes || []).find((a: any) => a.key === 'service.name');
          const svcName = svcAttr?.value?.stringValue || 'unknown';
          for (const scopeSpan of batch.scopeSpans || batch.instrumentationLibrarySpans || []) {
            for (const span of scopeSpan.spans || []) {
              totalSpans++;
              const startNano = parseInt(span.startTimeUnixNano || '0', 10);
              const endNano = parseInt(span.endTimeUnixNano || '0', 10);
              if (startNano < minStart) {
                minStart = startNano;
                rootService = svcName;
                rootName = span.name || 'unknown';
              }
              if (endNano > maxEnd) maxEnd = endNano;
              if (span.status?.code === 2 || span.status?.code === 'STATUS_CODE_ERROR') {
                errors.push(`${svcName}/${span.name}`);
              }
            }
          }
        }

        const durationMs = maxEnd > minStart ? Math.round((maxEnd - minStart) / 1e6) : 0;
        traceDetails.push({ traceId: tid, rootService, rootName, durationMs, spanCount: totalSpans, errorSpans: errors });
      }
    } catch (err: any) {
      logger.debug('Correlation: failed to fetch trace', { traceId: tid, error: err.message });
    }
  }

  if (traceDetails.length > 0) {
    const traceText = traceDetails.map((t) => {
      const status = t.errorSpans.length > 0 ? `**errors in:** ${t.errorSpans.slice(0, 3).join(', ')}` : 'no errors';
      return `| \`${t.traceId.slice(0, 16)}...\` | ${t.rootService} | ${t.rootName} | ${t.durationMs}ms | ${t.spanCount} spans | ${status} |`;
    }).join('\n');
    sections.push(`### Distributed Traces\n| Trace ID | Service | Operation | Duration | Spans | Status |\n|----------|---------|-----------|----------|-------|--------|\n${traceText}`);
    entries.push({
      type: 'ai_insight',
      message: `Fetched ${traceDetails.length} distributed trace(s) from error logs. ${traceDetails.filter((t) => t.errorSpans.length > 0).length} trace(s) contain error spans.`,
      metadata: { traces: traceDetails },
    });
  }

  // ── 3. Fetch metrics snapshot ──
  // Always include the rule's own metric/query first so the snapshot is
  // directly relevant to what triggered the alert. Fall back to generic
  // HTTP + infra queries only for PromQL rules (LogQL rules have no PromQL
  // equivalent to snapshot).
  const metricsQueries: Array<{ label: string; query: string }> = [];

  if (rule.source_type !== 'managed_logql') {
    // The rule's own expression — most relevant data point
    const ruleExpr = rule.query?.trim() || rule.condition.metric;
    if (ruleExpr) {
      const rulePromql = toWindowedPromql(ruleExpr, 5);
      metricsQueries.push({ label: rule.condition.metric || 'Alert Metric', query: rulePromql });
    }
    // Generic HTTP + infra metrics as secondary context
    metricsQueries.push(
      { label: 'Error Rate (5xx)', query: 'sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))' },
      { label: 'Request Rate', query: 'sum(rate(http_server_request_duration_seconds_count[5m]))' },
      { label: 'P99 Latency', query: 'histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le))' },
      { label: 'CPU Usage %', query: 'avg(rate(node_cpu_seconds_total{mode!="idle"}[5m])) * 100' },
      { label: 'Memory Usage %', query: '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100' },
    );
  }

  const metricsSnapshot: Record<string, string> = {};
  for (const mq of metricsQueries) {
    try {
      const result = await queryMimir(mq.query, tenantId, mimirUrl);
      if (result?.value != null) {
        metricsSnapshot[mq.label] = result.value.toFixed(2);
      }
    } catch { /* skip */ }
  }

  if (Object.keys(metricsSnapshot).length > 0) {
    const metricsText = Object.entries(metricsSnapshot).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
    sections.push(`### System Metrics at Alert Time\n| Metric | Value |\n|--------|-------|\n${metricsText}`);
    entries.push({
      type: 'ai_insight',
      message: `Metrics snapshot at alert time: ${Object.entries(metricsSnapshot).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      metadata: { metrics_snapshot: metricsSnapshot },
    });
  }

  const opSymbol: Record<string, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==' };
  const thresholdStr = `${opSymbol[rule.condition.operator] || rule.condition.operator} ${rule.condition.threshold}`;
  const valueStr = rule.source_type === 'managed_logql'
    ? `${alertValue} matching log entries (threshold: ${thresholdStr})`
    : `Current value: **${typeof alertValue === 'number' ? alertValue.toFixed(2) : alertValue}** (threshold: ${thresholdStr})`;

  const description = [
    `${valueStr}`,
    '',
    sections.length > 0 ? '---' : '',
    ...sections,
  ].filter(Boolean).join('\n\n');

  return { description, timelineEntries: entries };
}

async function resolveTempoUrl(tenantId: string): Promise<string> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
    mode: 'byos',
  }).sort({ created_at: -1 });

  if (conn?.endpoints?.traces_url) {
    return conn.endpoints.traces_url;
  }

  return MANAGED_TEMPO_URL;
}

/** Resolve Mimir URL for a tenant — checks BYOS connections, falls back to managed */
async function resolveMimirUrl(tenantId: string): Promise<string> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
    mode: 'byos',
  }).sort({ created_at: -1 });

  if (conn?.endpoints?.metrics_url) {
    return conn.endpoints.metrics_url;
  }

  return MANAGED_MIMIR_URL;
}

interface QueryResult {
  value: number;
  labels: Record<string, string>;
  /** All series returned by the query (used by the evaluator to pick the worst-case offender per the rule's operator). */
  allSeries?: Array<{ value: number; labels: Record<string, string> }>;
}

/** Query Mimir with proper tenant isolation */
async function queryMimir(promql: string, tenantId: string, mimirUrl: string): Promise<QueryResult | null> {
  const url = `${mimirUrl}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: {
        'X-Scope-OrgID': tenantId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!resp.ok) { await throwOnBadQuery(resp); return null; }

    const json: any = await resp.json();
    if (json.status === 'error') throw new QueryExecutionError(json.error || 'query error', 400);
    if (json.status === 'success' && Array.isArray(json.data?.result) && json.data.result.length > 0) {
      const allSeries: Array<{ value: number; labels: Record<string, string> }> = [];
      for (const r of json.data.result) {
        const v = parseFloat(r.value?.[1]);
        if (isNaN(v)) continue;
        const labels: Record<string, string> = {};
        if (r.metric && typeof r.metric === 'object') {
          for (const [k, val] of Object.entries(r.metric)) {
            if (typeof val === 'string') labels[k] = val;
          }
        }
        allSeries.push({ value: v, labels });
      }
      if (allSeries.length === 0) return null;
      // Default to first series; the evaluator will pick the worst-case
      // offender based on the rule's operator.
      return { value: allSeries[0].value, labels: allSeries[0].labels, allSeries };
    }
    return null;
  } catch (err) {
    // A malformed query must surface; only transient failures resolve to null.
    if (err instanceof QueryExecutionError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve Loki URL for a tenant — checks BYOS connections, falls back to managed */
async function resolveLokiUrl(tenantId: string): Promise<string> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
    mode: 'byos',
  }).sort({ created_at: -1 });

  if (conn?.endpoints?.logs_url) {
    return conn.endpoints.logs_url;
  }

  return MANAGED_LOKI_URL;
}

/** Query Loki with LogQL — uses the instant query API and returns the
 *  scalar/vector value. For bare stream selectors (no aggregation), wraps the
 *  query in sum(count_over_time(... [Xm])) so the result is a single number.
 */
async function queryLoki(logql: string, tenantId: string, lokiUrl: string, windowMinutes: number): Promise<QueryResult | null> {
  // Detect aggregation: if the query already contains an aggregation function
  // (sum, count_over_time, rate, etc.) treat it as a metric query and pass it
  // through. Otherwise wrap a bare stream selector.
  const hasAggregation = /\b(sum|count_over_time|rate|avg|max|min|topk|bottomk|count|bytes_over_time|absent_over_time|quantile_over_time)\s*[({]/.test(logql);
  const wrapped = hasAggregation
    ? logql
    : `sum(count_over_time(${logql} [${windowMinutes}m]))`;

  const params = new URLSearchParams({
    query: wrapped,
    time: String(Date.now() * 1e6),
    limit: '1',
  });
  const url = `${lokiUrl}/loki/api/v1/query?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: {
        'X-Scope-OrgID': tenantId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!resp.ok) { await throwOnBadQuery(resp); return null; }

    const json: any = await resp.json();
    if (json.status === 'error') throw new QueryExecutionError(json.error || 'query error', 400);
    if (json.status !== 'success' || !json.data) return null;

    const resultType = json.data.resultType;
    const result = json.data.result;

    // Empty vector → no data => treat as 0 so "absence" alerts can resolve
    if (resultType === 'vector') {
      if (!Array.isArray(result) || result.length === 0) {
        return { value: 0, labels: {} };
      }
      // Sum across all returned series so per-label fan-out doesn't hide hits
      let total = 0;
      const labels: Record<string, string> = {};
      for (const r of result) {
        const v = parseFloat(r.value?.[1]);
        if (!isNaN(v)) total += v;
        if (Object.keys(labels).length === 0 && r.metric && typeof r.metric === 'object') {
          for (const [k, val] of Object.entries(r.metric)) {
            if (typeof val === 'string') labels[k] = val;
          }
        }
      }
      return { value: total, labels };
    }
    if (resultType === 'scalar' || resultType === 'matrix') {
      const v = parseFloat(Array.isArray(result) ? (result[0]?.value?.[1] ?? result[1]) : result?.[1]);
      if (isNaN(v)) return { value: 0, labels: {} };
      return { value: v, labels: {} };
    }
    // streams (raw log result) — count entries
    if (resultType === 'streams') {
      let total = 0;
      const labels: Record<string, string> = {};
      for (const stream of result || []) {
        total += (stream.values?.length ?? 0);
        if (Object.keys(labels).length === 0 && stream.stream && typeof stream.stream === 'object') {
          for (const [k, v] of Object.entries(stream.stream)) {
            if (typeof v === 'string') labels[k] = v;
          }
        }
      }
      return { value: total, labels };
    }
    return null;
  } catch (err) {
    if (err instanceof QueryExecutionError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function compareValue(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gt':  return value > threshold;
    case 'lt':  return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq':  return value === threshold;
    default:    return false;
  }
}

/** Send a Slack webhook notification */
async function sendSlackWebhook(
  webhookUrl: string,
  rule: IAlertRule,
  value: number,
  state: 'firing' | 'resolved',
  dedupCount: number = 1,
): Promise<void> {
  const isFiring = state === 'firing';
  const { operator, threshold } = rule.condition;
  const opSymbol: Record<string, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==' };

  const color = isFiring
    ? (rule.severity === 'critical' ? '#DC2626' : rule.severity === 'high' ? '#F59E0B' : '#3B82F6')
    : '#16A34A';

  // Build title with dedup info
  let title: string;
  if (isFiring) {
    title = dedupCount > 1
      ? `:rotating_light: *FIRING* — ${rule.name} (fired ${dedupCount} times in last ${Math.round(DEDUP_COOLDOWN_MS / 60_000)} minutes)`
      : `:rotating_light: *FIRING* — ${rule.name}`;
  } else {
    title = dedupCount > 1
      ? `:white_check_mark: *RESOLVED* — ${rule.name} (resolved after ${dedupCount} occurrences)`
      : `:white_check_mark: *RESOLVED* — ${rule.name}`;
  }

  const payload = {
    attachments: [{
      color,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: title,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Severity:*\n${rule.severity.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Current Value:*\n${value.toFixed(4)}` },
            { type: 'mrkdwn', text: `*Condition:*\n${rule.condition.metric} ${opSymbol[operator] || operator} ${threshold}` },
            { type: 'mrkdwn', text: `*Window:*\n${rule.condition.window_minutes}m` },
          ],
        },
        ...(rule.description ? [{
          type: 'context',
          elements: [{ type: 'mrkdwn', text: rule.description }],
        }] : []),
        ...(isFiring ? [{
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: 'Create Incident', emoji: false },
            style: 'primary',
            action_id: 'incident_create_from_alert',
            value: JSON.stringify({
              tenant_id: rule.tenant_id.toString(),
              source_alert_id: rule._id.toString(),
              current_value: value,
              dedup_count: dedupCount,
            }),
          }],
        }] : []),
      ],
    }],
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      logger.error('Slack webhook failed', { ruleId: rule._id, status: resp.status });
    }
  } catch (err: any) {
    logger.error('Slack webhook error', { ruleId: rule._id, error: err.message });
  }
}

/** Result of evaluating one condition of a compound / native-expression rule. */
interface ConditionEval {
  triggered: boolean;
  value: number | null;
  labels: Record<string, string>;
  /** True only when a threshold condition could not be evaluated (metric returned nothing). */
  noData: boolean;
}

/**
 * Evaluate a single query-backed condition (PromQL via Mimir, LogQL via Loki).
 * - operator `expr`: the expression's non-empty result vector IS the fire
 *   signal (Prometheus alerting semantics); an empty result means "not firing",
 *   NOT no-data.
 * - other operators: compare the returned value to the threshold.
 */
async function evaluateQueryCondition(
  rule: IAlertRule,
  cond: { metric: string; operator: string; threshold: number; window_minutes: number; query?: string | null },
  tenantId: string,
): Promise<ConditionEval> {
  const { metric, operator, threshold, window_minutes } = cond;
  const expr = (cond.query && cond.query.trim()) ? cond.query.trim() : metric;

  let result: QueryResult | null = null;
  try {
    if (rule.source_type === 'managed_logql') {
      const lokiUrl = await resolveLokiUrl(tenantId);
      result = await queryLoki(expr, tenantId, lokiUrl, window_minutes);
    } else {
      const promql = toWindowedPromql(expr, window_minutes);
      const mimirUrl = await resolveMimirUrl(tenantId);
      result = await queryMimir(promql, tenantId, mimirUrl);
    }
  } catch (err) {
    if (err instanceof QueryExecutionError) {
      // A malformed query cannot be evaluated — log it and mark this condition
      // no-data so the rule surfaces as `no_data` instead of firing an `absent`
      // rule or silently staying OK.
      logger.warn('alert rule condition query rejected by backend', { ruleId: (rule as any)._id?.toString?.(), expr, error: err.message });
      return { triggered: false, value: null, labels: {}, noData: true };
    }
    throw err;
  }

  // Worst-case series selection per operator (mirrors the single-condition path).
  if (result?.allSeries && result.allSeries.length > 1) {
    let chosen = result.allSeries[0];
    for (const s of result.allSeries) {
      if (operator === 'gt' || operator === 'gte' || operator === 'expr') {
        if (s.value > chosen.value) chosen = s;
      } else if (operator === 'lt' || operator === 'lte') {
        if (s.value < chosen.value) chosen = s;
      } else if (operator === 'eq') {
        if (s.value === threshold) { chosen = s; break; }
      }
    }
    result.value = chosen.value;
    result.labels = chosen.labels;
  }

  if (operator === 'expr') {
    // Native expression = fire on a matching result. For PromQL an empty result
    // vector is null (not firing); for LogQL queryLoki coalesces empties to
    // value 0, so fire when the aggregated count/rate is > 0.
    const triggeredExpr = rule.source_type === 'managed_logql'
      ? (result?.value ?? 0) > 0
      : result !== null;
    return { triggered: triggeredExpr, value: result?.value ?? null, labels: result?.labels ?? {}, noData: false };
  }
  if (operator === 'absent') {
    // Inverse of `expr`: fire when the query returns NOTHING. For PromQL an
    // empty result vector is null; for LogQL an empty vector coalesces to 0.
    // A backend query error was already turned into no-data above, so `absent`
    // never fires on a broken query.
    const isAbsent = rule.source_type === 'managed_logql'
      ? (result?.value ?? 0) === 0
      : result === null;
    return { triggered: isAbsent, value: result?.value ?? null, labels: result?.labels ?? {}, noData: false };
  }
  if (!result) {
    return { triggered: false, value: null, labels: {}, noData: true };
  }
  return { triggered: compareValue(result.value, operator, threshold), value: result.value, labels: result.labels, noData: false };
}

async function evaluateRule(rule: IAlertRule): Promise<void> {
  const tenantId = rule.tenant_id.toString();
  const { metric, operator, threshold, window_minutes } = rule.condition;

  let result: QueryResult | null = null;

  if (rule.source_type === 'byos_webhook') {
    // Webhook rules are event-driven via the public ingress endpoint and do not
    // participate in polling evaluation.
    return;
  }

  // Compound (`conditions[]`) or native-expression (`operator === 'expr'`) rules
  // are evaluated per-condition and combined with AND/OR. Only query-backed
  // sources support this; synthetic/webhook keep the single-value path below.
  const conditionList = rule.conditions && rule.conditions.length > 0 ? rule.conditions : null;
  const isMultiEval =
    (rule.source_type === 'managed_promql' || rule.source_type === 'managed_logql') &&
    (conditionList !== null || rule.condition.operator === 'expr' || rule.condition.operator === 'absent');
  let multiEvalTriggered = false;

  if (isMultiEval) {
    const conds = conditionList ?? [rule.condition];
    const logic = rule.condition_logic === 'or' ? 'or' : 'and';
    const evals: ConditionEval[] = [];
    for (const c of conds) {
      evals.push(await evaluateQueryCondition(rule, c, tenantId));
    }
    const evaluable = evals.filter((e) => !e.noData);
    if (evaluable.length === 0) {
      // Every condition returned no data — fall through to the no_data path.
      result = null;
    } else {
      multiEvalTriggered = logic === 'and'
        ? evals.every((e) => e.triggered)
        : evals.some((e) => e.triggered);
      // Representative value/labels: the first triggered condition, else the
      // first evaluable one. Coalesce a null value (empty expr result) to 0 so
      // an evaluated-but-not-firing rule doesn't get mistaken for no_data.
      const rep = evals.find((e) => e.triggered) ?? evaluable[0];
      result = { value: rep.value ?? 0, labels: rep.labels };
    }
  } else if (rule.source_type === 'synthetic') {
    const check = (rule as any).synthetic_check_id
      ? await SyntheticCheck.findOne({ _id: (rule as any).synthetic_check_id, tenant_id: rule.tenant_id }).lean()
      : (rule.service_id
          ? await SyntheticCheck.findOne({ tenant_id: rule.tenant_id, service_id: rule.service_id, status: 'active' }).sort({ name: 1 }).lean()
          : null);

    if (check) {
      const field = (rule.query?.trim() || metric || 'consecutive_failures').trim();
      let value: number | null = null;
      switch (field) {
        case 'consecutive_failures':
          value = check.consecutive_failures ?? 0;
          break;
        case 'last_response_time_ms':
          value = check.last_response_time_ms ?? null;
          break;
        case 'uptime_1h':
          value = check.uptime_1h ?? null;
          break;
        case 'uptime_24h':
          value = check.uptime_24h ?? null;
          break;
        case 'uptime_7d':
          value = check.uptime_7d ?? null;
          break;
        case 'uptime_30d':
          value = (check as any).uptime_30d ?? null;
          break;
        case 'uptime_90d':
          value = (check as any).uptime_90d ?? null;
          break;
        case 'status':
          value = check.last_status === 'down' ? 2 : check.last_status === 'degraded' ? 1 : check.last_status === 'up' ? 0 : null;
          break;
        default:
          value = check.consecutive_failures ?? 0;
          break;
      }

      if (value !== null) {
        result = {
          value,
          labels: {
            check_id: (check as any)._id.toString(),
            check_name: check.name,
            check_type: check.type,
            last_status: check.last_status || 'unknown',
          },
        };
      }
    }
  } else if (rule.source_type === 'managed_logql') {
    // LogQL-based alert: query Loki for matching log lines
    const logql = rule.query || metric;
    const lokiUrl = await resolveLokiUrl(tenantId);
    try {
      result = await queryLoki(logql, tenantId, lokiUrl, window_minutes);
    } catch (err) {
      if (!(err instanceof QueryExecutionError)) throw err;
      logger.warn('alert rule LogQL query rejected by backend', { ruleId: (rule as any)._id?.toString?.(), logql, error: err.message });
      result = null; // falls through to the no_data path below
    }
  } else {
    // PromQL-based alert: query Mimir.
    // Prefer the rule's full query expression (set by predefined templates and
    // the rule editor). Fall back to the bare condition.metric for legacy
    // rules that only stored a metric name — wrap raw names in avg_over_time.
    const expr = rule.query && rule.query.trim() ? rule.query : metric;
    const promql = toWindowedPromql(expr, window_minutes);
    const mimirUrl = await resolveMimirUrl(tenantId);
    try {
      result = await queryMimir(promql, tenantId, mimirUrl);
    } catch (err) {
      if (!(err instanceof QueryExecutionError)) throw err;
      logger.warn('alert rule PromQL query rejected by backend', { ruleId: (rule as any)._id?.toString?.(), promql, error: err.message });
      result = null; // falls through to the no_data path below
    }
  }

  // Pick the worst-case series for multi-series Prom results so per-instance
  // / per-pod alerts fire on ANY breaching series, not just the first one
  // returned. "Worst-case" depends on the rule's operator: max for gt/gte,
  // min for lt/lte, any matching for eq.
  if (result?.allSeries && result.allSeries.length > 1) {
    let chosen = result.allSeries[0];
    for (const s of result.allSeries) {
      if (operator === 'gt' || operator === 'gte') {
        if (s.value > chosen.value) chosen = s;
      } else if (operator === 'lt' || operator === 'lte') {
        if (s.value < chosen.value) chosen = s;
      } else if (operator === 'eq') {
        if (s.value === threshold) { chosen = s; break; }
      }
    }
    result.value = chosen.value;
    result.labels = chosen.labels;
  }

  const value = result?.value ?? null;
  const queryLabels = result?.labels ?? {};

  // Update last_value regardless
  const updateFields: Record<string, any> = {};

  if (value === null) {
    // No data — mark as no_data if was previously ok
    if (rule.alert_state !== 'no_data') {
      updateFields.alert_state = 'no_data';
      updateFields.last_value = null;
    }
    // Clear any in-flight pending window: when the metric returns, the
    // for_duration timer should restart from zero rather than firing
    // instantly because of stale pending_since from before the gap.
    if ((rule as any).pending_since || (rule as any).pending_fingerprint) {
      updateFields.pending_since = null;
      updateFields.pending_fingerprint = null;
    }
    if (Object.keys(updateFields).length > 0) {
      await AlertRule.updateOne({ _id: rule._id }, { $set: updateFields });
    }
    return;
  }

  updateFields.last_value = value;
  // Store the metric labels from the query result
  if (Object.keys(queryLabels).length > 0) {
    updateFields.last_firing_labels = queryLabels;
  }
  const triggered = isMultiEval ? multiEvalTriggered : compareValue(value, operator, threshold);
  const previousState = rule.alert_state || 'ok';

  // Compute dedup fingerprint from rule ID + firing labels.
  // For LogQL rules the stream labels vary per-poll (fan-out across Heroku dyno
  // streams etc.), so using them in the fingerprint causes a new "first
  // occurrence" on every tick and bypasses dedup entirely. Use only the rule ID
  // for LogQL so the fingerprint is stable across evaluations.
  const fingerprintLabels = rule.source_type === 'managed_logql' ? {} : queryLabels;
  const fingerprint = computeFingerprint(rule._id.toString(), fingerprintLabels);
  const now = Date.now();

  if (triggered) {
    // ---- for_duration_seconds gating (Prometheus `for:` semantics) ----
    const forMs = (rule.for_duration_seconds || 0) * 1000;
    if (forMs > 0) {
      const currentPendingFp = (rule as any).pending_fingerprint as string | null;
      const currentPendingSince = (rule as any).pending_since ? new Date((rule as any).pending_since).getTime() : null;

      if (previousState !== 'firing') {
        if (!currentPendingSince || currentPendingFp !== fingerprint) {
          // First breach (or fingerprint changed) — start pending window, don't fire yet
          updateFields.alert_state = 'pending';
          updateFields.pending_since = new Date(now);
          updateFields.pending_fingerprint = fingerprint;
          logger.debug(`Alert rule "${rule.name}" entering pending state (for=${rule.for_duration_seconds}s)`, {
            ruleId: rule._id, tenantId, fingerprint,
          });
          if (Object.keys(updateFields).length > 0) {
            await AlertRule.updateOne({ _id: rule._id }, { $set: updateFields });
          }
          return;
        }
        if (now - currentPendingSince < forMs) {
          // Still within pending window — stay pending, don't fire yet
          updateFields.alert_state = 'pending';
          logger.debug(`Alert rule "${rule.name}" still pending (${Math.round((now - currentPendingSince) / 1000)}s / ${rule.for_duration_seconds}s)`, {
            ruleId: rule._id, tenantId,
          });
          if (Object.keys(updateFields).length > 0) {
            await AlertRule.updateOne({ _id: rule._id }, { $set: updateFields });
          }
          return;
        }
        // Pending duration elapsed — transition to firing below; clear pending markers
        updateFields.pending_since = null;
        updateFields.pending_fingerprint = null;
      }
    }

    updateFields.alert_state = 'firing';

    // ---- Silence check ----
    // Skip notification/incident creation if rule is currently silenced
    const nowDate = new Date();
    const activeSilence = (rule.active_silences || []).find((s: any) => {
      const start = s.start ? new Date(s.start) : null;
      const end = s.end ? new Date(s.end) : null;
      return start && end && nowDate >= start && nowDate <= end;
    });
    if (activeSilence) {
      logger.debug(`Alert rule "${rule.name}" is silenced until ${activeSilence.end} — skipping notification`, {
        ruleId: rule._id, tenantId,
      });
      // Update last_value but don't create incident or notification
      if (Object.keys(updateFields).length > 0) {
        await AlertRule.updateOne({ _id: rule._id }, { $set: updateFields });
      }
      return;
    }

    // ---- Persistent cooldown check (survives API restarts) ----
    // If the rule was triggered recently, skip re-firing for the cooldown window
    if (rule.last_triggered_at) {
      const lastTriggered = new Date(rule.last_triggered_at).getTime();
      if (now - lastTriggered < DEDUP_COOLDOWN_MS) {
        logger.debug(`Alert rule "${rule.name}" in persistent cooldown (last triggered ${Math.round((now - lastTriggered) / 1000)}s ago)`, {
          ruleId: rule._id, tenantId,
        });
        if (Object.keys(updateFields).length > 0) {
          await AlertRule.updateOne({ _id: rule._id }, { $set: updateFields });
        }
        return;
      }
    }

    // ---- Deduplication logic (in-memory, for label-level dedup) ----
    const existing = dedupMap.get(fingerprint);
    let dedupCount = 1;
    let shouldNotify = false;

    if (existing) {
      // Increment count and update lastSeenAt
      existing.count++;
      existing.lastSeenAt = now;
      dedupCount = existing.count;

      // Only notify if cooldown has elapsed
      if (now - existing.lastNotifiedAt >= DEDUP_COOLDOWN_MS) {
        shouldNotify = true;
        existing.lastNotifiedAt = now;
      }
      // else: skip notification, just count
    } else {
      // First occurrence — always notify
      dedupMap.set(fingerprint, {
        firstFiredAt: now,
        lastNotifiedAt: now,
        lastSeenAt: now,
        count: 1,
      });
      shouldNotify = true;
    }

    if (shouldNotify) {
      logger.info(`Alert rule triggered: "${rule.name}" (value=${value}, threshold=${operator} ${threshold}, dedupCount=${dedupCount})`, {
        ruleId: rule._id, tenantId, fingerprint,
      });

      updateFields.last_triggered_at = new Date();
      updateFields.trigger_count = (rule.trigger_count || 0) + 1;

      // Build dedup-aware message fragments
      const dedupSuffix = dedupCount > 1
        ? ` Alert fired ${dedupCount} times in last ${Math.round(DEDUP_COOLDOWN_MS / 60_000)} minutes.`
        : '';

      // Send Slack webhook
      if (rule.webhook_url) {
        await sendSlackWebhook(rule.webhook_url, rule, value, 'firing', dedupCount);
      }

      // In-app notification
      const ruleCreator = await resolveRuleCreator(rule);
      if (ruleCreator) {
        try {
          await notificationService.createNotification({
            tenant_id: rule.tenant_id as any,
            user_id: ruleCreator as any,
            type: 'alert',
            title: `Alert: ${rule.name}`,
            body: `Alert rule "${rule.name}" triggered. Current value: ${value.toFixed(2)} (threshold: ${operator} ${threshold}).${dedupSuffix}`,
            resource_type: 'alert_rule',
            resource_id: rule._id.toString(),
          });
        } catch (err: any) {
          logger.error('Failed to create alert notification', { ruleId: rule._id, error: err.message });
        }
      }

      // Trigger AI agents: incident-triage + alert-intelligence
      const tenantStr = (rule.tenant_id as any).toString();
      publishAgentTrigger('incident-triage', {
        type: 'event', event_type: 'alert.fired', source_id: rule._id.toString(),
      }, tenantStr).catch((err: any) => logger.error('Agent trigger failed (triage)', { error: err.message }));
      publishAgentTrigger('alert-intelligence', {
        type: 'event', event_type: 'alert.fired', source_id: rule._id.toString(),
      }, tenantStr).catch((err: any) => logger.error('Agent trigger failed (alert-intel)', { error: err.message }));

      // Auto-create incident (skip if an open incident already exists for this alert,
      // OR if an incident was recently resolved/closed within the cooldown window —
      // this prevents duplicate incidents from being created right after manual resolution)
      if (rule.auto_create_incident && ruleCreator) {
        try {
          const cooldownAgo = new Date(Date.now() - DEDUP_COOLDOWN_MS);
          const existingIncident = await Incident.findOne({
            tenant_id: rule.tenant_id,
            source_alert_id: rule._id,
            $or: [
              { status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] } },
              {
                status: { $in: ['resolved', 'closed'] },
                // mongoose timestamps:true creates camelCase updatedAt;
                // querying snake_case updated_at would silently never match.
                updatedAt: { $gte: cooldownAgo },
              },
            ],
          });

          if (!existingIncident) {
            const sevMap: Record<string, number> = { sev1: 1, sev2: 2, sev3: 3, sev4: 4 };

            // Resolve escalation_policy_id: rule routing > linked service
            let escalationPolicyId: string | undefined;
            if (rule.routing?.escalation_policy_id) {
              escalationPolicyId = rule.routing.escalation_policy_id.toString();
            } else if (rule.service_id) {
              const svc = await Service.findById(rule.service_id);
              if (svc?.escalation_policy_id) {
                escalationPolicyId = svc.escalation_policy_id.toString();
              }
            }

            // Correlate: fetch error logs, trace details, and metrics snapshot
            let correlation: CorrelationData | null = null;
            try {
              correlation = await correlateAlertData(rule, value, tenantId);
            } catch (err: any) {
              logger.debug('Alert correlation failed (non-fatal)', { ruleId: rule._id, error: err.message });
            }

            // Resolve service name for richer incident context
            let serviceName = '';
            if (rule.service_id) {
              const svc = await Service.findById(rule.service_id).select('name type').lean();
              serviceName = svc ? (svc as any).name : '';
            }

            // Build contextual title
            const titleSuffix = serviceName ? ` — ${serviceName}` : (queryLabels.pod ? ` — ${queryLabels.pod}` : '');
            const incTitle = `[Alert] ${rule.name}${titleSuffix}`;

            // Build SRE-actionable incident description
            const sevLabels: Record<string, string> = { critical: 'SEV1 — Critical', high: 'SEV2 — High', medium: 'SEV3 — Medium', low: 'SEV4 — Low' };
            const opSymbolMap: Record<string, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==' };

            // Summary section
            const summaryParts: string[] = [];
            if (rule.source_type === 'managed_logql') {
              summaryParts.push(`**${value}** error log entries detected in the monitoring window, exceeding the threshold of ${opSymbolMap[operator] || operator} ${threshold}.`);
            } else {
              summaryParts.push(`Metric breached threshold: current value **${typeof value === 'number' ? value.toFixed(2) : value}** (threshold: ${opSymbolMap[operator] || operator} ${threshold}).`);
            }
            if (serviceName) summaryParts.push(`Affected service: **${serviceName}**`);

            // Infrastructure context
            const infraParts: string[] = [];
            const infraMap: [string, string | undefined][] = [
              ['Instance', queryLabels.instance],
              ['Node', queryLabels.node],
              ['Namespace', queryLabels.namespace],
              ['Pod', queryLabels.pod],
              ['Container', queryLabels.container],
              ['Deployment', queryLabels.deployment],
              ['DaemonSet', queryLabels.daemonset],
              ['StatefulSet', queryLabels.statefulset],
              ['HPA', queryLabels.horizontalpodautoscaler],
              ['PVC', queryLabels.persistentvolumeclaim],
              ['Job', queryLabels.job],
              ['K8s Job', queryLabels.job_name],
              ['Ingress', queryLabels.ingress],
              ['Device', queryLabels.device],
              ['Mountpoint', queryLabels.mountpoint],
              ['Interface', queryLabels.ifName],
              ['BGP Peer', queryLabels.bgpPeerRemoteAddr],
              ['Sensor', queryLabels.entPhysicalDescr],
              ['Sysname', queryLabels.sysname || queryLabels.sysName],
              ['GPU', queryLabels.gpu],
              ['Stream', queryLabels.stream_name],
              ['Consumer', queryLabels.consumer_name],
              ['EC2 Instance', queryLabels.dimension_InstanceId],
              ['RDS Instance', queryLabels.dimension_DBInstanceIdentifier],
              ['Lambda Function', queryLabels.dimension_FunctionName],
              ['Load Balancer', queryLabels.dimension_LoadBalancer],
              ['SQS Queue', queryLabels.dimension_QueueName],
              ['Dest IP', queryLabels.dest_ip],
              ['Dest Port', queryLabels.dest_port],
              ['Service', queryLabels.service_name || queryLabels.service],
              ['Resource', queryLabels.resource],
              ['Reason', queryLabels.reason],
            ];
            const activeInfra = infraMap.filter(([, v]) => v);
            if (activeInfra.length > 0) {
              infraParts.push('### Infrastructure');
              infraParts.push('| Component | Value |');
              infraParts.push('|-----------|-------|');
              for (const [label, val] of activeInfra) {
                infraParts.push(`| ${label} | \`${val}\` |`);
              }
            }

            // Suggested investigation steps
            const investigationSteps: string[] = ['### Investigation'];
            if (rule.source_type === 'managed_logql') {
              investigationSteps.push('1. Check the **Observability** tab on this incident for full error logs');
              investigationSteps.push('2. Open **Log Explorer** and filter by the affected service');
              if (serviceName) investigationSteps.push(`3. Check \`${serviceName}\` deployment status and recent changes`);
              investigationSteps.push(`${serviceName ? '4' : '3'}. Review **Metrics Explorer** for correlated resource spikes (CPU, memory, connections)`);
            } else {
              investigationSteps.push(`1. Check the **Observability** tab for live metrics and logs`);
              if (queryLabels.pod) investigationSteps.push(`2. Inspect pod: \`kubectl describe pod ${queryLabels.pod}${queryLabels.namespace ? ' -n ' + queryLabels.namespace : ''}\``);
              if (queryLabels.deployment) investigationSteps.push(`${queryLabels.pod ? '3' : '2'}. Check deployment: \`kubectl rollout status deployment/${queryLabels.deployment}${queryLabels.namespace ? ' -n ' + queryLabels.namespace : ''}\``);
              if (serviceName) investigationSteps.push(`${queryLabels.pod ? '4' : queryLabels.deployment ? '3' : '2'}. Review recent changes to **${serviceName}** in the Changes page`);
            }

            const descParts = [
              summaryParts.join(' '),
              '',
              ...infraParts,
              '',
              ...investigationSteps,
              '',
              correlation?.description || '',
            ].filter((s) => s !== undefined);

            const fullDesc = descParts.join('\n');

            // Carry select rule labels onto the incident so the correlator can
            // group related signals (e.g. heroku_dyno_memory groups H18+R14+R15).
            // rule.labels is a Mongoose Map; normalize to a plain object first.
            const ruleLabels: Record<string, string> = rule.labels instanceof Map
              ? Object.fromEntries(rule.labels)
              : ((rule.labels as any) || {});
            const incidentLabels: string[] = [];
            if (ruleLabels.correlation_group) {
              incidentLabels.push(`correlation_group:${ruleLabels.correlation_group}`);
            }
            if (ruleLabels.code) {
              incidentLabels.push(`code:${ruleLabels.code}`);
            }

            const inc = await incidentService.createIncident({
              tenant_id: rule.tenant_id as any,
              created_by: ruleCreator as any,
              title: incTitle,
              description: `${fullDesc}${dedupSuffix}`,
              severity: sevMap[rule.incident_severity] ?? 3,
              source: 'alert',
              escalation_policy_id: escalationPolicyId,
              affected_service_ids: rule.service_id ? [rule.service_id.toString()] : [],
              labels: incidentLabels.length > 0 ? incidentLabels : undefined,
            });

            // Link the incident back to the alert rule
            await Incident.updateOne({ _id: inc._id }, { $set: { source_alert_id: rule._id } });

            // Add correlation timeline entries (traces, metrics, log samples)
            if (correlation?.timelineEntries.length) {
              for (const entry of correlation.timelineEntries) {
                try {
                  await incidentService.addTimelineEntry(
                    rule.tenant_id as any,
                    inc._id.toString(),
                    ruleCreator as any,
                    entry.message,
                    entry.type as any,
                    entry.metadata,
                  );
                } catch { /* best-effort */ }
              }
            }

            logger.info(`Auto-created incident INC-${inc.number} from alert rule "${rule.name}"`, {
              ruleId: rule._id, incidentId: inc._id, tenantId,
              correlated: !!correlation,
              traceCount: correlation?.timelineEntries.filter((e) => e.metadata?.traces).length ?? 0,
            });

            // Set the root service's status through the cascade-aware path —
            // status-cascade.worker.ts owns all downstream propagation from
            // here (respecting DAG criticality and cycle-safety), and appends
            // affected dependents to this incident's affected_service_ids
            // itself as it walks. 'alert' marks this as a trust boundary the
            // cascade engine can propagate past but never silently overwrite
            // or auto-clear — only this alert resolving should clear it.
            if (rule.service_id) {
              const sevStatus = rule.severity === 'critical' ? 'major_outage' : rule.severity === 'high' ? 'partial_outage' : 'degraded';
              await applyAlertStatusToService(tenantId, rule.service_id.toString(), sevStatus, inc._id.toString());
            }
          }
        } catch (err: any) {
          logger.error('Failed to auto-create incident from alert rule', { ruleId: rule._id, error: err.message });
        }
      }
    }
  } else {
    // Condition not met — transition to OK
    updateFields.alert_state = 'ok';

    // Clear any pending window — the breach did not persist
    if ((rule as any).pending_since || (rule as any).pending_fingerprint) {
      updateFields.pending_since = null;
      updateFields.pending_fingerprint = null;
    }

    // Send resolved notification if transitioning from firing
    if (previousState === 'firing') {
      // Clear last_triggered_at on resolve so the cooldown window doesn't
      // block a new incident from being created next time the alert fires
      updateFields.last_triggered_at = null;

      // Retrieve dedup count before removing the fingerprint
      const dedupEntry = dedupMap.get(fingerprint);
      const totalFires = dedupEntry?.count ?? 1;
      dedupMap.delete(fingerprint);

      const resolvedSuffix = totalFires > 1
        ? ` Resolved after ${totalFires} occurrences.`
        : '';

      logger.info(`Alert rule resolved: "${rule.name}" (value=${value}, totalFires=${totalFires})`, { ruleId: rule._id, tenantId });

      if (rule.webhook_url) {
        await sendSlackWebhook(rule.webhook_url, rule, value, 'resolved', totalFires);
      }

      const resolvedRuleCreator = await resolveRuleCreator(rule);
      if (resolvedRuleCreator) {
        try {
          await notificationService.createNotification({
            tenant_id: rule.tenant_id as any,
            user_id: resolvedRuleCreator as any,
            type: 'alert',
            title: `Resolved: ${rule.name}`,
            body: `Alert rule "${rule.name}" has resolved. Current value: ${value.toFixed(2)}.${resolvedSuffix}`,
            resource_type: 'alert_rule',
            resource_id: rule._id.toString(),
          });
        } catch (err: any) {
          logger.error('Failed to create resolved notification', { ruleId: rule._id, error: err.message });
        }
      }

      // Auto-resolve linked incident when alert resolves
      if (rule.auto_create_incident) {
        try {
          const openIncident = await Incident.findOne({
            tenant_id: rule.tenant_id,
            source_alert_id: rule._id,
            status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
          });
          if (openIncident) {
            // Use resolveIncident() so bridge sync, SLA state, and Slack
            // notifications all fire — a raw updateOne bypasses all of that
            // and leaves the provider's mirrored incident open indefinitely.
            const systemActor = resolvedRuleCreator
              || new Types.ObjectId('000000000000000000000000');
            await incidentService.resolveIncident(
              openIncident.tenant_id as Types.ObjectId,
              openIncident._id.toString(),
              systemActor as any,
              `Auto-resolved: alert "${rule.name}" is no longer firing.${resolvedSuffix}`,
            );
            logger.info(`Auto-resolved incident INC-${openIncident.number} after alert resolved`, {
              ruleId: rule._id, incidentId: openIncident._id, tenantId,
            });
          }
        } catch (err: any) {
          logger.error('Failed to auto-resolve incident', { ruleId: rule._id, error: err.message });
        }
      }
    }
  }

  if (Object.keys(updateFields).length > 0) {
    await AlertRule.updateOne({ _id: rule._id }, { $set: updateFields });
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rules = await AlertRule.find({ status: 'active' }).lean();
    if (rules.length > 0) {
      logger.debug(`Alert rule worker: evaluating ${rules.length} active rules`);
      for (let i = 0; i < rules.length; i += CONCURRENCY) {
        await Promise.allSettled(
          rules.slice(i, i + CONCURRENCY).map((r) => evaluateRule(r as any)),
        );
      }
    }
  } catch (err: any) {
    logger.error('Alert rule worker tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

export function startAlertRuleWorker(): void {
  logger.info('Starting alert rule worker');
  tick().catch(() => {});
  timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);

  // Start periodic cleanup of stale dedup entries
  cleanupTimer = setInterval(cleanupStaleDedupEntries, DEDUP_CLEANUP_INTERVAL_MS);
}

export function stopAlertRuleWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  dedupMap.clear();
  logger.info('Alert rule worker stopped');
}
