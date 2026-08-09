import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as projectService from '../services/project.service';
import * as boardInviteService from '../services/board-invite.service';
import { BoardMember } from '../models/board-member.model';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  key: z.string().max(8).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  visibility: z.enum(['org', 'private']).optional(),
});

const updateSchema = createSchema.partial();

function serialize(p: any) {
  return {
    id: p._id?.toString() ?? p.id,
    name: p.name,
    key: p.key ?? null,
    color: p.color ?? null,
    description: p.description ?? '',
    visibility: p.visibility ?? 'org',
    created_by: p.created_by?.toString() ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// GET /api/v1/projects
router.get('/', rbac('projects:read'), async (req: Request, res: Response) => {
  const result = await projectService.listProjects(req.tenantId.toString(), {
    search: req.query.search as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
    userId: req.userId?.toString(),
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/projects/:id
router.get('/:id', rbac('projects:read'), async (req: Request, res: Response) => {
  const doc = await projectService.getProjectById(req.tenantId.toString(), req.params.id as string);
  res.json(serialize(doc));
});

// POST /api/v1/projects
router.post('/', rbac('projects:create'), auditMiddleware({ action: 'project.created', resourceType: 'project' }), async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await projectService.createProject(req.tenantId.toString(), req.userId.toString(), body);
  if (body.visibility === 'private') {
    await BoardMember.updateOne(
      { board_id: doc._id, user_id: req.userId },
      { $setOnInsert: { tenant_id: req.tenantId, board_id: doc._id, user_id: req.userId, role: 'admin', invited_by: req.userId, joined_at: new Date() } },
      { upsert: true },
    );
  }
  res.status(201).json(serialize(doc));
});

// PATCH /api/v1/projects/:id
router.patch('/:id', rbac('projects:update'), auditMiddleware({ action: 'project.updated', resourceType: 'project' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await projectService.updateProject(req.tenantId.toString(), req.params.id as string, body);
  res.json(serialize(doc));
});

// DELETE /api/v1/projects/:id
router.delete('/:id', rbac('projects:delete'), auditMiddleware({ action: 'project.deleted', resourceType: 'project' }), async (req: Request, res: Response) => {
  await projectService.deleteProject(req.tenantId.toString(), req.params.id as string);
  res.status(204).send();
});

// PATCH /api/v1/projects/:id/visibility
router.patch('/:id/visibility', rbac('projects:update'), async (req: Request, res: Response) => {
  const { visibility } = z.object({ visibility: z.enum(['org', 'private']) }).parse(req.body);
  const doc = await projectService.updateProject(req.tenantId.toString(), req.params.id as string, { visibility });
  if (visibility === 'private') {
    await BoardMember.updateOne(
      { board_id: doc._id, user_id: req.userId },
      { $setOnInsert: { tenant_id: req.tenantId, board_id: doc._id, user_id: req.userId, role: 'admin', invited_by: req.userId, joined_at: new Date() } },
      { upsert: true },
    );
  }
  res.json(serialize(doc));
});

// GET /api/v1/projects/:id/members
router.get('/:id/members', rbac('projects:read'), async (req: Request, res: Response) => {
  const members = await boardInviteService.listBoardMembers(new Types.ObjectId(req.params.id as string));
  res.json({ data: members });
});

// DELETE /api/v1/projects/:id/members/:userId
router.delete('/:id/members/:userId', rbac('projects:update'), async (req: Request, res: Response) => {
  await boardInviteService.removeBoardMember({
    boardId: new Types.ObjectId(req.params.id as string),
    userId: new Types.ObjectId(req.params.userId as string),
    actorId: req.userId,
  });
  res.status(204).send();
});

export default router;
