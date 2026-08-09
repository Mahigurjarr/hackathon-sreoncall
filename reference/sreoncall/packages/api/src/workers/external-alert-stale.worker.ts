/**
 * External Alert Stale-Detection Worker
 *
 * Some monitoring platforms (Groundcover, certain Prometheus setups) don't
 * send an explicit "resolved" webhook when an alert clears — they simply
 * stop sending firing pings. SREonCall would otherwise leave the incident
 * open indefinitely.
 *
 * This worker polls every minute and auto-resolves any incident sourced
 * from an external alert where the last firing ping was longer ago than
 * EXTERNAL_ALERT_STALE_MINUTES (default: 10 min, configurable via env).
 *
 * Only acts on incidents that:
 *   - have custom_fields.external_alert_fingerprint set (i.e. created via
 *     the external alert ingest path)
 *   - have status in {open, acknowledged, investigating, monitoring}
 *   - last firing ping is older than the threshold
 *   - the source still has auto_resolve=true (consumer opt-in)
 */

import { Incident } from '../models/incident.model';
import { ExternalAlertSource } from '../models/external-alert-source.model';
import * as incidentService from '../services/incident.service';
import { Types } from 'mongoose';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 60_000;
const STALE_MINUTES = parseInt(process.env['EXTERNAL_ALERT_STALE_MINUTES'] || '10', 10);

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runStaleCheck(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000);
  try {
    const stale = await Incident.find({
      'custom_fields.external_alert_fingerprint': { $exists: true, $ne: null },
      'custom_fields.external_alert_last_firing_at': { $lt: cutoff },
      status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
    }).select('_id tenant_id custom_fields number').lean();

    if (stale.length === 0) return;

    for (const inc of stale) {
      try {
        // Re-check source's auto_resolve flag — operator may have toggled
        // it off for noisy sources.
        const sourceId = (inc as any).custom_fields?.external_source_id;
        if (sourceId) {
          const src = await ExternalAlertSource.findById(sourceId).select('auto_resolve').lean();
          if (src && (src as any).auto_resolve === false) continue;
        }
        await incidentService.resolveIncident(
          inc.tenant_id as Types.ObjectId,
          (inc._id as Types.ObjectId).toString(),
          new Types.ObjectId('000000000000000000000000') as any, // system actor
          `Auto-resolved: no firing ping from external monitor in ${STALE_MINUTES} minutes`,
        );
        logger.info('External alert auto-resolved (stale)', {
          incidentId: inc._id.toString(),
          incidentNumber: (inc as any).number,
          staleMinutes: STALE_MINUTES,
        });
      } catch (err: any) {
        logger.warn('Failed to auto-resolve stale external-alert incident', {
          incidentId: inc._id.toString(),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('External alert stale-check cycle failed', { error: err.message });
  }
}

export function startExternalAlertStaleWorker(): void {
  if (intervalHandle) return;
  logger.info('External alert stale-detection worker started', { staleMinutes: STALE_MINUTES, pollIntervalMs: POLL_INTERVAL_MS });
  runStaleCheck().catch(() => {});
  intervalHandle = setInterval(() => {
    runStaleCheck().catch(() => {});
  }, POLL_INTERVAL_MS);
}

export function stopExternalAlertStaleWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
