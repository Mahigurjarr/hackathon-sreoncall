import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { resolveLogsEndpoint } from '../services/observability-upstream.service';
import { listLogLabelNames, listLogLabelValues, sanitizeLogScope } from '../services/observability-logs-discovery.service';

const router = Router();
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

router.get('/labels', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url, orgId } = await resolveLogsEndpoint(String(req.tenantId));
    const out = await listLogLabelNames(url, orgId);
    res.json({ labels: out.values, total: out.total, truncated: out.truncated });
  } catch (err) { next(err); }
});

router.get('/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = z.string().min(1).parse(req.params.name);
    if (!LABEL_NAME_RE.test(name)) throw AppError.badRequest('Invalid label name');
    const { url, orgId } = await resolveLogsEndpoint(String(req.tenantId));
    const scope = sanitizeLogScope(req.query as Record<string, unknown>);
    const out = await listLogLabelValues(url, orgId, name, scope);
    res.json({ label: name, ...out });
  } catch (err) { next(err); }
});

export default router;
