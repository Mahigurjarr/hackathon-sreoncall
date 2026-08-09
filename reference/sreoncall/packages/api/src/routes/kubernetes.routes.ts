import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { ObservabilityConnection } from '../models/observability-connection.model';

const router = Router();

/* ── env vars for managed LGTM ── */
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';
const QUERY_TIMEOUT_MS  = 15_000;

/* ── types ── */

interface K8sEvent {
  timestamp: string;
  severity: 'critical' | 'warning' | 'info';
  namespace: string;
  workload: string;
  pod: string;
  event_type: string;
  message: string;
  source: 'metrics' | 'k8s_api';
}

/* ── helpers ── */

/** Resolve Mimir + Loki endpoints for a tenant */
async function resolveEndpoints(tenantId: string): Promise<{
  metricsUrl: string;
  logsUrl: string;
  orgId: string;
} | null> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
  }).sort({ created_at: -1 });

  if (conn && conn.mode === 'byos' && conn.endpoints) {
    return {
      metricsUrl: conn.endpoints.metrics_url || MANAGED_MIMIR_URL,
      logsUrl:    conn.endpoints.logs_url    || MANAGED_LOKI_URL,
      orgId: tenantId,
    };
  }

  return {
    metricsUrl: MANAGED_MIMIR_URL,
    logsUrl:    MANAGED_LOKI_URL,
    orgId: tenantId,
  };
}

/** Instant query to Mimir */
async function queryMimir(metricsUrl: string, orgId: string, query: string): Promise<any> {
  const params = new URLSearchParams({ query });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${metricsUrl}/prometheus/api/v1/query?${params}`, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Mimir ${resp.status}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Range query to Loki */
async function queryLoki(
  logsUrl: string,
  orgId: string,
  query: string,
  start: string,
  end: string,
  limit: number,
): Promise<any> {
  const params = new URLSearchParams({
    query,
    start,
    end,
    limit: String(limit),
    direction: 'backward',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${logsUrl}/loki/api/v1/query_range?${params}`, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Loki ${resp.status}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Range query to Mimir */
async function queryMimirRange(
  metricsUrl: string,
  orgId: string,
  query: string,
  start: string,
  end: string,
  step: string,
): Promise<any> {
  const params = new URLSearchParams({ query, start, end, step });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${metricsUrl}/prometheus/api/v1/query_range?${params}`, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Mimir ${resp.status}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Classify a K8s event reason into severity */
function classifySeverity(reason: string): 'critical' | 'warning' | 'info' {
  const r = reason.toLowerCase();
  if (r.includes('oomkilled') || r.includes('crashloopbackoff') || r.includes('createcontainererror')) {
    return 'critical';
  }
  if (r.includes('imagepullbackoff') || r.includes('errimagepull') || r.includes('pending') || r.includes('failed')) {
    return 'warning';
  }
  return 'info';
}

/** Infer workload name from pod name */
function inferWorkloadName(podName: string): string {
  // StatefulSet: <name>-<ordinal>  e.g. redis-0
  const ssMatch = podName.match(/^(.+)-(\d+)$/);
  if (ssMatch) return ssMatch[1];

  // Deployment: <name>-<replicaset-hash>-<pod-hash>  e.g. nginx-5d4f7c8b9-xk2j4
  const depMatch = podName.match(/^(.+)-[a-z0-9]+-[a-z0-9]+$/);
  if (depMatch) return depMatch[1];

  // DaemonSet: <name>-<pod-hash>  e.g. fluentd-kzj4x
  const dsMatch = podName.match(/^(.+)-[a-z0-9]+$/);
  if (dsMatch) return dsMatch[1];

  return podName;
}

/* ──────────────────────────────────────────────
   GET /events — K8s events from Mimir + Loki
   ────────────────────────────────────────────── */

const eventsQuerySchema = z.object({
  cluster: z.string().optional(),
  namespace: z.string().optional(),
  severity: z.enum(['critical', 'warning', 'info', 'all']).optional().default('all'),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(200),
});

router.get('/events', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const params = eventsQuerySchema.parse(req.query);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) {
    res.status(400).json({ error: 'No observability connection configured' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const startTs = params.start || String(now - 3600);
  const endTs = params.end || String(now);

  const events: K8sEvent[] = [];

  try {
    // ── Mimir metric-derived events ──
    const nsFilter = params.namespace ? `,namespace="${params.namespace}"` : '';
    const clusterFilter = params.cluster ? `,cluster="${params.cluster}"` : '';
    const extraLabels = `${nsFilter}${clusterFilter}`;

    const mimirQueries = [
      {
        query: `kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerError"${extraLabels}} > 0`,
        eventType: 'container_waiting',
      },
      {
        query: `increase(kube_pod_container_status_restarts_total${extraLabels ? `{${extraLabels.slice(1)}}` : ''}[15m]) > 0`,
        eventType: 'container_restart',
      },
      {
        query: `kube_pod_status_phase{phase=~"Pending|Failed"${extraLabels}} == 1`,
        eventType: 'pod_phase',
      },
    ];

    const mimirResults = await Promise.all(
      mimirQueries.map((mq) => queryMimir(ep.metricsUrl, ep.orgId, mq.query).catch(() => null)),
    );

    for (let i = 0; i < mimirResults.length; i++) {
      const result = mimirResults[i];
      const eventType = mimirQueries[i].eventType;
      if (!result?.data?.result) continue;

      for (const r of result.data.result as Array<{ metric: Record<string, string>; value?: [number, string] }>) {
        const m = r.metric;
        const reason = m.reason || m.phase || eventType;
        const pod = m.pod || '';
        const namespace = m.namespace || '';
        const ts = r.value?.[0] ? new Date(r.value[0] * 1000).toISOString() : new Date().toISOString();

        events.push({
          timestamp: ts,
          severity: classifySeverity(reason),
          namespace,
          workload: inferWorkloadName(pod),
          pod,
          event_type: reason,
          message: `${eventType}: ${reason} on pod ${pod} in ${namespace}`,
          source: 'metrics',
        });
      }
    }

    // ── Loki K8s API events ──
    let lokiQuery = '{job="kubernetes-events"}';
    if (params.namespace) {
      lokiQuery = `{job="kubernetes-events"} |= "${params.namespace}"`;
    }

    const lokiResult = await queryLoki(
      ep.logsUrl,
      ep.orgId,
      lokiQuery,
      String(Number(startTs) * 1e9),
      String(Number(endTs) * 1e9),
      params.limit,
    ).catch(() => null);

    if (lokiResult?.data?.result) {
      for (const stream of lokiResult.data.result as Array<{ stream: Record<string, string>; values: [string, string][] }>) {
        for (const [tsNano, line] of stream.values) {
          let parsed: any = {};
          try {
            parsed = JSON.parse(line);
          } catch {
            // Non-JSON log line — use raw text
          }

          const namespace = parsed.involvedObject?.namespace || stream.stream.namespace || '';
          const pod = parsed.involvedObject?.name || '';
          const reason = parsed.reason || 'Unknown';
          const message = parsed.message || line;
          const ts = new Date(Number(tsNano) / 1e6).toISOString();

          events.push({
            timestamp: ts,
            severity: classifySeverity(reason),
            namespace,
            workload: inferWorkloadName(pod),
            pod,
            event_type: reason,
            message,
            source: 'k8s_api',
          });
        }
      }
    }

    // ── Deduplicate by pod:event_type:source ──
    const seen = new Set<string>();
    const deduped: K8sEvent[] = [];
    for (const e of events) {
      const key = `${e.pod}:${e.event_type}:${e.source}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(e);
      }
    }

    // ── Filter by severity ──
    const filtered = params.severity === 'all'
      ? deduped
      : deduped.filter((e) => e.severity === params.severity);

    // ── Sort by timestamp descending, apply limit ──
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const limited = filtered.slice(0, params.limit);

    res.json({ data: limited });
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'K8s events query failed' });
  }
});

/* ──────────────────────────────────────────────
   GET /workload-metrics — PromQL range queries for a workload
   ────────────────────────────────────────────── */

const workloadMetricsSchema = z.object({
  namespace: z.string().min(1),
  workload: z.string().min(1),
  kind: z.enum(['Deployment', 'StatefulSet', 'DaemonSet']).optional().default('Deployment'),
  start: z.string().optional(),
  end: z.string().optional(),
  step: z.string().optional().default('60s'),
});

router.get('/workload-metrics', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const params = workloadMetricsSchema.parse(req.query);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) {
    res.status(400).json({ error: 'No observability connection configured' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const startTs = params.start || String(now - 3600);
  const endTs = params.end || String(now);

  // Build pod regex based on workload kind
  let podRegex: string;
  switch (params.kind) {
    case 'StatefulSet':
      podRegex = `${params.workload}-[0-9]+`;
      break;
    case 'DaemonSet':
      podRegex = `${params.workload}-[a-z0-9]+`;
      break;
    case 'Deployment':
    default:
      podRegex = `${params.workload}-[a-z0-9]+-[a-z0-9]+`;
      break;
  }

  const selector = `namespace="${params.namespace}",pod=~"${podRegex}"`;

  const queries = {
    cpu: `sum(rate(container_cpu_usage_seconds_total{${selector}}[5m])) by (pod)`,
    memory: `sum(container_memory_working_set_bytes{${selector}}) by (pod)`,
    network_rx: `sum(rate(container_network_receive_bytes_total{${selector}}[5m])) by (pod)`,
    network_tx: `sum(rate(container_network_transmit_bytes_total{${selector}}[5m])) by (pod)`,
    restarts: `sum(increase(kube_pod_container_status_restarts_total{${selector}}[15m])) by (pod)`,
  };

  try {
    const [cpu, memory, network_rx, network_tx, restarts] = await Promise.all(
      Object.values(queries).map((q) =>
        queryMimirRange(ep.metricsUrl, ep.orgId, q, startTs, endTs, params.step).catch(() => null),
      ),
    );

    res.json({
      data: {
        cpu: cpu?.data?.result ?? [],
        memory: memory?.data?.result ?? [],
        network_rx: network_rx?.data?.result ?? [],
        network_tx: network_tx?.data?.result ?? [],
        restarts: restarts?.data?.result ?? [],
      },
    });
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Workload metrics query failed' });
  }
});

export default router;
