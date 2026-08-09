import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AgentDefinition } from '../models/agent-definition.model';
import { AgentInstallation } from '../models/agent-installation.model';
import { AgentExecution } from '../models/agent-execution.model';
import { AgentUsage } from '../models/agent-usage.model';

const router = Router();

// All routes require platform_admin role (checked via rbac('*') or role check in route registration)

// ─── Catalog Management ──────────────────────────────────────────────────────

router.get('/catalog', async (req: Request, res: Response) => {
  const agents = await AgentDefinition.find()
    .sort({ category: 1, sort_order: 1 })
    .lean();

  // Enrich with install counts
  const installCounts = await AgentInstallation.aggregate([
    { $group: { _id: '$agent_slug', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(installCounts.map((c) => [c._id, c.count]));

  const enriched = agents.map((a) => ({
    ...a,
    install_count: countMap.get(a.slug) || 0,
  }));

  res.json(enriched);
});

const updateCatalogSchema = z.object({
  is_active: z.boolean().optional(),
  is_beta: z.boolean().optional(),
  pricing: z.object({
    monthly_cents: z.number().int().min(0).optional(),
    stripe_price_id: z.string().optional(),
  }).optional(),
  required_plan: z.enum(['starter', 'business', 'enterprise']).optional(),
  sort_order: z.number().int().optional(),
});

router.patch('/catalog/:slug', async (req: Request, res: Response) => {
  const body = updateCatalogSchema.parse(req.body);

  const update: any = {};
  if (body.is_active !== undefined) update.is_active = body.is_active;
  if (body.is_beta !== undefined) update.is_beta = body.is_beta;
  if (body.required_plan) update.required_plan = body.required_plan;
  if (body.sort_order !== undefined) update.sort_order = body.sort_order;
  if (body.pricing) {
    if (body.pricing.monthly_cents !== undefined) update['pricing.monthly_cents'] = body.pricing.monthly_cents;
    if (body.pricing.stripe_price_id) update['pricing.stripe_price_id'] = body.pricing.stripe_price_id;
  }

  const agent = await AgentDefinition.findOneAndUpdate(
    { slug: req.params.slug },
    { $set: update },
    { new: true }
  );

  if (!agent) {
    res.status(404).json({ detail: 'Agent not found' });
    return;
  }

  res.json(agent);
});

// ─── Analytics ───────────────────────────────────────────────────────────────

router.get('/analytics', async (req: Request, res: Response) => {
  const period = req.query.period as string || getCurrentPeriod();

  // Aggregate usage across all tenants
  const usageByAgent = await AgentUsage.aggregate([
    { $match: { period } },
    {
      $group: {
        _id: '$agent_slug',
        total_executions: { $sum: '$executions' },
        total_tokens: { $sum: { $add: ['$input_tokens', '$output_tokens'] } },
        total_cost_cents: { $sum: '$cost_cents' },
        tenant_count: { $addToSet: '$tenant_id' },
      },
    },
    {
      $project: {
        agent_slug: '$_id',
        total_executions: 1,
        total_tokens: 1,
        total_cost_cents: 1,
        active_tenants: { $size: '$tenant_count' },
      },
    },
    { $sort: { total_executions: -1 } },
  ]);

  // Total installations
  const totalInstalls = await AgentInstallation.countDocuments({ enabled: true });

  // Total active tenants with agents
  const activeTenants = await AgentInstallation.distinct('tenant_id', { enabled: true });

  res.json({
    period,
    total_installations: totalInstalls,
    active_tenants: activeTenants.length,
    usage_by_agent: usageByAgent,
  });
});

// ─── Billing/Revenue ─────────────────────────────────────────────────────────

router.get('/billing', async (req: Request, res: Response) => {
  const period = req.query.period as string || getCurrentPeriod();

  const revenue = await AgentUsage.aggregate([
    { $match: { period } },
    {
      $group: {
        _id: '$agent_slug',
        total_revenue_cents: { $sum: '$cost_cents' },
        tenant_count: { $addToSet: '$tenant_id' },
      },
    },
    {
      $project: {
        agent_slug: '$_id',
        total_revenue_cents: 1,
        paying_tenants: { $size: '$tenant_count' },
      },
    },
    { $sort: { total_revenue_cents: -1 } },
  ]);

  const totalRevenue = revenue.reduce((sum, r) => sum + r.total_revenue_cents, 0);

  res.json({
    period,
    total_revenue_cents: totalRevenue,
    revenue_by_agent: revenue,
  });
});

// ─── Kill Switch ─────────────────────────────────────────────────────────────

router.post('/kill-switch/:slug', async (req: Request, res: Response) => {
  const agent = await AgentDefinition.findOneAndUpdate(
    { slug: req.params.slug },
    { $set: { is_active: false } },
    { new: true }
  );

  if (!agent) {
    res.status(404).json({ detail: 'Agent not found' });
    return;
  }

  // Disable all installations
  const result = await AgentInstallation.updateMany(
    { agent_slug: req.params.slug },
    { $set: { enabled: false } }
  );

  res.json({
    message: `Agent "${req.params.slug}" disabled globally`,
    installations_disabled: result.modifiedCount,
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default router;
