import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SlaConfig } from '../models/sla-config.model';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { AppError } from '../middleware/errorHandler.middleware';

const router = Router();

const businessHoursSchema = z.object({
  timezone: z.string().default('UTC'),
  schedule: z.array(
    z.object({
      day: z.number().int().min(0).max(6),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    })
  ),
  holidays: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1),
      })
    )
    .optional(),
});

const createSlaConfigSchema = z.object({
  name: z.string().min(1).max(200),
  conditions: z.object({
    priority: z.array(z.number().int().min(1).max(5)).default([]),
    ticket_types: z.array(z.string()).default([]),
  }),
  response_time_minutes: z.number().int().positive(),
  resolution_time_minutes: z.number().int().positive(),
  business_hours: businessHoursSchema.optional(),
  enabled: z.boolean().default(true),
});

const updateSlaConfigSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  conditions: z
    .object({
      priority: z.array(z.number().int().min(1).max(5)).optional(),
      ticket_types: z.array(z.string()).optional(),
    })
    .optional(),
  response_time_minutes: z.number().int().positive().optional(),
  resolution_time_minutes: z.number().int().positive().optional(),
  business_hours: businessHoursSchema.optional(),
  enabled: z.boolean().optional(),
});

// GET /api/v1/sla-configs
router.get('/', rbac('sla:read'), async (req: Request, res: Response) => {
  const configs = await SlaConfig.find({ tenant_id: req.tenantId }).sort({ createdAt: -1 });
  res.json({ data: configs });
});

// GET /api/v1/sla-configs/:id
router.get('/:id', rbac('sla:read'), async (req: Request, res: Response) => {
  const config = await SlaConfig.findOne({ _id: req.params.id as string, tenant_id: req.tenantId });
  if (!config) {
    throw AppError.notFound('SLA Config');
  }
  res.json(config);
});

// POST /api/v1/sla-configs
router.post(
  '/',
  rbac('sla:create'),
  auditMiddleware({ action: 'sla_config.create', resourceType: 'sla_config' }),
  async (req: Request, res: Response) => {
    const body = createSlaConfigSchema.parse(req.body);

    const config = await SlaConfig.create({
      tenant_id: req.tenantId,
      ...body,
    });

    res.status(201).json(config);
  }
);

// PATCH /api/v1/sla-configs/:id
router.patch(
  '/:id',
  rbac('sla:update'),
  auditMiddleware({
    action: 'sla_config.update',
    resourceType: 'sla_config',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const body = updateSlaConfigSchema.parse(req.body);

    const config = await SlaConfig.findOne({ _id: req.params.id as string, tenant_id: req.tenantId });
    if (!config) {
      throw AppError.notFound('SLA Config');
    }

    if (body.name !== undefined) config.name = body.name;
    if (body.conditions) {
      if (body.conditions.priority !== undefined) config.conditions.priority = body.conditions.priority;
      if (body.conditions.ticket_types !== undefined) config.conditions.ticket_types = body.conditions.ticket_types;
    }
    if (body.response_time_minutes !== undefined) config.response_time_minutes = body.response_time_minutes;
    if (body.resolution_time_minutes !== undefined) config.resolution_time_minutes = body.resolution_time_minutes;
    if (body.business_hours !== undefined) config.business_hours = body.business_hours as any;
    if (body.enabled !== undefined) config.enabled = body.enabled;

    await config.save();
    res.json(config);
  }
);

// DELETE /api/v1/sla-configs/:id
router.delete(
  '/:id',
  rbac('sla:delete'),
  auditMiddleware({
    action: 'sla_config.delete',
    resourceType: 'sla_config',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const result = await SlaConfig.deleteOne({ _id: req.params.id as string, tenant_id: req.tenantId });
    if (result.deletedCount === 0) {
      throw AppError.notFound('SLA Config');
    }
    res.status(204).send();
  }
);

export default router;
