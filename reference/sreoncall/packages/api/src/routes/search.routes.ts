import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as searchService from '../services/search.service';
import { rbac } from '../middleware/rbac.middleware';

const router = Router();

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  types: z.string().optional(), // comma-separated: "tickets,users"
  status: z.string().optional(),
  priority: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// GET /api/v1/search?q=...
router.get('/', rbac('search:read'), async (req: Request, res: Response) => {
  const query = searchQuerySchema.parse(req.query);

  const entityTypes = query.types ? query.types.split(',').map((t) => t.trim()) : undefined;
  const filters: Record<string, any> = {};
  if (query.status) filters.status = query.status;
  if (query.priority) filters.priority = parseInt(query.priority, 10);

  const result = await searchService.search({
    query: query.q,
    tenant_id: req.tenantId,
    entity_types: entityTypes,
    filters,
    limit: query.limit,
    offset: query.offset,
  });

  res.json(result);
});

export default router;
