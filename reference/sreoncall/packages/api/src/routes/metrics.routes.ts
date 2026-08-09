/**
 * Metrics proxy — forwards PromQL queries to local Mimir (:9009)
 * Mimir exposes a Prometheus-compatible API at /prometheus
 */
import http from 'http';
import { Router, Request, Response } from 'express';
import { rbac } from '../middleware/rbac.middleware';

const router = Router();
const MIMIR_BASE   = process.env.MIMIR_URL   ?? 'http://127.0.0.1:9009/prometheus';
const LOKI_BASE    = process.env.LOKI_URL    ?? 'http://127.0.0.1:3100';
const MIMIR_ORG_ID = process.env.MIMIR_ORG_ID ?? 'platform';

function proxyGet(targetUrl: string, res: Response): void {
  const parsed = new URL(targetUrl);
  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || 80,
    path:     parsed.pathname + parsed.search,
    method:   'GET',
    headers:  {
      'Content-Type': 'application/json',
      'X-Scope-OrgID': MIMIR_ORG_ID,
    },
    timeout:  15000,
  };

  const req = http.request(options, (upstream) => {
    res.status(upstream.statusCode ?? 200);
    upstream.pipe(res);
  });

  req.on('error', (err) => {
    res.status(502).json({ error: 'Upstream unavailable', detail: err.message });
  });
  req.on('timeout', () => {
    req.destroy();
    res.status(504).json({ error: 'Upstream timeout' });
  });
  req.end();
}

// ─── Prometheus / Mimir ────────────────────────────────────────────────────────

// GET /api/v1/metrics/query?query=<promql>&time=<unix>
router.get('/query', rbac('metrics:read'), (req: Request, res: Response) => {
  const qs = new URLSearchParams(req.query as any).toString();
  proxyGet(`${MIMIR_BASE}/api/v1/query?${qs}`, res);
});

// GET /api/v1/metrics/query_range?query=<promql>&start=&end=&step=
router.get('/query_range', rbac('metrics:read'), (req: Request, res: Response) => {
  const qs = new URLSearchParams(req.query as any).toString();
  proxyGet(`${MIMIR_BASE}/api/v1/query_range?${qs}`, res);
});

// GET /api/v1/metrics/label/__name__/values — list metric names
router.get('/label/__name__/values', rbac('metrics:read'), (req: Request, res: Response) => {
  proxyGet(`${MIMIR_BASE}/api/v1/label/__name__/values`, res);
});

// ─── Loki ─────────────────────────────────────────────────────────────────────

// GET /api/v1/metrics/logs?query=<logql>&start=&end=&limit=
router.get('/logs', rbac('metrics:read'), (req: Request, res: Response) => {
  const qs = new URLSearchParams(req.query as any).toString();
  proxyGet(`${LOKI_BASE}/loki/api/v1/query_range?${qs}`, res);
});

// GET /api/v1/metrics/logs/labels
router.get('/logs/labels', rbac('metrics:read'), (req: Request, res: Response) => {
  proxyGet(`${LOKI_BASE}/loki/api/v1/labels`, res);
});

export default router;
