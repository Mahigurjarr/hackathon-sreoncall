import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { ObservabilityConnection } from '../models/observability-connection.model';

const router = Router();

router.use(requireTenantType('provider'));

const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';
const MANAGED_TEMPO_URL = process.env.MANAGED_TEMPO_URL || 'http://10.10.1.21:3200';
const QUERY_TIMEOUT_MS  = 30_000;

/* ── helpers ── */

/**
 * Builds the "|"-joined X-Scope-OrgID for managed consumers that have the
 * 'observability' scope on their link. BYOS consumers are excluded — they have
 * separate endpoints that can't participate in a single multi-tenant query.
 *
 * If consumer_id is provided, restricts to that single consumer.
 */
async function resolveConsumerOrgId(
  providerTenantId: string,
  consumerId?: string,
): Promise<{ orgId: string; count: number } | null> {
  const filter: Record<string, any> = {
    provider_tenant_id: providerTenantId,
    status: 'active',
    scope: 'observability',
  };
  if (consumerId) filter.consumer_tenant_id = consumerId;

  const links = await ProviderConsumerLink.find(filter).select('consumer_tenant_id').lean();
  if (links.length === 0) return null;

  const allIds = links.map((l) => String(l.consumer_tenant_id));

  // Remove consumers that have their own BYOS stack — we can't merge them into
  // a single Mimir/Loki query without a fan-out implementation.
  const byos = await ObservabilityConnection.find({
    tenant_id: { $in: allIds },
    mode: 'byos',
    status: { $in: ['connected', 'pending'] },
  })
    .select('tenant_id')
    .lean();
  const byosSet = new Set(byos.map((c) => String(c.tenant_id)));

  const managedIds = allIds.filter((id) => !byosSet.has(id));
  if (managedIds.length === 0) return null;

  return { orgId: managedIds.join('|'), count: managedIds.length };
}

async function proxyFetch(url: string, orgId: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Upstream ${resp.status}: ${body.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ── consumers list ── */

// GET /provider/observability/consumers
// Lists which linked consumers have observability scope and whether they are
// included in cross-tenant queries (managed) or excluded (BYOS).
router.get('/consumers', rbac('tenants:read'), async (req: Request, res: Response) => {
  const links = await ProviderConsumerLink.find({
    provider_tenant_id: req.tenantId,
    status: 'active',
    scope: 'observability',
  })
    .populate('consumer_tenant_id', 'name slug')
    .lean();

  const allIds = links.map((l) => String((l.consumer_tenant_id as any)?._id ?? l.consumer_tenant_id));

  const byos = await ObservabilityConnection.find({
    tenant_id: { $in: allIds },
    mode: 'byos',
    status: { $in: ['connected', 'pending'] },
  })
    .select('tenant_id')
    .lean();
  const byosSet = new Set(byos.map((c) => String(c.tenant_id)));

  res.json({
    data: links.map((l) => {
      const cid = String((l.consumer_tenant_id as any)?._id ?? l.consumer_tenant_id);
      return {
        consumer_id: cid,
        consumer_name: (l.consumer_tenant_id as any)?.name ?? null,
        consumer_slug: (l.consumer_tenant_id as any)?.slug ?? null,
        observability_mode: byosSet.has(cid) ? 'byos' : 'managed',
        included_in_cross_tenant_query: !byosSet.has(cid),
      };
    }),
  });
});

/* ── metrics (PromQL → Mimir) ── */

const metricsQuerySchema = z.object({
  query: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  step: z.string().optional().default('60s'),
  time: z.string().optional(),
  consumer_id: z.string().optional(),
});

// GET /provider/observability/metrics/query
router.get('/metrics/query', rbac('metrics:read'), async (req: Request, res: Response) => {
  const { query, time, consumer_id } = metricsQuerySchema.parse(req.query);
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const params = new URLSearchParams({ query });
  if (time) params.set('time', time);

  try {
    const data = await proxyFetch(
      `${MANAGED_MIMIR_URL}/prometheus/api/v1/query?${params}`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream query failed' });
  }
});

// GET /provider/observability/metrics/query_range
router.get('/metrics/query_range', rbac('metrics:read'), async (req: Request, res: Response) => {
  const { query, start, end, step, consumer_id } = metricsQuerySchema.parse(req.query);
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: start || String(now - 3600),
    end: end || String(now),
    step,
  });

  try {
    const data = await proxyFetch(
      `${MANAGED_MIMIR_URL}/prometheus/api/v1/query_range?${params}`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream range query failed' });
  }
});

// GET /provider/observability/metrics/labels
router.get('/metrics/labels', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  try {
    const data = await proxyFetch(`${MANAGED_MIMIR_URL}/prometheus/api/v1/labels`, resolved.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream labels failed' });
  }
});

// GET /provider/observability/metrics/label/:name/values
router.get('/metrics/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const labelName = req.params['name'] as string;
  const params = new URLSearchParams();
  if (req.query.start) params.set('start', req.query.start as string);
  if (req.query.end) params.set('end', req.query.end as string);
  if (req.query['match[]']) params.set('match[]', req.query['match[]'] as string);

  try {
    const qs = params.toString() ? `?${params}` : '';
    const data = await proxyFetch(
      `${MANAGED_MIMIR_URL}/prometheus/api/v1/label/${encodeURIComponent(labelName)}/values${qs}`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream label values failed' });
  }
});

/* ── logs (LogQL → Loki) ── */

const logsQuerySchema = z.object({
  query: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.string().optional().default('500'),
  direction: z.enum(['forward', 'backward']).optional().default('backward'),
  consumer_id: z.string().optional(),
});

// GET /provider/observability/logs/query_range
router.get('/logs/query_range', rbac('metrics:read'), async (req: Request, res: Response) => {
  const { query, start, end, limit, direction, consumer_id } = logsQuerySchema.parse(req.query);
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: start || String((now - 3600) * 1e9),
    end: end || String(now * 1e9),
    limit,
    direction,
  });

  try {
    const data = await proxyFetch(
      `${MANAGED_LOKI_URL}/loki/api/v1/query_range?${params}`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream logs query failed' });
  }
});

// GET /provider/observability/logs/volume
router.get('/logs/volume', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const query = req.query.query as string;
  if (!query) return res.status(400).json({ error: 'query parameter required' });

  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: (req.query.start as string) || String((now - 3600) * 1e9),
    end: (req.query.end as string) || String(now * 1e9),
    step: (req.query.step as string) || '60s',
  });

  try {
    const data = await proxyFetch(
      `${MANAGED_LOKI_URL}/loki/api/v1/query_range?${params}`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream log volume query failed' });
  }
});

// GET /provider/observability/logs/labels
router.get('/logs/labels', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  try {
    const data = await proxyFetch(`${MANAGED_LOKI_URL}/loki/api/v1/labels`, resolved.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream log labels failed' });
  }
});

// GET /provider/observability/logs/label/:name/values
router.get('/logs/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const labelName = req.params['name'] as string;
  try {
    const data = await proxyFetch(
      `${MANAGED_LOKI_URL}/loki/api/v1/label/${encodeURIComponent(labelName)}/values`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream label values failed' });
  }
});

/* ── traces (TraceQL → Tempo) ── */

// GET /provider/observability/traces
router.get('/traces', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const params = new URLSearchParams();
  if (req.query.q) params.set('q', req.query.q as string);
  if (req.query.start) params.set('start', req.query.start as string);
  if (req.query.end) params.set('end', req.query.end as string);
  if (req.query.limit) params.set('limit', req.query.limit as string);
  if (req.query.minDuration) params.set('minDuration', req.query.minDuration as string);
  if (req.query.maxDuration) params.set('maxDuration', req.query.maxDuration as string);

  try {
    const data = await proxyFetch(`${MANAGED_TEMPO_URL}/api/search?${params}`, resolved.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream trace search failed' });
  }
});

// GET /provider/observability/traces/:traceId
router.get('/traces/:traceId', rbac('metrics:read'), async (req: Request, res: Response) => {
  const consumer_id = req.query.consumer_id as string | undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumer_id);
  if (!resolved) {
    return res.status(400).json({ error: 'No managed consumers with observability scope found' });
  }

  const traceId = req.params['traceId'] as string;
  try {
    const data = await proxyFetch(
      `${MANAGED_TEMPO_URL}/api/traces/${encodeURIComponent(traceId)}`,
      resolved.orgId,
    );
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Upstream trace fetch failed' });
  }
});

export default router;
