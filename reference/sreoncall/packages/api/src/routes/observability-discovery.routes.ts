import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { resolveOwnOrgId } from '../services/observability-upstream.service';
import {
  getChildren,
  getLevelHealth,
  listLabelValues,
  Level,
  DiscoveryScope,
} from '../services/observability-discovery.service';

const router = Router();

const childrenQuery = z.object({
  level: z.enum(['cluster', 'namespace', 'service', 'pod']),
  cluster: z.string().optional(),
  namespace: z.string().optional(),
  service: z.string().optional(),
});

function scopeFrom(q: { cluster?: string; namespace?: string; service?: string }): DiscoveryScope {
  const s: DiscoveryScope = {};
  if (q.cluster) s.cluster = q.cluster;
  if (q.namespace) s.namespace = q.namespace;
  if (q.service) s.service = q.service;
  return s;
}

router.get('/children', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = childrenQuery.safeParse(req.query);
    if (!parsed.success) throw AppError.badRequest('Invalid discovery query', parsed.error.issues);
    const orgId = await resolveOwnOrgId(String(req.tenantId));
    const scope = scopeFrom(parsed.data);
    const [out, health] = await Promise.all([
      getChildren(orgId, parsed.data.level as Level, scope),
      getLevelHealth(orgId, parsed.data.level as Level, scope),
    ]);
    res.json({ level: parsed.data.level, ...out, health });
  } catch (err) {
    next(err);
  }
});

router.get('/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = z.string().min(1).parse(req.params.name);
    const orgId = await resolveOwnOrgId(String(req.tenantId));
    const out = await listLabelValues(orgId, name, scopeFrom(req.query as any));
    res.json({ label: name, ...out });
  } catch (err) {
    next(err);
  }
});

export default router;
