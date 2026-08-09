import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { resolveConsumerOrgId } from '../services/observability-upstream.service';
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
  consumer_id: z.string().optional(),
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
    const resolved = await resolveConsumerOrgId(String(req.tenantId), parsed.data.consumer_id);
    if (!resolved) throw AppError.notFound('Observability consumer');
    const scope = scopeFrom(parsed.data);
    const [out, health] = await Promise.all([
      getChildren(resolved.orgId, parsed.data.level as Level, scope),
      getLevelHealth(resolved.orgId, parsed.data.level as Level, scope),
    ]);
    res.json({ level: parsed.data.level, consumer_count: resolved.count, ...out, health });
  } catch (err) {
    next(err);
  }
});

router.get('/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = z.string().min(1).parse(req.params.name);
    const consumerId = typeof req.query.consumer_id === 'string' ? req.query.consumer_id : undefined;
    const resolved = await resolveConsumerOrgId(String(req.tenantId), consumerId);
    if (!resolved) throw AppError.notFound('Observability consumer');
    const out = await listLabelValues(resolved.orgId, name, scopeFrom(req.query as any));
    res.json({ label: name, consumer_count: resolved.count, ...out });
  } catch (err) {
    next(err);
  }
});

export default router;
