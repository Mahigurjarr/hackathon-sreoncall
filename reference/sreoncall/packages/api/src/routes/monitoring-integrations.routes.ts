import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as svc from '../services/monitoring-integration.service';

const router = Router();

const INTEGRATION_TYPES = ['prometheus', 'datadog', 'newrelic', 'grafana', 'mimir', 'loki'] as const;

const createSchema = z.object({
  name:          z.string().min(1).max(200),
  type:          z.enum(INTEGRATION_TYPES),
  endpoint_url:  z.string().url(),
  api_key:       z.string().optional(),
  extra_headers: z.record(z.string()).optional(),
});

const updateSchema = createSchema.partial();

function serialize(i: any) {
  return {
    id:            i._id?.toString() ?? i.id,
    name:          i.name,
    type:          i.type,
    endpoint_url:  i.endpoint_url,
    api_key:       i.api_key ? '••••••' + i.api_key.slice(-4) : '',
    extra_headers: i.extra_headers ?? {},
    status:        i.status,
    last_tested_at: i.last_tested_at,
    error_message: i.error_message,
    created_at:    i.created_at,
    updated_at:    i.updated_at,
  };
}

// GET /api/v1/monitoring-integrations
router.get('/', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const docs = await svc.listIntegrations(req.tenantId.toString());
  res.json({ data: docs.map(serialize) });
});

// GET /api/v1/monitoring-integrations/:id
router.get('/:id', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const doc = await svc.getIntegrationById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// POST /api/v1/monitoring-integrations
router.post('/', rbac('monitoring-integrations:create'), auditMiddleware({ action: 'monitoring_integration.created', resourceType: 'monitoring_integration' }), async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await svc.createIntegration(req.tenantId.toString(), req.userId.toString(), body as any);
  res.status(201).json(serialize(doc));
});

// PATCH /api/v1/monitoring-integrations/:id
router.patch('/:id', rbac('monitoring-integrations:update'), auditMiddleware({ action: 'monitoring_integration.updated', resourceType: 'monitoring_integration' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await svc.updateIntegration(req.tenantId.toString(), req.params['id'] as string, body as any);
  res.json(serialize(doc));
});

// DELETE /api/v1/monitoring-integrations/:id
router.delete('/:id', rbac('monitoring-integrations:delete'), auditMiddleware({ action: 'monitoring_integration.deleted', resourceType: 'monitoring_integration' }), async (req: Request, res: Response) => {
  await svc.deleteIntegration(req.tenantId.toString(), req.params['id'] as string);
  res.status(204).send();
});

// POST /api/v1/monitoring-integrations/:id/test
router.post('/:id/test', rbac('monitoring-integrations:update'), async (req: Request, res: Response) => {
  const result = await svc.testConnection(req.tenantId.toString(), req.params['id'] as string);
  res.json(result);
});

// POST /api/v1/monitoring-integrations/:id/query — proxy a query through the integration
router.post('/:id/query', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const { path: queryPath, params } = req.body as { path: string; params?: Record<string, string> };
  if (!queryPath) { res.status(400).json({ error: 'path is required' }); return; }
  const result = await svc.proxyQuery(req.tenantId.toString(), req.params['id'] as string, queryPath, params ?? {});
  res.status(result.status || 200).json(result.data);
});

export default router;
