import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { SloDefinition } from '../models/slo-definition.model';
import { EmergingRisk } from '../models/emerging-risk.model';
import { Service } from '../models/service.model';
import * as lgtm from '../services/lgtm-query.service';

const STREAM_NAME = 'ICC_PREDICTIVE';
const CONSUMER_NAME = 'icc-predictive-processor';

let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.predictive.>'],
      retention: 'workqueue' as any,
      max_msgs: 100_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_PREDICTIVE stream created');
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
      ack_wait: 120_000_000_000, // 2 minutes (metric queries can be slow)
    });
    logger.info('Predictive worker consumer created');
  }
}

async function handleBurnRate(data: any): Promise<void> {
  const { tenant_id, slo_id } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Predictive worker: calculating burn rates', { tenant_id, slo_id });

  // Fetch SLO definitions to process
  const query: any = { tenant_id: tenantId };
  if (slo_id) {
    query._id = new Types.ObjectId(slo_id);
  }

  const sloDefinitions = await SloDefinition.find(query);

  if (sloDefinitions.length === 0) {
    logger.debug('Predictive worker: no SLO definitions found', { tenant_id });
    return;
  }

  const js = getJetStream();

  for (const slo of sloDefinitions) {
    try {
      // Query Mimir for actual metric data to calculate burn rates
      const sloMetric = (slo as any).metric || 'http_requests';
      const [burnRate1h, burnRate6h, burnRate24h] = await Promise.all([
        lgtm.queryMetricInstant(
          tenant_id,
          `1 - (sum(rate(${sloMetric}_total{status!~"5.."}[1h])) / clamp_min(sum(rate(${sloMetric}_total[1h])), 1))`,
        ),
        lgtm.queryMetricInstant(
          tenant_id,
          `1 - (sum(rate(${sloMetric}_total{status!~"5.."}[6h])) / clamp_min(sum(rate(${sloMetric}_total[6h])), 1))`,
        ),
        lgtm.queryMetricInstant(
          tenant_id,
          `1 - (sum(rate(${sloMetric}_total{status!~"5.."}[24h])) / clamp_min(sum(rate(${sloMetric}_total[24h])), 1))`,
        ),
      ]);

      // Calculate forecast breach time
      let forecastBreachAt: Date | null = null;
      let forecastConfidence: number | null = null;

      if (burnRate24h !== null && burnRate24h > 0) {
        const sloTarget = (slo as any).target_percent || 99.9;
        const errorBudgetPercent = 100 - sloTarget;
        const sloWindowDays = (slo as any).window_days || 30;

        // Calculate remaining error budget from actual metric data
        const errorBudgetUsedPercent = burnRate24h * 100; // burn rate is the fraction of budget consumed per window
        const totalBudgetMinutes = (errorBudgetPercent / 100) * sloWindowDays * 24 * 60;
        const usedBudgetMinutes = (errorBudgetUsedPercent / 100) * totalBudgetMinutes;
        const remainingBudgetMinutes = totalBudgetMinutes - usedBudgetMinutes;

        if (remainingBudgetMinutes > 0 && burnRate24h > 0) {
          const minutesToBreach = remainingBudgetMinutes / burnRate24h;
          if (minutesToBreach > 0 && minutesToBreach < sloWindowDays * 24 * 60) {
            forecastBreachAt = new Date(Date.now() + minutesToBreach * 60 * 1000);
            forecastConfidence = (burnRate6h !== null && burnRate24h > burnRate6h) ? 70 : 50;
          }
        }

        // Check if we need to generate predictive alerts
        const predictiveConfig = (slo as any).predictive_alerts;
        if (predictiveConfig?.enabled && forecastBreachAt) {
          // Publish alert notification if budget crosses warn/critical thresholds
          let alertSeverity: string | null = null;
          let alertMessage: string | null = null;

          if (errorBudgetUsedPercent >= (predictiveConfig.critical_at_budget_percent ?? 90)) {
            alertSeverity = 'critical';
            alertMessage = `SLO "${(slo as any).name}" error budget critically low (${errorBudgetUsedPercent}% consumed). Projected breach at ${forecastBreachAt.toISOString()}.`;
          } else if (errorBudgetUsedPercent >= (predictiveConfig.warn_at_budget_percent ?? 75)) {
            alertSeverity = 'warning';
            alertMessage = `SLO "${(slo as any).name}" error budget warning (${errorBudgetUsedPercent}% consumed). Projected breach at ${forecastBreachAt.toISOString()}.`;
          }

          if (alertSeverity && alertMessage) {
            try {
              await js.publish(
                `notifications.slo.${alertSeverity}`,
                new TextEncoder().encode(JSON.stringify({
                  event: 'slo_budget_alert',
                  tenant_id: tenant_id,
                  slo_id: slo._id.toString(),
                  slo_name: (slo as any).name,
                  severity: alertSeverity,
                  message: alertMessage,
                  error_budget_used_percent: errorBudgetUsedPercent,
                  forecast_breach_at: forecastBreachAt.toISOString(),
                  forecast_confidence: forecastConfidence,
                }))
              );
              logger.info('Predictive worker: SLO budget alert published', {
                slo_id: slo._id.toString(),
                severity: alertSeverity,
              });
            } catch (pubErr: any) {
              logger.warn('Failed to publish SLO budget alert', { error: pubErr.message });
            }
          }
        }
      }

      // Update SLO definition with burn rate data
      await SloDefinition.findByIdAndUpdate(slo._id, {
        'burn_rate.current_1h': burnRate1h,
        'burn_rate.current_6h': burnRate6h,
        'burn_rate.current_24h': burnRate24h,
        'burn_rate.forecast_breach_at': forecastBreachAt,
        'burn_rate.forecast_confidence': forecastConfidence,
        updated_at: new Date(),
      });

      logger.debug('Predictive worker: burn rate updated', {
        slo_id: slo._id.toString(),
        burn_rate_1h: burnRate1h,
        burn_rate_24h: burnRate24h,
        forecast_breach_at: forecastBreachAt ? (forecastBreachAt as Date).toISOString() : null,
      });
    } catch (err: any) {
      logger.error('Predictive worker: failed to calculate burn rate for SLO', {
        slo_id: slo._id.toString(),
        error: err.message,
      });
    }
  }

  logger.info('Predictive worker: burn rate calculation complete', {
    tenant_id,
    slos_processed: sloDefinitions.length,
  });
}

async function handleEmergingRisks(data: any): Promise<void> {
  const { tenant_id } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Predictive worker: evaluating emerging risks', { tenant_id });

  // Fetch all services for the tenant
  const services = await Service.find({ tenant_id: tenantId, status: { $ne: 'archived' } });

  if (services.length === 0) {
    logger.debug('Predictive worker: no services found', { tenant_id });
    return;
  }

  let risksCreated = 0;
  let risksCleared = 0;

  for (const service of services) {
    try {
      // Query Mimir for service metrics to detect pre-incident signals
      const svcName = service.name;

      // Check 1: CPU trend (derivative over 6h)
      const cpuTrend = await lgtm.queryMetricInstant(
        tenant_id,
        `deriv(process_cpu_seconds_total{service="${svcName}"}[6h]) * 100`,
      );

      // Check 2: Memory trend (derivative over 6h)
      const memTrend = await lgtm.queryMetricInstant(
        tenant_id,
        `deriv(process_resident_memory_bytes{service="${svcName}"}[6h])`,
      );
      const currentMem = await lgtm.queryMetricInstant(
        tenant_id,
        `process_resident_memory_bytes{service="${svcName}"}`,
      );

      // Check 3: Error spike detection (15m error rate)
      const errorRate = await lgtm.queryMetricInstant(
        tenant_id,
        `100 * sum(rate(http_requests_total{service="${svcName}",status=~"5.."}[15m])) / clamp_min(sum(rate(http_requests_total{service="${svcName}"}[15m])), 1)`,
      );

      // Check 4: Disk usage projection (predict 24h ahead)
      const diskProjected = await lgtm.queryMetricInstant(
        tenant_id,
        `predict_linear(node_filesystem_avail_bytes{service="${svcName}"}[6h], 3600*24)`,
      );

      // Create risks based on real metric data
      // Memory climbing risk
      if (memTrend !== null && memTrend > 0 && currentMem !== null) {
        const memTrendPerHour = memTrend * 3600; // bytes per hour
        const projectedMem3h = currentMem + memTrendPerHour * 3;
        // If projected to grow > 20% in 3 hours, flag it
        if (memTrendPerHour > currentMem * 0.02) {
          await EmergingRisk.findOneAndUpdate(
            { tenant_id: tenantId, service_id: service._id, risk_type: 'resource_exhaustion', cleared_at: null },
            {
              tenant_id: tenantId,
              service_id: service._id,
              risk_type: 'resource_exhaustion',
              severity: 'warning',
              description: `Memory climbing ${(memTrendPerHour / 1024 / 1024).toFixed(1)}MB/hour for 6h, projected ${Math.round(projectedMem3h / 1024 / 1024)}MB in 3h`,
              current_value: `${Math.round(currentMem / 1024 / 1024)}MB`,
              projected_value: `${Math.round(projectedMem3h / 1024 / 1024)}MB`,
              projected_breach_at: new Date(Date.now() + 3 * 3600 * 1000),
              recommendation: 'Consider scaling up or investigating memory leak',
              updated_at: new Date(),
            },
            { upsert: true, new: true },
          );
          risksCreated++;
        }
      }

      // Error spike risk
      if (errorRate !== null && errorRate > 5) {
        await EmergingRisk.findOneAndUpdate(
          { tenant_id: tenantId, service_id: service._id, risk_type: 'error_spike', cleared_at: null },
          {
            tenant_id: tenantId,
            service_id: service._id,
            risk_type: 'error_spike',
            severity: errorRate > 20 ? 'critical' : 'warning',
            description: `Error rate at ${errorRate.toFixed(1)}% over last 15 minutes`,
            current_value: `${errorRate.toFixed(1)}%`,
            projected_value: null,
            projected_breach_at: null,
            recommendation: 'Investigate recent deployments or upstream dependency failures',
            updated_at: new Date(),
          },
          { upsert: true, new: true },
        );
        risksCreated++;
      }

      // CPU trend risk (mapped to metric_trending)
      if (cpuTrend !== null && cpuTrend > 2) {
        await EmergingRisk.findOneAndUpdate(
          { tenant_id: tenantId, service_id: service._id, risk_type: 'metric_trending', description: /CPU/, cleared_at: null },
          {
            tenant_id: tenantId,
            service_id: service._id,
            risk_type: 'metric_trending',
            severity: 'warning',
            description: `CPU usage climbing at ${cpuTrend.toFixed(1)}%/hour over 6h`,
            current_value: `trend: +${cpuTrend.toFixed(1)}%/hr`,
            projected_value: null,
            projected_breach_at: null,
            recommendation: 'Investigate for runaway processes or consider scaling',
            updated_at: new Date(),
          },
          { upsert: true, new: true },
        );
        risksCreated++;
      }

      // Disk exhaustion risk (mapped to resource_exhaustion — disk variant)
      if (diskProjected !== null && diskProjected < 0) {
        await EmergingRisk.findOneAndUpdate(
          { tenant_id: tenantId, service_id: service._id, risk_type: 'resource_exhaustion', description: /[Dd]isk/, cleared_at: null },
          {
            tenant_id: tenantId,
            service_id: service._id,
            risk_type: 'resource_exhaustion',
            severity: 'critical',
            description: `Disk projected to fill within 24 hours based on 6h trend`,
            current_value: null,
            projected_value: 'Full within 24h',
            projected_breach_at: new Date(Date.now() + 24 * 3600 * 1000),
            recommendation: 'Clean up disk space, increase volume, or add log rotation',
            updated_at: new Date(),
          },
          { upsert: true, new: true },
        );
        risksCreated++;
      }

      // Clear risks that are no longer active
      const existingRisks = await EmergingRisk.find({
        tenant_id: tenantId,
        service_id: service._id,
        cleared_at: null,
      });
      for (const risk of existingRisks) {
        let isHealthy = false;
        if (risk.risk_type === 'error_spike' && (errorRate === null || errorRate < 2)) isHealthy = true;
        if (risk.risk_type === 'resource_exhaustion' && (memTrend === null || memTrend <= 0)) isHealthy = true;
        if (risk.risk_type === 'metric_trending' && (cpuTrend === null || cpuTrend <= 1)) isHealthy = true;
        // For resource_exhaustion that is disk-related, check disk projection
        if (risk.risk_type === 'resource_exhaustion' && risk.description?.includes('isk') && (diskProjected === null || diskProjected > 0)) isHealthy = true;
        if (isHealthy) {
          await EmergingRisk.findByIdAndUpdate(risk._id, { cleared_at: new Date() });
          risksCleared++;
        }
      }
    } catch (err: any) {
      logger.error('Predictive worker: failed to evaluate service', {
        service_id: service._id.toString(),
        service_name: service.name,
        error: err.message,
      });
    }
  }

  logger.info('Predictive worker: emerging risks evaluation complete', {
    tenant_id,
    services_evaluated: services.length,
    risks_created: risksCreated,
    risks_cleared: risksCleared,
  });
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.predictive.burn-rate') {
      await handleBurnRate(data);
    } else if (subject === 'icc.predictive.emerging-risks') {
      await handleEmergingRisks(data);
    } else {
      logger.debug('Predictive worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Predictive worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startPredictiveWorker(): Promise<void> {
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
      logger.error('Predictive worker loop error', { error: err.message });
    }
  });

  logger.info('Predictive worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopPredictiveWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Predictive worker stopped');
}
