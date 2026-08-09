/**
 * Schedule-page state machine
 *
 * Tracks per-incident-per-schedule paging state so layer escalation
 * happens sequentially (layer 0 first; on no-ack timeout, layer 1; etc.)
 * instead of paging every layer simultaneously.
 *
 * The lifecycle:
 *
 *   startSchedulePage(scheduleId, incidentId, tenantId, options)
 *     → resolves the schedule's primary user (override or layer 0),
 *       creates a SchedulePage in 'active' status with layer_deadline
 *       computed from layer.escalation_after_minutes, and returns the
 *       paged user (so the caller can dispatch a notification).
 *
 *   The schedule-page worker scans for active rows whose layer_deadline
 *   has passed and calls escalateNextLayer, which advances
 *   current_layer_index and re-deadlines, returning the next user to
 *   page. When the last layer is reached (or a layer has no escalation
 *   timeout), the page is marked 'completed' and no further escalation
 *   occurs.
 *
 *   On incident ack/resolve, cancelSchedulePagesForIncident closes any
 *   open pages so the worker stops promoting them.
 *
 * Overrides are paged once with no escalation — overrides represent a
 * specific person specifically chosen to be on call right now, so
 * skipping past them to the next layer would defeat the purpose.
 */

import { Types } from 'mongoose';
import { SchedulePage, SchedulePageDocument, SchedulePageStatus } from '../models/schedule-page.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { resolvePrimaryOnCall, resolveUserAtLayer } from './oncall.service';
import { logger } from '../utils/logger';

export interface StartSchedulePageOptions {
  tierLevel?: 1 | 2 | 3 | null;
}

export interface StartSchedulePageResult {
  page: SchedulePageDocument | null;
  /** The user that should be paged immediately. Null if the schedule has no one on call. */
  user_id: Types.ObjectId | null;
  /** True when an override fired (no escalation will happen). */
  is_override: boolean;
}

/**
 * Begin a sequential page on a schedule for a specific incident.
 *
 * If a SchedulePage already exists for this (incident, schedule, tier)
 * triple in active state, the existing one is returned without
 * re-paging — this makes the call idempotent against retries from
 * the bridge create path.
 */
export async function startSchedulePage(
  scheduleId: Types.ObjectId,
  incidentId: Types.ObjectId,
  tenantId: Types.ObjectId,
  options: StartSchedulePageOptions = {},
  now: Date = new Date(),
): Promise<StartSchedulePageResult> {
  const tierLevel = options.tierLevel ?? null;
  const existing = await SchedulePage.findOne({
    incident_id: incidentId,
    schedule_id: scheduleId,
    tier_level: tierLevel,
    status: 'active',
  });
  if (existing) {
    return {
      page: existing,
      user_id: existing.current_user_id,
      is_override: existing.current_layer_index === -1,
    };
  }

  const schedule = await OnCallSchedule.findOne({ _id: scheduleId, tenant_id: tenantId });
  if (!schedule || !schedule.enabled) {
    logger.warn('startSchedulePage: schedule not found or disabled', {
      schedule_id: scheduleId.toString(),
      enabled: schedule?.enabled,
    });
    return { page: null, user_id: null, is_override: false };
  }

  const primary = resolvePrimaryOnCall(schedule, now);
  if (!primary.user_id) {
    logger.info('startSchedulePage: no on-call user found', {
      schedule_id: scheduleId.toString(),
      incident_id: incidentId.toString(),
    });
    return { page: null, user_id: null, is_override: false };
  }

  // Compute the deadline. Overrides never escalate. Otherwise look up the
  // layer's escalation_after_minutes. If null / unset, this layer is the
  // last hop — page the user, mark completed.
  const layer = primary.layer_index >= 0
    ? (schedule.layers[primary.layer_index] as any)
    : null;
  const escalationMin: number | null = layer?.escalation_after_minutes ?? null;
  const hasNextLayer = !primary.is_override && primary.layer_index + 1 < schedule.layers.length;
  const layer_deadline = !primary.is_override && hasNextLayer && escalationMin && escalationMin > 0
    ? new Date(now.getTime() + escalationMin * 60_000)
    : null;
  const status: SchedulePageStatus = layer_deadline ? 'active' : 'completed';

  const page = await SchedulePage.create({
    tenant_id: tenantId,
    schedule_id: scheduleId,
    incident_id: incidentId,
    tier_level: tierLevel,
    current_layer_index: primary.layer_index,
    current_layer_id: primary.layer_id,
    current_user_id: primary.user_id,
    layer_started_at: now,
    layer_deadline,
    status,
    history: [
      {
        layer_index: primary.layer_index,
        layer_id: primary.layer_id,
        user_id: primary.user_id,
        started_at: now,
        ended_at: null,
        reason: primary.is_override ? 'override' : 'initial',
      },
    ],
    started_at: now,
  });

  return { page, user_id: primary.user_id, is_override: primary.is_override };
}

/**
 * Promote a SchedulePage to the next layer. Called by the worker when
 * `layer_deadline` has passed without an ack.
 *
 * Returns the next user to page, or null when the chain is exhausted
 * (in which case the page is marked 'completed' and no further work is
 * needed).
 */
export async function escalateNextLayer(
  page: SchedulePageDocument,
  now: Date = new Date(),
): Promise<{ page: SchedulePageDocument; nextUserId: Types.ObjectId | null; nextLayerIndex: number | null }> {
  if (page.status !== 'active') {
    return { page, nextUserId: null, nextLayerIndex: null };
  }

  const schedule = await OnCallSchedule.findById(page.schedule_id);
  if (!schedule) {
    page.status = 'canceled';
    await page.save();
    return { page, nextUserId: null, nextLayerIndex: null };
  }

  // Find the next layer that has someone on call. Skip empty layers (a
  // layer with no rotation members or no one inside the active window
  // doesn't deserve a page — escalate past it).
  let nextIndex = page.current_layer_index + 1;
  let nextUser: Types.ObjectId | null = null;
  let nextLayerId: string | null = null;

  // Close out the current history entry first.
  const open = page.history.find((h) => !h.ended_at);
  if (open) open.ended_at = now;

  while (nextIndex < schedule.layers.length) {
    const probe = resolveUserAtLayer(schedule, nextIndex, now);
    if (probe.user_id) {
      nextUser = probe.user_id;
      nextLayerId = probe.layer_id;
      break;
    }
    // Record the skip for diagnostics.
    page.history.push({
      layer_index: nextIndex,
      layer_id: probe.layer_id,
      user_id: null,
      started_at: now,
      ended_at: now,
      reason: 'no_user_for_layer',
    });
    nextIndex++;
  }

  if (!nextUser) {
    page.status = 'completed';
    await page.save();
    return { page, nextUserId: null, nextLayerIndex: null };
  }

  const nextLayer = schedule.layers[nextIndex] as any;
  const escalationMin: number | null = nextLayer?.escalation_after_minutes ?? null;
  const hasFurtherLayer = nextIndex + 1 < schedule.layers.length;
  const newDeadline = hasFurtherLayer && escalationMin && escalationMin > 0
    ? new Date(now.getTime() + escalationMin * 60_000)
    : null;

  page.current_layer_index = nextIndex;
  page.current_layer_id = nextLayerId;
  page.current_user_id = nextUser;
  page.layer_started_at = now;
  page.layer_deadline = newDeadline;
  page.history.push({
    layer_index: nextIndex,
    layer_id: nextLayerId,
    user_id: nextUser,
    started_at: now,
    ended_at: null,
    reason: 'no_ack_timeout',
  });
  if (!newDeadline) page.status = 'completed';
  await page.save();

  return { page, nextUserId: nextUser, nextLayerIndex: nextIndex };
}

/**
 * Close out any active pages for an incident. Called when the incident
 * is acknowledged, resolved, closed, or when tier escalation supersedes
 * the previous tier's pages.
 */
export async function cancelSchedulePagesForIncident(
  incidentId: Types.ObjectId,
  reason: 'acknowledged' | 'resolved' | 'canceled',
  filter: { tierLevel?: 1 | 2 | 3 | null } = {},
  now: Date = new Date(),
): Promise<number> {
  const query: Record<string, any> = { incident_id: incidentId, status: 'active' };
  if (filter.tierLevel !== undefined) {
    query.tier_level = filter.tierLevel;
  }
  const pages = await SchedulePage.find(query);
  for (const page of pages) {
    const open = page.history.find((h) => !h.ended_at);
    if (open) open.ended_at = now;
    page.status = reason;
    page.layer_deadline = null;
    await page.save();
  }
  if (pages.length > 0) {
    logger.info('Schedule pages closed', {
      incident_id: incidentId.toString(),
      reason,
      count: pages.length,
    });
  }
  return pages.length;
}

/** Convenience: list the user's currently-paged schedules for an incident. */
export async function getActiveSchedulePagesForIncident(
  incidentId: Types.ObjectId,
): Promise<SchedulePageDocument[]> {
  return SchedulePage.find({ incident_id: incidentId, status: 'active' });
}
