import { v4 as uuid } from 'uuid';
import { Types } from 'mongoose';
import { OnCallSchedule, OnCallScheduleDocument } from '../models/oncall-schedule.model';
import { Service } from '../models/service.model';
import { AppError } from '../middleware/errorHandler.middleware';

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Returns date components for a UTC Date in the given IANA timezone.
 */
function tzParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(p['hour']!, 10);
  return {
    year:    parseInt(p['year']!, 10),
    month:   parseInt(p['month']!, 10),
    day:     parseInt(p['day']!, 10),
    weekday: weekdayMap[p['weekday']!] ?? 0,
    hour:    hour === 24 ? 0 : hour,
    minute:  parseInt(p['minute']!, 10),
  };
}

/**
 * Converts a "local" date+time (year/month/day/hour/minute in `tz`) to a UTC ms timestamp.
 * Uses a two-step approach to handle DST correctly.
 */
function localToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number,
  tz: string,
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  // Step 1: parse as UTC proxy
  const proxyUtc = new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00.000Z`,
  );
  // Step 2: see what timezone says for that UTC moment
  const actual = tzParts(proxyUtc, tz);
  // Step 3: compute the offset and correct
  const desiredMs = Date.UTC(year, month - 1, day, hour, minute);
  const actualMs  = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
  return proxyUtc.getTime() + (desiredMs - actualMs);
}

/**
 * Returns the UTC ms of the first occurrence of (handoffWeekday at HH:MM in tz)
 * on or after the Unix epoch.
 */
function firstHandoffAfterEpochMs(
  handoffWeekday: number,
  handoffHour: number,
  handoffMinute: number,
  tz: string,
): number {
  // Unix epoch = 1970-01-01 00:00 UTC = Thursday (weekday 4) in UTC.
  // Scan forward from epoch until we land on the right weekday.
  let candidate = new Date(0); // 1970-01-01T00:00:00.000Z
  for (let i = 0; i < 8; i++) {
    const p = tzParts(candidate, tz);
    if (p.weekday === handoffWeekday) {
      const ts = localToUtcMs(p.year, p.month, p.day, handoffHour, handoffMinute, tz);
      if (ts >= 0) return ts;
    }
    candidate = new Date(candidate.getTime() + 86_400_000);
  }
  return 0;
}

// ─── Rotation computation ─────────────────────────────────────────────────────

interface OnCallResult {
  current_user_id: string | null;
  layer_id: string | null;
  next_user_id: string | null;
  handoff_at: Date | null;
  handoff_in_seconds: number | null;
  override_active: boolean;
}

function computeOnCallForLayer(
  layer: OnCallScheduleDocument['layers'][0],
  scheduleTz: string,
  now: Date,
): { userId: string | null; handoffAt: Date | null } {
  const users = layer.users.map((u) => u.toString());
  if (users.length === 0) return { userId: null, handoffAt: null };

  const tz        = layer.timezone || scheduleTz || 'UTC';
  const [sh, sm]  = (layer.start_time || '09:00').split(':').map(Number) as [number, number];
  const nowMs     = now.getTime();

  if (layer.rotation_type === 'weekly') {
    const handoffWeekday = layer.handoff_day ?? 1; // default Monday
    const epochRef = firstHandoffAfterEpochMs(handoffWeekday, sh, sm, tz);
    const msPerWeek = 7 * 86_400_000;

    // Find most recent handoff ≤ now
    const elapsed   = nowMs - epochRef;
    const periodIdx = elapsed < 0 ? 0 : Math.floor(elapsed / msPerWeek);
    const userIdx   = ((periodIdx % users.length) + users.length) % users.length;

    const lastHandoffMs = epochRef + periodIdx * msPerWeek;
    const nextHandoffMs = lastHandoffMs + msPerWeek;

    return {
      userId:    users[userIdx]!,
      handoffAt: new Date(nextHandoffMs),
    };
  }

  if (layer.rotation_type === 'daily') {
    // Daily handoff at sh:sm in tz
    const p          = tzParts(now, tz);
    const todayHandoffMs = localToUtcMs(p.year, p.month, p.day, sh, sm, tz);
    const epochRef   = firstHandoffAfterEpochMs(0 /* any weekday is fine, start from Thu */, sh, sm, tz);
    const msPerDay   = 86_400_000;

    const elapsed    = nowMs - epochRef;
    const periodIdx  = elapsed < 0 ? 0 : Math.floor(elapsed / msPerDay);
    const userIdx    = ((periodIdx % users.length) + users.length) % users.length;

    const nextHandoffMs = todayHandoffMs > nowMs
      ? todayHandoffMs
      : todayHandoffMs + msPerDay;

    return {
      userId:    users[userIdx]!,
      handoffAt: new Date(nextHandoffMs),
    };
  }

  if (layer.rotation_type === 'monthly') {
    // Cycle users by calendar month index
    const p = tzParts(now, tz);
    const monthIndex = (p.year - 1970) * 12 + (p.month - 1);
    const userIdx = ((monthIndex % users.length) + users.length) % users.length;

    // Next handoff is the 1st of next month at start_time
    const nextMonth = p.month === 12 ? 1 : p.month + 1;
    const nextYear = p.month === 12 ? p.year + 1 : p.year;
    const nextHandoffMs = localToUtcMs(nextYear, nextMonth, 1, sh, sm, tz);

    return {
      userId:    users[userIdx]!,
      handoffAt: new Date(nextHandoffMs),
    };
  }

  // custom_hours or fallback: return first user
  return { userId: users[0]!, handoffAt: null };
}

/**
 * Check if current time falls within a layer's start_time-end_time window.
 * Handles overnight ranges (e.g., 22:00 - 06:00).
 */
function isTimeInLayerWindow(
  layer: OnCallScheduleDocument['layers'][0],
  scheduleTz: string,
  now: Date,
): boolean {
  const tz = layer.timezone || scheduleTz || 'UTC';
  const p = tzParts(now, tz);
  const nowMinutes = p.hour * 60 + p.minute;

  const [startH, startM] = (layer.start_time || '09:00').split(':').map(Number) as [number, number];
  const [endH, endM] = (layer.end_time || '17:00').split(':').map(Number) as [number, number];
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Normal range (e.g., 09:00 - 17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 06:00)
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

/**
 * Returns the UTC ms timestamp of the layer's end_time boundary relative
 * to `now` — i.e. the next moment the current shift stops. Handles
 * overnight ranges (start > end) by rolling to the next calendar day
 * when `now` is already past midnight but before the end.
 */
function nextEndOfLayerWindowMs(
  layer: OnCallScheduleDocument['layers'][0],
  scheduleTz: string,
  now: Date,
): number | null {
  const tz = layer.timezone || scheduleTz || 'UTC';
  const [startH, startM] = (layer.start_time || '09:00').split(':').map(Number) as [number, number];
  const [endH, endM] = (layer.end_time || '17:00').split(':').map(Number) as [number, number];
  if ([startH, startM, endH, endM].some((n) => Number.isNaN(n))) return null;

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  // 24/7 layer — no meaningful end boundary within the day.
  if (startMinutes === endMinutes) return null;

  const p = tzParts(now, tz);
  const nowMinutes = p.hour * 60 + p.minute;

  if (startMinutes <= endMinutes) {
    // Normal range: end is today at end_time.
    return localToUtcMs(p.year, p.month, p.day, endH, endM, tz);
  }
  // Overnight range: if `now` is after midnight (nowMinutes < endMinutes),
  // end is today; otherwise (still before midnight), end is tomorrow.
  if (nowMinutes < endMinutes) {
    return localToUtcMs(p.year, p.month, p.day, endH, endM, tz);
  }
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const pt = tzParts(tomorrow, tz);
  return localToUtcMs(pt.year, pt.month, pt.day, endH, endM, tz);
}

/**
 * Finds the next shift for this schedule after `atTime` (i.e. the layer
 * whose time-window covers the instant the current shift ends). Returns
 * who is on-call in that layer at that instant. Used to surface
 * cross-shift handoffs in the on-call widget instead of same-shift
 * intra-layer rotations.
 */
function resolveNextShiftAt(
  schedule: OnCallScheduleDocument,
  excludeLayerId: string | null,
  atTime: Date,
): { userId: string | null; layerId: string } | null {
  // Probe slightly after atTime so we pick the layer that STARTS at the
  // handoff boundary, not the one that ends there.
  const probe = new Date(atTime.getTime() + 60_000);
  for (const l of schedule.layers) {
    if (l.id === excludeLayerId) continue;
    if (l.users.length === 0) continue;
    if (isTimeInLayerWindow(l, schedule.timezone, probe)) {
      const { userId } = computeOnCallForLayer(l, schedule.timezone, probe);
      return { userId, layerId: l.id };
    }
  }
  return null;
}

/**
 * Computes who is currently on-call for a schedule, checking overrides first.
 * Iterates ALL layers, checking time windows. First matching layer wins.
 */
function computeCurrentOnCall(schedule: OnCallScheduleDocument): OnCallResult {
  const now = new Date();

  // 1. Check active overrides (most recently created override wins)
  const activeOverride = schedule.overrides
    .filter((o) => new Date(o.start) <= now && new Date(o.end) >= now)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  if (activeOverride) {
    return {
      current_user_id:  activeOverride.user_id.toString(),
      layer_id:         null,
      next_user_id:     null,
      handoff_at:       new Date(activeOverride.end),
      handoff_in_seconds: Math.max(0, Math.floor((new Date(activeOverride.end).getTime() - now.getTime()) / 1000)),
      override_active:  true,
    };
  }

  // 2. Iterate ALL layers — first matching layer (time window) wins
  for (const layer of schedule.layers) {
    if (layer.users.length === 0) continue;
    if (isTimeInLayerWindow(layer, schedule.timezone, now)) {
      const { userId, handoffAt: intraHandoffAt } = computeOnCallForLayer(layer, schedule.timezone, now);
      const users = layer.users.map((u) => u.toString());

      // Intra-layer successor (next user in the same rotation — e.g.
      // "next week on this shift").
      let intraNextUserId: string | null = null;
      if (userId && users.length > 1) {
        const idx = users.indexOf(userId);
        intraNextUserId = users[(idx + 1) % users.length] ?? null;
      }

      // Cross-shift successor (primary of the NEXT layer whose window
      // starts when this layer's window ends). For multi-shift schedules,
      // this is typically the more immediate handoff — today at end_time
      // — not the intra-layer rotation next week.
      let nextHandoffAt = intraHandoffAt;
      let nextUserId = intraNextUserId;
      const shiftEndMs = nextEndOfLayerWindowMs(layer, schedule.timezone, now);
      if (shiftEndMs && shiftEndMs > now.getTime()) {
        const nextShift = resolveNextShiftAt(schedule, layer.id, new Date(shiftEndMs));
        if (nextShift?.userId) {
          const shiftHandoffAt = new Date(shiftEndMs);
          // Prefer whichever handoff is sooner. For multi-shift
          // schedules this is normally the shift boundary.
          if (!nextHandoffAt || shiftHandoffAt.getTime() < nextHandoffAt.getTime()) {
            nextHandoffAt = shiftHandoffAt;
            nextUserId = nextShift.userId;
          }
        }
      }

      return {
        current_user_id:  userId,
        layer_id:         layer.id,
        next_user_id:     nextUserId,
        handoff_at:       nextHandoffAt,
        handoff_in_seconds: nextHandoffAt
          ? Math.max(0, Math.floor((nextHandoffAt.getTime() - now.getTime()) / 1000))
          : null,
        override_active:  false,
      };
    }
  }

  // 3. Fallback: first layer with users
  const fallbackLayer = schedule.layers.find((l) => l.users.length > 0);
  if (!fallbackLayer) {
    return {
      current_user_id:  null,
      layer_id:         null,
      next_user_id:     null,
      handoff_at:       null,
      handoff_in_seconds: null,
      override_active:  false,
    };
  }

  const { userId, handoffAt } = computeOnCallForLayer(fallbackLayer, schedule.timezone, now);
  const users = fallbackLayer.users.map((u) => u.toString());

  let nextUserId: string | null = null;
  if (userId && users.length > 1) {
    const idx = users.indexOf(userId);
    nextUserId = users[(idx + 1) % users.length] ?? null;
  }

  return {
    current_user_id:  userId,
    layer_id:         fallbackLayer.id,
    next_user_id:     nextUserId,
    handoff_at:       handoffAt,
    handoff_in_seconds: handoffAt
      ? Math.max(0, Math.floor((handoffAt.getTime() - now.getTime()) / 1000))
      : null,
    override_active:  false,
  };
}

// ─── Service functions ─────────────────────────────────────────────────────────

export async function listSchedules(tenantId: string, opts: {
  search?: string;
  limit?: number;
}) {
  const filter: Record<string, unknown> = { tenant_id: new Types.ObjectId(tenantId) };
  if (opts.search) {
    filter['name'] = { $regex: opts.search, $options: 'i' };
  }
  const docs = await OnCallSchedule
    .find(filter)
    .sort({ enabled: -1, created_at: -1 })
    .limit(opts.limit ?? 100)
    .lean();
  return docs;
}

export async function getScheduleById(tenantId: string, id: string) {
  const doc = await OnCallSchedule.findOne({
    _id: new Types.ObjectId(id),
    tenant_id: new Types.ObjectId(tenantId),
  });
  if (!doc) throw AppError.notFound('On-call schedule not found');
  return doc;
}

export async function createSchedule(input: {
  tenant_id: string;
  name: string;
  description?: string;
  timezone?: string;
  layers?: Array<{
    name: string;
    rotation_type?: string;
    users?: string[];
    start_time?: string;
    end_time?: string;
    timezone?: string;
    handoff_day?: number | null;
  }>;
  service_ids?: string[];
  escalation_policy_id?: string | null;
  created_by: string;
}) {
  const layers = (input.layers ?? []).map((l) => ({
    id:                    uuid(),
    name:                  l.name,
    rotation_type:         l.rotation_type || 'weekly',
    users:                 (l.users ?? []).map((uid) => new Types.ObjectId(uid)),
    start_time:            l.start_time || '09:00',
    end_time:              l.end_time || '17:00',
    timezone:              l.timezone || input.timezone || 'UTC',
    handoff_day:           l.handoff_day ?? null,
    rotation_length_seconds: 604800,
    restrictions:          [],
  }));

  const doc = await OnCallSchedule.create({
    tenant_id:            new Types.ObjectId(input.tenant_id),
    name:                 input.name,
    description:          input.description || '',
    timezone:             input.timezone || 'UTC',
    layers,
    overrides:            [],
    service_ids:          (input.service_ids ?? []).map((id) => new Types.ObjectId(id)),
    escalation_policy_id: input.escalation_policy_id
      ? new Types.ObjectId(input.escalation_policy_id)
      : null,
    created_by:           new Types.ObjectId(input.created_by),
  });
  return doc;
}

export async function updateSchedule(
  tenantId: string,
  id: string,
  input: {
    name?: string;
    description?: string;
    timezone?: string;
    enabled?: boolean;
    layers?: Array<{
      id?: string;
      name: string;
      rotation_type?: string;
      users?: string[];
      start_time?: string;
      end_time?: string;
      timezone?: string;
      handoff_day?: number | null;
    }>;
    service_ids?: string[];
    escalation_policy_id?: string | null;
  },
) {
  const doc = await getScheduleById(tenantId, id);

  if (input.name !== undefined)        doc.name = input.name;
  if (input.description !== undefined) doc.description = input.description;
  if (input.timezone !== undefined)    doc.timezone = input.timezone;
  if (input.enabled !== undefined)     doc.enabled = input.enabled;
  if (input.service_ids !== undefined) {
    doc.service_ids = input.service_ids.map((sid) => new Types.ObjectId(sid)) as any;
  }
  if (input.escalation_policy_id !== undefined) {
    doc.escalation_policy_id = input.escalation_policy_id
      ? (new Types.ObjectId(input.escalation_policy_id) as any)
      : null;
  }

  if (input.layers !== undefined) {
    doc.layers = input.layers.map((l) => ({
      id:                    l.id || uuid(),
      name:                  l.name,
      rotation_type:         (l.rotation_type as any) || 'weekly',
      users:                 (l.users ?? []).map((uid) => new Types.ObjectId(uid)) as any,
      start_time:            l.start_time || '09:00',
      end_time:              l.end_time || '17:00',
      timezone:              l.timezone || doc.timezone,
      handoff_day:           l.handoff_day ?? null,
      rotation_length_seconds: 604800,
      restrictions:          [],
    })) as any;
  }

  await doc.save();
  return doc;
}

export async function deleteSchedule(tenantId: string, id: string) {
  const doc = await getScheduleById(tenantId, id);

  const linkedCount = await Service.countDocuments({
    oncall_schedule_id: new Types.ObjectId(id),
    tenant_id: new Types.ObjectId(tenantId),
    deleted_at: null,
  });
  if (linkedCount > 0) {
    throw AppError.badRequest(
      `Cannot delete: linked to ${linkedCount} service(s). Unlink first.`,
    );
  }

  await doc.deleteOne();
}

export async function getCurrentOnCall(tenantId: string, id: string) {
  const schedule = await getScheduleById(tenantId, id);
  return computeCurrentOnCall(schedule);
}

export async function addOverride(
  tenantId: string,
  id: string,
  input: {
    user_id: string;
    layer_id?: string | null;
    start: string;
    end: string;
    reason?: string;
    created_by: string;
  },
) {
  const doc = await getScheduleById(tenantId, id);

  const start = new Date(input.start);
  const end   = new Date(input.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw AppError.badRequest('Invalid start or end date');
  }
  if (end <= start) {
    throw AppError.badRequest('Override end must be after start');
  }

  const override = {
    id:         uuid(),
    user_id:    new Types.ObjectId(input.user_id) as any,
    layer_id:   input.layer_id || null,
    start,
    end,
    reason:     input.reason || null,
    created_by: new Types.ObjectId(input.created_by) as any,
    created_at: new Date(),
  };

  doc.overrides.push(override as any);
  await doc.save();
  return doc;
}

export async function deleteOverride(tenantId: string, scheduleId: string, overrideId: string) {
  const doc = await getScheduleById(tenantId, scheduleId);
  const idx = doc.overrides.findIndex((o) => o.id === overrideId);
  if (idx === -1) throw AppError.notFound('Override not found');
  doc.overrides.splice(idx, 1);
  await doc.save();
  return doc;
}
