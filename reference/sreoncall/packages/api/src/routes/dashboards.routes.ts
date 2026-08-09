import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import { Dashboard } from '../models/dashboard.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { DASHBOARD_TEMPLATES, getTemplatesByCategory } from '../data/dashboard-templates';

const router = Router();

const panelSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.enum(['line_chart', 'bar_chart', 'gauge', 'stat', 'table', 'heatmap', 'log_viewer', 'trace_waterfall']),
  grid: z.object({
    x: z.number().int().min(0).default(0),
    y: z.number().int().min(0).default(0),
    w: z.number().int().min(1).max(24).default(6),
    h: z.number().int().min(1).max(24).default(4),
  }),
  data_source: z.object({
    type: z.enum(['managed', 'byos']).default('managed'),
    provider: z.string().nullable().optional(),
    service_id: z.string().nullable().optional(),
  }).optional(),
  query: z.string().max(5000).default(''),
  options: z.record(z.any()).optional(),
  thresholds: z.array(z.object({
    value: z.number(),
    color: z.string(),
  })).optional(),
});

const variableSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'variable name must be a valid identifier'),
  label: z.string().min(1).max(200),
  type: z.enum(['query', 'custom']),
  source: z.object({
    label_name: z.string().min(1).max(200).optional(),
    values: z.array(z.string()).optional(),
  }).default({}),
  default: z.array(z.string()).default([]),
  multi: z.boolean().default(false),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  is_template: z.boolean().optional(),
  is_public: z.boolean().optional(),
  panels: z.array(panelSchema).optional(),
  variables: z.array(variableSchema).optional(),
  time_range: z.object({
    from: z.string().default('now-1h'),
    to: z.string().default('now'),
  }).optional(),
  refresh_interval_seconds: z.number().int().min(5).max(3600).optional(),
  tags: z.array(z.string()).optional(),
});

const updateSchema = createSchema.partial();

function serialize(d: any) {
  return {
    id: d._id?.toString() ?? d.id,
    name: d.name,
    description: d.description ?? '',
    is_template: d.is_template ?? false,
    is_public: d.is_public ?? false,
    share_token: d.share_token ?? null,
    panels: (d.panels || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      grid: p.grid,
      data_source: p.data_source ? {
        type: p.data_source.type ?? 'managed',
        provider: p.data_source.provider ?? null,
        service_id: p.data_source.service_id?.toString() ?? null,
      } : { type: 'managed', provider: null, service_id: null },
      query: p.query ?? '',
      options: p.options ?? {},
      thresholds: p.thresholds ?? [],
    })),
    variables: (d.variables || []).map((v: any) => ({
      name: v.name,
      label: v.label,
      type: v.type,
      source: {
        label_name: v.source?.label_name ?? null,
        values: v.source?.values ?? null,
        match_template: v.source?.match_template ?? null,
      },
      default: v.default ?? [],
      multi: v.multi ?? false,
    })),
    time_range: d.time_range ?? { from: 'now-1h', to: 'now' },
    refresh_interval_seconds: d.refresh_interval_seconds ?? 30,
    tags: d.tags ?? [],
    source_template_id: d.source_template_id ?? null,
    hide_scope: d.hide_scope ?? false,
    default_time_range: d.default_time_range ?? 'now-24h',
    created_by: d.created_by?.toString() ?? null,
    created_at: d.createdAt?.toISOString?.() ?? d.created_at,
    updated_at: d.updatedAt?.toISOString?.() ?? d.updated_at,
  };
}

// GET /api/v1/dashboards/templates — returns available pre-built dashboard templates
router.get('/templates', rbac('dashboards:read'), async (req: Request, res: Response) => {
  const { ObservabilityConnection } = await import('../models/observability-connection.model');
  const connections = await ObservabilityConnection.find({ tenant_id: req.tenantId, status: 'connected' }).lean();
  const activeVendors = new Set(connections.map((c: any) => c.vendor).filter(Boolean));

  const available = DASHBOARD_TEMPLATES.filter(
    (t) => t.requires_vendor === null || activeVendors.has(t.requires_vendor),
  );

  const grouped = getTemplatesByCategory(available);
  res.json({ data: available, grouped });
});

// POST /api/v1/dashboards/templates/:templateId/instantiate — create a dashboard from template
router.post('/templates/:templateId/instantiate', rbac('dashboards:create'), async (req: Request, res: Response) => {
  const template = DASHBOARD_TEMPLATES.find((t) => t.template_id === req.params['templateId']);
  if (!template) throw AppError.notFound('Dashboard template');

  const existing = await Dashboard.findOneAndUpdate(
    { tenant_id: req.tenantId, source_template_id: template.template_id },
    // Keep panels/name but refresh variables from the current template so that
    // match_template and other variable metadata stays in sync with the template.
    { $set: { variables: template.variables ?? [] } },
    { new: true },
  ).lean();
  if (existing) {
    return res.status(409).json({ error: 'already_cloned', dashboard: serialize(existing) });
  }

  const doc = await Dashboard.create({
    tenant_id: req.tenantId,
    created_by: req.userId,
    name: template.name,
    description: template.description,
    is_template: false,
    source_template_id: template.template_id,
    hide_scope: template.hide_scope ?? false,
    default_time_range: template.default_time_range ?? 'now-24h',
    panels: template.panels.map((p) => ({
      ...p,
      data_source: { type: 'managed', provider: null, service_id: null },
      options: p.options ?? {},
      thresholds: p.thresholds ?? [],
    })),
    variables: template.variables ?? [],
    tags: template.tags,
  });

  res.status(201).json(serialize(doc));
});

// GET /api/v1/dashboards
router.get('/', rbac('dashboards:read'), async (req: Request, res: Response) => {
  const filter: any = { tenant_id: req.tenantId };
  if (req.query.is_template === 'true') filter.is_template = true;
  if (req.query.tags) {
    filter.tags = { $in: (req.query.tags as string).split(',') };
  }

  const docs = await Dashboard.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({
    data: docs.map(serialize),
    pagination: { total: docs.length },
  });
});

// POST /api/v1/dashboards
router.post('/',
  rbac('dashboards:create'),
  requirePlanLimit('max_dashboards', async (req) => Dashboard.countDocuments({ tenant_id: req.tenantId })),
  async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await Dashboard.create({
    tenant_id: req.tenantId,
    created_by: req.userId,
    ...body,
  });
  res.status(201).json(serialize(doc));
});

// GET /api/v1/dashboards/:id
router.get('/:id', rbac('dashboards:read'), async (req: Request, res: Response) => {
  const doc = await Dashboard.findOne({ _id: req.params['id'], tenant_id: req.tenantId }).lean();
  if (!doc) throw AppError.notFound('Dashboard');
  res.json(serialize(doc));
});

// PATCH /api/v1/dashboards/:id
router.patch('/:id', rbac('dashboards:update'), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await Dashboard.findOneAndUpdate(
    { _id: req.params['id'], tenant_id: req.tenantId },
    { $set: body },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Dashboard');
  res.json(serialize(doc));
});

// DELETE /api/v1/dashboards/:id
router.delete('/:id', rbac('dashboards:delete'), async (req: Request, res: Response) => {
  const result = await Dashboard.deleteOne({ _id: req.params['id'], tenant_id: req.tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Dashboard');
  res.status(204).send();
});

// POST /api/v1/dashboards/:id/clone
router.post('/:id/clone', rbac('dashboards:create'), async (req: Request, res: Response) => {
  const original = await Dashboard.findOne({ _id: req.params['id'], tenant_id: req.tenantId }).lean();
  if (!original) throw AppError.notFound('Dashboard');

  // Find a unique name by incrementing the copy suffix
  const baseName = `${original.name} (Copy)`;
  let cloneName = baseName;
  let counter = 2;
  while (await Dashboard.exists({ tenant_id: req.tenantId, name: cloneName })) {
    cloneName = `${baseName} ${counter++}`;
  }

  const clone = await Dashboard.create({
    tenant_id: req.tenantId,
    created_by: req.userId,
    name: cloneName,
    description: original.description,
    is_template: false,
    is_public: false,
    source_template_id: null,
    panels: original.panels,
    variables: original.variables ?? [],
    time_range: original.time_range,
    refresh_interval_seconds: original.refresh_interval_seconds,
    tags: original.tags,
  });

  res.status(201).json(serialize(clone));
});

// POST /api/v1/dashboards/deduplicate — remove duplicate dashboards, keep newest per name/template
router.post('/deduplicate', rbac('dashboards:delete'), async (req: Request, res: Response) => {
  const all = await Dashboard.find({ tenant_id: req.tenantId, is_template: false })
    .sort({ updatedAt: -1 })
    .lean();

  const seen = new Map<string, string>();
  const toDelete: string[] = [];

  for (const d of all) {
    const key = d.source_template_id ?? d.name;
    if (seen.has(key)) {
      toDelete.push(d._id.toString());
    } else {
      seen.set(key, d._id.toString());
    }
  }

  if (toDelete.length > 0) {
    await Dashboard.deleteMany({ _id: { $in: toDelete }, tenant_id: req.tenantId });
  }

  res.json({ removed: toDelete.length });
});

export default router;
