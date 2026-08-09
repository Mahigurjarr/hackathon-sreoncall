import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import * as epService from '../services/escalation-policy.service';
import { parsePaginationParams } from '../utils/pagination';
import mongoose from 'mongoose';

const router = Router();

const escalationStepSchema = z.object({
  delay_minutes: z.number().int().min(0).default(5),
  targets: z.array(z.string()).optional(),
  target_type: z.enum(['user', 'team', 'schedule', 'provider_escalation']).optional(),
  provider_policy_id: z.string().optional(),
  timeout_minutes: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
  notify_channels: z.array(z.enum(['email', 'sms', 'slack', 'teams', 'in_app', 'voice', 'whatsapp'])).optional(),
});

const createEPSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  steps: z.array(escalationStepSchema).optional(),
  repeat_count: z.number().int().min(0).optional(),
  repeat_interval_minutes: z.number().int().min(1).optional(),
});

const updateEPSchema = createEPSchema.partial();

function serializeEP(p: any) {
  return {
    _id: p._id.toString(),
    name: p.name,
    description: p.description,
    status: p.status ?? 'active',
    steps: (p.steps || []).map((s: any) => ({
      delay_minutes: s.delay_minutes,
      targets: (s.targets || []).map((t: any) => t?.toString()),
      target_type: s.target_type,
      provider_policy_id: s.provider_policy_id?.toString() || null,
      timeout_minutes: s.timeout_minutes ?? null,
      note: s.note,
      notify_channels: s.notify_channels ?? ['in_app', 'email'],
    })),
    repeat_count: p.repeat_count ?? 0,
    repeat_interval_minutes: p.repeat_interval_minutes ?? 30,
    created_by: p.created_by?.toString(),
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// GET /api/v1/escalation-policies
router.get('/', rbac('escalation:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const status = req.query.status as string | undefined;
  const result = await epService.listEscalationPolicies(req.tenantId, pagination, { status });
  res.json({ data: result.data.map(serializeEP), pagination: result.pagination });
});

// GET /api/v1/escalation-policies/:id
router.get('/:id', rbac('escalation:read'), async (req: Request, res: Response) => {
  const policy = await epService.getEscalationPolicyById(req.tenantId, req.params['id'] as string);
  res.json(serializeEP(policy));
});

// POST /api/v1/escalation-policies
router.post('/',
  rbac('escalation:create'),
  requirePlanLimit('max_escalation_policies', (req) =>
    mongoose.model('EscalationPolicy').countDocuments({ tenant_id: req.tenantId })
  ),
  async (req: Request, res: Response) => {
  const body = createEPSchema.parse(req.body);
  const policy = await epService.createEscalationPolicy({
    ...body,
    tenant_id: req.tenantId,
    created_by: req.userId,
  });
  res.status(201).json(serializeEP(policy));
});

// PATCH /api/v1/escalation-policies/:id
router.patch('/:id', rbac('escalation:update'), auditMiddleware({ action: 'escalation_policy.updated', resourceType: 'escalation_policy' }), async (req: Request, res: Response) => {
  const body = updateEPSchema.parse(req.body);
  const policy = await epService.updateEscalationPolicy(req.tenantId, req.params['id'] as string, body);
  res.json(serializeEP(policy));
});

// DELETE /api/v1/escalation-policies/:id
router.delete('/:id', rbac('escalation:delete'), auditMiddleware({ action: 'escalation_policy.deleted', resourceType: 'escalation_policy' }), async (req: Request, res: Response) => {
  await epService.deleteEscalationPolicy(req.tenantId, req.params['id'] as string);
  res.status(204).send();
});

export default router;
