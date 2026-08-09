import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as linkService from '../../services/platform/provider-link.service';
import { parsePaginationParams } from '../../utils/pagination';

const router = Router();

function serializeLink(l: any) {
  return {
    _id: l._id.toString(),
    provider_tenant_id: l.provider_tenant_id?._id?.toString() || l.provider_tenant_id?.toString(),
    consumer_tenant_id: l.consumer_tenant_id?._id?.toString() || l.consumer_tenant_id?.toString(),
    provider_tenant: l.provider_tenant_id?._id ? {
      _id: l.provider_tenant_id._id.toString(),
      slug: l.provider_tenant_id.slug,
      name: l.provider_tenant_id.name,
      type: l.provider_tenant_id.type,
    } : undefined,
    consumer_tenant: l.consumer_tenant_id?._id ? {
      _id: l.consumer_tenant_id._id.toString(),
      slug: l.consumer_tenant_id.slug,
      name: l.consumer_tenant_id.name,
      type: l.consumer_tenant_id.type,
    } : undefined,
    status: l.status,
    scope: l.scope,
    created_by: l.created_by?.toString(),
    createdAt: l.createdAt?.toISOString?.() || l.createdAt,
    updatedAt: l.updatedAt?.toISOString?.() || l.updatedAt,
  };
}

const createLinkSchema = z.object({
  provider_tenant_id: z.string().min(1),
  consumer_tenant_id: z.string().min(1),
  scope: z.array(z.enum(['incidents', 'escalations', 'oncall', 'runbooks', 'communications', 'tickets', 'changes', 'managed_support', 'observability'])).min(1),
});

const updateLinkSchema = z.object({
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  scope: z.array(z.enum(['incidents', 'escalations', 'oncall', 'runbooks', 'communications', 'tickets', 'changes', 'managed_support', 'observability'])).optional(),
});

// GET /platform/provider-links
router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filter = {
    provider_tenant_id: req.query.provider_tenant_id as string | undefined,
    consumer_tenant_id: req.query.consumer_tenant_id as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = await linkService.listLinks(filter, pagination);
  res.json({
    data: result.data.map(serializeLink),
    pagination: result.pagination,
  });
});

// POST /platform/provider-links
router.post('/', async (req: Request, res: Response) => {
  const body = createLinkSchema.parse(req.body);
  const link = await linkService.createLink(
    body.provider_tenant_id,
    body.consumer_tenant_id,
    body.scope,
    req.userId,
  );
  res.status(201).json(serializeLink(link));
});

// PATCH /platform/provider-links/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const body = updateLinkSchema.parse(req.body);
  const link = await linkService.updateLink(req.params['id'] as string, body);
  res.json(serializeLink(link));
});

// DELETE /platform/provider-links/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await linkService.deleteLink(req.params['id'] as string);
  res.status(204).send();
});

export default router;
