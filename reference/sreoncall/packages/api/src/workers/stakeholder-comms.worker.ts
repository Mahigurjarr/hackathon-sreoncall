import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { Incident } from '../models/incident.model';
import { StakeholderUpdate } from '../models/stakeholder-update.model';
import { ResolutionPlan } from '../models/resolution-plan.model';
import { BusinessImpactConfig } from '../models/business-impact-config.model';
import * as aiService from '../services/ai.service';

const STREAM_NAME = 'ICC_STAKEHOLDER';
const CONSUMER_NAME = 'icc-stakeholder-processor';
const DEFAULT_REMINDER_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.stakeholder.>'],
      retention: 'workqueue' as any,
      max_msgs: 100_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_STAKEHOLDER stream created');
  }
}

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_deliver: 3,
      ack_wait: 60_000_000_000, // 60 seconds
    });
    logger.info('Stakeholder comms worker consumer created');
  }
}

// Audience-specific system prompts for AI drafting
const AUDIENCE_PROMPTS: Record<string, string> = {
  internal_engineering: `You are writing an incident update for the engineering team. Include:
- Current incident status and affected services
- Technical details: error rates, latency, logs
- Commands run and their results
- Next steps and who is working on what
Use precise technical language. Include metrics and timestamps.`,

  internal_leadership: `You are writing an incident update for leadership/management. Include:
- Business impact: affected users, revenue exposure, SLA risk
- Current status and ETA for resolution
- Team members engaged
- Risk level assessment
Keep it concise. Focus on business impact, not technical details.`,

  external_customer: `You are writing an incident update for external customers. Include:
- Acknowledgment of the issue
- What is affected in user-facing terms
- Current status
- Expected resolution time
Use plain English. Do NOT include internal details, server names, or technical jargon.`,

  status_page: `You are writing a status page update. Be concise (2-3 sentences max).
Format: Current status summary. What we're doing about it. Expected resolution time.
Do NOT include internal details.`,
};

async function handleGenerate(data: any): Promise<void> {
  const { tenant_id, incident_id, audience, update_id, created_by } = data;
  const tenantId = new Types.ObjectId(tenant_id);
  const incidentId = new Types.ObjectId(incident_id);

  logger.info('Stakeholder comms worker: generating update', { incident_id, audience });

  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId });
  if (!incident) {
    throw new Error(`Incident ${incident_id} not found`);
  }

  // Build incident context for AI
  const incidentDurationMinutes = Math.round(
    (Date.now() - new Date(incident.createdAt).getTime()) / 60000
  );

  const contextParts = [
    `Incident: ${incident.title}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Duration: ${incidentDurationMinutes} minutes`,
    `Description: ${incident.description || 'No description'}`,
    incident.labels?.length ? `Labels: ${incident.labels.join(', ')}` : '',
  ].filter(Boolean);

  // Include resolution plan progress if available
  try {
    const plan = await ResolutionPlan.findOne({ incident_id: incidentId, tenant_id: tenantId })
      .sort({ createdAt: -1 })
      .lean();
    if (plan) {
      const completedSteps = (plan as any).steps?.filter((s: any) => s.status === 'completed').length ?? 0;
      const totalSteps = (plan as any).steps?.length ?? 0;
      contextParts.push(`Resolution Plan: ${(plan as any).status} — ${completedSteps}/${totalSteps} steps completed`);
      if ((plan as any).diagnosis?.root_cause) {
        contextParts.push(`Diagnosed Root Cause: ${(plan as any).diagnosis.root_cause} (confidence: ${(plan as any).diagnosis.confidence_percent ?? 'N/A'}%)`);
      }
      const currentStep = (plan as any).steps?.find((s: any) => s.status === 'in_progress');
      if (currentStep) {
        contextParts.push(`Current Step: ${currentStep.title}`);
      }
    }
  } catch {
    // Resolution plan fetch failed — continue without it
  }

  // Include business impact data if available
  try {
    const affectedServiceIds = ((incident as any).affected_service_ids ?? []).map((s: any) => s.toString());
    if (affectedServiceIds.length > 0) {
      const impactConfigs = await BusinessImpactConfig.find({
        tenant_id: tenantId,
        service_id: { $in: affectedServiceIds },
      }).lean();
      if (impactConfigs.length > 0) {
        const totalRevenue = impactConfigs.reduce((sum, c) => {
          if (c.revenue_per_request_cents != null && c.avg_requests_per_minute != null) {
            return sum + (c.avg_requests_per_minute * 60 * c.revenue_per_request_cents) / 100;
          }
          return sum;
        }, 0);
        const totalUsers = impactConfigs.reduce((sum, c) => {
          return sum + (c.total_user_count != null ? Math.round(c.total_user_count * (c.estimated_users_affected_percent / 100)) : 0);
        }, 0);
        const impactParts: string[] = [];
        if (totalRevenue > 0) impactParts.push(`$${(totalRevenue / 100).toFixed(2)}/hr revenue at risk`);
        if (totalUsers > 0) impactParts.push(`~${totalUsers} users affected`);
        const tiers = impactConfigs.flatMap((c) => c.customer_tiers || []);
        if (tiers.length > 0) impactParts.push(`Customer tiers: ${tiers.map((t) => `${t.tier}(${t.count})`).join(', ')}`);
        if (impactParts.length > 0) {
          contextParts.push(`Business Impact: ${impactParts.join('; ')}`);
        }
      }
    }
  } catch {
    // Business impact fetch failed — continue without it
  }

  // Include recent timeline entries
  try {
    const timelineEntries = ((incident as any).timeline ?? []) as Array<{
      timestamp: Date; type: string; message: string;
    }>;
    const recentEntries = timelineEntries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
    if (recentEntries.length > 0) {
      const timelineText = recentEntries
        .map((e) => `[${new Date(e.timestamp).toISOString()}] ${e.type}: ${e.message}`)
        .join('\n');
      contextParts.push(`Recent Timeline:\n${timelineText}`);
    }
  } catch {
    // Timeline extraction failed — continue without it
  }

  const systemPrompt = AUDIENCE_PROMPTS[audience] || AUDIENCE_PROMPTS.internal_engineering;

  const result = await aiService.generateCompletion({
    tenantId: tenant_id,
    system: systemPrompt,
    userMessage: contextParts.join('\n'),
  });

  if (update_id) {
    // Update existing draft
    await StakeholderUpdate.findByIdAndUpdate(update_id, {
      'content.draft': result.text,
      'content.generated_by': 'ai',
      updated_at: new Date(),
    });
  } else {
    // Create new stakeholder update
    await StakeholderUpdate.create({
      tenant_id: tenantId,
      incident_id: incidentId,
      audience,
      content: {
        draft: result.text,
        final: null,
        generated_by: 'ai',
      },
      delivery: { channels: [] },
      status: 'draft',
      created_by: created_by ? new Types.ObjectId(created_by) : null,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  logger.info('Stakeholder comms worker: update generated', {
    incident_id,
    audience,
    draft_length: result.text.length,
  });
}

async function handleSend(data: any): Promise<void> {
  const { tenant_id, incident_id, update_id, channels } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Stakeholder comms worker: sending update', { incident_id, update_id });

  const update = await StakeholderUpdate.findOne({
    _id: new Types.ObjectId(update_id),
    tenant_id: tenantId,
  });

  if (!update) {
    throw new Error(`Stakeholder update ${update_id} not found`);
  }

  const content = (update as any).content?.final || (update as any).content?.draft;
  if (!content) {
    throw new Error('No content to send');
  }

  // Publish to NOTIFICATIONS stream for each channel to be delivered
  const js = getJetStream();
  const deliveryChannels = channels || (update as any).delivery?.channels || [];

  for (const channel of deliveryChannels) {
    try {
      const notificationPayload = {
        event: 'stakeholder_update',
        tenant_id: tenant_id,
        channel_type: channel.type,
        target: channel.target,
        content,
        incident_id,
        audience: (update as any).audience,
      };

      await js.publish(
        `notifications.stakeholder.${channel.type}`,
        new TextEncoder().encode(JSON.stringify(notificationPayload))
      );

      // Update channel delivery status
      channel.sent_at = new Date();
      channel.delivery_status = 'sent';
    } catch (err: any) {
      logger.error('Stakeholder comms worker: failed to send via channel', {
        channel_type: channel.type,
        target: channel.target,
        error: err.message,
      });
      channel.delivery_status = 'failed';
    }
  }

  // Update the stakeholder update record
  await StakeholderUpdate.findByIdAndUpdate(update_id, {
    status: 'sent',
    'delivery.channels': deliveryChannels,
    sent_by: data.sent_by ? new Types.ObjectId(data.sent_by) : null,
    updated_at: new Date(),
  });

  logger.info('Stakeholder comms worker: update sent', {
    incident_id,
    update_id,
    channels_count: deliveryChannels.length,
  });
}

async function handleReminder(data: any): Promise<void> {
  const { tenant_id } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Stakeholder comms worker: checking for reminder-eligible incidents', { tenant_id });

  // Find open incidents without recent stakeholder updates
  const openIncidents = await Incident.find({
    tenant_id: tenantId,
    status: { $in: ['triggered', 'acknowledged', 'investigating'] },
  });

  const js = getJetStream();
  let remindersGenerated = 0;

  for (const incident of openIncidents) {
    // Find the most recent stakeholder update for this incident
    const lastUpdate = await StakeholderUpdate.findOne({
      tenant_id: tenantId,
      incident_id: incident._id,
      status: 'sent',
    }).sort({ updated_at: -1 });

    const lastUpdateTime = lastUpdate
      ? new Date((lastUpdate as any).updated_at || (lastUpdate as any).created_at).getTime()
      : new Date(incident.createdAt).getTime();

    const timeSinceLastUpdate = Date.now() - lastUpdateTime;

    if (timeSinceLastUpdate >= DEFAULT_REMINDER_INTERVAL_MS) {
      // Publish notification reminder to incident commander/assignee
      const reminderPayload = {
        event: 'stakeholder_update_reminder',
        tenant_id: tenant_id,
        incident_id: incident._id.toString(),
        notification_type: 'direct',
        user_ids: incident.commander_id ? [incident.commander_id.toString()] : [],
        title: `Stakeholder update overdue for ${incident.title}`,
        body: `No stakeholder update sent in the last ${Math.round(timeSinceLastUpdate / 60000)} minutes. Consider sending an update.`,
      };

      await js.publish(
        'notifications.reminder',
        new TextEncoder().encode(JSON.stringify(reminderPayload))
      );

      remindersGenerated++;
    }
  }

  logger.info('Stakeholder comms worker: reminder check complete', {
    tenant_id,
    open_incidents: openIncidents.length,
    reminders_generated: remindersGenerated,
  });
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.stakeholder.generate') {
      await handleGenerate(data);
    } else if (subject === 'icc.stakeholder.send') {
      await handleSend(data);
    } else if (subject === 'icc.stakeholder.reminder') {
      await handleReminder(data);
    } else {
      logger.debug('Stakeholder comms worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Stakeholder comms worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startStakeholderCommsWorker(): Promise<void> {
  if (running) return;

  await ensureStream();
  await ensureConsumer();
  const js = getJetStream();
  consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME).then((c) => c.consume());
  running = true;

  (async () => {
    if (!consumer) return;
    for await (const msg of consumer) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Stakeholder comms worker loop error', { error: err.message });
    }
  });

  logger.info('Stakeholder comms worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopStakeholderCommsWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Stakeholder comms worker stopped');
}
