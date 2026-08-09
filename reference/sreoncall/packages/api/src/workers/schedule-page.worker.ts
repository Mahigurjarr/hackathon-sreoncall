/**
 * Schedule-page worker
 *
 * Polls active SchedulePage documents every 30s. For each page whose
 * current layer's escalation timeout has elapsed without an ack, calls
 * escalateNextLayer to advance to the next layer's user and dispatches
 * a notification to the new user.
 *
 * Sister to sla-timer.worker.ts (which handles tier-level escalation
 * across the contract). This worker handles within-schedule layer-level
 * escalation; both can fire on the same incident.
 */

import { Types } from 'mongoose';
import { SchedulePage, SchedulePageDocument } from '../models/schedule-page.model';
import { Incident } from '../models/incident.model';
import { User } from '../models/user.model';
import { escalateNextLayer } from '../services/schedule-page.service';
import { createBulkNotifications } from '../services/notification.service';
import { sendNotificationEmail } from '../services/email-notification.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 30_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startSchedulePageWorker(): void {
  if (intervalHandle) return;
  logger.info('Schedule-page worker starting');
  intervalHandle = setInterval(runCycle, POLL_INTERVAL_MS);
  runCycle().catch((err) =>
    logger.error('Schedule-page cycle error (initial)', { error: err.message }),
  );
}

export function stopSchedulePageWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Schedule-page worker stopped');
}

async function runCycle(): Promise<void> {
  try {
    const now = new Date();
    const due = await SchedulePage.find({
      status: 'active',
      layer_deadline: { $ne: null, $lte: now },
    });
    for (const page of due) {
      try {
        await processPage(page, now);
      } catch (err: any) {
        logger.error('Failed to process schedule page', {
          page_id: page._id.toString(),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Schedule-page cycle failed', { error: err.message });
  }
}

async function processPage(page: SchedulePageDocument, now: Date): Promise<void> {
  // Short-circuit if the incident is already acked/resolved/closed —
  // mark the page accordingly so we stop scanning it. (The ack/resolve
  // path will normally have called cancelSchedulePagesForIncident, but
  // there is a small race where the worker reads a stale row.)
  const incident = await Incident.findById(page.incident_id);
  if (!incident) {
    page.status = 'canceled';
    page.layer_deadline = null;
    await page.save();
    return;
  }
  if (['acknowledged', 'resolved', 'closed'].includes(incident.status)) {
    page.status = incident.status === 'acknowledged' ? 'acknowledged' : 'resolved';
    page.layer_deadline = null;
    await page.save();
    return;
  }

  const { page: updated, nextUserId, nextLayerIndex } = await escalateNextLayer(page, now);
  if (!nextUserId || nextLayerIndex === null) {
    // Last layer reached or chain exhausted; nothing more to do.
    return;
  }

  // Dispatch notification to the newly-paged user.
  const sevLabel = `SEV${incident.severity}`;
  const incidentNumber = `INC-${String(incident.number).padStart(4, '0')}`;
  const tierSegment = updated.tier_level ? ` (L${updated.tier_level})` : '';
  const layerSegment = ` — Layer ${nextLayerIndex + 1} escalation`;
  const title = `${sevLabel} ${incidentNumber}${tierSegment}${layerSegment}: ${incident.title}`;
  const body = `${incidentNumber} escalated to you because the previous on-call user did not acknowledge in time.`;
  const priority = incident.severity <= 2 ? 'critical' : incident.severity <= 3 ? 'warning' : 'info';

  await createBulkNotifications([
    {
      tenant_id: updated.tenant_id,
      user_id: nextUserId,
      type: 'incident',
      priority: priority as 'critical' | 'warning' | 'info',
      title,
      body,
      resource_type: 'incident',
      resource_id: incident._id.toString(),
    },
  ]);

  // Best-effort email — do not await.
  User.findById(nextUserId)
    .then((user) => {
      if (user?.email) {
        sendNotificationEmail(
          user.email,
          title,
          body,
          `/incidents/${incident._id}`,
          updated.tenant_id.toString(),
        ).catch((e) => logger.error('Schedule-page escalation email failed', { error: e.message }));
      }
    })
    .catch((err) => logger.error('Failed to fetch user for schedule-page email', { error: err.message }));

  // Add a timeline entry so the incident view shows the escalation step.
  incident.timeline.push({
    _id: new Types.ObjectId(),
    type: 'provider_escalation' as any,
    actor_id: null,
    message: `Layer ${nextLayerIndex + 1} escalation${tierSegment} — previous on-call did not ack in time`,
    metadata: {
      schedule_page_id: updated._id.toString(),
      schedule_id: updated.schedule_id.toString(),
      layer_index: nextLayerIndex,
      tier_level: updated.tier_level,
      reason: 'no_ack_timeout',
    },
    timestamp: now,
  } as any);
  await incident.save();

  logger.info('Schedule page escalated to next layer', {
    page_id: updated._id.toString(),
    incident_id: incident._id.toString(),
    new_layer_index: nextLayerIndex,
    new_user_id: nextUserId.toString(),
  });
}
