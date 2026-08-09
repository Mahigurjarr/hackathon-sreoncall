import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as businessImpactService from '../services/business-impact.service';

const router = Router();

const customerTierSchema = z.object({
  tier: z.string().min(1).max(100),
  count: z.number().int().min(0),
  sla_commitment: z.string().max(20).nullable().optional(),
});

const createSchema = z.object({
  service_id: z.string().min(1),
  revenue_per_request_cents: z.number().nullable().optional(),
  avg_requests_per_minute: z.number().nullable().optional(),
  affected_user_scope: z.enum(['all', 'subset', 'internal_only']).optional(),
  estimated_users_affected_percent: z.number().min(0).max(100).optional(),
  total_user_count: z.number().int().nullable().optional(),
  customer_tiers: z.array(customerTierSchema).optional(),
  sla_config_id: z.string().nullable().optional(),
  support_escalation_threshold_minutes: z.number().int().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateSchema = createSchema.omit({ service_id: true }).partial();

function serializeService(s: any) {
  if (!s || typeof s === 'string' || s._bsontype === 'ObjectId') return null;
  return { id: s._id?.toString(), name: s.name, type: s.type, current_status: s.current_status };
}

function serializeUser(u: any) {
  if (!u || typeof u === 'string' || u._bsontype === 'ObjectId') return null;
  return { id: u._id?.toString(), name: u.name || null, email: u.email || null };
}

function serialize(doc: any) {
  const service = doc.service_id && typeof doc.service_id === 'object' ? doc.service_id : null;
  return {
    id: doc._id?.toString() ?? doc.id,
    service_id: service ? service._id?.toString() : (doc.service_id?.toString() ?? null),
    service: serializeService(doc.service_id),
    revenue_per_request_cents: doc.revenue_per_request_cents,
    avg_requests_per_minute: doc.avg_requests_per_minute,
    affected_user_scope: doc.affected_user_scope,
    estimated_users_affected_percent: doc.estimated_users_affected_percent,
    total_user_count: doc.total_user_count,
    customer_tiers: doc.customer_tiers ?? [],
    sla_config_id: doc.sla_config_id?.toString() ?? null,
    support_escalation_threshold_minutes: doc.support_escalation_threshold_minutes,
    notes: doc.notes,
    updated_by: serializeUser(doc.updated_by),
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

// GET /api/v1/business-impact-configs
router.get('/', rbac('services:read'), async (req: Request, res: Response) => {
  const result = await businessImpactService.list(req.tenantId.toString(), {
    service_id: req.query.service_id as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// POST /api/v1/business-impact-configs
router.post(
  '/',
  rbac('services:create'),
  auditMiddleware({ action: 'business_impact_config.created', resourceType: 'business_impact_config' }),
  async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const doc = await businessImpactService.create(req.tenantId.toString(), req.userId.toString(), body as any);
    res.status(201).json(serialize(doc));
  },
);

// GET /api/v1/business-impact-configs/:id
router.get('/:id', rbac('services:read'), async (req: Request, res: Response) => {
  const doc = await businessImpactService.getById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// PATCH /api/v1/business-impact-configs/:id
router.patch(
  '/:id',
  rbac('services:update'),
  auditMiddleware({ action: 'business_impact_config.updated', resourceType: 'business_impact_config', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);
    const doc = await businessImpactService.update(
      req.tenantId.toString(),
      req.params['id'] as string,
      req.userId.toString(),
      body as any,
    );
    res.json(serialize(doc));
  },
);

// DELETE /api/v1/business-impact-configs/:id
router.delete(
  '/:id',
  rbac('services:delete'),
  auditMiddleware({ action: 'business_impact_config.deleted', resourceType: 'business_impact_config', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    await businessImpactService.remove(req.tenantId.toString(), req.params['id'] as string);
    res.status(204).send();
  },
);

export default router;
