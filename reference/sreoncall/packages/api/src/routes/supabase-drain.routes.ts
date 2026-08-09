import { Router, Request, Response } from 'express';
import express from 'express';
import { logger } from '../utils/logger';
import { validateProviderDrainToken } from '../services/provider-drain-auth.service';
import { getDefaultLabels, mergeLabels, enrichLogLine } from '../services/observability-labels.service';

const router = Router();

// Supabase Log Drains post JSON payloads (generic webhook destination, Team/Enterprise feature).
router.use(
  express.raw({ type: ['application/json', 'application/x-ndjson', 'text/plain'], limit: '5mb' }),
);

/**
 * Supabase Log Drain Receiver
 *
 * Supabase (Team / Enterprise) can forward logs to a generic HTTP endpoint via
 * Project Settings → Log Drains → Add destination (type: HTTP).
 *
 * Drain URL format: POST /api/v1/webhooks/supabase/logs/:tenantId/:drainToken
 *
 * Payload is a JSON array of events. Each event typically contains:
 *   {
 *     event_message: "...",
 *     timestamp: <microseconds since epoch>,
 *     metadata: { project_ref, service, level, request_id, ... }
 *   }
 *
 * Services: api, auth, postgres, storage, realtime, functions, postgrest.
 */

interface SupabaseLogEvent {
  event_message?: string;
  message?: string;
  timestamp?: number | string;
  metadata?: Record<string, unknown> | Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface SupabaseMetric {
  name: string;
  value: number;
  projectRef: string;
  service: string;
  statusClass?: string;
  timestamp: number;
}

function extractStatusCode(meta: Record<string, unknown>): number | null {
  if (typeof meta.status_code === 'number') return meta.status_code;
  if (typeof meta.status_code === 'string') return parseInt(meta.status_code, 10) || null;
  const response = meta.response as any;
  if (!response) return null;
  if (typeof response.status_code === 'number') return response.status_code;
  if (Array.isArray(response) && typeof response[0]?.status_code === 'number') return response[0].status_code;
  return null;
}

function extractSupabaseMetrics(events: SupabaseLogEvent[]): SupabaseMetric[] {
  const metrics: SupabaseMetric[] = [];

  for (const evt of events) {
    const meta = flatMetadata(evt.metadata);
    const tsMs = toMillis(evt.timestamp);
    const service = String(meta.service || meta.product || 'supabase');
    const projectRef = String(meta.project_ref || meta.project || '');

    const statusCode = extractStatusCode(meta);
    if (statusCode !== null) {
      const statusClass =
        statusCode >= 500 ? '5xx' :
        statusCode >= 400 ? '4xx' :
        statusCode >= 300 ? '3xx' : '2xx';
      metrics.push({ name: 'supabase_requests_total', value: 1, projectRef, service, statusClass, timestamp: tsMs });
    }

    const level = String(meta.level || meta.severity || '').toLowerCase();
    if (level === 'error') {
      metrics.push({ name: 'supabase_errors_total', value: 1, projectRef, service, timestamp: tsMs });
    }
  }

  return metrics;
}

function buildOTLPPayload(metrics: SupabaseMetric[], tenantId: string): object {
  const byProject = new Map<string, Map<string, SupabaseMetric[]>>();
  for (const m of metrics) {
    const key = m.projectRef || 'unknown';
    if (!byProject.has(key)) byProject.set(key, new Map());
    const byName = byProject.get(key)!;
    if (!byName.has(m.name)) byName.set(m.name, []);
    byName.get(m.name)!.push(m);
  }

  const resourceMetrics = [];
  for (const [projectRef, byName] of byProject) {
    const otlpMetrics = [];
    for (const [metricName, dataPoints] of byName) {
      otlpMetrics.push({
        name: metricName,
        gauge: {
          dataPoints: dataPoints.map((dp) => {
            const attrs: object[] = [
              { key: 'project_ref', value: { stringValue: dp.projectRef } },
              { key: 'service', value: { stringValue: dp.service } },
              { key: 'source', value: { stringValue: 'supabase' } },
              { key: 'tenant_id', value: { stringValue: tenantId } },
            ];
            if (dp.statusClass) {
              attrs.push({ key: 'status_class', value: { stringValue: dp.statusClass } });
            }
            return {
              attributes: attrs,
              timeUnixNano: String(dp.timestamp * 1_000_000),
              asDouble: dp.value,
            };
          }),
        },
      });
    }

    resourceMetrics.push({
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: `supabase/${projectRef}` } },
          { key: 'source', value: { stringValue: 'supabase' } },
          { key: 'tenant_id', value: { stringValue: tenantId } },
        ],
      },
      scopeMetrics: [{ metrics: otlpMetrics }],
    });
  }

  return { resourceMetrics };
}

function flatMetadata(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (Array.isArray(meta)) return (meta[0] as Record<string, unknown>) || {};
  if (typeof meta === 'object') return meta as Record<string, unknown>;
  return {};
}

function toMillis(ts: number | string | undefined): number {
  if (ts == null) return Date.now();
  if (typeof ts === 'number') {
    // Supabase typically sends microseconds since epoch
    if (ts > 1e14) return Math.floor(ts / 1000);
    if (ts > 1e11) return ts;
    return ts * 1000;
  }
  const parsed = new Date(ts).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseSupabaseBody(body: string, contentType: string): SupabaseLogEvent[] {
  if (!body) return [];

  if (contentType.includes('x-ndjson')) {
    return body
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as SupabaseLogEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is SupabaseLogEvent => e !== null);
  }

  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed as SupabaseLogEvent[];
    // Some Supabase payloads wrap the array in { batch: [...] }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray((parsed as any).batch)) return (parsed as any).batch as SupabaseLogEvent[];
      if (Array.isArray((parsed as any).events)) return (parsed as any).events as SupabaseLogEvent[];
      return [parsed as SupabaseLogEvent];
    }
  } catch {
    return [];
  }
  return [];
}

// POST /api/v1/webhooks/supabase/logs/:tenantId/:drainToken
router.post('/:tenantId/:drainToken', async (req: Request, res: Response) => {
  const tenantId = String(req.params['tenantId'] || '');
  const drainToken = String(req.params['drainToken'] || '');
  const contentType = String(req.headers['content-type'] || '');
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body || '');

  const isAuthorized = await validateProviderDrainToken(tenantId, 'supabase', drainToken);
  if (!isAuthorized) {
    logger.warn('Rejected Supabase drain with invalid token', { tenantId });
    res.status(404).send();
    return;
  }

  try {
    const events = parseSupabaseBody(raw, contentType);
    if (events.length === 0) {
      res.status(204).send();
      return;
    }

    const LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';
    const customLabels = await getDefaultLabels(tenantId, 'supabase');
    const streams = events.map((evt) => {
      const meta = flatMetadata(evt.metadata);
      const tsMs = toMillis(evt.timestamp);
      const tsNano = `${tsMs * 1_000_000}`;
      const line = evt.event_message || evt.message || JSON.stringify(evt);
      const service =
        (meta.service as string) ||
        (meta.product as string) ||
        (evt as any).source_type ||
        'supabase';

      const projectRef = String(meta.project_ref || meta.project || '');
      return {
        stream: mergeLabels(
          {
            // Platform-enforced (unified cross-source schema)
            source: 'supabase',
            service_name: projectRef ? `${projectRef}/${service}` : String(service),
            // Supabase-specific, bounded cardinality only
            service: String(service),
            project_ref: projectRef,
            level: String(meta.level || meta.severity || 'info'),
            host: String(meta.host || ''),
            tenant_id: tenantId,
            job: 'supabase',
          },
          customLabels,
        ),
        values: [[
          tsNano,
          enrichLogLine(String(line), {
            request_id: meta.request_id as string | undefined,
            trace_id: meta.trace_id as string | undefined,
          }),
        ]],
      };
    });

    fetch(`${LOKI_URL}/loki/api/v1/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scope-OrgID': tenantId,
      },
      body: JSON.stringify({ streams }),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      logger.warn('Failed to push Supabase logs to Loki', { error: err.message, tenantId });
    });

    // Forward Supabase request metrics to Mimir via OTLP JSON
    const supabaseMetrics = extractSupabaseMetrics(events);
    if (supabaseMetrics.length > 0) {
      const MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
      fetch(`${MIMIR_URL}/otlp/v1/metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scope-OrgID': tenantId,
        },
        body: JSON.stringify(buildOTLPPayload(supabaseMetrics, tenantId)),
        signal: AbortSignal.timeout(5000),
      }).catch((err) => {
        logger.warn('Failed to push Supabase metrics to Mimir', { error: err.message, tenantId });
      });
    }

    logger.debug('Supabase drain received', {
      tenantId,
      events: events.length,
      metrics: supabaseMetrics.length,
      service: flatMetadata(events[0]?.metadata).service,
    });
  } catch (err: any) {
    logger.warn('Supabase drain parse error', { error: err.message, tenantId });
  }

  res.status(200).send('OK');
});

export default router;
