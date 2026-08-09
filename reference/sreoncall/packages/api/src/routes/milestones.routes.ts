import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { boardAccessMiddleware } from '../middleware/boardAccess.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as milestoneService from '../services/milestone.service';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  project_id: z.string().nullable().optional(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
  start_date: z.string().min(1),
  target_date: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  project_id: z.string().nullable().optional(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
});

function serialize(m: any) {
  return {
    id: m._id?.toString() ?? m.id,
    name: m.name,
    description: m.description ?? '',
    project_id: m.project_id?.toString() ?? null,
    status: m.status,
    start_date: m.start_date instanceof Date ? m.start_date.toISOString() : m.start_date,
    target_date: m.target_date instanceof Date ? m.target_date.toISOString() : m.target_date,
    completed_at: m.completed_at instanceof Date ? m.completed_at.toISOString() : (m.completed_at ?? null),
    created_by: m.created_by?.toString() ?? null,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

// GET /api/v1/milestones
router.get('/', rbac('milestones:read'), boardAccessMiddleware, async (req: Request, res: Response) => {
  const result = await milestoneService.listMilestones(req.tenantId.toString(), {
    project_id: req.query.project_id as string | undefined,
    status: req.query.status as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/milestones/:id
router.get('/:id', rbac('milestones:read'), async (req: Request, res: Response) => {
  const doc = await milestoneService.getMilestoneById(req.tenantId.toString(), req.params.id as string);
  res.json(serialize(doc));
});

// GET /api/v1/milestones/:id/progress
router.get('/:id/progress', rbac('milestones:read'), async (req: Request, res: Response) => {
  const progress = await milestoneService.getMilestoneProgress(req.tenantId.toString(), req.params.id as string);
  res.json(progress);
});

// POST /api/v1/milestones
router.post('/', rbac('milestones:create'), boardAccessMiddleware, auditMiddleware({ action: 'milestone.created', resourceType: 'milestone' }), async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await milestoneService.createMilestone(req.tenantId.toString(), req.userId.toString(), body);
  res.status(201).json(serialize(doc));
});

// PATCH /api/v1/milestones/:id
router.patch('/:id', rbac('milestones:update'), auditMiddleware({ action: 'milestone.updated', resourceType: 'milestone' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await milestoneService.updateMilestone(req.tenantId.toString(), req.params.id as string, body);
  res.json(serialize(doc));
});

// DELETE /api/v1/milestones/:id
router.delete('/:id', rbac('milestones:delete'), auditMiddleware({ action: 'milestone.deleted', resourceType: 'milestone' }), async (req: Request, res: Response) => {
  await milestoneService.deleteMilestone(req.tenantId.toString(), req.params.id as string);
  res.status(204).send();
});

export default router;
