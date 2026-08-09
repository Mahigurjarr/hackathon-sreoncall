/**
 * Action Item Reminder Worker
 *
 * Polls every hour for postmortem action items approaching their due date.
 * - Items due within 24 hours: sends an "upcoming" reminder notification.
 * - Items past due: sends an "overdue" notification.
 *
 * Uses `reminder_sent` and `overdue_reminder_sent` flags on each action item
 * to avoid duplicate notifications.
 */

import { Postmortem, PostmortemDocument } from '../models/postmortem.model';
import { Notification } from '../models/notification.model';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startActionItemReminderWorker(): void {
  if (intervalHandle) return;
  logger.info('Action item reminder worker starting');
  intervalHandle = setInterval(runReminderCycle, POLL_INTERVAL_MS);
  // Run once immediately
  runReminderCycle().catch((err) =>
    logger.error('Action item reminder cycle error', { error: err.message })
  );
}

export function stopActionItemReminderWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Action item reminder worker stopped');
}

async function runReminderCycle(): Promise<void> {
  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find postmortems that have action items with due dates that are:
    // 1. Due within the next 24 hours and not yet reminded, OR
    // 2. Already overdue and not yet overdue-reminded
    // Only look at items that are not done.
    const postmortems = await Postmortem.find({
      'action_items.status': { $in: ['open', 'in_progress'] },
      'action_items.due_date': { $ne: null },
      $or: [
        {
          'action_items.due_date': { $lte: in24Hours, $gt: now },
          'action_items.reminder_sent': { $ne: true },
        },
        {
          'action_items.due_date': { $lte: now },
          'action_items.overdue_reminder_sent': { $ne: true },
        },
      ],
    });

    let upcomingCount = 0;
    let overdueCount = 0;

    for (const pm of postmortems) {
      const notificationDocs: any[] = [];
      let modified = false;

      for (let i = 0; i < pm.action_items.length; i++) {
        const item = pm.action_items[i];

        // Skip items that are done or have no due date or no owner
        if (item.status === 'done' || !item.due_date || !item.owner_id) continue;

        const dueDate = new Date(item.due_date);
        const isOverdue = dueDate <= now;
        const isDueSoon = dueDate <= in24Hours && dueDate > now;

        // Overdue notification
        if (isOverdue && !item.overdue_reminder_sent) {
          notificationDocs.push({
            tenant_id: pm.tenant_id,
            user_id: item.owner_id,
            type: 'postmortem.action_item_overdue',
            priority: 'warning',
            title: 'Overdue action item',
            body: `Action item "${item.description}" from postmortem "${pm.title}" is overdue (was due ${dueDate.toISOString().split('T')[0]}).`,
            resource_type: 'postmortem',
            resource_id: pm._id.toString(),
            read: false,
            created_at: now,
          });
          pm.action_items[i].overdue_reminder_sent = true;
          modified = true;
          overdueCount++;
        }

        // Upcoming due date notification (within 24 hours)
        if (isDueSoon && !item.reminder_sent) {
          notificationDocs.push({
            tenant_id: pm.tenant_id,
            user_id: item.owner_id,
            type: 'postmortem.action_item_due_soon',
            priority: 'info',
            title: 'Action item due soon',
            body: `Action item "${item.description}" from postmortem "${pm.title}" is due on ${dueDate.toISOString().split('T')[0]}.`,
            resource_type: 'postmortem',
            resource_id: pm._id.toString(),
            read: false,
            created_at: now,
          });
          pm.action_items[i].reminder_sent = true;
          modified = true;
          upcomingCount++;
        }
      }

      if (notificationDocs.length > 0) {
        await Notification.insertMany(notificationDocs);
      }
      if (modified) {
        await pm.save();
      }
    }

    if (upcomingCount > 0 || overdueCount > 0) {
      logger.info('Action item reminders sent', { upcoming: upcomingCount, overdue: overdueCount });
    }
  } catch (err: any) {
    logger.error('Action item reminder cycle failed', { error: err.message });
  }
}
