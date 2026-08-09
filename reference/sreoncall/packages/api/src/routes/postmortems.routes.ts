import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as postmortemService from '../services/postmortem.service';
import { Postmortem } from '../models/postmortem.model';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(500),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  summary: z.string().optional(),
  incident_id: z.string().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['draft', 'in-review', 'published']).optional(),
  summary: z.string().optional(),
  root_cause: z.string().optional(),
  contributing_factors: z.array(z.string()).optional(),
  timeline: z
    .array(z.object({ time: z.string(), description: z.string() }))
    .optional(),
  action_items: z
    .array(
      z.object({
        description: z.string(),
        owner_id: z.string().optional(),
        due_date: z.string().optional(),
        status: z.enum(['open', 'in_progress', 'done']).optional(),
      })
    )
    .optional(),
});

function serializePm(pm: any) {
  const author =
    pm.author_id && typeof pm.author_id === 'object' && pm.author_id.name
      ? { id: pm.author_id._id?.toString(), name: pm.author_id.name }
      : { id: pm.author_id?.toString(), name: 'Unknown' };
  return {
    id: pm._id.toString(),
    title: pm.title,
    incident_id: pm.incident_id?.toString() || null,
    severity: pm.severity,
    status: pm.status,
    summary: pm.summary,
    timeline: pm.timeline,
    root_cause: pm.root_cause,
    contributing_factors: pm.contributing_factors,
    action_items: pm.action_items,
    author,
    reviewed_by: (pm.reviewed_by || []).map((u: any) => u.toString()),
    published_at: pm.published_at || null,
    created_at: pm.created_at,
    updated_at: pm.updated_at,
  };
}

router.get('/', rbac('postmortems:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await postmortemService.listPostmortems(
    {
      tenant_id: req.tenantId,
      status: req.query.status as string | undefined,
      severity: req.query.severity as string | undefined,
    },
    pagination
  );
  res.json({ data: result.data.map(serializePm), pagination: result.pagination });
});

// GET /api/v1/postmortems/open-action-items-count?incident_ids=id1,id2
// Must be declared before /:id so Express doesn't interpret the literal path as a param.
router.get('/open-action-items-count', rbac('postmortems:read'), async (req: Request, res: Response) => {
  const raw = req.query.incident_ids;
  const incidentIds = typeof raw === 'string' ? raw.split(',').filter(Boolean) : [];

  if (incidentIds.length === 0) return res.json({ count: 0 });

  const postmortems = await Postmortem.find({
    tenant_id: req.tenantId,
    incident_id: { $in: incidentIds },
  }).select('action_items action_items_v2').lean();

  const openStatuses = new Set(['open', 'in_progress']);
  let count = 0;
  for (const pm of postmortems) {
    count += (pm.action_items ?? []).filter((a: any) => openStatuses.has(a.status)).length;
    count += (pm.action_items_v2 ?? []).filter((a: any) => openStatuses.has(a.status)).length;
  }

  res.json({ count });
});

router.get('/:id', rbac('postmortems:read'), async (req: Request, res: Response) => {
  const pm = await postmortemService.getPostmortemById(req.tenantId, req.params.id as string);
  res.json(serializePm(pm));
});

router.post('/', rbac('postmortems:create'), async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const pm = await postmortemService.createPostmortem({
    ...body,
    tenant_id: req.tenantId,
    author_id: req.userId,
  });
  res.status(201).json(serializePm(pm));
});

router.patch('/:id', rbac('postmortems:update'), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const pm = await postmortemService.updatePostmortem(
    req.tenantId,
    req.params.id as string,
    body
  );
  res.json(serializePm(pm));
});

router.delete('/:id', rbac('postmortems:delete'), async (req: Request, res: Response) => {
  await postmortemService.deletePostmortem(req.tenantId, req.params.id as string);
  res.status(204).send();
});

router.post('/:id/publish', rbac('postmortems:update'), async (req: Request, res: Response) => {
  const pm = await postmortemService.publishPostmortem(req.tenantId, req.params.id as string);
  res.json(serializePm(pm));
});

export default router;
