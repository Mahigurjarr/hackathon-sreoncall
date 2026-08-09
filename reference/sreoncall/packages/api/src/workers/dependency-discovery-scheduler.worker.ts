/**
 * Dependency Discovery Scheduler Worker
 *
 * Every 15 minutes, checks all tenants with auto-discovery enabled
 * (`DependencyDiscoverySettings.otel_trace_scanning_enabled`) and fires a
 * discovery job for any tenant whose `next_run_at` has passed — reusing the
 * exact same NATS trigger path the "Run Now" button uses, rather than a
 * separate scheduling mechanism.
 */

import { DependencyDiscoverySettings } from '../models/dependency-discovery-settings.model';
import { DependencyDiscoveryJob } from '../models/dependency-discovery-job.model';
import { triggerDiscovery, publishDiscoveryTriggerEvent } from '../services/service-dependency.service';
import { intervalToMs } from '../services/dependency-discovery-settings.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 15 * 60_000; // 15 minutes
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startDependencyDiscoveryScheduler(): void {
  if (intervalHandle) return;
  logger.info('Dependency discovery scheduler starting');
  intervalHandle = setInterval(runSchedulerSweep, POLL_INTERVAL_MS);
  runSchedulerSweep().catch((err) =>
    logger.error('Dependency discovery scheduler sweep error', { error: err.message }),
  );
}

export function stopDependencyDiscoveryScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Dependency discovery scheduler stopped');
}

async function runSchedulerSweep(): Promise<void> {
  const dueSettings = await DependencyDiscoverySettings.find({
    otel_trace_scanning_enabled: true,
    next_run_at: { $lte: new Date() },
  });

  for (const settings of dueSettings) {
    try {
      await maybeTriggerForTenant(settings);
    } catch (err: any) {
      logger.error('Dependency discovery scheduler failed for tenant', {
        tenantId: settings.tenant_id.toString(),
        error: err.message,
      });
    }
  }
}

async function maybeTriggerForTenant(settings: InstanceType<typeof DependencyDiscoverySettings>): Promise<void> {
  const tenantId = settings.tenant_id.toString();

  // Skip if a scan is already in flight — avoids stacking a second job on a
  // slow-running one (OTel/LGTM queries can be slow; the discovery worker
  // itself uses a 120s ack_wait for this reason).
  const inFlight = await DependencyDiscoveryJob.exists({
    tenant_id: settings.tenant_id,
    type: 'otel_trace_scan',
    status: { $in: ['pending', 'running'] },
  });
  if (inFlight) {
    logger.debug('Dependency discovery scheduler: skipping tenant, scan already in flight', { tenantId });
    return;
  }

  const job = await triggerDiscovery(tenantId, 'otel_trace_scan', null, {
    observability_connection_id: settings.observability_connection_id,
  });
  await publishDiscoveryTriggerEvent(tenantId, job._id.toString(), 'otel_trace_scan', null);

  settings.next_run_at = new Date(Date.now() + intervalToMs(settings.schedule_interval));
  await settings.save();

  logger.info('Dependency discovery scheduler: triggered scan', { tenantId, jobId: job._id.toString() });
}
