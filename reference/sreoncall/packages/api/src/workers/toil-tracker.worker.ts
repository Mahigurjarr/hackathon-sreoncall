import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { ToilRecord } from '../models/toil-record.model';
import * as aiService from '../services/ai.service';

const STREAM_NAME = 'ICC_TOIL';
const CONSUMER_NAME = 'icc-toil-processor';

// Toil detection thresholds (from FRD §11.2)
const RUNBOOK_REPEAT_THRESHOLD = 3;    // same step > 3 times in 30 days
const MANUAL_ACTION_THRESHOLD = 3;     // same action > 3 times in 30 days
const ALERT_DISMISS_THRESHOLD = 5;     // same alert dismissed > 5 times in 7 days
const INCIDENT_RECURRENCE_THRESHOLD = 2; // same root cause > 2 times in 30 days

let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.toil.>'],
      retention: 'workqueue' as any,
      max_msgs: 200_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_TOIL stream created');
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
    logger.info('Toil tracker worker consumer created');
  }
}

async function handleRecord(data: any): Promise<void> {
  const {
    tenant_id,
    type,
    description,
    service_id,
    user_id,
    incident_id,
    runbook_id,
    runbook_step_title,
    alert_rule_id,
    duration_seconds,
  } = data;

  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Toil tracker worker: recording toil event', { tenant_id, type, description });

  await ToilRecord.create({
    tenant_id: tenantId,
    type,
    description,
    service_id: service_id ? new Types.ObjectId(service_id) : null,
    user_id: new Types.ObjectId(user_id),
    source: {
      incident_id: incident_id ? new Types.ObjectId(incident_id) : null,
      runbook_id: runbook_id ? new Types.ObjectId(runbook_id) : null,
      runbook_step_title: runbook_step_title || null,
      alert_rule_id: alert_rule_id ? new Types.ObjectId(alert_rule_id) : null,
    },
    duration_seconds: duration_seconds || null,
    automatable: false, // will be assessed in analyze phase
    automation_suggestion: null,
    created_at: new Date(),
  });

  logger.info('Toil tracker worker: toil event recorded', {
    tenant_id,
    type,
    service_id: service_id || null,
  });
}

async function handleAnalyze(data: any): Promise<void> {
  const { tenant_id } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Toil tracker worker: analyzing toil patterns', { tenant_id });

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Pattern 1: Repeated runbook step executions (> 3 times in 30 days)
  const runbookRepeats = await ToilRecord.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        type: 'runbook_repeat',
        created_at: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          runbook_id: '$source.runbook_id',
          runbook_step_title: '$source.runbook_step_title',
          service_id: '$service_id',
        },
        count: { $sum: 1 },
        total_duration: { $sum: '$duration_seconds' },
        records: { $push: '$_id' },
      },
    },
    {
      $match: { count: { $gte: RUNBOOK_REPEAT_THRESHOLD } },
    },
  ]);

  // Pattern 2: Repeated manual incident actions (> 3 times in 30 days)
  const manualRepeats = await ToilRecord.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        type: 'manual_action',
        created_at: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          description: '$description',
          service_id: '$service_id',
        },
        count: { $sum: 1 },
        total_duration: { $sum: '$duration_seconds' },
        records: { $push: '$_id' },
      },
    },
    {
      $match: { count: { $gte: MANUAL_ACTION_THRESHOLD } },
    },
  ]);

  // Pattern 3: Alert dismissal patterns (> 5 times in 7 days)
  const alertDismissals = await ToilRecord.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        type: 'alert_dismiss',
        created_at: { $gte: sevenDaysAgo },
      },
    },
    {
      $group: {
        _id: { alert_rule_id: '$source.alert_rule_id' },
        count: { $sum: 1 },
        records: { $push: '$_id' },
      },
    },
    {
      $match: { count: { $gte: ALERT_DISMISS_THRESHOLD } },
    },
  ]);

  // Pattern 4: Incident recurrence (> 2 times in 30 days)
  const incidentRecurrence = await ToilRecord.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        type: 'incident_repeat',
        created_at: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: { service_id: '$service_id' },
        count: { $sum: 1 },
        total_duration: { $sum: '$duration_seconds' },
        records: { $push: '$_id' },
      },
    },
    {
      $match: { count: { $gte: INCIDENT_RECURRENCE_THRESHOLD } },
    },
  ]);

  // Combine all patterns that need automation assessment
  const patternsToAssess = [
    ...runbookRepeats.map((r) => ({
      records: r.records,
      description: `Runbook step "${r._id.runbook_step_title}" executed ${r.count} times in 30 days`,
      totalDuration: r.total_duration,
    })),
    ...manualRepeats.map((r) => ({
      records: r.records,
      description: `Manual action "${r._id.description}" performed ${r.count} times in 30 days`,
      totalDuration: r.total_duration,
    })),
    ...alertDismissals.map((r) => ({
      records: r.records,
      description: `Alert dismissed ${r.count} times in 7 days without action`,
      totalDuration: 0,
    })),
    ...incidentRecurrence.map((r) => ({
      records: r.records,
      description: `Same incident type recurred ${r.count} times in 30 days`,
      totalDuration: r.total_duration,
    })),
  ];

  let automatableUpdated = 0;

  // A tenant may have its own AI provider configured even if the global fallback key isn't set.
  const tenantAiAvailable =
    aiService.isAIAvailable() || !!(await aiService.getClientForTenant(tenant_id));

  for (const pattern of patternsToAssess) {
    // Ask AI if this pattern is automatable
    let automatable = true;
    let automationSuggestion: string | null = null;

    if (tenantAiAvailable) {
      try {
        const result = await aiService.generateCompletion({
          tenantId: tenant_id,
          system: 'You are an SRE expert. Given a repetitive operational task, assess if it can be automated and suggest how. Return JSON: { "automatable": boolean, "suggestion": "string" }. Return valid JSON only.',
          userMessage: pattern.description,
        });

        const parsed = JSON.parse(result.text);
        automatable = parsed.automatable ?? true;
        automationSuggestion = parsed.suggestion || null;
      } catch {
        // Fallback: assume automatable
        automatable = true;
        automationSuggestion = 'Consider creating a runbook automation for this repeated task.';
      }
    } else {
      automationSuggestion = 'Consider creating a runbook automation for this repeated task.';
    }

    // Update toil records with automation assessment
    if (pattern.records.length > 0) {
      await ToilRecord.updateMany(
        { _id: { $in: pattern.records } },
        {
          automatable,
          automation_suggestion: automationSuggestion,
        }
      );
      automatableUpdated += pattern.records.length;
    }
  }

  logger.info('Toil tracker worker: analysis complete', {
    tenant_id,
    patterns_found: patternsToAssess.length,
    runbook_repeats: runbookRepeats.length,
    manual_repeats: manualRepeats.length,
    alert_dismissals: alertDismissals.length,
    incident_recurrences: incidentRecurrence.length,
    records_updated: automatableUpdated,
  });
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.toil.record') {
      await handleRecord(data);
    } else if (subject === 'icc.toil.analyze') {
      await handleAnalyze(data);
    } else {
      logger.debug('Toil tracker worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Toil tracker worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startToilTrackerWorker(): Promise<void> {
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
      logger.error('Toil tracker worker loop error', { error: err.message });
    }
  });

  logger.info('Toil tracker worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopToilTrackerWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Toil tracker worker stopped');
}
