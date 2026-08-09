import { AlertQuality, AlertQualityDocument } from '../models/alert-quality.model';
import { AlertRule } from '../models/alert-rule.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { StringCodec } from 'nats';
import { getJetStream } from '../config/nats';

export interface ListAlertQualityFilter {
  alert_rule_id?: string;
  service_id?: string;
  recommendation?: string;
  period_start?: string;
  period_end?: string;
  min_noise_score?: number;
  limit?: number;
  cursor?: string;
}

export async function list(tenantId: string, filter: ListAlertQualityFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };

  // Resolve service_id → alert_rule_ids so callers can scope to one service.
  // alert_rule_id takes precedence when both are provided.
  if (filter.service_id && !filter.alert_rule_id) {
    const ruleIds = await AlertRule.find({
      tenant_id: tenantId,
      service_id: filter.service_id,
    }).distinct('_id');
    query.alert_rule_id = { $in: ruleIds };
  }

  if (filter.alert_rule_id) query.alert_rule_id = filter.alert_rule_id;
  if (filter.recommendation) query.recommendation = filter.recommendation;
  if (filter.min_noise_score) query.noise_score = { $gte: filter.min_noise_score };
  if (filter.period_start) query.period_start = { $gte: new Date(filter.period_start) };
  if (filter.period_end) query.period_end = { $lte: new Date(filter.period_end) };
  if (filter.cursor) query._id = { $gt: filter.cursor };

  const docs = await AlertQuality.find(query)
    .populate('alert_rule_id', 'name severity status condition')
    .sort({ noise_score: -1, createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await AlertQuality.countDocuments({ tenant_id: tenantId }),
    },
  };
}

export async function getReport(tenantId: string, period: 'weekly' | 'monthly' = 'weekly') {
  const now = new Date();
  const start = new Date(now);
  if (period === 'weekly') {
    start.setDate(start.getDate() - 7);
  } else {
    start.setMonth(start.getMonth() - 1);
  }

  const scores = await AlertQuality.find({
    tenant_id: tenantId,
    period_start: { $gte: start },
  })
    .populate('alert_rule_id', 'name severity status condition')
    .sort({ noise_score: -1 })
    .lean();

  const totalAlerts = scores.length;
  const noisyAlerts = scores.filter((s) => s.noise_score > 80);
  const suggestedDeletions = scores.filter((s) => s.recommendation === 'delete');
  const suggestedRetunes = scores.filter((s) => s.recommendation === 'retune_threshold');
  const avgSignalScore = totalAlerts > 0
    ? scores.reduce((sum, s) => sum + s.signal_score, 0) / totalAlerts
    : 0;
  const avgNoiseScore = totalAlerts > 0
    ? scores.reduce((sum, s) => sum + s.noise_score, 0) / totalAlerts
    : 0;

  return {
    period,
    period_start: start.toISOString(),
    period_end: now.toISOString(),
    total_alerts_evaluated: totalAlerts,
    avg_signal_score: Math.round(avgSignalScore * 100) / 100,
    avg_noise_score: Math.round(avgNoiseScore * 100) / 100,
    noisy_alerts: noisyAlerts,
    suggested_deletions: suggestedDeletions,
    suggested_retunes: suggestedRetunes,
    recommendations_summary: {
      keep: scores.filter((s) => s.recommendation === 'keep').length,
      retune_threshold: suggestedRetunes.length,
      increase_duration: scores.filter((s) => s.recommendation === 'increase_duration').length,
      merge_with_other: scores.filter((s) => s.recommendation === 'merge_with_other').length,
      delete: suggestedDeletions.length,
      needs_review: scores.filter((s) => s.recommendation === 'needs_review').length,
    },
  };
}

export async function getByAlertRule(tenantId: string, alertRuleId: string) {
  const docs = await AlertQuality.find({
    tenant_id: tenantId,
    alert_rule_id: alertRuleId,
  })
    .sort({ period_start: -1 })
    .limit(52) // up to 52 weeks of history
    .lean();

  if (docs.length === 0) {
    throw AppError.notFound('No quality scores found for this alert rule');
  }

  return docs;
}

export async function recalculate(tenantId: string) {
  // Publish NATS message to trigger async recalculation
  try {
    const sc = StringCodec();
    const js = getJetStream();
    await js.publish(
      'icc.alert-quality.calculate',
      sc.encode(JSON.stringify({
        tenant_id: tenantId,
        requested_at: new Date().toISOString(),
      }))
    );
  } catch (err: any) {
    logger.warn('Failed to publish alert quality recalculation to NATS', { error: err.message });
  }

  return {
    message: 'Alert quality recalculation queued',
    tenant_id: tenantId,
    queued_at: new Date().toISOString(),
  };
}
