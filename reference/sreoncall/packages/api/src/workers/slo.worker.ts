import { SloDefinition, ISloDefinition } from '../models/slo-definition.model';
import { SyntheticCheckResult } from '../models/synthetic-check-result.model';
import { ObservabilityConnection } from '../models/observability-connection.model';
import * as notificationService from '../services/notification.service';
import { logger } from '../utils/logger';
import { isBarePromqlSelector } from '../utils/query-error';

const POLL_INTERVAL_MS = 60_000; // evaluate every 60 seconds
const CONCURRENCY = 10;
const QUERY_TIMEOUT_MS = 10_000;

// Central LGTM endpoints (same as alert-rule worker / observability-proxy)
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';

let timer: NodeJS.Timeout | null = null;
let running = false;

/* ── Mimir helpers (same pattern as alert-rule worker) ── */

async function resolveMimirUrl(tenantId: string): Promise<string> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
    mode: 'byos',
  }).sort({ created_at: -1 });

  if (conn?.endpoints?.metrics_url) {
    return conn.endpoints.metrics_url;
  }

  return MANAGED_MIMIR_URL;
}

async function queryMimir(promql: string, tenantId: string, mimirUrl: string): Promise<number | null> {
  const url = `${mimirUrl}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: {
        'X-Scope-OrgID': tenantId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!resp.ok) return null;

    const json: any = await resp.json();
    if (json.status === 'success' && json.data?.result?.length > 0) {
      const val = parseFloat(json.data.result[0].value?.[1]);
      return isNaN(val) ? null : val;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ── Loki helpers (for LogQL-based SLIs) ── */

async function queryLoki(logql: string, tenantId: string, windowDays: number): Promise<number | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (windowDays * 24 * 60 * 60);
  const url = `${MANAGED_LOKI_URL}/loki/api/v1/query?query=${encodeURIComponent(logql)}&time=${end}&start=${start}&end=${end}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': tenantId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    if (json.status === 'success' && json.data?.result?.length > 0) {
      const val = parseFloat(json.data.result[0].value?.[1]);
      return isNaN(val) ? null : val;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ── Synthetic SLI helper ── */

async function querySyntheticSli(checkId: string, windowDays: number): Promise<{ good: number; total: number } | null> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const results = await SyntheticCheckResult.find({
    check_id: checkId,
    checked_at: { $gte: since },
  }).lean();

  if (results.length === 0) return null;

  const good = results.filter((r) => r.status === 'up').length;
  return { good, total: results.length };
}

/* ── SLO evaluation ── */

async function evaluateSlo(slo: ISloDefinition): Promise<void> {
  const tenantId = slo.tenant_id.toString();
  const windowDays = slo.window_days || 30;
  let currentSliPct: number | null = null;

  if (slo.sli.source === 'managed_logql') {
    // LogQL-based SLI (e.g., Heroku log drain, Loki queries)
    if (!slo.sli.query_good || !slo.sli.query_total) {
      logger.warn('SLO missing query_good or query_total for logql', { sloId: slo._id, tenantId });
      return;
    }

    const [good, total] = await Promise.all([
      queryLoki(slo.sli.query_good, tenantId, windowDays),
      queryLoki(slo.sli.query_total, tenantId, windowDays),
    ]);

    if (good === null || total === null || total === 0) {
      await SloDefinition.updateOne({ _id: slo._id }, { $set: { last_evaluated_at: new Date() } });
      logger.debug('SLO evaluation: no data from Loki', { sloId: slo._id, tenantId });
      return;
    }

    currentSliPct = (good / total) * 100;
  } else if (slo.sli.source === 'managed_promql' || slo.sli.source === 'byos') {
    // Query Mimir for good and total event counts
    if (!slo.sli.query_good || !slo.sli.query_total) {
      logger.warn('SLO missing query_good or query_total', { sloId: slo._id, tenantId });
      return;
    }

    const mimirUrl = await resolveMimirUrl(tenantId);

    // Wrap queries in a range aggregation over the SLO window
    const windowMinutes = windowDays * 24 * 60;
    const queryGood = isBarePromqlSelector(slo.sli.query_good)
      ? `sum(increase(${slo.sli.query_good.trim()}[${windowMinutes}m]))`
      : slo.sli.query_good.trim();
    const queryTotal = isBarePromqlSelector(slo.sli.query_total)
      ? `sum(increase(${slo.sli.query_total.trim()}[${windowMinutes}m]))`
      : slo.sli.query_total.trim();

    const [good, total] = await Promise.all([
      queryMimir(queryGood, tenantId, mimirUrl),
      queryMimir(queryTotal, tenantId, mimirUrl),
    ]);

    if (good === null || total === null || total === 0) {
      // No data available — update last_evaluated_at but leave computed values as-is
      await SloDefinition.updateOne({ _id: slo._id }, {
        $set: { last_evaluated_at: new Date() },
      });
      logger.debug('SLO evaluation: no data from Mimir', { sloId: slo._id, tenantId });
      return;
    }

    currentSliPct = (good / total) * 100;
  } else if (slo.sli.source === 'synthetic') {
    // Query synthetic check results over the SLO window
    if (!slo.sli.synthetic_check_id) {
      logger.warn('SLO with synthetic source missing synthetic_check_id', { sloId: slo._id, tenantId });
      return;
    }

    const syntheticResult = await querySyntheticSli(
      slo.sli.synthetic_check_id.toString(),
      windowDays,
    );

    if (!syntheticResult || syntheticResult.total === 0) {
      await SloDefinition.updateOne({ _id: slo._id }, {
        $set: { last_evaluated_at: new Date() },
      });
      logger.debug('SLO evaluation: no synthetic check results', { sloId: slo._id, tenantId });
      return;
    }

    currentSliPct = (syntheticResult.good / syntheticResult.total) * 100;
  } else {
    logger.warn('Unknown SLI source type', { sloId: slo._id, source: slo.sli.source });
    return;
  }

  // Compute error budget remaining
  // Error budget = 100 - objective_pct (e.g., 0.1% for a 99.9% SLO)
  const errorBudgetTotal = 100 - slo.objective_pct;
  const errorConsumed = 100 - currentSliPct; // how much error we've actually used
  const errorBudgetRemainingPct = errorBudgetTotal > 0
    ? Math.max(0, ((errorBudgetTotal - errorConsumed) / errorBudgetTotal) * 100)
    : 0;

  // Compute burn rate
  // burn_rate = (error_consumed / error_budget_total)
  // A burn rate of 1.0 means we're consuming budget at exactly the sustainable rate
  // A burn rate > 1.0 means we're consuming budget faster than sustainable
  const burnRate = errorBudgetTotal > 0
    ? errorConsumed / errorBudgetTotal
    : 0;

  // Update SLO document with computed values
  const updateFields: Record<string, any> = {
    current_sli_pct: Math.round(currentSliPct * 10000) / 10000, // 4 decimal places
    error_budget_remaining_pct: Math.round(errorBudgetRemainingPct * 100) / 100,
    burn_rate: Math.round(burnRate * 1000) / 1000,
    last_evaluated_at: new Date(),
  };

  await SloDefinition.updateOne({ _id: slo._id }, { $set: updateFields });

  logger.debug('SLO evaluated', {
    sloId: slo._id,
    tenantId,
    name: slo.name,
    currentSliPct: updateFields.current_sli_pct,
    errorBudgetRemainingPct: updateFields.error_budget_remaining_pct,
    burnRate: updateFields.burn_rate,
  });

  // Check burn rate thresholds and send alerts if needed
  if (slo.alert_on_burn_rate && slo.created_by) {
    const fastBurn = slo.burn_rate_thresholds?.fast_burn ?? 14.4;
    const slowBurn = slo.burn_rate_thresholds?.slow_burn ?? 6;

    let alertSeverity: 'fast_burn' | 'slow_burn' | null = null;
    if (burnRate >= fastBurn) {
      alertSeverity = 'fast_burn';
    } else if (burnRate >= slowBurn) {
      alertSeverity = 'slow_burn';
    }

    if (alertSeverity) {
      logger.info(`SLO burn rate alert: "${slo.name}" ${alertSeverity} (burn_rate=${burnRate.toFixed(2)}, threshold=${alertSeverity === 'fast_burn' ? fastBurn : slowBurn})`, {
        sloId: slo._id, tenantId,
      });

      try {
        await notificationService.createNotification({
          tenant_id: slo.tenant_id as any,
          user_id: slo.created_by as any,
          type: 'alert',
          title: `SLO Burn Rate Alert: ${slo.name}`,
          body: alertSeverity === 'fast_burn'
            ? `SLO "${slo.name}" is burning error budget at ${burnRate.toFixed(2)}x (fast burn threshold: ${fastBurn}x). Current SLI: ${currentSliPct.toFixed(2)}%, Error budget remaining: ${errorBudgetRemainingPct.toFixed(1)}%.`
            : `SLO "${slo.name}" is burning error budget at ${burnRate.toFixed(2)}x (slow burn threshold: ${slowBurn}x). Current SLI: ${currentSliPct.toFixed(2)}%, Error budget remaining: ${errorBudgetRemainingPct.toFixed(1)}%.`,
          resource_type: 'slo',
          resource_id: slo._id.toString(),
        });
      } catch (err: any) {
        logger.error('Failed to create SLO burn rate notification', { sloId: slo._id, error: err.message });
      }
    }
  }
}

/* ── Worker lifecycle (same pattern as alert-rule worker) ── */

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const slos = await SloDefinition.find({ status: 'active' }).lean();
    if (slos.length > 0) {
      logger.debug(`SLO worker: evaluating ${slos.length} active SLOs`);
      for (let i = 0; i < slos.length; i += CONCURRENCY) {
        await Promise.allSettled(
          slos.slice(i, i + CONCURRENCY).map((s) => evaluateSlo(s as any)),
        );
      }
    }
  } catch (err: any) {
    logger.error('SLO worker tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

export function startSloWorker(): void {
  logger.info('Starting SLO evaluation worker');
  tick().catch(() => {});
  timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
}

export function stopSloWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logger.info('SLO evaluation worker stopped');
}
