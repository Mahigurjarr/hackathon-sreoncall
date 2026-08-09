/**
 * Escalation Engine Worker
 *
 * Polls for open/acknowledged incidents that have escalation policies attached.
 * Tracks which escalation step has been reached and, after the step's delay_minutes,
 * notifies the next target (user/team/schedule) and records it on the incident timeline.
 *
 * Supports per-step notify_channels and policy repeat logic.
 *
 * Runs every 30 seconds.
 */

import { Types } from 'mongoose';
import { Incident, IncidentDocument } from '../models/incident.model';
import { EscalationPolicy, IEscalationStep, NotifyChannel } from '../models/escalation-policy.model';
import { TenantIntegration } from '../models/tenant-integration.model';
import { User } from '../models/user.model';
import { resolveEscalationTargets } from '../services/oncall.service';
import { executeProviderEscalation } from '../services/escalation-policy.service';
import { createBulkNotifications } from '../services/notification.service';
import { sendNotificationEmail } from '../services/email-notification.service';
import { sendSms } from '../services/sms.service';
import { makeVoiceCall, sendWhatsApp } from '../services/plivo.service';
import * as slackService from '../services/slack.service';
import * as teamsService from '../services/teams.service';
import { decryptToken } from '../utils/encryption';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 30_000; // 30 seconds
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// In-memory tracker: incidentId -> last escalation step index executed + repeat cycle
const escalationState = new Map<string, { stepIndex: number; stepTriggeredAt: Date; repeatCycle: number }>();

export function startEscalationWorker(): void {
  if (intervalHandle) return;
  logger.info('Escalation worker starting');
  intervalHandle = setInterval(runEscalationCycle, POLL_INTERVAL_MS);
  // Run once immediately
  runEscalationCycle().catch((err) =>
    logger.error('Escalation cycle error', { error: err.message })
  );
}

export function stopEscalationWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Escalation worker stopped');
}

async function runEscalationCycle(): Promise<void> {
  try {
    // Find incidents that are open or acknowledged AND have an escalation policy
    const incidents = await Incident.find({
      status: 'open',
      escalation_policy_id: { $ne: null },
    });

    for (const incident of incidents) {
      try {
        await processIncidentEscalation(incident);
      } catch (err: any) {
        logger.error('Failed to process escalation for incident', {
          incidentId: incident._id.toString(),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Escalation cycle failed', { error: err.message });
  }
}

async function processIncidentEscalation(incident: IncidentDocument): Promise<void> {
  const incidentId = incident._id.toString();
  const policy = await EscalationPolicy.findById(incident.escalation_policy_id);

  if (!policy || !policy.steps || policy.steps.length === 0) {
    return;
  }

  const now = new Date();
  const incidentCreatedAt = incident.createdAt;

  // Get current escalation state for this incident
  let state = escalationState.get(incidentId);

  if (!state) {
    // New incident — check if first step delay has passed
    const firstStep = policy.steps[0];
    const delayMs = firstStep.delay_minutes * 60_000;
    const triggerTime = new Date(incidentCreatedAt.getTime() + delayMs);

    if (now < triggerTime) {
      return; // Not yet time for first escalation step
    }

    // Execute first step
    await executeEscalationStep(incident, policy.steps[0], 0);
    escalationState.set(incidentId, { stepIndex: 0, stepTriggeredAt: now, repeatCycle: 0 });
    return;
  }

  // Already started escalation — check if next step is due
  const nextStepIndex = state.stepIndex + 1;

  if (nextStepIndex >= policy.steps.length) {
    // All steps exhausted — check repeat logic
    const repeatCount = policy.repeat_count ?? 0;
    if (repeatCount > 0 && state.repeatCycle < repeatCount) {
      const repeatDelayMs = (policy.repeat_interval_minutes ?? 30) * 60_000;
      const repeatTriggerTime = new Date(state.stepTriggeredAt.getTime() + repeatDelayMs);

      if (now < repeatTriggerTime) {
        return; // Not yet time to repeat
      }

      // Start a new cycle from step 0
      const newCycle = state.repeatCycle + 1;
      logger.info('Escalation policy repeating', { incidentId, cycle: newCycle, maxCycles: repeatCount });
      await executeEscalationStep(incident, policy.steps[0], 0);
      escalationState.set(incidentId, { stepIndex: 0, stepTriggeredAt: now, repeatCycle: newCycle });
    }
    return;
  }

  const nextStep = policy.steps[nextStepIndex];
  const delayMs = nextStep.delay_minutes * 60_000;
  const triggerTime = new Date(state.stepTriggeredAt.getTime() + delayMs);

  if (now < triggerTime) {
    return; // Not yet time for next step
  }

  // Execute next step
  await executeEscalationStep(incident, nextStep, nextStepIndex);
  escalationState.set(incidentId, { stepIndex: nextStepIndex, stepTriggeredAt: now, repeatCycle: state.repeatCycle });
}

async function executeEscalationStep(
  incident: IncidentDocument,
  step: IEscalationStep,
  stepIndex: number
): Promise<void> {
  const incidentId = incident._id.toString();
  const tenantId = incident.tenant_id;
  const channels: NotifyChannel[] = step.notify_channels?.length > 0
    ? step.notify_channels
    : ['in_app', 'email'];

  // Provider escalation: create a bridge to the provider tenant so their
  // on-call engineer gets paged using the provider's own on-call schedules.
  // The createBridge flow dispatches notifications on the provider side.
  if (step.target_type === 'provider_escalation') {
    await executeProviderEscalation(tenantId, incident._id);
    // Use atomic $push so we don't overwrite custom_fields that createBridge
    // may have just written (race: escalation worker holds a stale doc copy).
    await Incident.findByIdAndUpdate(incident._id, {
      $push: {
        timeline: {
          _id: new Types.ObjectId(),
          type: 'provider_escalation',
          actor_id: null,
          message: `Escalation step ${stepIndex + 1}: provider on-call engaged`,
          metadata: { step_index: stepIndex },
          timestamp: new Date(),
        },
      },
    });
    return;
  }

  // Resolve target users
  const targetUserIds = await resolveEscalationTargets(
    step.target_type,
    step.targets,
    tenantId
  );

  if (targetUserIds.length === 0) {
    logger.warn('Escalation step has no resolvable targets', {
      incidentId,
      stepIndex,
      targetType: step.target_type,
    });
    return;
  }

  const sevLabel = `SEV${incident.severity}`;
  const notifTitle = `Escalation Step ${stepIndex + 1}: ${sevLabel} ${incident.title}`;
  const notifBody = `Incident INC-${String(incident.number).padStart(4, '0')} has been escalated to you (step ${stepIndex + 1}).${step.note ? ` Note: ${step.note}` : ''}`;

  // In-app notifications
  if (channels.includes('in_app')) {
    const notifications = targetUserIds.map((userId) => ({
      tenant_id: tenantId,
      user_id: userId,
      type: 'escalation' as string,
      priority: (incident.severity <= 2 ? 'critical' : 'warning') as 'critical' | 'warning',
      title: notifTitle,
      body: notifBody,
      resource_type: 'incident',
      resource_id: incidentId,
    }));
    await createBulkNotifications(notifications);
  }

  // Email notifications
  if (channels.includes('email')) {
    try {
      const users = await User.find({ _id: { $in: targetUserIds } });
      for (const user of users) {
        sendNotificationEmail(
          user.email,
          notifTitle,
          notifBody,
          `/incidents/${incidentId}`,
          tenantId.toString()
        ).catch((err) =>
          logger.error('Failed to send escalation email', { error: err.message, email: user.email })
        );
      }
    } catch (err: any) {
      logger.error('Failed to fetch users for escalation email', { error: err.message });
    }
  }

  // SMS notifications
  if (channels.includes('sms')) {
    try {
      const users = await User.find({ _id: { $in: targetUserIds } });
      for (const user of users) {
        const phone = (user as any).phone_number;
        if (phone) {
          sendSms(phone, `${notifTitle}\n${notifBody}`).catch((err) =>
            logger.error('Failed to send escalation SMS', { error: err.message, phone })
          );
        }
      }
    } catch (err: any) {
      logger.error('Failed to fetch users for escalation SMS', { error: err.message });
    }
  }

  // Voice call notifications
  if (channels.includes('voice')) {
    try {
      const users = await User.find({ _id: { $in: targetUserIds } });
      for (const user of users) {
        const phone = (user as any).phone_number;
        if (phone) {
          makeVoiceCall(phone, `${notifTitle}. ${notifBody}`, {
            incidentId,
            tenantId: tenantId.toString(),
            userId: user._id.toString(),
          }).catch((err) =>
            logger.error('Failed to initiate escalation voice call', { error: err.message, phone })
          );
        }
      }
    } catch (err: any) {
      logger.error('Failed to fetch users for escalation voice call', { error: err.message });
    }
  }

  // WhatsApp notifications
  if (channels.includes('whatsapp')) {
    try {
      const users = await User.find({ _id: { $in: targetUserIds } });
      for (const user of users) {
        const phone = (user as any).phone_number;
        if (phone) {
          sendWhatsApp(phone, `${notifTitle}\n${notifBody}`).catch((err) =>
            logger.error('Failed to send escalation WhatsApp', { error: err.message, phone })
          );
        }
      }
    } catch (err: any) {
      logger.error('Failed to fetch users for escalation WhatsApp', { error: err.message });
    }
  }

  // Slack DM notifications
  if (channels.includes('slack')) {
    try {
      const slackIntegration = await TenantIntegration.findOne({
        tenant_id: tenantId,
        platform: 'slack',
        is_active: true,
      });
      if (slackIntegration) {
        const token = decryptToken(slackIntegration.bot_token_encrypted);
        const users = await User.find({ _id: { $in: targetUserIds } });
        for (const user of users) {
          slackService.sendDirectMessage(token, user.email, `${notifTitle}\n${notifBody}`).catch((err) =>
            logger.error('Failed to send escalation Slack DM', { error: err.message, email: user.email })
          );
        }
      } else {
        logger.debug('No Slack integration for escalation Slack DM', { tenantId: tenantId.toString() });
      }
    } catch (err: any) {
      logger.error('Failed to send escalation Slack DMs', { error: err.message });
    }
  }

  // Teams notifications
  if (channels.includes('teams')) {
    try {
      const teamsIntegration = await TenantIntegration.findOne({
        tenant_id: tenantId,
        platform: 'teams',
        is_active: true,
      });
      if (teamsIntegration) {
        const token = decryptToken(teamsIntegration.bot_token_encrypted);
        const users = await User.find({ _id: { $in: targetUserIds } });
        for (const user of users) {
          teamsService.sendDirectMessage(token, user.email, `${notifTitle}\n${notifBody}`).catch((err) =>
            logger.error('Failed to send escalation Teams DM', { error: err.message, email: user.email })
          );
        }
      } else {
        logger.debug('No Teams integration for escalation Teams DM', { tenantId: tenantId.toString() });
      }
    } catch (err: any) {
      logger.error('Failed to send escalation Teams DMs', { error: err.message });
    }
  }

  // Add timeline entry with user names
  const notifiedUsers = await User.find({ _id: { $in: targetUserIds } }, 'name').lean();
  const notifiedNames = notifiedUsers.map(u => u.name).filter(Boolean);
  const namesStr = notifiedNames.length > 0 ? notifiedNames.join(', ') : `${targetUserIds.length} user(s)`;

  incident.timeline.push({
    _id: new Types.ObjectId(),
    type: 'escalation',
    actor_id: null,
    message: `Escalation step ${stepIndex + 1} triggered — notified ${namesStr} via ${channels.join(', ')}`,
    metadata: {
      step_index: stepIndex,
      target_type: step.target_type,
      target_count: targetUserIds.length,
      delay_minutes: step.delay_minutes,
      notify_channels: channels,
      notified_user_names: notifiedNames,
    },
    timestamp: new Date(),
  });

  await incident.save();

  logger.info('Escalation step executed', {
    incidentId,
    stepIndex,
    targetType: step.target_type,
    notifiedCount: targetUserIds.length,
    channels,
  });
}

// Clean up resolved incidents from in-memory state periodically
setInterval(() => {
  for (const [id] of escalationState) {
    Incident.findById(id)
      .then((inc) => {
        if (!inc || ['resolved', 'closed'].includes(inc.status)) {
          escalationState.delete(id);
        }
      })
      .catch(() => escalationState.delete(id));
  }
}, 5 * 60_000); // every 5 minutes
