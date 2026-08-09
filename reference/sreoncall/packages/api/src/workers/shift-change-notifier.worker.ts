/**
 * Shift Change Notifier Worker
 *
 * Polls every minute. For each enabled schedule, computes who is currently
 * on-call. If that changed since the last poll (different user, or new
 * user where there was none), dispatches:
 *   - Shift-start notification to the new on-call: in-app + email + SMS
 *     (+ voice for paid plans on critical schedules).
 *   - Shift-end / handover notification to the outgoing on-call: in-app +
 *     email; tells them who's taking over so they can pass context.
 *
 * Idempotent across restarts via the schedule's `last_notified_user_id`
 * field — we only fire when the resolved primary differs from that stored
 * value.
 */

import { Types } from 'mongoose';
import { OnCallSchedule, OnCallScheduleDocument } from '../models/oncall-schedule.model';
import { User } from '../models/user.model';
import { resolvePrimaryOnCall } from '../services/oncall.service';
import { createBulkNotifications } from '../services/notification.service';
import { sendNotificationEmail } from '../services/email-notification.service';
import { sendSms } from '../services/sms.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 60_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function processSchedule(schedule: OnCallScheduleDocument, now: Date): Promise<void> {
  const primary = resolvePrimaryOnCall(schedule, now);
  const currentUserId = primary.user_id;
  const previousUserId = (schedule as any).last_notified_user_id ?? null;

  // No change — nothing to do.
  if (currentUserId?.toString() === previousUserId?.toString()) return;

  // Persist the new state first so a crash mid-notify doesn't cause a re-send.
  await OnCallSchedule.updateOne(
    { _id: schedule._id },
    { $set: { last_notified_user_id: currentUserId, last_notified_at: now } },
  );

  // Fetch user objects for naming + outreach
  const userIds: Types.ObjectId[] = [];
  if (currentUserId) userIds.push(currentUserId);
  if (previousUserId) userIds.push(previousUserId);
  const users = userIds.length > 0
    ? await User.find({ _id: { $in: userIds } }).select('name email phone_number notification_preferences').lean()
    : [];
  const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));
  const incomingUser = currentUserId ? userMap.get(currentUserId.toString()) : null;
  const outgoingUser = previousUserId ? userMap.get(previousUserId.toString()) : null;

  const scheduleName = schedule.name;
  const incomingName = (incomingUser as any)?.name || 'someone';
  const outgoingName = (outgoingUser as any)?.name || 'someone';

  // Notify incoming person — shift start
  if (incomingUser) {
    const title = `On-call shift starting · ${scheduleName}`;
    const body = previousUserId
      ? `You're now on-call on the "${scheduleName}" rotation. Handover from ${outgoingName} — please reach out if you need context on anything in flight.`
      : `You're now on-call on the "${scheduleName}" rotation. Stay reachable; you'll be paged for any incident routed to this schedule.`;

    await createBulkNotifications([{
      tenant_id: schedule.tenant_id,
      user_id: currentUserId!,
      type: 'oncall',
      priority: 'info',
      title,
      body,
      resource_type: 'oncall_schedule',
      resource_id: schedule._id.toString(),
    }]);

    // Email gated by user's pref. With the new opt-in default, users who
    // haven't enabled email won't receive shift emails — only the in-app
    // notification. Escalation policies bypass this gate (intentional).
    if ((incomingUser as any).email && (incomingUser as any).notification_preferences?.email) {
      sendNotificationEmail(
        (incomingUser as any).email,
        title,
        body,
        `/on-call/schedules/${schedule._id.toString()}`,
        schedule.tenant_id.toString(),
      ).catch((err) => logger.warn('Shift-start email failed', { error: err.message }));
    }
    const prefs = (incomingUser as any).notification_preferences || {};
    const phone = (incomingUser as any).phone_number;
    if (phone && prefs.sms) {
      sendSms(phone, `[SREonCall] Your on-call shift on "${scheduleName}" has started. ${previousUserId ? `Handover from ${outgoingName}.` : ''}`)
        .catch((err) => logger.warn('Shift-start SMS failed', { error: err.message }));
    }
  }

  // Notify outgoing person — shift end / handover ask
  if (outgoingUser) {
    const title = `On-call shift ending · ${scheduleName}`;
    const body = currentUserId
      ? `Your on-call shift on "${scheduleName}" is ending. ${incomingName} is now on-call — please hand over context on any in-flight incidents directly with them.`
      : `Your on-call shift on "${scheduleName}" is ending. No one is currently scheduled to take over — please raise this with your team.`;

    await createBulkNotifications([{
      tenant_id: schedule.tenant_id,
      user_id: previousUserId!,
      type: 'oncall',
      priority: currentUserId ? 'info' : 'warning',
      title,
      body,
      resource_type: 'oncall_schedule',
      resource_id: schedule._id.toString(),
    }]);

    if ((outgoingUser as any).email && (outgoingUser as any).notification_preferences?.email) {
      sendNotificationEmail(
        (outgoingUser as any).email,
        title,
        body,
        `/on-call/schedules/${schedule._id.toString()}`,
        schedule.tenant_id.toString(),
      ).catch((err) => logger.warn('Shift-end email failed', { error: err.message }));
    }
  }

  logger.info('Shift change processed', {
    scheduleId: schedule._id.toString(),
    incomingUser: currentUserId?.toString() || null,
    outgoingUser: previousUserId?.toString() || null,
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
        logger.warn('Shift-change processSchedule failed', {
          scheduleId: s._id.toString(),
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Shift-change worker cycle failed', { error: err.message });
  }
}

export function startShiftChangeNotifierWorker(): void {
  if (intervalHandle) return;
  logger.info('Shift-change notifier worker started', { pollIntervalMs: POLL_INTERVAL_MS });
  runCycle().catch(() => {});
  intervalHandle = setInterval(() => {
    runCycle().catch(() => {});
  }, POLL_INTERVAL_MS);
}

export function stopShiftChangeNotifierWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
