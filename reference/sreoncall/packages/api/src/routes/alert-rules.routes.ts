import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import * as alertRuleService from '../services/alert-rule.service';
import { dryRunAlertRule, testSavedAlertRule } from '../services/alert-rule-evaluator.service';
import { AlertRule } from '../models/alert-rule.model';
import { ALERT_TEMPLATES, getTemplatesByCategory } from '../data/alert-templates';

const router = Router();

const conditionSchema = z.object({
  // metric/threshold are optional at the schema layer because native-PromQL
  // (`expr`) conditions don't use them; per-source requirements are enforced in
  // alert-rule.service.normalizeAndValidateInput.
  metric:         z.string().max(200).optional(),
  operator:       z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'expr', 'absent']),
  threshold:      z.number().optional(),
  window_minutes: z.number().int().min(1).max(1440).optional(),
  query:          z.string().max(5000).nullable().optional(),
});

// Compound conditions: multiple simultaneous conditions combined with AND/OR.
const conditionsArraySchema = z.array(conditionSchema).max(10);

const routingSchema = z.object({
  escalation_policy_id: z.string().nullable().optional(),
  oncall_schedule_id: z.string().nullable().optional(),
  additional_channels: z.array(z.string()).optional(),
}).optional();

const createSchema = z.object({
  name:                  z.string().min(1).max(200),
  description:           z.string().max(1000).optional(),
  service_id:            z.string().min(1, 'service_id is required'),
  status:                z.enum(['active', 'inactive']).optional(),
  severity:              z.enum(['critical', 'high', 'medium', 'low']).optional(),
  source_type:           z.enum(['managed_promql', 'managed_logql', 'byos_webhook', 'synthetic']).optional(),
  synthetic_check_id:    z.string().nullable().optional(),
  query:                 z.string().max(5000).nullable().optional(),
  condition:             conditionSchema,
  conditions:            conditionsArraySchema.optional(),
  condition_logic:       z.enum(['and', 'or']).optional(),
  for_duration_seconds:  z.number().int().min(0).max(86400).optional(),
  labels:                z.record(z.string()).optional(),
  routing:               routingSchema,
  auto_create_incident:  z.boolean().optional(),
  incident_severity:     z.enum(['sev1', 'sev2', 'sev3', 'sev4']).optional(),
  notification_channels: z.array(z.string()).optional(),
  webhook_url:           z.string().url().nullable().optional(),
  is_predefined:         z.boolean().optional(),
  template_id:           z.string().max(100).nullable().optional(),
  category:              z.string().max(100).nullable().optional(),
});

const dryRunSchema = createSchema.extend({
  sample_value: z.number().nullable().optional(),
});

const updateSchema = createSchema.extend({
  condition: conditionSchema.partial().optional(),
}).partial();

const createSilenceSchema = z.object({
  start:  z.string().min(1),
  end:    z.string().min(1),
  reason: z.string().max(500).optional(),
});

function serialize(r: any) {
  const service = r.service_id && typeof r.service_id === 'object' ? r.service_id : null;
  const labelsObj: Record<string, string> = {};
  if (r.labels) {
    if (r.labels instanceof Map) {
      r.labels.forEach((v: string, k: string) => { labelsObj[k] = v; });
    } else if (typeof r.labels === 'object') {
      Object.assign(labelsObj, r.labels);
    }
  }
  return {
    id:                    r._id?.toString() ?? r.id,
    name:                  r.name,
    description:           r.description ?? '',
    service_id:            service ? service._id?.toString() : (r.service_id?.toString() ?? null),
    service:               service ? {
      id:             service._id?.toString(),
      name:           service.name,
      type:           service.type,
      current_status: service.current_status,
    } : null,
    status:                r.status,
    severity:              r.severity,
    source_type:           r.source_type ?? 'managed_promql',
    synthetic_check_id:    r.synthetic_check_id?.toString?.() ?? null,
    query:                 r.query ?? null,
    condition:             r.condition,
    conditions:            r.conditions ?? [],
    condition_logic:       r.condition_logic ?? 'and',
    for_duration_seconds:  r.for_duration_seconds ?? 300,
    labels:                labelsObj,
    routing:               r.routing ? {
      escalation_policy_id: r.routing.escalation_policy_id?.toString() ?? null,
      oncall_schedule_id:   r.routing.oncall_schedule_id?.toString() ?? null,
      additional_channels:  r.routing.additional_channels ?? [],
    } : null,
    active_silences:       (r.active_silences ?? []).map((s: any) => ({
      _id:        s._id?.toString(),
      start:      s.start?.toISOString?.() ?? s.start,
      end:        s.end?.toISOString?.() ?? s.end,
      reason:     s.reason ?? '',
      created_by: s.created_by?.toString() ?? null,
    })),
    auto_create_incident:  r.auto_create_incident,
    incident_severity:     r.incident_severity,
    notification_channels: r.notification_channels ?? [],
    webhook_url:           r.webhook_url ?? null,
    webhook_secret:        r.webhook_secret ?? null,
    last_triggered_at:     r.last_triggered_at ?? null,
    last_webhook_at:       r.last_webhook_at ?? null,
    last_value:            r.last_value ?? null,
    alert_state:           r.alert_state ?? 'ok',
    last_firing_labels:    r.last_firing_labels ?? null,
    trigger_count:         r.trigger_count ?? 0,
    is_predefined:         r.is_predefined ?? false,
    template_id:           r.template_id ?? null,
    category:              r.category ?? null,
    created_by:            r.created_by?.toString() ?? null,
    created_at:            r.created_at,
    updated_at:            r.updated_at,
  };
}

// GET /api/v1/alert-rules/templates — returns available pre-defined alert templates
router.get('/templates', rbac('alert-rules:read'), async (req: Request, res: Response) => {
  // Optionally filter by active connection vendors
  const { ObservabilityConnection } = await import('../models/observability-connection.model');
  const connections = await ObservabilityConnection.find({ tenant_id: req.tenantId, status: 'connected' }).lean();
  const activeVendors = new Set(connections.map((c: any) => c.vendor).filter(Boolean));

  // Filter templates: show all with requires_vendor=null, or those matching active vendors
  const available = ALERT_TEMPLATES.filter(
    (t) => t.requires_vendor === null || activeVendors.has(t.requires_vendor),
  );

  // Check which templates are already activated (and currently active) for this tenant
  const { AlertRule } = await import('../models/alert-rule.model');
  const predefined = await AlertRule.find({ tenant_id: req.tenantId, is_predefined: true }).lean();
  const activatedIds = new Set(predefined.map((r: any) => r.template_id));
  const activeIds = new Set(
    predefined.filter((r: any) => r.status === 'active').map((r: any) => r.template_id),
  );

  const grouped = getTemplatesByCategory(available);

  res.json({
    data: available.map((t) => ({
      ...t,
      is_active: activeIds.has(t.template_id),
    })),
    grouped,
    activated_template_ids: Array.from(activatedIds),
  });
});

// GET /api/v1/alert-rules
router.get('/', rbac('alert-rules:read'), async (req: Request, res: Response) => {
  const result = await alertRuleService.listAlertRules(req.tenantId.toString(), {
    status:     req.query.status as string | undefined,
    severity:   req.query.severity as string | undefined,
    service_id: req.query.service_id as string | undefined,
    search:     req.query.search as string | undefined,
    limit:      req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor:     req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// POST /api/v1/alert-rules/dry-run
router.post('/dry-run', rbac('alert-rules:create'), async (req: Request, res: Response) => {
  const body = dryRunSchema.parse(req.body);
  const result = await dryRunAlertRule(req.tenantId.toString(), body as any);
  res.json(result);
});

// GET /api/v1/alert-rules/:id
router.get('/:id', rbac('alert-rules:read'), async (req: Request, res: Response) => {
  const doc = await alertRuleService.getAlertRuleById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// POST /api/v1/alert-rules
//
// The plan limit counts ACTIVE CUSTOM rules only, not everything in the
// collection. Predefined-template activations are platform-provided, and
// disabled rules consume no evaluation resources — penalising tenants for
// either would defeat the purpose of the cap.
router.post('/',
  rbac('alert-rules:create'),
  requirePlanLimit('max_alert_rules', async (req) => AlertRule.countDocuments({
    tenant_id: req.tenantId,
    status: 'active',
    $or: [{ is_predefined: false }, { is_predefined: { $exists: false } }],
  })),
  auditMiddleware({ action: 'alert_rule.created', resourceType: 'alert_rule' }),
  async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await alertRuleService.createAlertRule(req.tenantId.toString(), req.userId.toString(), body as any);
  res.status(201).json(serialize(doc));
});

// PATCH /api/v1/alert-rules/:id
router.patch('/:id', rbac('alert-rules:update'), auditMiddleware({ action: 'alert_rule.updated', resourceType: 'alert_rule' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await alertRuleService.updateAlertRule(req.tenantId.toString(), req.params['id'] as string, body as any);
  res.json(serialize(doc));
});

// DELETE /api/v1/alert-rules/:id
router.delete('/:id', rbac('alert-rules:delete'), auditMiddleware({ action: 'alert_rule.deleted', resourceType: 'alert_rule' }), async (req: Request, res: Response) => {
  await alertRuleService.deleteAlertRule(req.tenantId.toString(), req.params['id'] as string);
  res.status(204).send();
});

// POST /api/v1/alert-rules/:id/toggle — enable/disable
router.post('/:id/toggle', rbac('alert-rules:update'), async (req: Request, res: Response) => {
  const rule = await alertRuleService.getAlertRuleById(req.tenantId.toString(), req.params['id'] as string);
  const newStatus = (rule as any).status === 'active' ? 'inactive' : 'active';
  const doc = await alertRuleService.updateAlertRule(req.tenantId.toString(), req.params['id'] as string, { status: newStatus });
  res.json(serialize(doc));
});

// POST /api/v1/alert-rules/:id/test — source-aware inspection / test helper
router.post('/:id/test', rbac('alert-rules:update'), async (req: Request, res: Response) => {
  const result = await testSavedAlertRule(req.tenantId.toString(), req.params['id'] as string);
  res.json(result);
});

// POST /api/v1/alert-rules/:id/silences — create silence
router.post('/:id/silences', rbac('alert-rules:update'), async (req: Request, res: Response) => {
  const body = createSilenceSchema.parse(req.body);
  const { AlertRule } = await import('../models/alert-rule.model');
  const rule = await AlertRule.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
  if (!rule) { res.status(404).json({ detail: 'Alert rule not found' }); return; }

  rule.active_silences.push({
    start: new Date(body.start),
    end: new Date(body.end),
    reason: body.reason || '',
    created_by: req.userId,
  } as any);
  await rule.save();
  res.status(201).json(serialize(rule));
});

// DELETE /api/v1/alert-rules/:id/silences/:silenceId — remove silence
router.delete('/:id/silences/:silenceId', rbac('alert-rules:update'), async (req: Request, res: Response) => {
  const { AlertRule } = await import('../models/alert-rule.model');
  const rule = await AlertRule.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
  if (!rule) { res.status(404).json({ detail: 'Alert rule not found' }); return; }

  const idx = rule.active_silences.findIndex((s: any) => s._id.toString() === req.params['silenceId']);
  if (idx === -1) { res.status(404).json({ detail: 'Silence not found' }); return; }
  rule.active_silences.splice(idx, 1);
  await rule.save();
  res.json(serialize(rule));
});

export default router;
