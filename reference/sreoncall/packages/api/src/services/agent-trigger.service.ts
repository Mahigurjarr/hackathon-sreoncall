import { StringCodec } from 'nats';
import { getJetStream } from '../config/nats';
import { AgentInstallation } from '../models/agent-installation.model';
import { logger } from '../utils/logger';

const sc = StringCodec();

export interface AgentTriggerPayload {
  agent_slug: string;
  trigger: {
    type: 'event' | 'schedule' | 'manual' | 'agent';
    event_type?: string;
    source_id?: string;
    parent_execution_id?: string;
  };
  tenant_id: string;
  consumer_tenant_id?: string;
  context?: Record<string, any>;
}

/**
 * Publish a trigger event for an agent.
 * Checks if the agent is installed and enabled before publishing.
 */
export async function publishAgentTrigger(
  agentSlug: string,
  trigger: AgentTriggerPayload['trigger'],
  tenantId: string,
  consumerTenantId?: string,
  extraContext?: Record<string, any>
): Promise<boolean> {
  try {
    // Check if agent is installed and enabled for this tenant
    const installation = await AgentInstallation.findOne({
      tenant_id: tenantId,
      agent_slug: agentSlug,
      enabled: true,
    }).lean();

    if (!installation) {
      return false; // Agent not installed or disabled — silently skip
    }

    // If provider+consumer context, check consumer override
    if (consumerTenantId && installation.consumer_overrides?.length) {
      const override = installation.consumer_overrides.find(
        (o) => o.consumer_tenant_id.toString() === consumerTenantId
      );
      if (override && override.enabled === false) {
        return false; // Agent disabled for this consumer
      }
    }

    // Check quiet hours
    if (installation.configuration?.quiet_hours?.enabled) {
      const qh = installation.configuration.quiet_hours;
      const now = new Date();
      const hour = now.getUTCHours();
      const day = now.getUTCDay();

      const inQuietHours = qh.days.includes(day) && isInHourRange(hour, qh.start_hour, qh.end_hour);
      if (inQuietHours) {
        logger.info(`Agent "${agentSlug}" in quiet hours, skipping trigger`, { tenantId });
        return false;
      }
    }

    const payload: AgentTriggerPayload = {
      agent_slug: agentSlug,
      trigger,
      tenant_id: tenantId,
      consumer_tenant_id: consumerTenantId,
      context: extraContext,
    };

    const js = getJetStream();
    await js.publish(
      `agents.trigger.${agentSlug}`,
      sc.encode(JSON.stringify(payload))
    );

    logger.info(`Agent trigger published: ${agentSlug}`, {
      tenantId,
      triggerType: trigger.type,
      eventType: trigger.event_type,
    });

    return true;
  } catch (err: any) {
    logger.error(`Failed to publish agent trigger for "${agentSlug}"`, {
      error: err.message,
      tenantId,
    });
    return false;
  }
}

/**
 * Publish a trigger for all agents that listen to a specific event type.
 */
export async function publishEventTriggers(
  eventType: string,
  sourceId: string,
  tenantId: string,
  consumerTenantId?: string,
  extraContext?: Record<string, any>
): Promise<void> {
  const agentSlugs = EVENT_TO_AGENTS[eventType];
  if (!agentSlugs?.length) return;

  const trigger = {
    type: 'event' as const,
    event_type: eventType,
    source_id: sourceId,
  };

  await Promise.allSettled(
    agentSlugs.map((slug) =>
      publishAgentTrigger(slug, trigger, tenantId, consumerTenantId, extraContext)
    )
  );
}

// ─── Event → Agent mapping ───────────────────────────────────────────────────

const EVENT_TO_AGENTS: Record<string, string[]> = {
  'alert.fired': ['incident-triage', 'alert-intelligence'],
  'incident.created': ['incident-commander', 'runbook-automation', 'knowledge-agent'],
  'incident.severity_changed': ['incident-commander'],
  'incident.resolved': ['rca-agent', 'comms-agent'],
  'incident.status_changed': ['comms-agent'],
  'change.submitted': ['change-risk'],
  'change.scheduled': ['change-risk'],
  'comms.inbound': ['comms-agent'],
  'slo.budget_burned': ['slo-guardian'],
  'oncall.rotation_changed': ['oncall-wellness'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isInHourRange(current: number, start: number, end: number): boolean {
  if (start <= end) {
    return current >= start && current < end;
  }
  // Wraps midnight: e.g., start=22, end=6
  return current >= start || current < end;
}
