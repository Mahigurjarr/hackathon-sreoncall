import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { AlertRule } from '../models/alert-rule.model';
import { AlertQuality } from '../models/alert-quality.model';
import { Incident } from '../models/incident.model';
import * as lgtm from '../services/lgtm-query.service';

const STREAM_NAME = 'ICC_ALERT_QUALITY';
const CONSUMER_NAME = 'icc-alert-quality-processor';
let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.alert-quality.>'],
      retention: 'workqueue' as any,
      max_msgs: 50_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_ALERT_QUALITY stream created');
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
      ack_wait: 120_000_000_000, // 2 minutes (scanning can be slow)
    });
    logger.info('Alert quality worker consumer created');
  }
}

async function calculateAlertQuality(data: any): Promise<void> {
  const { tenant_id, alert_rule_id, window_days } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Alert quality worker: calculating scores', { tenant_id, alert_rule_id, window_days });

  // Determine which alert rules to process
  const query: any = { tenant_id: tenantId, is_active: true };
  if (alert_rule_id) {
    query._id = new Types.ObjectId(alert_rule_id);
  }

  const alertRules = await AlertRule.find(query);

  if (alertRules.length === 0) {
    logger.debug('Alert quality worker: no active alert rules found', { tenant_id });
    return;
  }

  const now = new Date();
  const windows = [
    { days: 7, label: '7d' },
    { days: 30, label: '30d' },
  ];

  // If a specific window was requested, only compute that one
  const targetWindows = window_days
    ? windows.filter((w) => w.days === window_days)
    : windows;

  for (const rule of alertRules) {
    for (const window of targetWindows) {
      const periodStart = new Date(now.getTime() - window.days * 24 * 60 * 60 * 1000);
      const periodEnd = now;

      // Query alert firing history using incidents with source='alert' and matching source_alert_id
      const alertIncidents = await Incident.find({
        tenant_id: tenantId,
        source: 'alert',
        source_alert_id: rule._id,
        createdAt: { $gte: periodStart, $lte: periodEnd },
      }).lean();

      // Total firings = all incidents created from this alert rule
      let totalFirings = alertIncidents.length;

      // Acknowledged = incidents where metrics.ack_at is set
      let acknowledgedCount = alertIncidents.filter(
        (inc) => (inc as any).metrics?.ack_at != null
      ).length;

      // Dismissed = incidents closed very quickly (mttr < 60s, likely noise)
      let dismissedCount = alertIncidents.filter(
        (inc) => (inc as any).status === 'closed' && (inc as any).metrics?.mttr_seconds != null && (inc as any).metrics.mttr_seconds < 60
      ).length;

      // Incidents that resulted in real investigation (not quickly dismissed)
      let incidentCreatedCount = totalFirings - dismissedCount;

      // Auto-resolved = resolved with no responders joined
      let autoResolvedCount = alertIncidents.filter(
        (inc) => (inc as any).status === 'resolved' && ((inc as any).responders?.length ?? 0) === 0
      ).length;

      // Average time to action (mtta_seconds) for incidents where it was recorded
      const mttaValues = alertIncidents
        .map((inc) => (inc as any).metrics?.mtta_seconds)
        .filter((v): v is number => v != null);
      let avgTimeToActionSeconds: number | null = mttaValues.length > 0
        ? Math.round(mttaValues.reduce((sum, v) => sum + v, 0) / mttaValues.length)
        : null;

      // Calculate signal and noise scores
      const signalScore = totalFirings > 0
        ? Math.round(((incidentCreatedCount + acknowledgedCount) / totalFirings) * 100)
        : 0;
      const noiseScore = totalFirings > 0
        ? Math.round((dismissedCount / totalFirings) * 100)
        : 0;

      // Generate recommendation
      let recommendation: string;
      let recommendationDetails: string | null = null;
      let suggestedThreshold: number | null = null;

      if (totalFirings === 0) {
        recommendation = 'needs_review';
        recommendationDetails = `No firings in the last ${window.days} days. Consider if this rule is still needed.`;
      } else if (noiseScore > 80) {
        recommendation = 'delete';
        recommendationDetails = `${noiseScore}% of firings were dismissed. This rule is generating excessive noise.`;
      } else if (noiseScore > 50) {
        recommendation = 'retune_threshold';
        recommendationDetails = `${noiseScore}% dismiss rate suggests the threshold is too sensitive.`;

        // Analyze metric values at alert firing times to compute a suggested threshold
        const ruleQuery = (rule as any).promql_query || (rule as any).query;
        if (ruleQuery && totalFirings > 0) {
          try {
            const metricData = await lgtm.queryMetrics(
              tenant_id,
              ruleQuery,
              Math.floor(periodStart.getTime() / 1000),
              Math.floor(periodEnd.getTime() / 1000),
              '3600s', // hourly resolution for threshold analysis
            );
            if (metricData.length > 0 && metricData[0].values.length > 0) {
              // Calculate the 90th percentile of metric values to suggest a less noisy threshold
              const allValues = metricData[0].values
                .map(([, v]) => parseFloat(v))
                .filter((v) => !isNaN(v))
                .sort((a, b) => a - b);
              if (allValues.length > 0) {
                const p90Index = Math.floor(allValues.length * 0.9);
                suggestedThreshold = allValues[p90Index];
                recommendationDetails += ` Suggested threshold (p90): ${suggestedThreshold.toFixed(2)}.`;
              }
            }
          } catch {
            // LGTM unreachable — skip metric-based threshold analysis
          }
        }
      } else if (autoResolvedCount > totalFirings * 0.7) {
        recommendation = 'increase_duration';
        recommendationDetails = `${Math.round((autoResolvedCount / totalFirings) * 100)}% of firings auto-resolved. Consider increasing the evaluation window.`;
      } else if (signalScore > 60) {
        recommendation = 'keep';
        recommendationDetails = `Strong signal: ${signalScore}% of firings led to action.`;
      } else {
        recommendation = 'needs_review';
        recommendationDetails = `Mixed signal (${signalScore}%) and noise (${noiseScore}%). Manual review recommended.`;
      }

      // Upsert alert quality record
      await AlertQuality.findOneAndUpdate(
        {
          tenant_id: tenantId,
          alert_rule_id: rule._id,
          period_start: periodStart,
        },
        {
          tenant_id: tenantId,
          alert_rule_id: rule._id,
          period_start: periodStart,
          period_end: periodEnd,
          total_firings: totalFirings,
          acknowledged_count: acknowledgedCount,
          dismissed_count: dismissedCount,
          incident_created_count: incidentCreatedCount,
          auto_resolved_count: autoResolvedCount,
          avg_time_to_action_seconds: avgTimeToActionSeconds,
          signal_score: signalScore,
          noise_score: noiseScore,
          recommendation,
          recommendation_details: recommendationDetails,
          suggested_threshold: suggestedThreshold,
          current_threshold: (rule as any).threshold || null,
          updated_at: new Date(),
        },
        { upsert: true, new: true }
      );

      logger.debug('Alert quality worker: scored rule', {
        alert_rule_id: rule._id.toString(),
        window: window.label,
        signal_score: signalScore,
        noise_score: noiseScore,
        recommendation,
      });
    }
  }

  logger.info('Alert quality worker: calculation complete', {
    tenant_id,
    rules_processed: alertRules.length,
  });
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.alert-quality.calculate') {
      await calculateAlertQuality(data);
    } else {
      logger.debug('Alert quality worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Alert quality worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startAlertQualityWorker(): Promise<void> {
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
      logger.error('Alert quality worker loop error', { error: err.message });
    }
  });

  logger.info('Alert quality worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopAlertQualityWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Alert quality worker stopped');
}
