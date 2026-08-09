import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { resolveConsumerOrgId } from '../services/observability-upstream.service';
import {
  listMetricNames, listMetricLabelNames, listMetricLabelValues, getMetricType, sanitizeMetricScope,
} from '../services/observability-metrics-discovery.service';

const router = Router();
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Metric-name path-param grammar — broader than LABEL_NAME_RE: permits colons (recording rules, e.g.
// job:http_requests:rate5m) AND dots (vendor/OTLP-style names, e.g. http.server.duration). Safe to
// accept these — buildMetricMatcher routes anything outside the bare-name grammar through the
// `{__name__="<escaped>",...}` matcher form, so the value is always escaped before reaching Mimir.
// Capped at 200 chars, a generous ceiling for any real metric name (review fix #2).
const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:.]{0,199}$/;

async function orgFor(req: Request): Promise<string> {
  const consumerId = typeof req.query.consumer_id === 'string' ? req.query.consumer_id : undefined;
  const resolved = await resolveConsumerOrgId(String(req.tenantId), consumerId);
  if (!resolved) throw AppError.notFound('Observability consumer');
  return resolved.orgId;
}

router.get('/metric-names', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = await orgFor(req);
    const scope = sanitizeMetricScope(req.query as Record<string, unknown>); // strips consumer_id
    const out = await listMetricNames(orgId, scope);
    res.json({ metrics: out.values, total: out.total, truncated: out.truncated });
  } catch (err) { next(err); }
});

router.get('/metric/:metric/labels', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = z.string().min(1).parse(req.params.metric);
    if (!METRIC_NAME_RE.test(metric)) throw AppError.badRequest('Invalid metric name');
    const orgId = await orgFor(req);
    const scope = sanitizeMetricScope(req.query as Record<string, unknown>);
    const out = await listMetricLabelNames(orgId, metric, scope);
    res.json({ labels: out.values, total: out.total, truncated: out.truncated });
  } catch (err) { next(err); }
});

router.get('/metric/:metric/label/:name/values', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = z.string().min(1).parse(req.params.metric);
    if (!METRIC_NAME_RE.test(metric)) throw AppError.badRequest('Invalid metric name');
    const name = z.string().min(1).parse(req.params.name);
    if (!LABEL_NAME_RE.test(name)) throw AppError.badRequest('Invalid label name');
    const orgId = await orgFor(req);
    const scope = sanitizeMetricScope(req.query as Record<string, unknown>);
    const out = await listMetricLabelValues(orgId, metric, name, scope);
    res.json({ label: name, ...out });
  } catch (err) { next(err); }
});

router.get('/metric/:metric/type', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = z.string().min(1).parse(req.params.metric);
    if (!METRIC_NAME_RE.test(metric)) throw AppError.badRequest('Invalid metric name');
    const orgId = await orgFor(req);
    const type = await getMetricType(orgId, metric);
    res.json({ metric, type });
  } catch (err) { next(err); }
});

export default router;
