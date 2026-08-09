import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { RumApplication } from '../models/rum-application.model';
import { assertUrlSafe } from '../utils/ssrf-guard';
import { buildRumSummary, filterRumEntriesByAppName } from '../services/rum.service';

const router = Router();

/* ── env vars for managed LGTM ── */
const MANAGED_MIMIR_URL   = process.env.MANAGED_MIMIR_URL   || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL    = process.env.MANAGED_LOKI_URL    || 'http://10.10.1.21:3100';
const MANAGED_TEMPO_URL   = process.env.MANAGED_TEMPO_URL   || 'http://10.10.1.21:3200';
// Stable org ID for the managed LGTM stack. Never changes regardless of tenants.
// BYOS connections use the tenant's own ID instead (see resolveEndpoints below).
const MANAGED_LGTM_ORG_ID = process.env.MANAGED_LGTM_ORG_ID || 'sreoncall';
const QUERY_TIMEOUT_MS  = 30_000;
const INTERNAL_RUM_APP_NAME = process.env.INTERNAL_RUM_APP_NAME || 'sreoncall-web';

/* ── helpers ── */

/** Resolve the LGTM endpoints for a tenant — checks managed env first, then connections */
export async function resolveEndpoints(tenantId: string): Promise<{
  metrics_url: string;
  logs_url: string;
  traces_url: string;
  orgId: string;
} | null> {
  // 1) Check if tenant has a BYOS connection
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

  // 2) Default: managed LGTM — each tenant's data is isolated by their own ID
  return {
    metrics_url: MANAGED_MIMIR_URL,
    logs_url:    MANAGED_LOKI_URL,
    traces_url:  MANAGED_TEMPO_URL,
    orgId: tenantId,
  };
}

/** Proxy a request to an upstream LGTM service */
export async function proxyFetch(url: string, orgId: string): Promise<any> {
  // SSRF protection for BYOS endpoints (managed URLs are internal by design)
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
      throw new Error(`Upstream ${resp.status}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Same as proxyFetch but returns null on 404 instead of throwing (used for scope auto-detection) */
async function proxyFetchMaybe(url: string, orgId: string): Promise<any | null> {
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
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Upstream ${resp.status}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ──────────────────────────────────────────────
   METRICS — PromQL proxy to Mimir
   ────────────────────────────────────────────── */

const metricsQuerySchema = z.object({
  query: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  step: z.string().optional().default('60s'),
  time: z.string().optional(),
});

// Instant query
router.get('/metrics/query', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const { query, time } = metricsQuerySchema.parse(req.query);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const params = new URLSearchParams({ query });
  if (time) params.set('time', time);

  try {
    const data = await proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?${params}`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream query failed' });
  }
});

// Range query
router.get('/metrics/query_range', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const { query, start, end, step } = metricsQuerySchema.parse(req.query);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: start || String(now - 3600),
    end: end || String(now),
    step,
  });

  try {
    const data = await proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query_range?${params}`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream range query failed' });
  }
});

// Label values (for autocomplete)
router.get('/metrics/labels', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  try {
    const data = await proxyFetch(`${ep.metrics_url}/prometheus/api/v1/labels`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream labels failed' });
  }
});

// Label values (for metric name autocomplete and label value dropdowns)
router.get('/metrics/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const labelName = req.params['name'] as string;
  const params = new URLSearchParams();
  if (req.query.start) params.set('start', req.query.start as string);
  if (req.query.end) params.set('end', req.query.end as string);
  if (req.query['match[]']) params.set('match[]', req.query['match[]'] as string);

  try {
    const qs = params.toString() ? `?${params}` : '';
    const data = await proxyFetch(
      `${ep.metrics_url}/prometheus/api/v1/label/${encodeURIComponent(labelName)}/values${qs}`,
      ep.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream label values failed' });
  }
});

// Exemplars
router.get('/metrics/exemplars', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const query = req.query.query as string;
  if (!query) return res.status(400).json({ error: 'query parameter required' });

  const params = new URLSearchParams({ query });
  if (req.query.start) params.set('start', req.query.start as string);
  if (req.query.end) params.set('end', req.query.end as string);

  try {
    const data = await proxyFetch(
      `${ep.metrics_url}/prometheus/api/v1/query_exemplars?${params}`,
      ep.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream exemplars failed' });
  }
});

// Series metadata
router.get('/metrics/series', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const match = (req.query['match[]'] as string) || (req.query.match as string) || '';
  const params = new URLSearchParams();
  if (match) params.set('match[]', match);
  if (req.query.start) params.set('start', req.query.start as string);
  if (req.query.end) params.set('end', req.query.end as string);

  try {
    const data = await proxyFetch(`${ep.metrics_url}/prometheus/api/v1/series?${params}`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream series failed' });
  }
});

/* ──────────────────────────────────────────────
   LOGS — LogQL proxy to Loki
   ────────────────────────────────────────────── */

const logsQuerySchema = z.object({
  query: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.string().optional().default('500'),
  direction: z.enum(['forward', 'backward']).optional().default('backward'),
});

// Log query range
router.get('/logs/query_range', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const { query, start, end, limit, direction } = logsQuerySchema.parse(req.query);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: start || String((now - 3600) * 1e9),
    end: end || String(now * 1e9),
    limit,
    direction,
  });

  try {
    const data = await proxyFetch(`${ep.logs_url}/loki/api/v1/query_range?${params}`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream logs query failed' });
  }
});

// RUM summary from Faro logs stored in Loki
router.get('/rum/summary', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const now = Math.floor(Date.now() / 1000);
  const start = String(req.query.start || (now - 3600));
  const end = String(req.query.end || now);
  const appSlug = typeof req.query.appSlug === 'string' ? req.query.appSlug.trim() : '';
  const latestConnection = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
  }).sort({ created_at: -1 });

  if (latestConnection?.mode === 'byos' && appSlug) {
    return res.status(400).json({
      error: 'RUM application targeting is not supported for BYOS observability connections yet',
    });
  }

  if (latestConnection?.mode === 'byos' && !appSlug) {
    return res.json(buildRumSummary([]));
  }

  let selector = `{signal_source="rum"}`;
  let expectedAppName = INTERNAL_RUM_APP_NAME;

  if (appSlug) {
    const app = await RumApplication.findOne({ tenant_id: tenantId, slug: appSlug, status: 'active' })
      .select('slug')
      .lean();

    if (!app) {
      return res.status(404).json({ error: 'RUM application not found' });
    }

    expectedAppName = `${tenantId}::${app.slug}`;
  }

  const params = new URLSearchParams({
    query: selector,
    start: String(Number(start) * 1e9),
    end: String(Number(end) * 1e9),
    limit: '10000',
    direction: 'forward',
  });

  try {
    const data = await proxyFetch(`${ep.logs_url}/loki/api/v1/query_range?${params}`, MANAGED_LGTM_ORG_ID);
    const result = Array.isArray(data?.data?.result) ? data.data.result as Array<{ values?: [string, string][] }> : [];
    const entries = result.flatMap((stream) =>
      (stream.values || []).map(([timestampNs, line]) => ({ timestampNs, line })),
    );
    res.json(buildRumSummary(filterRumEntriesByAppName(entries, expectedAppName)));
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream rum summary failed' });
  }
});

// Log volume — metric query (count_over_time) with step for histogram
router.get('/logs/volume', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const query = req.query.query as string;
  if (!query) return res.status(400).json({ error: 'query parameter required' });

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: (req.query.start as string) || String((now - 3600) * 1e9),
    end: (req.query.end as string) || String(now * 1e9),
    step: (req.query.step as string) || '60s',
  });

  try {
    const data = await proxyFetch(`${ep.logs_url}/loki/api/v1/query_range?${params}`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream log volume query failed' });
  }
});

// Log labels
router.get('/logs/labels', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  try {
    const data = await proxyFetch(`${ep.logs_url}/loki/api/v1/labels`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream log labels failed' });
  }
});

// Log label values
router.get('/logs/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const labelName = req.params.name as string;
  try {
    const data = await proxyFetch(`${ep.logs_url}/loki/api/v1/label/${encodeURIComponent(labelName)}/values`, ep.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream label values failed' });
  }
});

/* ──────────────────────────────────────────────
   TRACES — TraceQL proxy to Tempo
   ────────────────────────────────────────────── */

// Get trace by ID
router.get('/traces/:traceId', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const traceId = req.params.traceId as string;
  const traceUrl = `${ep.traces_url}/api/traces/${encodeURIComponent(traceId)}`;
  const isByos = ep.orgId === tenantId && !ep.traces_url.startsWith(MANAGED_TEMPO_URL);

  // ?scope=platform → force platform org; ?scope=tenant → force tenant org;
  // no scope → auto-detect: try platform first, then tenant (so a pasted traceId
  // works regardless of which toggle the user has active).
  if (req.query.scope === 'platform') {
    const orgId = isByos ? ep.orgId : MANAGED_LGTM_ORG_ID;
    try {
      const data = await proxyFetch(traceUrl, orgId);
      return res.json(data);
    } catch (err: any) {
      return res.status(502).json({ status: 'error', error: err.message || 'Upstream trace fetch failed' });
    }
  }

  if (req.query.scope === 'tenant') {
    try {
      const data = await proxyFetch(traceUrl, ep.orgId);
      return res.json(data);
    } catch (err: any) {
      return res.status(502).json({ status: 'error', error: err.message || 'Upstream trace fetch failed' });
    }
  }

  // Auto-detect: try platform org first (most traces originate there), then tenant
  try {
    const platformOrgId = isByos ? ep.orgId : MANAGED_LGTM_ORG_ID;
    const platformData = await proxyFetchMaybe(traceUrl, platformOrgId);
    if (platformData !== null) return res.json(platformData);

    // Fallback: try tenant org (for BYOS or tenant-instrumented services)
    if (ep.orgId !== platformOrgId) {
      const tenantData = await proxyFetchMaybe(traceUrl, ep.orgId);
      if (tenantData !== null) return res.json(tenantData);
    }

    return res.status(404).json({ status: 'error', error: 'Trace not found in any org' });
  } catch (err: any) {
    return res.status(502).json({ status: 'error', error: err.message || 'Upstream trace fetch failed' });
  }
});

// Search traces
router.get('/traces', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  // ?scope=platform queries sreoncall-api platform traces on the managed stack
  const orgId = (req.query.scope === 'platform' && !ep.metrics_url.startsWith('http://10.10.1'))
    ? ep.orgId
    : req.query.scope === 'platform'
      ? MANAGED_LGTM_ORG_ID
      : ep.orgId;

  const params = new URLSearchParams();
  if (req.query.q) params.set('q', req.query.q as string);
  if (req.query.start) params.set('start', req.query.start as string);
  if (req.query.end) params.set('end', req.query.end as string);
  if (req.query.limit) params.set('limit', req.query.limit as string);
  if (req.query.minDuration) params.set('minDuration', req.query.minDuration as string);
  if (req.query.maxDuration) params.set('maxDuration', req.query.maxDuration as string);

  try {
    const data = await proxyFetch(`${ep.traces_url}/api/search?${params}`, orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream trace search failed' });
  }
});

// ── Profiles (Pyroscope) ──────────────────────────────────────────────────

const PYROSCOPE_URL = process.env.MANAGED_PYROSCOPE_URL || 'http://10.10.1.21:4040';

// GET /profiles/render — flame graph data
router.get('/profiles/render', rbac('metrics:read'), async (req: Request, res: Response) => {
  const orgId = String((req as any).tenantId);
  const query = req.query.query as string;
  const from = req.query.from as string || String(Math.floor(Date.now() / 1000) - 3600);
  const until = req.query.until as string || String(Math.floor(Date.now() / 1000));
  const format = req.query.format as string || 'json';

  if (!query) {
    res.status(400).json({ error: 'query parameter is required' });
    return;
  }

  const params = new URLSearchParams({ query, from, until, format });
  const url = `${PYROSCOPE_URL}/pyroscope/render?${params}`;

  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Pyroscope returned ${resp.status}` });
      return;
    }
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyroscope query failed: ${err.message}` });
  }
});

// GET /profiles/label-names — available labels
router.get('/profiles/label-names', rbac('metrics:read'), async (req: Request, res: Response) => {
  const orgId = String((req as any).tenantId);
  const from = req.query.from as string || String(Math.floor(Date.now() / 1000) - 3600);
  const until = req.query.until as string || String(Math.floor(Date.now() / 1000));

  const params = new URLSearchParams({ from, until });
  const url = `${PYROSCOPE_URL}/pyroscope/label-names?${params}`;

  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Pyroscope returned ${resp.status}` });
      return;
    }
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyroscope label-names failed: ${err.message}` });
  }
});

// GET /profiles/label-values — values for a label
router.get('/profiles/label-values', rbac('metrics:read'), async (req: Request, res: Response) => {
  const orgId = String((req as any).tenantId);
  const label = req.query.label as string;
  const from = req.query.from as string || String(Math.floor(Date.now() / 1000) - 3600);
  const until = req.query.until as string || String(Math.floor(Date.now() / 1000));

  if (!label) {
    res.status(400).json({ error: 'label parameter is required' });
    return;
  }

  const params = new URLSearchParams({ name: label, from, until });
  const url = `${PYROSCOPE_URL}/pyroscope/label-values?${params}`;

  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Pyroscope returned ${resp.status}` });
      return;
    }
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyroscope label-values failed: ${err.message}` });
  }
});

/* ──────────────────────────────────────────────
   NETWORK TOPOLOGY — LLDP-based device graph
   ────────────────────────────────────────────── */

router.get('/network-topology', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  try {
    // Query device info and LLDP neighbor data in parallel
    const [deviceResults, lldpResults, ifCountResults, bgpResults] = await Promise.all([
      proxyFetch(
        `${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent('last_over_time(snmp_device_info[2h])')}`,
        ep.orgId,
      ),
      proxyFetch(
        `${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent('last_over_time(snmp_lldp_neighbor_info[2h])')}`,
        ep.orgId,
      ),
      proxyFetch(
        `${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent('last_over_time(snmp_device_interface_count[2h])')}`,
        ep.orgId,
      ),
      proxyFetch(
        `${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent('last_over_time(snmp_bgp_peer_count[2h])')}`,
        ep.orgId,
      ),
    ]);

    // Build device nodes
    const deviceMetrics: Array<{ metric: Record<string, string>; value?: [number, string] }> =
      deviceResults?.data?.result ?? [];
    const ifCountMetrics: Array<{ metric: Record<string, string>; value?: [number, string] }> =
      ifCountResults?.data?.result ?? [];
    const bgpMetrics: Array<{ metric: Record<string, string>; value?: [number, string] }> =
      bgpResults?.data?.result ?? [];

    // Build lookup maps
    const ifCountMap = new Map<string, number>();
    for (const r of ifCountMetrics) {
      const ip = r.metric.instance?.replace(/:\d+$/, '') || r.metric.target;
      if (ip) ifCountMap.set(ip, parseInt(r.value?.[1] ?? '0', 10));
    }
    const bgpCountMap = new Map<string, number>();
    for (const r of bgpMetrics) {
      const ip = r.metric.instance?.replace(/:\d+$/, '') || r.metric.target;
      if (ip) bgpCountMap.set(ip, parseInt(r.value?.[1] ?? '0', 10));
    }

    interface TopoNode {
      id: string;
      label: string;
      ip: string;
      device_type: string;
      sys_descr: string;
      sys_location: string;
      interface_count: number;
      bgp_peer_count: number;
      status: 'healthy' | 'unknown';
    }

    interface TopoEdge {
      source: string;
      target: string;
      source_port: string;
      target_port: string;
      neighbor_name: string;
    }

    const nodesMap = new Map<string, TopoNode>();
    for (const r of deviceMetrics) {
      const ip = r.metric.instance?.replace(/:\d+$/, '') || r.metric.target || '';
      const sysName = r.metric.sys_name || ip;
      nodesMap.set(ip, {
        id: ip,
        label: sysName,
        ip,
        device_type: r.metric.device_type || 'snmp_device',
        sys_descr: r.metric.sys_descr || '',
        sys_location: r.metric.sys_location || '',
        interface_count: ifCountMap.get(ip) ?? 0,
        bgp_peer_count: bgpCountMap.get(ip) ?? 0,
        status: 'healthy',
      });
    }

    // Build edges from LLDP data
    const lldpMetrics: Array<{ metric: Record<string, string>; value?: [number, string] }> =
      lldpResults?.data?.result ?? [];

    const edges: TopoEdge[] = [];
    const seenEdges = new Set<string>();

    for (const r of lldpMetrics) {
      const sourceIP = r.metric.instance?.replace(/:\d+$/, '') || r.metric.target || '';
      const neighborName = r.metric.neighbor_name || r.metric.neighbor_chassis_id || '';
      const neighborIP = r.metric.neighbor_mgmt_addr || '';
      const localPort = r.metric.local_port || '';
      const remotePort = r.metric.neighbor_port_id || r.metric.neighbor_port_desc || '';

      // Determine target node ID (prefer IP, fall back to name-based lookup)
      let targetId = neighborIP;
      if (!targetId) {
        // Try to find by sysName match
        for (const [ip, node] of nodesMap) {
          if (node.label === neighborName) {
            targetId = ip;
            break;
          }
        }
      }

      if (!targetId) {
        // Create a placeholder node for the neighbor
        targetId = `lldp:${neighborName || sourceIP + '-neighbor'}`;
        if (!nodesMap.has(targetId)) {
          nodesMap.set(targetId, {
            id: targetId,
            label: neighborName || 'Unknown Neighbor',
            ip: neighborIP || '',
            device_type: 'snmp_device',
            sys_descr: '',
            sys_location: '',
            interface_count: 0,
            bgp_peer_count: 0,
            status: 'unknown',
          });
        }
      }

      // Deduplicate bidirectional edges
      const edgeKey = [sourceIP, targetId].sort().join('<->');
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        edges.push({
          source: sourceIP,
          target: targetId,
          source_port: localPort,
          target_port: remotePort,
          neighbor_name: neighborName,
        });
      }
    }

    res.json({
      nodes: Array.from(nodesMap.values()),
      edges,
    });
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Topology query failed' });
  }
});

/* ──────────────────────────────────────────────
   95TH PERCENTILE BANDWIDTH REPORTING
   ────────────────────────────────────────────── */

const p95ReportSchema = z.object({
  period_days: z.string().optional().default('30'),
  interface_filter: z.string().optional(),
  device_filter: z.string().optional(),
});

router.get('/bandwidth-report', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const { period_days, interface_filter, device_filter } = p95ReportSchema.parse(req.query);
  const days = Math.min(parseInt(period_days, 10) || 30, 90);
  const now = Math.floor(Date.now() / 1000);
  const start = now - days * 86400;

  // Build label matchers
  let selector = '';
  const matchers: string[] = [];
  if (interface_filter) matchers.push(`if_descr=~"${interface_filter}"`);
  if (device_filter) matchers.push(`instance=~"${device_filter}.*"`);
  if (matchers.length > 0) selector = `{${matchers.join(',')}}`;

  try {
    // Query 95th percentile of ingress and egress rates over the period
    // Using rate() over 5m intervals, then quantile_over_time for p95
    const inQuery = `quantile_over_time(0.95, rate(snmp_interface_hc_in_octets${selector}[5m])[${days}d:5m]) * 8`;
    const outQuery = `quantile_over_time(0.95, rate(snmp_interface_hc_out_octets${selector}[5m])[${days}d:5m]) * 8`;
    const avgInQuery = `avg_over_time(rate(snmp_interface_hc_in_octets${selector}[5m])[${days}d:5m]) * 8`;
    const avgOutQuery = `avg_over_time(rate(snmp_interface_hc_out_octets${selector}[5m])[${days}d:5m]) * 8`;
    const maxInQuery = `max_over_time(rate(snmp_interface_hc_in_octets${selector}[5m])[${days}d:5m]) * 8`;
    const maxOutQuery = `max_over_time(rate(snmp_interface_hc_out_octets${selector}[5m])[${days}d:5m]) * 8`;
    const speedQuery = `last_over_time(snmp_interface_high_speed${selector}[2h]) * 1000000`;

    const [p95In, p95Out, avgIn, avgOut, maxIn, maxOut, speeds] = await Promise.all([
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(inQuery)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(outQuery)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(avgInQuery)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(avgOutQuery)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(maxInQuery)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(maxOutQuery)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(speedQuery)}`, ep.orgId),
    ]);

    // Build lookup for interface speeds
    const speedMap = new Map<string, number>();
    for (const r of (speeds?.data?.result ?? []) as Array<{ metric: Record<string, string>; value?: [number, string] }>) {
      const key = `${r.metric.instance}|${r.metric.if_descr || r.metric.if_index}`;
      speedMap.set(key, parseFloat(r.value?.[1] ?? '0'));
    }

    // Build per-interface results
    type MetricResult = { metric: Record<string, string>; value?: [number, string] };

    function buildMap(results: any): Map<string, number> {
      const m = new Map<string, number>();
      for (const r of (results?.data?.result ?? []) as MetricResult[]) {
        const key = `${r.metric.instance}|${r.metric.if_descr || r.metric.if_index}`;
        m.set(key, parseFloat(r.value?.[1] ?? '0'));
      }
      return m;
    }

    const p95InMap = buildMap(p95In);
    const p95OutMap = buildMap(p95Out);
    const avgInMap = buildMap(avgIn);
    const avgOutMap = buildMap(avgOut);
    const maxInMap = buildMap(maxIn);
    const maxOutMap = buildMap(maxOut);

    // Merge all interface keys
    const allKeys = new Set([
      ...p95InMap.keys(), ...p95OutMap.keys(),
      ...avgInMap.keys(), ...avgOutMap.keys(),
    ]);

    interface InterfaceReport {
      device: string;
      interface_name: string;
      speed_bps: number;
      p95_in_bps: number;
      p95_out_bps: number;
      p95_burstable_bps: number;
      avg_in_bps: number;
      avg_out_bps: number;
      max_in_bps: number;
      max_out_bps: number;
      utilization_pct: number;
    }

    const interfaces: InterfaceReport[] = [];
    let totalP95Burstable = 0;

    for (const key of allKeys) {
      const [device, ifName] = key.split('|');
      const p95InVal = p95InMap.get(key) ?? 0;
      const p95OutVal = p95OutMap.get(key) ?? 0;
      const p95Burstable = Math.max(p95InVal, p95OutVal); // burstable billing = higher of in/out
      const speed = speedMap.get(key) ?? 0;

      totalP95Burstable += p95Burstable;

      interfaces.push({
        device: device.replace(/:\d+$/, ''),
        interface_name: ifName || 'unknown',
        speed_bps: speed,
        p95_in_bps: Math.round(p95InVal),
        p95_out_bps: Math.round(p95OutVal),
        p95_burstable_bps: Math.round(p95Burstable),
        avg_in_bps: Math.round(avgInMap.get(key) ?? 0),
        avg_out_bps: Math.round(avgOutMap.get(key) ?? 0),
        max_in_bps: Math.round(maxInMap.get(key) ?? 0),
        max_out_bps: Math.round(maxOutMap.get(key) ?? 0),
        utilization_pct: speed > 0 ? Math.round((p95Burstable / speed) * 10000) / 100 : 0,
      });
    }

    // Sort by p95 burstable descending
    interfaces.sort((a, b) => b.p95_burstable_bps - a.p95_burstable_bps);

    res.json({
      period_days: days,
      start: new Date(start * 1000).toISOString(),
      end: new Date(now * 1000).toISOString(),
      total_interfaces: interfaces.length,
      total_p95_burstable_bps: Math.round(totalP95Burstable),
      total_p95_burstable_mbps: Math.round(totalP95Burstable / 1_000_000 * 100) / 100,
      interfaces,
    });
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Bandwidth report query failed' });
  }
});

/* ──────────────────────────────────────────────
   HEALTH — Check backend connectivity
   ────────────────────────────────────────────── */

router.get('/health', rbac('metrics:read'), async (req: Request, res: Response) => {
  const results: Record<string, { status: string; message: string }> = {};

  async function check(name: string, url: string) {
    try {
      const resp = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(5000) });
      results[name] = { status: resp.ok ? 'ok' : 'error', message: `HTTP ${resp.status}` };
    } catch (err: any) {
      results[name] = { status: 'error', message: err.message || 'unreachable' };
    }
  }

  await Promise.all([
    check('mimir', MANAGED_MIMIR_URL),
    check('loki', MANAGED_LOKI_URL),
    check('tempo', MANAGED_TEMPO_URL),
  ]);

  const allOk = Object.values(results).every((r) => r.status === 'ok');
  res.json({ status: allOk ? 'ok' : 'degraded', services: results });
});

/* ── GET /device-interfaces?device_ip=<ip> — live interface list from Mimir ── */

router.get('/device-interfaces', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const ep = await resolveEndpoints(tenantId);
  if (!ep) return res.status(400).json({ error: 'No observability connection configured' });

  const deviceIp = z.string().min(1).parse(req.query.device_ip);

  try {
    // Query oper status (has all interface labels), speed, and traffic rates in parallel
    const selector = `{device="${deviceIp}"}`;
    const [operRes, speedRes, inRateRes, outRateRes, inErrRes, outErrRes] = await Promise.all([
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(`last_over_time(snmp_interface_oper_status${selector}[2h])`)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(`last_over_time(snmp_interface_speed_bps${selector}[2h])`)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(`rate(snmp_interface_hc_in_octets_total${selector}[5m]) * 8`)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(`rate(snmp_interface_hc_out_octets_total${selector}[5m]) * 8`)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(`rate(snmp_interface_in_errors_total${selector}[5m])`)}`, ep.orgId),
      proxyFetch(`${ep.metrics_url}/prometheus/api/v1/query?query=${encodeURIComponent(`rate(snmp_interface_out_errors_total${selector}[5m])`)}`, ep.orgId),
    ]);

    type MResult = { metric: Record<string, string>; value?: [number, string] };

    // Build lookup by ifindex
    function buildByIndex(results: any): Map<string, number> {
      const m = new Map<string, number>();
      for (const r of (results?.data?.result ?? []) as MResult[]) {
        m.set(r.metric.ifindex ?? '', parseFloat(r.value?.[1] ?? '0'));
      }
      return m;
    }

    const speedMap = buildByIndex(speedRes);
    const inRateMap = buildByIndex(inRateRes);
    const outRateMap = buildByIndex(outRateRes);
    const inErrMap = buildByIndex(inErrRes);
    const outErrMap = buildByIndex(outErrRes);

    const interfaces = ((operRes?.data?.result ?? []) as MResult[]).map((r) => {
      const idx = r.metric.ifindex ?? '';
      const operStatus = parseFloat(r.value?.[1] ?? '0');
      return {
        ifindex: idx,
        ifdescr: r.metric.ifdescr ?? '',
        ifname: r.metric.ifname ?? '',
        ifalias: r.metric.ifalias ?? '',
        oper_status: operStatus === 1 ? 'up' : operStatus === 2 ? 'down' : 'unknown',
        speed_bps: speedMap.get(idx) ?? 0,
        in_bps: inRateMap.get(idx) ?? 0,
        out_bps: outRateMap.get(idx) ?? 0,
        in_errors_per_sec: inErrMap.get(idx) ?? 0,
        out_errors_per_sec: outErrMap.get(idx) ?? 0,
      };
    });

    // Sort: up interfaces first, then by ifindex numerically
    interfaces.sort((a, b) => {
      if (a.oper_status !== b.oper_status) return a.oper_status === 'up' ? -1 : 1;
      return parseInt(a.ifindex || '0', 10) - parseInt(b.ifindex || '0', 10);
    });

    res.json({ interfaces, count: interfaces.length });
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query interface metrics' });
  }
});

export default router;
