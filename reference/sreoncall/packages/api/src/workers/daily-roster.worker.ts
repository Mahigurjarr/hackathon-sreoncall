/**
 * Daily On-Call Roster Worker
 *
 * Once per day (configurable via ROSTER_POST_HOUR_LOCAL env, default 09:00
 * local-to-schedule timezone), posts the day's on-call rotation to the
 * tenant's connected Slack channels. Helps teams see "who's on point today"
 * without having to open the dashboard.
 *
 * Polls every 5 minutes. For each enabled schedule, checks the current
 * time in the schedule's timezone. If we're at/past the configured post
 * hour AND last_roster_posted_date is not today's date (in that tz), posts
 * the message and updates the marker.
 *
 * Message format:
 *   📅 Daily On-Call · <schedule name>
 *   <date in tz>
 *   • <Layer 1>: <Person 1>
 *   • <Layer 2>: <Person 2>
 *   ...
 */

import { Types } from 'mongoose';
import { OnCallSchedule, OnCallScheduleDocument } from '../models/oncall-schedule.model';
import { User } from '../models/user.model';
import { resolveAllSlackTargets } from '../services/incident-slack.service';
import { resolveLayerOnCallExported } from '../services/oncall.service';
import * as slackService from '../services/slack.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 5 * 60_000; // every 5 min
// Default post hour used only when a schedule's daily_roster_post_hour is
// unset. Per-schedule setting always wins. Override via env for self-hosters
// who want a global default different from 9.
const DEFAULT_POST_HOUR = parseInt(process.env['ROSTER_POST_HOUR_LOCAL'] || '9', 10);

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function dateKeyInTz(now: Date, timezone: string): string {
  try {
    // YYYY-MM-DD in the schedule's timezone
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function hourInTz(now: Date, timezone: string): number {
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now), 10);
  } catch {
    return now.getUTCHours();
  }
}

async function processSchedule(schedule: OnCallScheduleDocument, now: Date): Promise<void> {
  // Per-schedule opt-in. Default off — schedules don't post a daily roster
  // unless an operator explicitly enables it from the Edit dialog.
  if ((schedule as any).daily_roster_enabled !== true) return;

  const tz = schedule.timezone || 'UTC';
  const todayKey = dateKeyInTz(now, tz);
  if ((schedule as any).last_roster_posted_date === todayKey) return; // already posted today

  const postHour = typeof (schedule as any).daily_roster_post_hour === 'number'
    ? (schedule as any).daily_roster_post_hour
    : DEFAULT_POST_HOUR;
  const currentHour = hourInTz(now, tz);
  if (currentHour < postHour) return; // too early in the day

  // Resolve each layer's current on-call user
  const layerEntries: { layerName: string; userName: string | null }[] = [];
  const userIds: Types.ObjectId[] = [];
  for (const layer of schedule.layers) {
    const userId = resolveLayerOnCallExported(layer as any, now);
    if (userId) userIds.push(userId);
    layerEntries.push({ layerName: layer.name || 'Layer', userName: null });
  }
  // Active override
  const activeOverride = schedule.overrides.find((o) => now >= o.start && now < o.end);
  if (activeOverride) userIds.push(activeOverride.user_id);

  // Batch-fetch user names
  const users = userIds.length > 0
    ? await User.find({ _id: { $in: userIds } }).select('name').lean()
    : [];
  const nameMap = new Map(users.map((u: any) => [u._id.toString(), u.name]));

  for (let i = 0; i < schedule.layers.length; i++) {
    const userId = resolveLayerOnCallExported(schedule.layers[i] as any, now);
    layerEntries[i]!.userName = userId ? (nameMap.get(userId.toString()) || null) : null;
  }

  const overrideName = activeOverride
    ? (nameMap.get(activeOverride.user_id.toString()) || 'override user')
    : null;

  // Build the message
  const dateDisplay = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(now);

  const lines: string[] = [];
  lines.push(`📅 *Daily On-Call · ${schedule.name}*`);
  lines.push(`_${dateDisplay}  (${tz})_`);
  if (overrideName) {
    lines.push(`🔁 *Active override:* ${overrideName} — taking precedence over the rotation today.`);
  }
  for (const e of layerEntries) {
    lines.push(`• *${e.layerName}:* ${e.userName || '_no one assigned_'}`);
  }
  const text = lines.join('\n');

  // Post to Slack targets that would receive a NATIVE incident on this
  // tenant — i.e. channels with empty source-routing filter, OR filter
  // containing the tenant's own id. Channels filtered to specific managed
  // consumers (e.g. alygrp's #gigaspace-sreoncall) are excluded so the
  // alygrp roster doesn't pollute a Gigaspace-scoped channel.
  // Synthetic incident stub: source_consumer_tenant_id=null +
  // tenant_id=schedule.tenant_id triggers the "incidentSource = tenant_id"
  // branch in channelMatchesIncident.
  const syntheticIncident = {
    tenant_id: schedule.tenant_id,
    source_consumer_tenant_id: null,
  } as any;
  const targets = await resolveAllSlackTargets(schedule.tenant_id, syntheticIncident);
  if (targets.length === 0) {
    logger.debug('Daily roster: no Slack targets for tenant', {
      tenantId: schedule.tenant_id.toString(), scheduleId: schedule._id.toString(),
    });
  }
  for (const t of targets) {
    try {
      await slackService.postMessage(t.token, t.channelId, text);
    } catch (err: any) {
      logger.warn('Daily roster Slack post failed', {
        scheduleId: schedule._id.toString(), channelId: t.channelId, error: err.message,
      });
    }
  }

  await OnCallSchedule.updateOne(
    { _id: schedule._id },
    { $set: { last_roster_posted_date: todayKey } },
  );

  logger.info('Daily roster posted', {
    scheduleId: schedule._id.toString(),
    channelCount: targets.length,
    date: todayKey,
  });
}

async function runCycle(): Promise<void> {
  try {
    const schedules = await OnCallSchedule.find({ enabled: true });
    const now = new Date();
    for (const s of schedules) {
      try {
        await processSchedule(s, now);
      } catch (err: any) {
        logger.warn('Daily roster processSchedule failed', {
          scheduleId: s._id.toString(),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Daily roster cycle failed', { error: err.message });
  }
}

export function startDailyRosterWorker(): void {
  if (intervalHandle) return;
  logger.info('Daily roster worker started', { defaultPostHour: DEFAULT_POST_HOUR, pollIntervalMs: POLL_INTERVAL_MS });
  runCycle().catch(() => {});
  intervalHandle = setInterval(() => {
    runCycle().catch(() => {});
  }, POLL_INTERVAL_MS);
}

export function stopDailyRosterWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
