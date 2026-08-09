import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { rbac } from '../middleware/rbac.middleware';
import * as boardInviteService from '../services/board-invite.service';
import { Tenant } from '../models/tenant.model';

const router = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
});

// POST /projects/:projectId/invites
router.post('/projects/:projectId/invites', rbac('projects:update'), async (req: Request, res: Response) => {
  const body = inviteSchema.parse(req.body);
  const tenant = await Tenant.findById(req.tenantId).select('name slug').lean();
  const orgName = (tenant as any)?.name ?? 'Your Organization';
  const orgSlug = (tenant as any)?.slug ?? '';

  const invite = await boardInviteService.inviteUserToBoard({
    boardId: new Types.ObjectId(req.params.projectId as string),
    tenantId: req.tenantId,
    email: body.email,
    role: body.role,
    invitedBy: req.userId,
    orgName,
    orgSlug,
  });

  res.status(201).json(invite);
});

// GET /projects/:projectId/invites
router.get('/projects/:projectId/invites', rbac('projects:read'), async (req: Request, res: Response) => {
  const invites = await boardInviteService.listBoardInvites(new Types.ObjectId(req.params.projectId as string));
  res.json({ data: invites });
});

// DELETE /projects/:projectId/invites/:inviteId
router.delete('/projects/:projectId/invites/:inviteId', rbac('projects:update'), async (req: Request, res: Response) => {
  await boardInviteService.revokeBoardInvite({
    inviteId: new Types.ObjectId(req.params.inviteId as string),
    boardId: new Types.ObjectId(req.params.projectId as string),
    actorId: req.userId,
  });
  res.status(204).send();
});

// GET /invites/board/:token
router.get('/invites/board/:token', async (req: Request, res: Response) => {
  const member = await boardInviteService.acceptBoardInvite({
    token: req.params.token as string,
    userId: req.userId,
    tenantId: req.tenantId,
  });
  res.json(member);
});

export default router;
