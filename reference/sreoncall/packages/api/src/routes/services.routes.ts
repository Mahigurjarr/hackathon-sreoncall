import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import * as serviceService from '../services/service.service';
import { Service } from '../models/service.model';

const router = Router();

const SERVICE_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'] as const;
const SERVICE_TYPES = ['web', 'api', 'database', 'queue', 'cache', 'worker', 'storage', 'other'] as const;
const SERVICE_CLASSIFICATIONS = ['app', 'platform', 'infrastructure', 'monitoring', 'system'] as const;

const createSchema = z.object({
  name:                  z.string().min(1).max(200),
  description:           z.string().max(1000).optional(),
  type:                  z.enum(SERVICE_TYPES).optional(),
  classification:        z.enum(SERVICE_CLASSIFICATIONS).optional(),
  project_id:            z.string().min(1),
  escalation_policy_id:  z.string().nullable().optional(),
  oncall_schedule_id:    z.string().nullable().optional(),
  owner_id:              z.string().nullable().optional(),
  enabled:               z.boolean().optional(),
  tags:                  z.array(z.string()).optional(),
});

const updateSchema = createSchema.partial();

const statusSchema = z.object({
  status: z.enum(SERVICE_STATUSES),
});

function serialize(s: any) {
  return {
    id:                    s._id?.toString() ?? s.id,
    name:                  s.name,
    description:           s.description ?? '',
    type:                  s.type ?? 'web',
    classification:        s.classification ?? 'app',
    auto_discovered:       s.auto_discovered ?? false,
    source_asset_id:       s.source_asset_id?.toString() ?? null,
    project_id:            s.project_id?.toString() ?? null,
    escalation_policy_id:  s.escalation_policy_id?.toString() ?? null,
    oncall_schedule_id:    s.oncall_schedule_id?.toString() ?? null,
    owner_id:              s.owner_id?.toString() ?? null,
    current_status:        s.current_status ?? 'operational',
    enabled:               s.enabled ?? true,
    tags:                  s.tags ?? [],
    cloud_metadata:        s.cloud_metadata ?? null,
    created_by:            s.created_by?.toString() ?? null,
    created_at:            s.created_at,
    updated_at:            s.updated_at,
  };
}

// GET /api/v1/services
router.get('/', rbac('services:read'), async (req: Request, res: Response) => {
  const result = await serviceService.listServices(req.tenantId.toString(), {
    status:          req.query.status as string | undefined,
    type:            req.query.type as string | undefined,
    classification:  req.query.classification as string | undefined,
    auto_discovered: req.query.auto_discovered === 'true' ? true : undefined,
    project_id:      req.query.project_id as string | undefined,
    search:          req.query.search as string | undefined,
    limit:           req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor:          req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/services/:id
router.get('/:id', rbac('services:read'), async (req: Request, res: Response) => {
  const doc = await serviceService.getServiceById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// POST /api/v1/services
router.post('/',
  rbac('services:create'),
  requirePlanLimit('max_services', async (req) => Service.countDocuments({ tenant_id: req.tenantId })),
  auditMiddleware({ action: 'service.created', resourceType: 'service' }),
  async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await serviceService.createService(req.tenantId.toString(), req.userId.toString(), body);
  res.status(201).json(serialize(doc));
});

// PATCH /api/v1/services/bulk-classify  (must be before /:id routes)
const bulkClassifySchema = z.object({
  service_ids:    z.array(z.string().min(1)).min(1).max(200),
  classification: z.enum(SERVICE_CLASSIFICATIONS),
});

router.patch('/bulk-classify', rbac('services:update'), async (req: Request, res: Response) => {
  const { service_ids, classification } = bulkClassifySchema.parse(req.body);
  const result = await serviceService.bulkUpdateClassification(
    req.tenantId.toString(),
    service_ids,
    classification,
  );
  res.json({ updated: result });
});

// PATCH /api/v1/services/:id
router.patch('/:id', rbac('services:update'), auditMiddleware({ action: 'service.updated', resourceType: 'service' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await serviceService.updateService(req.tenantId.toString(), req.params['id'] as string, body);
  res.json(serialize(doc));
});

// DELETE /api/v1/services/:id
router.delete('/:id', rbac('services:delete'), auditMiddleware({ action: 'service.deleted', resourceType: 'service' }), async (req: Request, res: Response) => {
  await serviceService.deleteService(req.tenantId.toString(), req.params['id'] as string);
  res.status(204).send();
});

// POST /api/v1/services/:id/status  — quick status update
router.post('/:id/status', rbac('services:update'), auditMiddleware({ action: 'service.status_changed', resourceType: 'service' }), async (req: Request, res: Response) => {
  const { status } = statusSchema.parse(req.body);
  const doc = await serviceService.updateServiceStatus(req.tenantId.toString(), req.params['id'] as string, status);
  res.json(serialize(doc));
});

export default router;
