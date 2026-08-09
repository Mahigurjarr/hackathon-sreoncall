import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as alertQualityService from '../services/alert-quality.service';

const router = Router();

function serialize(doc: any) {
  const alertRule = doc.alert_rule_id && typeof doc.alert_rule_id === 'object' ? doc.alert_rule_id : null;
  return {
    id: doc._id?.toString() ?? doc.id,
    alert_rule_id: alertRule ? alertRule._id?.toString() : (doc.alert_rule_id?.toString() ?? null),
    alert_rule: alertRule ? {
      id: alertRule._id?.toString(),
      name: alertRule.name,
      severity: alertRule.severity,
      status: alertRule.status,
    } : null,
    period_start: doc.period_start,
    period_end: doc.period_end,
    total_firings: doc.total_firings,
    acknowledged_count: doc.acknowledged_count,
    dismissed_count: doc.dismissed_count,
    incident_created_count: doc.incident_created_count,
    auto_resolved_count: doc.auto_resolved_count,
    avg_time_to_action_seconds: doc.avg_time_to_action_seconds,
    signal_score: doc.signal_score,
    noise_score: doc.noise_score,
    recommendation: doc.recommendation,
    recommendation_details: doc.recommendation_details,
    suggested_threshold: doc.suggested_threshold,
    current_threshold: doc.current_threshold,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

// GET /api/v1/alert-quality
router.get('/', rbac('alert-rules:read'), async (req: Request, res: Response) => {
  const result = await alertQualityService.list(req.tenantId.toString(), {
    alert_rule_id: req.query.alert_rule_id as string | undefined,
    service_id: req.query.service_id as string | undefined,
    recommendation: req.query.recommendation as string | undefined,
    period_start: req.query.period_start as string | undefined,
    period_end: req.query.period_end as string | undefined,
    min_noise_score: req.query.min_noise_score ? parseInt(req.query.min_noise_score as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/alert-quality/report
router.get('/report', rbac('alert-rules:read'), async (req: Request, res: Response) => {
  const period = (req.query.period as string) === 'monthly' ? 'monthly' : 'weekly';
  const report = await alertQualityService.getReport(req.tenantId.toString(), period);
  res.json(report);
});

// GET /api/v1/alert-quality/:alertRuleId
router.get('/:alertRuleId', rbac('alert-rules:read'), async (req: Request, res: Response) => {
  const docs = await alertQualityService.getByAlertRule(
    req.tenantId.toString(),
    req.params['alertRuleId'] as string,
  );
  res.json({ data: docs.map(serialize) });
});

// POST /api/v1/alert-quality/recalculate
router.post('/recalculate', rbac('alert-rules:update'), async (req: Request, res: Response) => {
  const result = await alertQualityService.recalculate(req.tenantId.toString());
  res.json(result);
});

export default router;
