import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import * as svc from '../services/synthetic-check.service';
import mongoose from 'mongoose';

const router = Router();

const createSchema = z.object({
  name:                  z.string().min(1).max(200),
  type:                  z.enum(['http', 'tcp', 'dns']),
  service_id:            z.string().nullable().optional(),
  interval_seconds:      z.number().int().min(10).max(86400).optional(),
  timeout_seconds:       z.number().int().min(1).max(60).optional(),
  // HTTP
  url:                   z.string().url().optional(),
  method:                z.enum(['GET', 'POST', 'HEAD']).optional(),
  http_headers:          z.record(z.string()).optional(),
  expected_status_code:  z.number().int().optional(),
  allowed_status_codes:  z.array(z.number().int()).optional(),
  keyword_check:         z.string().optional(),
  verify_tls:            z.boolean().optional(),
  // TCP
  host:                  z.string().optional(),
  port:                  z.number().int().min(1).max(65535).nullable().optional(),
  // DNS
  hostname:              z.string().optional(),
  record_type:           z.enum(['A', 'CNAME', 'MX', 'TXT']).optional(),
  expected_value:        z.string().optional(),
});

const updateSchema = createSchema.partial();

function serialize(c: any) {
  return {
    id:                    c._id?.toString() ?? c.id,
    name:                  c.name,
    type:                  c.type,
    status:                c.status,
    service_id:            c.service_id?.toString() ?? null,
    interval_seconds:      c.interval_seconds,
    timeout_seconds:       c.timeout_seconds,
    url:                   c.url || null,
    method:                c.method,
    http_headers:          c.http_headers ?? {},
    expected_status_code:  c.expected_status_code,
    allowed_status_codes:  c.allowed_status_codes ?? [],
    keyword_check:         c.keyword_check || null,
    verify_tls:            c.verify_tls !== false,
    host:                  c.host || null,
    port:                  c.port,
    hostname:              c.hostname || null,
    record_type:           c.record_type,
    expected_value:        c.expected_value || null,
    last_check_at:         c.last_check_at,
    last_status:           c.last_status,
    last_response_time_ms: c.last_response_time_ms,
    uptime_1h:             c.uptime_1h,
    uptime_24h:            c.uptime_24h,
    uptime_7d:             c.uptime_7d,
    consecutive_failures:  c.consecutive_failures,
    geo_lat:               c.geo_lat ?? null,
    geo_lon:               c.geo_lon ?? null,
    geo_city:              c.geo_city || null,
    geo_country:           c.geo_country || null,
    geo_ip:                c.geo_ip || null,
    created_at:            c.created_at,
    updated_at:            c.updated_at,
  };
}

// GET /api/v1/synthetic-checks
router.get('/', rbac('synthetic-checks:read'), async (req: Request, res: Response) => {
  const result = await svc.listChecks(req.tenantId.toString(), {
    status: req.query.status as string,
    type:   req.query.type as string,
    search: req.query.search as string,
    limit:  req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  });
  res.json({ data: result.data.map(serialize), pagination: result.pagination });
});

// GET /api/v1/synthetic-checks/:id
router.get('/:id', rbac('synthetic-checks:read'), async (req: Request, res: Response) => {
  const doc = await svc.getCheckById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// GET /api/v1/synthetic-checks/:id/results
router.get('/:id/results', rbac('synthetic-checks:read'), async (req: Request, res: Response) => {
  const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string, 10) : 200, 5_000);
  const from  = req.query.from  ? new Date(req.query.from  as string) : undefined;
  const until = req.query.until ? new Date(req.query.until as string) : undefined;
  const results = await svc.getCheckResults(req.tenantId.toString(), req.params['id'] as string, limit, from, until);
  res.json({ data: results });
});

// POST /api/v1/synthetic-checks
router.post('/',
  rbac('synthetic-checks:create'),
  requirePlanLimit('max_synthetic_checks', (req) =>
    mongoose.model('SyntheticCheck').countDocuments({ tenant_id: req.tenantId })
  ),
  auditMiddleware({ action: 'synthetic_check.created', resourceType: 'synthetic_check' }),
  async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await svc.createCheck(req.tenantId.toString(), req.userId.toString(), body as any);
  res.status(201).json(serialize(doc));
});

// PATCH /api/v1/synthetic-checks/:id
router.patch('/:id', rbac('synthetic-checks:update'), auditMiddleware({ action: 'synthetic_check.updated', resourceType: 'synthetic_check' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await svc.updateCheck(req.tenantId.toString(), req.params['id'] as string, body as any);
  res.json(serialize(doc));
});

// DELETE /api/v1/synthetic-checks/:id
router.delete('/:id', rbac('synthetic-checks:delete'), auditMiddleware({ action: 'synthetic_check.deleted', resourceType: 'synthetic_check' }), async (req: Request, res: Response) => {
  await svc.deleteCheck(req.tenantId.toString(), req.params['id'] as string);
  res.status(204).send();
});

// POST /api/v1/synthetic-checks/:id/trigger — run immediately
router.post('/:id/trigger', rbac('synthetic-checks:update'), async (req: Request, res: Response) => {
  const doc = await svc.triggerCheck(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// POST /api/v1/synthetic-checks/:id/pause|resume
router.post('/:id/pause', rbac('synthetic-checks:update'), async (req: Request, res: Response) => {
  const doc = await svc.updateCheck(req.tenantId.toString(), req.params['id'] as string, { status: 'paused' } as any);
  res.json(serialize(doc));
});

router.post('/:id/resume', rbac('synthetic-checks:update'), async (req: Request, res: Response) => {
  const doc = await svc.updateCheck(req.tenantId.toString(), req.params['id'] as string, { status: 'active' } as any);
  res.json(serialize(doc));
});

export default router;
