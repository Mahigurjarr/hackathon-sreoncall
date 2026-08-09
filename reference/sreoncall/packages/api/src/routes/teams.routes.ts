import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as teamService from '../services/team.service';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  members: z.array(z.string()).optional(),
  team_lead: z.string().nullable().optional(),
  manager: z.string().nullable().optional(),
});

const updateTeamSchema = createTeamSchema.partial();

function serializeUser(u: any) {
  if (!u) return null;
  if (typeof u === 'object' && u.name) {
    return { _id: u._id?.toString(), name: u.name, email: u.email };
  }
  return null;
}

function serializeTeam(t: any) {
  const members = (t.members || []).map((m: any) =>
    typeof m === 'object' && m.name
      ? { _id: m._id?.toString(), name: m.name, email: m.email }
      : { _id: m?.toString(), name: 'Unknown', email: '' }
  );
  const createdBy =
    t.created_by && typeof t.created_by === 'object' && t.created_by.name
      ? t.created_by.name
      : t.created_by?.toString();
  return {
    _id: t._id.toString(),
    id: t._id.toString(),
    name: t.name,
    description: t.description,
    members,
    team_lead: serializeUser(t.team_lead),
    manager: serializeUser(t.manager),
    created_by: createdBy,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

// GET /api/v1/teams
router.get('/', rbac('teams:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await teamService.listTeams(req.tenantId, pagination);
  res.json({ data: result.data.map(serializeTeam), pagination: result.pagination });
});

// GET /api/v1/teams/check-conflicts — MUST be before /:id
router.get('/check-conflicts', rbac('teams:read'), async (req: Request, res: Response) => {
  const userIdsRaw = req.query.user_ids as string | undefined;
  if (!userIdsRaw) {
    res.json({ conflicts: [] });
    return;
  }
  const userIds = userIdsRaw.split(',').filter(Boolean);
  const excludeTeamId = req.query.exclude_team_id as string | undefined;
  const conflicts = await teamService.checkMemberConflicts(req.tenantId, userIds, excludeTeamId);
  res.json({ conflicts });
});

// GET /api/v1/teams/:id
router.get('/:id', rbac('teams:read'), async (req: Request, res: Response) => {
  const team = await teamService.getTeamById(req.tenantId, req.params['id'] as string);
  res.json(serializeTeam(team));
});

// POST /api/v1/teams
router.post('/', rbac('teams:create'), async (req: Request, res: Response) => {
  const body = createTeamSchema.parse(req.body);
  const team = await teamService.createTeam({
    ...body,
    tenant_id: req.tenantId,
    created_by: req.userId,
  });
  res.status(201).json(serializeTeam(team));
});

// PATCH /api/v1/teams/:id
router.patch('/:id', rbac('teams:update'), async (req: Request, res: Response) => {
  const body = updateTeamSchema.parse(req.body);
  const team = await teamService.updateTeam(req.tenantId, req.params['id'] as string, body);
  res.json(serializeTeam(team));
});

// POST /api/v1/teams/:id/members
router.post('/:id/members', rbac('teams:update'), async (req: Request, res: Response) => {
  const { user_id } = z.object({ user_id: z.string() }).parse(req.body);
  const team = await teamService.addMember(req.tenantId, req.params['id'] as string, user_id);
  res.json(serializeTeam(team));
});

// DELETE /api/v1/teams/:id/members/:userId
router.delete('/:id/members/:userId', rbac('teams:update'), async (req: Request, res: Response) => {
  const team = await teamService.removeMember(req.tenantId, req.params['id'] as string, req.params['userId'] as string);
  res.json(serializeTeam(team));
});

// DELETE /api/v1/teams/:id
router.delete('/:id', rbac('teams:delete'), async (req: Request, res: Response) => {
  await teamService.deleteTeam(req.tenantId, req.params['id'] as string);
  res.status(204).send();
});

export default router;
