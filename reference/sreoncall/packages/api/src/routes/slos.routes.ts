import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import { SloDefinition } from '../models/slo-definition.model';

const router = Router();

const createSchema = z.object({
  service_id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sli: z.object({
    source: z.enum(['managed_promql', 'managed_logql', 'synthetic', 'byos']),
    query_good: z.string().optional().default(''),
    query_total: z.string().optional().default(''),
    synthetic_check_id: z.string().nullable().optional(),
  }),
  objective_pct: z.number().min(0).max(100),
  window_days: z.number().int().min(1).max(365).optional(),
  alert_on_burn_rate: z.boolean().optional(),
  burn_rate_thresholds: z.object({
    fast_burn: z.number().optional(),
    slow_burn: z.number().optional(),
  }).optional(),
});

const updateSchema = createSchema.partial();

function serialize(s: any) {
  return {
    id: s._id?.toString() ?? s.id,
    service_id: s.service_id?.toString() ?? null,
    name: s.name,
    description: s.description,
    sli: s.sli,
    objective_pct: s.objective_pct,
    window_days: s.window_days,
    alert_on_burn_rate: s.alert_on_burn_rate,
    burn_rate_thresholds: s.burn_rate_thresholds,
    status: s.status,
    current_sli_pct: s.current_sli_pct,
    error_budget_remaining_pct: s.error_budget_remaining_pct,
    burn_rate: s.burn_rate,
    predictive_alerts: s.predictive_alerts,
    burn_rate_data: s.burn_rate_data,
    last_evaluated_at: s.last_evaluated_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

// List SLOs
router.get('/', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const docs = await SloDefinition.find({ tenant_id: tenantId }).sort({ created_at: -1 });
  res.json({ data: docs.map(serialize) });
});

// Get single SLO
router.get('/:id', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const doc = await SloDefinition.findOne({ _id: req.params.id, tenant_id: tenantId });
  if (!doc) return res.status(404).json({ error: 'SLO not found' });
  res.json({ data: serialize(doc) });
});

// Create SLO
router.post(
  '/',
  rbac('monitoring-integrations:create'),
  requirePlanLimit('max_slos', async (req) => SloDefinition.countDocuments({ tenant_id: req.tenantId })),
  auditMiddleware({ action: 'slo.create', resourceType: 'slo' }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const body = createSchema.parse(req.body);
    const doc = await SloDefinition.create({
      ...body,
      tenant_id: tenantId,
      created_by: userId,
    });

    if (body.alert_on_burn_rate) {
      try {
        const { AlertRule } = await import('../models/alert-rule.model');
        await AlertRule.create({
          tenant_id: tenantId,
          created_by: userId,
          name: `${body.name} — Burn Rate Alert`,
          description: `Auto-created burn rate alert for SLO: ${body.name}`,
          status: 'active',
          severity: 'high',
          source_type: 'managed_promql',
          query: body.sli.query_total
            ? `1 - (${body.sli.query_good || '0'}) / (${body.sli.query_total})`
            : null,
          condition: {
            metric: 'slo_burn_rate',
            operator: 'gt',
            threshold: body.burn_rate_thresholds?.fast_burn ?? 10,
            window_minutes: 5,
          },
          for_duration_seconds: 300,
          is_predefined: true,
          template_id: `slo_burn_rate_${doc._id}`,
          category: 'SLO',
          labels: { slo_id: doc._id.toString(), slo_name: body.name },
        });
      } catch (err: any) {
        // Don't fail SLO creation if alert creation fails
        console.error('Failed to auto-create burn rate alert:', err.message);
      }
    }

    res.status(201).json({ data: serialize(doc) });
  },
);

// GET /api/v1/slos/:id/burn-rate — get current burn rate and forecast
router.get('/:id/burn-rate', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const doc = await SloDefinition.findOne({ _id: req.params.id, tenant_id: tenantId });
  if (!doc) return res.status(404).json({ error: 'SLO not found' });

  const burnRate = doc.burn_rate_data ?? {
    current_1h: null,
    current_6h: null,
    current_24h: null,
    forecast_breach_at: null,
    forecast_confidence: null,
  };

  // Compute time remaining based on current error budget and burn rate
  const errorBudgetPct = doc.error_budget_remaining_pct;
  const currentBurn = burnRate.current_1h;
  let estimated_exhaustion_hours: number | null = null;
  if (errorBudgetPct != null && currentBurn != null && currentBurn > 0) {
    estimated_exhaustion_hours = Math.round((errorBudgetPct / currentBurn) * 10) / 10;
  }

  res.json({
    data: {
      slo_id: doc._id.toString(),
      name: doc.name,
      objective_pct: doc.objective_pct,
      window_days: doc.window_days,
      current_sli_pct: doc.current_sli_pct,
      error_budget_remaining_pct: doc.error_budget_remaining_pct,
      burn_rate: burnRate,
      estimated_exhaustion_hours,
      predictive_alerts: doc.predictive_alerts ?? { enabled: false, warn_at_budget_percent: 50, critical_at_budget_percent: 80 },
      last_evaluated_at: doc.last_evaluated_at,
    },
  });
});

// Update SLO
router.patch(
  '/:id',
  rbac('monitoring-integrations:create'),
  auditMiddleware({ action: 'slo.update', resourceType: 'slo', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const body = updateSchema.parse(req.body);
    const doc = await SloDefinition.findOneAndUpdate(
      { _id: req.params.id, tenant_id: tenantId },
      { $set: body },
      { new: true },
    );
    if (!doc) return res.status(404).json({ error: 'SLO not found' });
    res.json({ data: serialize(doc) });
  },
);

// Delete SLO
router.delete(
  '/:id',
  rbac('monitoring-integrations:delete'),
  auditMiddleware({ action: 'slo.delete', resourceType: 'slo', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const doc = await SloDefinition.findOneAndDelete({ _id: req.params.id, tenant_id: tenantId });
    if (!doc) return res.status(404).json({ error: 'SLO not found' });
    res.json({ message: 'SLO deleted' });
  },
);

export default router;
