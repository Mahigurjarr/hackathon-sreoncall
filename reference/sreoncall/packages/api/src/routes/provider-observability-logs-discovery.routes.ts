import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { resolveConsumerOrgId, MANAGED_LOKI_URL } from '../services/observability-upstream.service';
import { listLogLabelNames, listLogLabelValues, sanitizeLogScope } from '../services/observability-logs-discovery.service';

const router = Router();
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function orgFor(req: Request): Promise<string> {
  const consumerId = typeof req.query.consumer_id === 'string' ? req.query.consumer_id : undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumerId);
  if (!resolved) throw AppError.notFound('Observability consumer');
  return resolved.orgId;
}

router.get('/labels', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await orgFor(req);
    const out = await listLogLabelNames(MANAGED_LOKI_URL, orgId);
    res.json({ labels: out.values, total: out.total, truncated: out.truncated });
  } catch (err) { next(err); }
});

router.get('/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = z.string().min(1).parse(req.params.name);
    if (!LABEL_NAME_RE.test(name)) throw AppError.badRequest('Invalid label name');
    const orgId = await orgFor(req);
    const scope = sanitizeLogScope(req.query as Record<string, unknown>); // strips consumer_id
    const out = await listLogLabelValues(MANAGED_LOKI_URL, orgId, name, scope);
    res.json({ label: name, ...out });
  } catch (err) { next(err); }
});

export default router;
