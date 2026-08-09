import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requirePlanFeature, requirePlanLimit } from '../middleware/planLimit.middleware';
import { AgentDefinition } from '../models/agent-definition.model';
import { AgentInstallation } from '../models/agent-installation.model';
import { AgentExecution } from '../models/agent-execution.model';
import { AgentApproval } from '../models/agent-approval.model';
import { AgentUsage } from '../models/agent-usage.model';
import { executeAgent } from '../services/agent-orchestrator.service';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { logger } from '../utils/logger';

const router = Router();
const sc = StringCodec();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const installSchema = z.object({
  agent_slug: z.string().min(1).max(100),
  autonomy_level: z.enum(['observe', 'recommend', 'auto_low', 'auto_full']).optional(),
  configuration: z.object({
    max_actions_per_execution: z.number().int().min(1).max(50).optional(),
    max_executions_per_hour: z.number().int().min(1).max(1000).optional(),
    monthly_token_budget: z.number().int().min(0).optional(),
    monthly_cost_budget_cents: z.number().int().min(0).optional(),
    require_approval_above_risk: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    blocked_actions: z.array(z.string()).optional(),
  }).optional(),
});

const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  autonomy_level: z.enum(['observe', 'recommend', 'auto_low', 'auto_full']).optional(),
  configuration: z.object({
    max_actions_per_execution: z.number().int().min(1).max(50).optional(),
    max_executions_per_hour: z.number().int().min(1).max(1000).optional(),
    monthly_token_budget: z.number().int().min(0).optional(),
    monthly_cost_budget_cents: z.number().int().min(0).optional(),
    require_approval_above_risk: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    blocked_actions: z.array(z.string()).optional(),
    quiet_hours: z.object({
      enabled: z.boolean(),
      start_hour: z.number().int().min(0).max(23),
      end_hour: z.number().int().min(0).max(23),
      days: z.array(z.number().int().min(0).max(6)),
    }).optional(),
  }).optional(),
});

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(1000).optional(),
});

// ─── Catalog ─────────────────────────────────────────────────────────────────

router.get('/catalog', rbac('agents:read'), async (req: Request, res: Response) => {
  const tenantType = (req as any).tenantType || 'standalone';
  const tenantPlan = (req as any).tenantPlan || 'free';

  const filter: any = { is_active: true };

  // Filter by tenant type restriction
  filter.$or = [
    { tenant_type_restriction: 'any' },
    { tenant_type_restriction: tenantType },
  ];

  const agents = await AgentDefinition.find(filter)
    .sort({ category: 1, sort_order: 1 })
    .lean();

  res.json(agents);
});

router.get('/catalog/:slug', rbac('agents:read'), async (req: Request, res: Response) => {
  const agent = await AgentDefinition.findOne({ slug: req.params.slug, is_active: true }).lean();
  if (!agent) {
    res.status(404).json({ detail: 'Agent not found' });
    return;
  }
  res.json(agent);
});

// ─── Installed Agents ────────────────────────────────────────────────────────

router.get('/installed', rbac('agents:read'), async (req: Request, res: Response) => {
  const installations = await AgentInstallation.find({ tenant_id: req.tenantId })
    .sort({ installed_at: -1 })
    .lean();
  res.json(installations);
});

router.post('/install',
  rbac('agents:install'),
  requirePlanFeature('agents_enabled'),
  requirePlanLimit('max_agents', (req) =>
    AgentInstallation.countDocuments({ tenant_id: req.tenantId })
  ),
  async (req: Request, res: Response) => {
  const body = installSchema.parse(req.body);

  // Check if agent definition exists
  const definition = await AgentDefinition.findOne({ slug: body.agent_slug, is_active: true });
  if (!definition) {
    res.status(404).json({ detail: 'Agent not found in catalog' });
    return;
  }

  // Check if already installed
  const existing = await AgentInstallation.findOne({
    tenant_id: req.tenantId,
    agent_slug: body.agent_slug,
  });
  if (existing) {
    res.status(409).json({ detail: 'Agent already installed' });
    return;
  }

  const installation = await AgentInstallation.create({
    tenant_id: req.tenantId,
    agent_definition_id: definition._id,
    agent_slug: body.agent_slug,
    autonomy_level: body.autonomy_level || 'recommend',
    configuration: body.configuration || {},
    installed_by: req.userId,
    installed_at: new Date(),
  });

  res.status(201).json(installation);
});

router.delete('/installed/:slug', rbac('agents:install'), async (req: Request, res: Response) => {
  const result = await AgentInstallation.findOneAndDelete({
    tenant_id: req.tenantId,
    agent_slug: req.params.slug,
  });
  if (!result) {
    res.status(404).json({ detail: 'Agent installation not found' });
    return;
  }
  res.json({ message: 'Agent uninstalled' });
});

router.patch('/installed/:slug', rbac('agents:configure'), async (req: Request, res: Response) => {
  const body = updateConfigSchema.parse(req.body);

  const update: any = {};
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.autonomy_level) update.autonomy_level = body.autonomy_level;
  if (body.configuration) {
    for (const [key, value] of Object.entries(body.configuration)) {
      update[`configuration.${key}`] = value;
    }
  }

  const installation = await AgentInstallation.findOneAndUpdate(
    { tenant_id: req.tenantId, agent_slug: req.params.slug },
    { $set: update },
    { new: true }
  );

  if (!installation) {
    res.status(404).json({ detail: 'Agent installation not found' });
    return;
  }

  res.json(installation);
});

// ─── Executions (Activity Feed) ──────────────────────────────────────────────

router.get('/executions', rbac('agents:read'), async (req: Request, res: Response) => {
  const { agent_slug, status, limit = '20', offset = '0' } = req.query;

  const filter: any = { tenant_id: req.tenantId };
  if (agent_slug) filter.agent_slug = agent_slug;
  if (status) filter.status = status;

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

router.get('/executions/:id', rbac('agents:read'), async (req: Request, res: Response) => {
  const execution = await AgentExecution.findOne({
    _id: req.params.id,
    tenant_id: req.tenantId,
  }).lean();

  if (!execution) {
    res.status(404).json({ detail: 'Execution not found' });
    return;
  }
  res.json(execution);
});

// ─── Approvals ───────────────────────────────────────────────────────────────

router.get('/approvals', rbac('agents:read'), async (req: Request, res: Response) => {
  const { status = 'pending', agent_slug } = req.query;

  const filter: any = { tenant_id: req.tenantId };
  if (status) filter.status = status;
  if (agent_slug) filter.agent_slug = agent_slug;

  const approvals = await AgentApproval.find(filter)
    .sort({ priority: -1, requested_at: -1 })
    .limit(100)
    .lean();

  res.json(approvals);
});

router.post('/approvals/:id/decide', rbac('agents:approve'), async (req: Request, res: Response) => {
  const body = decideSchema.parse(req.body);

  const approval = await AgentApproval.findOne({
    _id: req.params.id,
    tenant_id: req.tenantId,
    status: 'pending',
  });

  if (!approval) {
    res.status(404).json({ detail: 'Approval not found or already decided' });
    return;
  }

  // Publish decision for the approval worker to process
  try {
    const js = getJetStream();
    await js.publish(
      'agents.approval.decision',
      sc.encode(JSON.stringify({
        approval_id: approval._id,
        decision: body.decision,
        decided_by: req.userId,
        reason: body.reason,
      }))
    );
  } catch (err: any) {
    logger.error('Failed to publish approval decision', { error: err.message });
  }

  // Also update directly for immediate UI response
  approval.status = body.decision;
  approval.decided_by = req.userId;
  approval.decided_at = new Date();
  approval.decision_reason = body.reason;
  await approval.save();

  res.json(approval);
});

// ─── Usage ───────────────────────────────────────────────────────────────────

router.get('/usage', rbac('agents:read'), async (req: Request, res: Response) => {
  const period = req.query.period as string || getCurrentPeriod();

  const usage = await AgentUsage.find({
    tenant_id: req.tenantId,
    period,
  }).lean();

  const total = usage.reduce((acc, u) => ({
    executions: acc.executions + u.executions,
    input_tokens: acc.input_tokens + u.input_tokens,
    output_tokens: acc.output_tokens + u.output_tokens,
    actions_executed: acc.actions_executed + u.actions_executed,
    cost_cents: acc.cost_cents + u.cost_cents,
  }), { executions: 0, input_tokens: 0, output_tokens: 0, actions_executed: 0, cost_cents: 0 });

  res.json({ period, agents: usage, total });
});

router.get('/usage/:slug', rbac('agents:read'), async (req: Request, res: Response) => {
  const period = req.query.period as string || getCurrentPeriod();

  const usage = await AgentUsage.findOne({
    tenant_id: req.tenantId,
    agent_slug: req.params.slug,
    period,
  }).lean();

  res.json(usage || { period, agent_slug: req.params.slug, executions: 0, cost_cents: 0 });
});

// ─── Manual Trigger ──────────────────────────────────────────────────────────

router.post('/trigger/:slug', rbac('agents:trigger'), async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const result = await executeAgent({
    agentSlug: slug,
    trigger: {
      type: 'manual',
      source_id: req.body.source_id,
    },
    tenantId: req.tenantId!.toString(),
    consumerTenantId: req.body.consumer_tenant_id,
  });

  res.json(result);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default router;
