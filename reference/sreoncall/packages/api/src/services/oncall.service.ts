/**
 * On-Call Resolution Service
 *
 * Determines who is currently on-call for a given tenant by evaluating
 * on-call schedules: overrides take priority, then layer rotation logic.
 */

import { Types } from 'mongoose';
import { OnCallSchedule, OnCallScheduleDocument, ScheduleLayer } from '../models/oncall-schedule.model';
import { Team } from '../models/team.model';
import { logger } from '../utils/logger';

/**
 * Get the current on-call user(s) for a tenant.
 * Returns a deduplicated list of user ObjectIds who are currently on-call.
 */
export async function getCurrentOnCallUsersForServices(
  tenantId: Types.ObjectId,
  serviceIds: Types.ObjectId[]
): Promise<Types.ObjectId[]> {
  if (serviceIds.length === 0) return getCurrentOnCallUsers(tenantId);

  // Find schedules linked to these services
  const schedules = await OnCallSchedule.find({
    tenant_id: tenantId,
    service_ids: { $in: serviceIds },
  });

  // If no schedules linked to services, fall back to all tenant schedules
  if (schedules.length === 0) return getCurrentOnCallUsers(tenantId);

  const now = new Date();
  const onCallUserIds = new Set<string>();
  for (const schedule of schedules) {
    const users = resolveScheduleOnCall(schedule, now);
    for (const uid of users) onCallUserIds.add(uid.toString());
  }
  return Array.from(onCallUserIds).map((id) => new Types.ObjectId(id));
}

/**
 * Resolve on-call user(s) for a single specific schedule belonging to a tenant.
 * Used by managed-support tiered escalation to page the exact tier schedule
 * the provider configured on the contract, not the tenant-wide default.
 */
export async function getOnCallUsersForSchedule(
  scheduleId: Types.ObjectId,
  tenantId: Types.ObjectId,
  at: Date = new Date(),
): Promise<Types.ObjectId[]> {
  const schedule = await OnCallSchedule.findOne({ _id: scheduleId, tenant_id: tenantId });
  if (!schedule) return [];
  return resolveScheduleOnCall(schedule, at);
}

/** Union of on-call users across all given schedules — used when a contract
 *  tier has multiple schedules (e.g. follow-the-sun L1 + L2 pools). */
export async function getOnCallUsersForSchedules(
  scheduleIds: Types.ObjectId[],
  tenantId: Types.ObjectId,
  at: Date = new Date(),
): Promise<Types.ObjectId[]> {
  if (scheduleIds.length === 0) return [];
  const schedules = await OnCallSchedule.find({ _id: { $in: scheduleIds }, tenant_id: tenantId });
  const seen = new Set<string>();
  const result: Types.ObjectId[] = [];
  for (const s of schedules) {
    for (const uid of resolveScheduleOnCall(s, at)) {
      if (!seen.has(uid.toString())) {
        seen.add(uid.toString());
        result.push(uid);
      }
    }
  }
  return result;
}

/**
 * Per-schedule on-call resolution for a batch of schedule IDs.
 * Issues ONE OnCallSchedule query and returns a Map<scheduleId, userId[]>
 * so callers can look up each service's on-call user without extra round-trips.
 */
export async function resolveScheduleOnCallMap(
  scheduleIds: Types.ObjectId[],
  tenantId: Types.ObjectId,
  at: Date = new Date(),
): Promise<Map<string, Types.ObjectId[]>> {
  const result = new Map<string, Types.ObjectId[]>();
  if (scheduleIds.length === 0) return result;

  const schedules = await OnCallSchedule.find({
    _id: { $in: scheduleIds },
    tenant_id: tenantId,
  });

  for (const schedule of schedules) {
    result.set(schedule._id.toString(), resolveScheduleOnCall(schedule, at));
  }

  return result;
}

export async function getCurrentOnCallUsers(
  tenantId: Types.ObjectId
): Promise<Types.ObjectId[]> {
  const schedules = await OnCallSchedule.find({ tenant_id: tenantId });

  if (schedules.length === 0) {
    return [];
  }

  const now = new Date();
  const onCallUserIds = new Set<string>();

  for (const schedule of schedules) {
    const users = resolveScheduleOnCall(schedule, now);
    for (const uid of users) {
      onCallUserIds.add(uid.toString());
    }
  }

  return Array.from(onCallUserIds).map((id) => new Types.ObjectId(id));
}

/**
 * Resolve on-call user(s) for a specific schedule at a given time.
 * Overrides take priority over layer rotation.
 */
function resolveScheduleOnCall(
  schedule: OnCallScheduleDocument,
  now: Date
): Types.ObjectId[] {
  // 1. Check overrides first
  const activeOverride = schedule.overrides.find(
    (o) => now >= o.start && now < o.end
  );
  if (activeOverride) {
    return [activeOverride.user_id];
  }

  // 2. Evaluate each layer — pass schedule timezone so start_time/end_time windows
  //    are evaluated in the correct timezone (e.g. Asia/Kolkata for IST schedules)
  const users: Types.ObjectId[] = [];
  for (const layer of schedule.layers) {
    const user = resolveLayerOnCall(layer, now, schedule.timezone || 'UTC');
    if (user) {
      users.push(user);
    }
  }

  return users;
}

/**
 * Returns the hour+minute in a given timezone for a Date.
 * Uses Intl.DateTimeFormat to convert correctly (handles DST, IST half-hour offsets, etc.)
 */
function nowMinutesInTz(date: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    return parseInt(parts['hour']!, 10) * 60 + parseInt(parts['minute']!, 10);
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/**
 * Determine who is on-call for a specific rotation layer at a given time.
 */
function resolveLayerOnCall(layer: ScheduleLayer, now: Date, scheduleTz = 'UTC'): Types.ObjectId | null {
  if (!layer.users || layer.users.length === 0) return null;

  // Check start_time/end_time window (handles follow-the-sun layers like APAC/EMEA/AMER).
  // Times are stored in the layer/schedule timezone, so we must convert `now` to that tz first.
  if (layer.start_time && layer.end_time) {
    const tz = (layer as any).timezone || scheduleTz;
    const nowMins = nowMinutesInTz(now, tz);
    const [sh, sm] = layer.start_time.split(':').map(Number) as [number, number];
    const [eh, em] = layer.end_time.split(':').map(Number) as [number, number];
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    const inWindow = startMins <= endMins
      ? nowMins >= startMins && nowMins < endMins  // normal range
      : nowMins >= startMins || nowMins < endMins;  // overnight range
    if (!inWindow) return null;
  }

  // Check additional day/hour restrictions (in UTC — kept as-is for back-compat)
  if (layer.restrictions && layer.restrictions.length > 0) {
    const dayOfWeek = now.getDay();
    const hour = now.getHours();
    const matchesRestriction = layer.restrictions.some(
      (r) => r.days.includes(dayOfWeek) && hour >= r.start_hour && hour < r.end_hour
    );
    if (!matchesRestriction) return null;
  }

  // Calculate which user is on-call based on rotation
  const rotationSeconds = layer.rotation_length_seconds || 604800; // default 7 days
  const rotationMs = rotationSeconds * 1000;

  // Use a fixed epoch as rotation start reference
  const epoch = new Date('2024-01-01T00:00:00Z').getTime();
  const elapsed = now.getTime() - epoch;
  const rotationIndex = Math.floor(elapsed / rotationMs);
  const userIndex = rotationIndex % layer.users.length;

  return layer.users[userIndex];
}

export const resolveLayerOnCallExported = resolveLayerOnCall;

export function resolvePrimaryOnCall(
  schedule: OnCallScheduleDocument,
  now: Date,
): { user_id: Types.ObjectId | null; layer_id: string | null; layer_index: number; is_override: boolean } {
  const activeOverride = schedule.overrides.find((o) => now >= o.start && now < o.end);
  if (activeOverride) {
    return { user_id: activeOverride.user_id, layer_id: null, layer_index: -1, is_override: true };
  }
  for (let i = 0; i < schedule.layers.length; i++) {
    const layer = schedule.layers[i];
    const user_id = resolveLayerOnCall(layer, now);
    if (user_id) {
      return { user_id, layer_id: (layer as any)._id?.toString() ?? null, layer_index: i, is_override: false };
    }
  }
  return { user_id: null, layer_id: null, layer_index: 0, is_override: false };
}

export function resolveUserAtLayer(
  schedule: OnCallScheduleDocument,
  layerIndex: number,
  now: Date,
): { user_id: Types.ObjectId | null; layer_id: string | null } {
  const layer = schedule.layers[layerIndex];
  if (!layer) return { user_id: null, layer_id: null };
  return { user_id: resolveLayerOnCall(layer, now), layer_id: (layer as any)._id?.toString() ?? null };
}

/**
 * Resolve escalation target to user IDs.
 * Supports target_type: 'user', 'team', 'schedule', 'provider_escalation'
 */
export async function resolveEscalationTargets(
  targetType: 'user' | 'team' | 'schedule' | 'provider_escalation',
  targetIds: Types.ObjectId[],
  tenantId: Types.ObjectId
): Promise<Types.ObjectId[]> {
  const userIds = new Set<string>();

  switch (targetType) {
    case 'user':
      for (const id of targetIds) {
        userIds.add(id.toString());
      }
      break;

    case 'team':
      for (const teamId of targetIds) {
        try {
          const team = await Team.findOne({ _id: teamId, tenant_id: tenantId });
          if (team) {
            for (const memberId of team.members) {
              userIds.add(memberId.toString());
            }
          }
        } catch (err: any) {
          logger.warn('Failed to resolve team for escalation', { teamId: teamId.toString(), error: err.message });
        }
      }
      break;

    case 'schedule':
      for (const scheduleId of targetIds) {
        try {
          const schedule = await OnCallSchedule.findOne({ _id: scheduleId, tenant_id: tenantId });
          if (schedule) {
            const onCallUsers = resolveScheduleOnCall(schedule, new Date());
            for (const uid of onCallUsers) {
              userIds.add(uid.toString());
            }
          }
        } catch (err: any) {
          logger.warn('Failed to resolve schedule for escalation', { scheduleId: scheduleId.toString(), error: err.message });
        }
      }
      break;

    case 'provider_escalation':
      // Provider escalation is handled separately via incident bridge — no local user targets
      break;
  }

  return Array.from(userIds).map((id) => new Types.ObjectId(id));
}
