import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import * as changeService from '../services/change.service';
import * as changeBridgeService from '../services/change-bridge.service';
import * as freezeWindowService from '../services/freeze-window.service';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeUser(u: any) {
  if (!u || typeof u === 'string' || u._bsontype === 'ObjectId') return null;
  return { id: u._id?.toString(), name: u.name || null, email: u.email || null, avatar_url: u.avatar_url || null };
}

function serializeChange(cr: any) {
  return {
    id:            cr._id.toString(),
    number:        cr.number,
    type:          cr.type,
    title:         cr.title,
    description:   cr.description,
    justification: cr.justification,
    rollback_plan: cr.rollback_plan,
    risk: {
      score:                   cr.risk?.score,
      ai_score:                cr.risk?.ai_score ?? null,
      factors:                 cr.risk?.factors ?? [],
      blast_radius_description: cr.risk?.blast_radius_description ?? '',
    },
    status:         cr.status,
    current_step:   cr.current_step,
    approval_chain: (cr.approval_chain || []).map((step: any) => ({
      id:                 step._id?.toString(),
      step:               step.step,
      type:               step.type,
      required_approvals: step.required_approvals,
      approvers: (step.approvers || []).map((a: any) => ({
        user:  serializeUser(a.user_id),
        role:  a.role,
      })),
      decisions: (step.decisions || []).map((d: any) => ({
        user:       serializeUser(d.user_id),
        decision:   d.decision,
        comment:    d.comment,
        decided_at: d.decided_at?.toISOString(),
      })),
      completed_at: step.completed_at?.toISOString() ?? null,
    })),
    affected_service_ids: (cr.affected_service_ids || []).map((s: any) =>
      typeof s === 'object' && s._id ? { id: s._id.toString(), name: s.name } : s.toString()
    ),
    implementation_window: cr.implementation_window
      ? {
          start:    cr.implementation_window.start?.toISOString(),
          end:      cr.implementation_window.end?.toISOString(),
          timezone: cr.implementation_window.timezone,
        }
      : null,
    pir: cr.pir
      ? {
          status:      cr.pir.status,
          outcome:     cr.pir.outcome ?? null,
          notes:       cr.pir.notes ?? null,
          reviewed_by: serializeUser(cr.pir.reviewed_by),
          reviewed_at: cr.pir.reviewed_at?.toISOString() ?? null,
        }
      : null,
    ai_conflict_warnings:  cr.ai_conflict_warnings  ?? [],
    ai_window_suggestions: (cr.ai_window_suggestions ?? []).map((s: any) => ({
      start: s.start?.toISOString(), end: s.end?.toISOString(), reason: s.reason,
    })),
    freeze_window_conflict: cr.freeze_window_conflict ?? false,
    linked_ticket_ids:   (cr.linked_ticket_ids   || []).map((id: any) => id.toString()),
    linked_runbook_ids:  (cr.linked_runbook_ids  || []).map((id: any) => id.toString()),
    linked_incident_ids: (cr.linked_incident_ids || []).map((id: any) => id.toString()),
    labels:       cr.labels ?? [],
    created_by:   serializeUser(cr.created_by),
    requester:      serializeUser(cr.requester_id),
    change_owner:   serializeUser(cr.change_owner_id),
    roll_out_date:  cr.roll_out_date?.toISOString() ?? null,
    notes: ((cr as any).notes || []).map((n: any) => ({
      user: serializeUser(n.user_id),
      body: n.body,
      type: n.type,
      created_at: n.created_at?.toISOString(),
    })),
    scheduled_at:   cr.scheduled_at?.toISOString()   ?? null,
    implemented_at: cr.implemented_at?.toISOString() ?? null,
    completed_at:   cr.completed_at?.toISOString()   ?? null,
    cancelled_at:   cr.cancelled_at?.toISOString()   ?? null,
    created_at:     cr.createdAt?.toISOString()       ?? null,
    updated_at:     cr.updatedAt?.toISOString()       ?? null,
  };
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const approverSchema = z.object({
  user_id: z.string().min(1),
  role:    z.string().optional(),
  external:       z.boolean().optional(),
  external_email: z.string().email().optional().nullable(),
});

const approvalStepSchema = z.object({
  type:               z.enum(['sequential', 'parallel']).optional(),
  required_approvals: z.number().int().min(1).optional(),
  approvers:          z.array(approverSchema).min(1),
});

const windowSchema = z.object({
  start:    z.string().datetime({ offset: true }).or(z.string()),
  end:      z.string().datetime({ offset: true }).or(z.string()),
  timezone: z.string().optional(),
});

const createSchema = z.object({
  title:           z.string().min(1).max(500),
  description:     z.string().max(100000).optional(),
  justification:   z.string().max(10000).optional(),
  rollback_plan:   z.string().max(10000).optional(),
  type:            z.enum(['standard', 'normal', 'emergency']).optional(),
  risk_score:      z.enum(['low', 'medium', 'high', 'critical']).optional(),
  labels:          z.array(z.string()).optional(),
  affected_service_ids:  z.array(z.string()).optional(),
  implementation_window: windowSchema.optional().nullable(),
  requester_id:     z.string().optional(),
  change_owner_id:  z.string().optional(),
  roll_out_date:    z.string().optional().nullable(),
  approval_chain:  z.array(approvalStepSchema).optional(),
});

const updateSchema = createSchema.partial();

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'abstained']),
  comment:  z.string().max(2000).optional().default(''),
});

const scheduleSchema = windowSchema;

const rollbackSchema = z.object({ reason: z.string().max(2000).optional().default('') });

const pirSchema = z.object({
  outcome: z.enum(['successful', 'partial_success', 'failed', 'rolled_back']),
  notes:   z.string().max(10000).optional(),
  waived:  z.boolean().optional(),
});

const calendarSchema = z.object({
  from: z.string(),
  to:   z.string(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/v1/changes
router.get('/', rbac('changes:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await changeService.listChanges(
    {
      tenant_id: req.tenantId,
      status:    req.query.status as string | undefined,
      type:      req.query.type   as string | undefined,
      search:    req.query.search as string | undefined,
    },
    pagination
  );
  res.json({ data: result.data.map(serializeChange), pagination: result.pagination });
});

// POST /api/v1/changes
router.post(
  '/',
  rbac('changes:create'),
  auditMiddleware({ action: 'change.create', resourceType: 'change_request' }),
  async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const cr = await changeService.createChange({ ...body, roll_out_date: body.roll_out_date ?? undefined, tenant_id: req.tenantId, created_by: req.userId });
    const populated = await changeService.getChangeById(req.tenantId, cr._id.toString());
    res.status(201).json(serializeChange(populated));
  }
);

// GET /api/v1/changes/calendar
router.get('/calendar', rbac('changes:read'), async (req: Request, res: Response) => {
  const { from, to } = calendarSchema.parse(req.query);
  const items = await changeService.getCalendar(req.tenantId, new Date(from), new Date(to));
  res.json({ data: items.map(serializeChange) });
});

// ─── Freeze windows (blackout periods change requests are checked against) ──

const createFreezeWindowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  service_ids: z.array(z.string()).optional(),
});

function serializeFreezeWindow(f: any) {
  return {
    _id: f._id.toString(),
    name: f.name,
    description: f.description,
    start: f.start?.toISOString?.() ?? f.start,
    end: f.end?.toISOString?.() ?? f.end,
    service_ids: (f.service_ids ?? []).map((id: any) => id.toString?.() ?? id),
    created_by: f.created_by?.toString?.() ?? f.created_by,
    createdAt: f.createdAt?.toISOString?.() ?? f.createdAt,
  };
}

// GET /api/v1/changes/freeze-windows
router.get('/freeze-windows', rbac('changes:read'), async (req: Request, res: Response) => {
  const windows = await freezeWindowService.listFreezeWindows(req.tenantId);
  res.json({ data: windows.map(serializeFreezeWindow) });
});

// POST /api/v1/changes/freeze-windows
router.post(
  '/freeze-windows',
  rbac('changes:update'),
  auditMiddleware({ action: 'freeze_window.created', resourceType: 'freeze_window' }),
  async (req: Request, res: Response) => {
    const body = createFreezeWindowSchema.parse(req.body);
    const window = await freezeWindowService.createFreezeWindow({
      tenant_id: req.tenantId,
      created_by: req.userId,
      ...body,
    });
    res.status(201).json(serializeFreezeWindow(window));
  }
);

// DELETE /api/v1/changes/freeze-windows/:freezeId
router.delete(
  '/freeze-windows/:freezeId',
  rbac('changes:update'),
  auditMiddleware({ action: 'freeze_window.deleted', resourceType: 'freeze_window', getResourceId: (req) => req.params['freezeId'] as string }),
  async (req: Request, res: Response) => {
    await freezeWindowService.deleteFreezeWindow(req.tenantId, req.params['freezeId'] as string);
    res.status(204).send();
  }
);

// GET /api/v1/changes/:id
router.get('/:id', rbac('changes:read'), async (req: Request, res: Response) => {
  const cr = await changeService.getChangeById(req.tenantId, req.params['id'] as string);
  res.json(serializeChange(cr));
});

// PATCH /api/v1/changes/:id
router.patch(
  '/:id',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.update', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);
    const cr = await changeService.updateChange(req.tenantId, req.params['id'] as string, body);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/submit
router.post(
  '/:id/submit',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.submit', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const cr = await changeService.submitChange(req.tenantId, req.params['id'] as string);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/approve  (approve or reject in one endpoint)
router.post(
  '/:id/approve',
  rbac('changes:approve'),
  auditMiddleware({ action: 'change.approve', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = decideSchema.parse(req.body);
    const cr = await changeService.decideApproval(
      req.tenantId,
      req.params['id'] as string,
      req.userId,
      body.decision,
      body.comment
    );
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/schedule
router.post(
  '/:id/schedule',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.schedule', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = scheduleSchema.parse(req.body);
    const cr = await changeService.scheduleChange(req.tenantId, req.params['id'] as string, body);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/implement
router.post(
  '/:id/implement',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.implement', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const cr = await changeService.implementChange(req.tenantId, req.params['id'] as string, req.userId);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/complete
router.post(
  '/:id/complete',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.complete', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const cr = await changeService.completeChange(req.tenantId, req.params['id'] as string, req.userId);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/rollback
router.post(
  '/:id/rollback',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.rollback', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = rollbackSchema.parse(req.body);
    const cr = await changeService.rollbackChange(req.tenantId, req.params['id'] as string, req.userId, body.reason);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/cancel
router.post(
  '/:id/cancel',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.cancel', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const cr = await changeService.cancelChange(req.tenantId, req.params['id'] as string, req.userId);
    res.json(serializeChange(cr));
  }
);

// POST /api/v1/changes/:id/pir
router.post(
  '/:id/pir',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.pir', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = pirSchema.parse(req.body);
    const cr = await changeService.submitPir(req.tenantId, req.params['id'] as string, req.userId, body);
    res.json(serializeChange(cr));
  }
);


// POST /api/v1/changes/:id/escalate
router.post(
  '/:id/escalate',
  rbac('changes:update'),
  auditMiddleware({ action: 'change.escalate', resourceType: 'change_request', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const { ProviderConsumerLink } = await import('../models/provider-consumer-link.model');
    const link = await ProviderConsumerLink.findOne({ consumer_tenant_id: req.tenantId, status: 'active' });
    if (!link) {
      res.status(400).json({ detail: 'No provider relationship configured for this tenant.' });
      return;
    }

    const bridge = await changeBridgeService.createChangeBridge(
      req.tenantId,
      new Types.ObjectId(req.params['id'] as string),
      link.provider_tenant_id,
      req.userId,
    );

    res.status(201).json({
      bridge_id: bridge._id.toString(),
      provider_change_id: bridge.provider_change_id.toString(),
      status: bridge.status,
      escalated_at: bridge.escalated_at.toISOString(),
    });
  }
);

const noteSchema = z.object({
  body: z.string().min(1).max(10000),
  type: z.enum(['comment', 'state_change', 'discussion']).optional(),
});

// POST /api/v1/changes/:id/notes
router.post(
  '/:id/notes',
  rbac('changes:update'),
  async (req: Request, res: Response) => {
    const body = noteSchema.parse(req.body);
    const cr = await changeService.addNote(req.tenantId, req.params['id'] as string, req.userId, body.body, body.type);
    const populated = await changeService.getChangeById(req.tenantId, cr._id.toString());
    res.status(201).json(serializeChange(populated));
  }
);

// GET /api/v1/changes/:id/notes
router.get(
  '/:id/notes',
  rbac('changes:read'),
  async (req: Request, res: Response) => {
    const notes = await changeService.getNotes(req.tenantId, req.params['id'] as string);
    res.json({ data: notes.map((n: any) => ({
      user: serializeUser(n.user_id),
      body: n.body,
      type: n.type,
      created_at: n.created_at?.toISOString(),
    })) });
  }
);

export default router;
