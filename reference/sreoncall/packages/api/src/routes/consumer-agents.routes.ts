import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import { AgentExecution } from '../models/agent-execution.model';
import { AgentInstallation } from '../models/agent-installation.model';
import { AgentDefinition } from '../models/agent-definition.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';

const router = Router();

// All routes require consumer tenant type
router.use(requireTenantType('consumer'));

// ─── Agent Activity Log (read-only) ─────────────────────────────────────────

router.get('/activity', rbac('agents:read'), async (req: Request, res: Response) => {
  const { limit = '20', offset = '0', agent_slug } = req.query;

  const filter: any = { consumer_tenant_id: req.tenantId };
  if (agent_slug) filter.agent_slug = agent_slug;

  const [executions, total] = await Promise.all([
    AgentExecution.find(filter)
      .sort({ started_at: -1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 100))
      .select('agent_slug trigger status context_summary actions_taken recommendations outcome started_at completed_at')
      .lean(),
    AgentExecution.countDocuments(filter),
  ]);

  res.json({ items: executions, total });
});

// ─── Provider's Agent Info (read-only) ───────────────────────────────────────

router.get('/provider-info', rbac('agents:read'), async (req: Request, res: Response) => {
  // Find the provider link for this consumer
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: req.tenantId,
    status: 'active',
  }).lean();

  if (!link) {
    res.json({ provider: null, agents: [] });
    return;
  }

  // Get provider's installed agents
  const installations = await AgentInstallation.find({
    tenant_id: link.provider_tenant_id,
    enabled: true,
  }).lean();

  // Get definitions for display info
  const slugs = installations.map((i) => i.agent_slug);
  const definitions = await AgentDefinition.find({ slug: { $in: slugs } })
    .select('slug display_name description category icon')
    .lean();

  const defMap = new Map(definitions.map((d) => [d.slug, d]));

  // Build response with consumer-specific info
  const agents = installations.map((inst) => {
    const def = defMap.get(inst.agent_slug);
    const override = inst.consumer_overrides?.find(
      (o) => o.consumer_tenant_id.toString() === req.tenantId?.toString()
    );

    return {
      agent_slug: inst.agent_slug,
      display_name: def?.display_name || inst.agent_slug,
      description: def?.description || '',
      category: def?.category || 'unknown',
      icon: def?.icon || 'Bot',
      enabled: override?.enabled ?? inst.enabled,
      autonomy_level: override?.autonomy_level || inst.autonomy_level,
    };
  });

  res.json({
    provider_tenant_id: link.provider_tenant_id,
    agents,
  });
});

// ─── Consumer Preferences ────────────────────────────────────────────────────

// Preferences are stored on the provider-consumer link as metadata
// This is a lightweight approach that avoids a new model

const preferencesSchema = z.object({
  notify_before_status_page: z.boolean().optional(),
  require_approval_for_public_comms: z.boolean().optional(),
  summary_frequency: z.enum(['daily', 'weekly', 'never']).optional(),
  notification_channel: z.enum(['slack', 'teams', 'email']).optional(),
});

router.get('/preferences', rbac('agents:read'), async (req: Request, res: Response) => {
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: req.tenantId,
    status: 'active',
  }).lean();

  if (!link) {
    res.json({
      notify_before_status_page: true,
      require_approval_for_public_comms: true,
      summary_frequency: 'weekly',
      notification_channel: 'email',
    });
    return;
  }

  // Return preferences from link metadata (or defaults)
  const prefs = (link as any).agent_preferences || {
    notify_before_status_page: true,
    require_approval_for_public_comms: true,
    summary_frequency: 'weekly',
    notification_channel: 'email',
  };

  res.json(prefs);
});

router.patch('/preferences', rbac('agents:read'), async (req: Request, res: Response) => {
  const body = preferencesSchema.parse(req.body);

  const link = await ProviderConsumerLink.findOneAndUpdate(
    { consumer_tenant_id: req.tenantId, status: 'active' },
    { $set: { agent_preferences: body } },
    { new: true }
  );

  if (!link) {
    res.status(404).json({ detail: 'No active provider link found' });
    return;
  }

  res.json((link as any).agent_preferences || body);
});

export default router;
