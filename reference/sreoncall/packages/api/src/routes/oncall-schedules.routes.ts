import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as svc from '../services/oncall-schedule.service';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import mongoose, { Types } from 'mongoose';

const router = Router();

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeSchedule(doc: any) {
  return {
    id:          doc._id.toString(),
    name:        doc.name,
    description: doc.description || '',
    timezone:    doc.timezone,
    enabled:     doc.enabled ?? true,
    layers: (doc.layers || []).map((l: any) => ({
      id:                    l.id,
      name:                  l.name,
      rotation_type:         l.rotation_type,
      users:                 (l.users || []).map((u: any) =>
        typeof u === 'object' && u._bsontype !== 'ObjectId' && u._id
          ? { id: u._id.toString(), name: u.name || null, email: u.email || null }
          : u.toString(),
      ),
      start_time:            l.start_time || '09:00',
      end_time:              l.end_time || '17:00',
      timezone:              l.timezone || doc.timezone,
      rotation_length_seconds: l.rotation_length_seconds || 604800,
      restrictions:          l.restrictions || [],
    })),
    overrides: (doc.overrides || []).map((o: any) => ({
      id:         o.id,
      user_id:    o.user_id?.toString() || null,
      start:      o.start instanceof Date ? o.start.toISOString() : o.start,
      end:        o.end   instanceof Date ? o.end.toISOString()   : o.end,
      reason:     o.reason || null,
      created_by: o.created_by?.toString() || null,
      created_at: o.created_at instanceof Date ? o.created_at.toISOString() : o.created_at,
    })),
    service_ids:          (doc.service_ids || []).map((id: any) => id.toString()),
    escalation_policy_id: doc.escalation_policy_id?.toString() || null,
    created_by:           doc.created_by?.toString() || null,
    created_at:           doc.created_at instanceof Date ? doc.created_at.toISOString() : doc.created_at,
    updated_at:           doc.updated_at instanceof Date ? doc.updated_at.toISOString() : doc.updated_at,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

const layerSchema = z.object({
  id:            z.string().optional(),
  name:          z.string().min(1).max(200),
  rotation_type: z.enum(['daily', 'weekly', 'monthly', 'custom_hours']).optional(),
  users:         z.array(z.string()).optional(),
  start_time:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time:      z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone:      z.string().optional(),
  rotation_length_seconds: z.number().optional(),
  restrictions:  z.array(z.object({
    start_hour: z.number(),
    end_hour:   z.number(),
    days:       z.array(z.number()),
  })).optional(),
}).passthrough();

const createSchema = z.object({
  name:                 z.string().min(1).max(200),
  description:          z.string().max(2000).optional(),
  timezone:             z.string().optional(),
  layers:               z.array(layerSchema).optional(),
  service_ids:          z.array(z.string()).optional(),
  escalation_policy_id: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name:                 z.string().min(1).max(200).optional(),
  description:          z.string().max(2000).optional(),
  timezone:             z.string().optional(),
  enabled:              z.boolean().optional(),
  layers:               z.array(layerSchema).optional(),
  service_ids:          z.array(z.string()).optional(),
  escalation_policy_id: z.string().nullable().optional(),
});

const overrideSchema = z.object({
  user_id:  z.string().min(1),
  layer_id: z.string().nullable().optional(),
  start:    z.string().min(1),
  end:      z.string().min(1),
  reason:   z.string().max(500).optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/v1/oncall-schedules
router.get('/', rbac('oncall:read'), async (req: Request, res: Response) => {
  const docs = await svc.listSchedules(req.tenantId.toString(), {
    search: req.query.search as string | undefined,
    limit:  req.query.limit ? Number(req.query.limit) : 100,
  });
  res.json({ data: docs.map(serializeSchedule), pagination: { total: docs.length } });
});

// GET /api/v1/oncall-schedules/current-users — tenant-wide on-call users
router.get('/current-users', rbac('oncall:read'), async (req: Request, res: Response) => {
  const { getCurrentOnCallUsers } = await import('../services/oncall.service');
  const { User } = await import('../models/user.model');
  const userIds = await getCurrentOnCallUsers(req.tenantId);
  const users = await User.find({ _id: { $in: userIds } }).select('_id name email avatar_url').lean();
  res.json({
    data: users.map((u: any) => ({
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      avatar_url: u.avatar_url ?? null,
    })),
  });
});

// POST /api/v1/oncall-schedules
router.post(
  '/',
  rbac('oncall:create'),
  requirePlanLimit('max_on_call_schedules', (req) =>
    mongoose.model('OncallSchedule').countDocuments({ tenant_id: req.tenantId })
  ),
  auditMiddleware({ action: 'oncall_schedule.create', resourceType: 'oncall_schedule' }),
  async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const doc  = await svc.createSchedule({
      ...body,
      tenant_id:  req.tenantId.toString(),
      created_by: req.userId.toString(),
    });
    res.status(201).json(serializeSchedule(doc));
  },
);

// GET /api/v1/oncall-schedules/:id
router.get('/:id', rbac('oncall:read'), async (req: Request, res: Response) => {
  const doc = await svc.getScheduleById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serializeSchedule(doc));
});

// PATCH /api/v1/oncall-schedules/:id
router.patch(
  '/:id',
  rbac('oncall:update'),
  auditMiddleware({
    action: 'oncall_schedule.update',
    resourceType: 'oncall_schedule',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);
    const doc  = await svc.updateSchedule(req.tenantId.toString(), req.params['id'] as string, body);
    res.json(serializeSchedule(doc));
  },
);

// DELETE /api/v1/oncall-schedules/:id
router.delete(
  '/:id',
  rbac('oncall:delete'),
  auditMiddleware({
    action: 'oncall_schedule.delete',
    resourceType: 'oncall_schedule',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    await svc.deleteSchedule(req.tenantId.toString(), req.params['id'] as string);
    res.status(204).send();
  },
);

// GET /api/v1/oncall-schedules/:id/current — who's on-call right now
router.get('/:id/current', rbac('oncall:read'), async (req: Request, res: Response) => {
  const result = await svc.getCurrentOnCall(req.tenantId.toString(), req.params['id'] as string);
  res.json(result);
});

// POST /api/v1/oncall-schedules/:id/overrides
router.post(
  '/:id/overrides',
  rbac('oncall:update'),
  auditMiddleware({
    action: 'oncall_schedule.override_add',
    resourceType: 'oncall_schedule',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    const body = overrideSchema.parse(req.body);
    const doc  = await svc.addOverride(req.tenantId.toString(), req.params['id'] as string, {
      ...body,
      created_by: req.userId.toString(),
    });
    res.status(201).json(serializeSchedule(doc));
  },
);

// DELETE /api/v1/oncall-schedules/:id/overrides/:overrideId
router.delete(
  '/:id/overrides/:overrideId',
  rbac('oncall:update'),
  async (req: Request, res: Response) => {
    const doc = await svc.deleteOverride(
      req.tenantId.toString(),
      req.params['id'] as string,
      req.params['overrideId'] as string,
    );
    res.json(serializeSchedule(doc));
  },
);

export default router;
