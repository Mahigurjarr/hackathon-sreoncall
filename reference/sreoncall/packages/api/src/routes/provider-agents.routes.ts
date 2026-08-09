import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import { AgentInstallation } from '../models/agent-installation.model';
import { AgentExecution } from '../models/agent-execution.model';
import { AgentApproval } from '../models/agent-approval.model';
import { AgentUsage } from '../models/agent-usage.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';

const router = Router();

// All routes require provider tenant type
router.use(requireTenantType('provider'));

// ─── Cross-Consumer Dashboard ────────────────────────────────────────────────

router.get('/dashboard', rbac('agents:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  // Get all consumer links for this provider
  const links = await ProviderConsumerLink.find({
    provider_tenant_id: tenantId,
    status: 'active',
  }).lean();

  const consumerIds = links.map((l) => l.consumer_tenant_id);

  // Aggregate stats across all consumers
  const [installations, pendingApprovals, todayExecutions, monthUsage] = await Promise.all([
    AgentInstallation.find({ tenant_id: tenantId, enabled: true }).countDocuments(),
    AgentApproval.countDocuments({ tenant_id: tenantId, status: 'pending' }),
    AgentExecution.countDocuments({
      tenant_id: tenantId,
      started_at: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
    AgentUsage.find({
      tenant_id: tenantId,
      period: getCurrentPeriod(),
    }).lean(),
  ]);

  const totalCost = monthUsage.reduce((sum, u) => sum + u.cost_cents, 0);

  // Per-consumer execution counts
  const consumerStats = await AgentExecution.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        consumer_tenant_id: { $in: consumerIds },
        started_at: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    },
    {
      $group: {
        _id: '$consumer_tenant_id',
        execution_count: { $sum: 1 },
        action_count: { $sum: { $size: '$actions_taken' } },
      },
    },
  ]);

  res.json({
    active_agents: installations,
    pending_approvals: pendingApprovals,
    executions_today: todayExecutions,
    monthly_cost_cents: totalCost,
    consumer_stats: consumerStats,
    usage_by_agent: monthUsage,
  });
});

// ─── Per-Consumer Config ─────────────────────────────────────────────────────

router.get('/consumers/:consumerId/config', rbac('agents:read'), async (req: Request, res: Response) => {
  const installations = await AgentInstallation.find({
    tenant_id: req.tenantId,
  }).lean();

  // Extract overrides for this consumer
  const result = installations.map((inst) => {
    const override = inst.consumer_overrides?.find(
      (o) => o.consumer_tenant_id.toString() === req.params.consumerId
    );
    return {
      agent_slug: inst.agent_slug,
      global_enabled: inst.enabled,
      global_autonomy_level: inst.autonomy_level,
      consumer_enabled: override?.enabled ?? inst.enabled,
      consumer_autonomy_level: override?.autonomy_level ?? inst.autonomy_level,
      consumer_configuration: override?.configuration,
    };
  });

  res.json(result);
});

const consumerOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  autonomy_level: z.enum(['observe', 'recommend', 'auto_low', 'auto_full']).optional(),
  configuration: z.record(z.any()).optional(),
});

router.patch('/consumers/:consumerId/config/:slug', rbac('agents:configure'), async (req: Request, res: Response) => {
  const body = consumerOverrideSchema.parse(req.body);

  const installation = await AgentInstallation.findOne({
    tenant_id: req.tenantId,
    agent_slug: req.params.slug,
  });

  if (!installation) {
    res.status(404).json({ detail: 'Agent installation not found' });
    return;
  }

  // Find or create consumer override
  const overrideIndex = installation.consumer_overrides.findIndex(
    (o) => o.consumer_tenant_id.toString() === req.params.consumerId
  );

  if (overrideIndex >= 0) {
    if (body.enabled !== undefined) installation.consumer_overrides[overrideIndex].enabled = body.enabled;
    if (body.autonomy_level) installation.consumer_overrides[overrideIndex].autonomy_level = body.autonomy_level as any;
    if (body.configuration) installation.consumer_overrides[overrideIndex].configuration = body.configuration as any;
  } else {
    installation.consumer_overrides.push({
      consumer_tenant_id: req.params.consumerId as any,
      enabled: body.enabled ?? true,
      autonomy_level: body.autonomy_level as any,
      configuration: body.configuration as any,
    });
  }

  await installation.save();
  res.json(installation);
});

// ─── Cross-Consumer Approvals ────────────────────────────────────────────────

router.get('/approvals', rbac('agents:read'), async (req: Request, res: Response) => {
  const { status = 'pending', consumer_id } = req.query;

  const filter: any = { tenant_id: req.tenantId };
  if (status) filter.status = status;
  if (consumer_id) filter.consumer_tenant_id = consumer_id;

  const approvals = await AgentApproval.find(filter)
    .sort({ priority: -1, requested_at: -1 })
    .limit(100)
    .lean();

  res.json(approvals);
});

// ─── Cross-Consumer Executions ───────────────────────────────────────────────

router.get('/executions', rbac('agents:read'), async (req: Request, res: Response) => {
  const { consumer_id, agent_slug, limit = '20', offset = '0' } = req.query;

  const filter: any = { tenant_id: req.tenantId };
  if (consumer_id) filter.consumer_tenant_id = consumer_id;
  if (agent_slug) filter.agent_slug = agent_slug;

  const [executions, total] = await Promise.all([
    AgentExecution.find(filter)
      .sort({ started_at: -1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 100))
      .lean(),
    AgentExecution.countDocuments(filter),
  ]);

  res.json({ items: executions, total });
});

// ─── Cross-Consumer Usage ────────────────────────────────────────────────────

router.get('/usage', rbac('agents:read'), async (req: Request, res: Response) => {
  const period = req.query.period as string || getCurrentPeriod();

  const usage = await AgentUsage.find({
    tenant_id: req.tenantId,
    period,
  }).lean();

  res.json({ period, agents: usage });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default router;
