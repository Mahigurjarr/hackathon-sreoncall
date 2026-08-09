import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as stakeholderCommsService from '../services/stakeholder-comms.service';

const router = Router({ mergeParams: true });

function serializeUser(u: any) {
  if (!u || typeof u === 'string' || u._bsontype === 'ObjectId') return null;
  return { id: u._id?.toString(), name: u.name || null, email: u.email || null, avatar_url: u.avatar_url || null };
}

function serialize(doc: any) {
  return {
    id: doc._id?.toString() ?? doc.id,
    incident_id: doc.incident_id?.toString() ?? null,
    audience: doc.audience,
    content: {
      draft: doc.content?.draft ?? '',
      final: doc.content?.final ?? null,
      generated_by: doc.content?.generated_by ?? 'manual',
    },
    delivery: {
      channels: (doc.delivery?.channels ?? []).map((ch: any) => ({
        type: ch.type,
        target: ch.target,
        sent_at: ch.sent_at ?? null,
        delivery_status: ch.delivery_status,
      })),
    },
    status: doc.status,
    created_by: serializeUser(doc.created_by),
    sent_by: serializeUser(doc.sent_by),
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

const createSchema = z.object({
  audience: z.enum(['internal_engineering', 'internal_leadership', 'external_customer', 'status_page']),
  content: z.string().max(50000).optional(),
});

const updateDraftSchema = z.object({
  content_final: z.string().max(50000).optional(),
});

// GET /api/v1/incidents/:id/stakeholder-updates
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const incidentId = req.params['id'] as string;
  const result = await stakeholderCommsService.list(req.tenantId.toString(), incidentId, {
    audience: req.query.audience as string | undefined,
    status: req.query.status as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// POST /api/v1/incidents/:id/stakeholder-updates
router.post(
  '/',
  rbac('incidents:update'),
  auditMiddleware({ action: 'stakeholder_update.created', resourceType: 'stakeholder_update' }),
  async (req: Request, res: Response) => {
    const incidentId = req.params['id'] as string;
    const body = createSchema.parse(req.body);
    const doc = await stakeholderCommsService.create(
      req.tenantId.toString(),
      incidentId,
      req.userId.toString(),
      body as any,
    );
    res.status(201).json(serialize(doc));
  },
);

// PATCH /api/v1/incidents/:id/stakeholder-updates/:updateId
router.patch(
  '/:updateId',
  rbac('incidents:update'),
  auditMiddleware({ action: 'stakeholder_update.updated', resourceType: 'stakeholder_update', getResourceId: (req) => req.params['updateId'] as string }),
  async (req: Request, res: Response) => {
    const incidentId = req.params['id'] as string;
    const updateId = req.params['updateId'] as string;
    const body = updateDraftSchema.parse(req.body);
    const doc = await stakeholderCommsService.update(
      req.tenantId.toString(),
      incidentId,
      updateId,
      body as any,
    );
    res.json(serialize(doc));
  },
);

// POST /api/v1/incidents/:id/stakeholder-updates/:updateId/send
router.post(
  '/:updateId/send',
  rbac('incidents:update'),
  auditMiddleware({ action: 'stakeholder_update.sent', resourceType: 'stakeholder_update', getResourceId: (req) => req.params['updateId'] as string }),
  async (req: Request, res: Response) => {
    const incidentId = req.params['id'] as string;
    const updateId = req.params['updateId'] as string;
    const doc = await stakeholderCommsService.send(
      req.tenantId.toString(),
      incidentId,
      updateId,
      req.userId.toString(),
    );
    res.json(serialize(doc));
  },
);

export default router;
