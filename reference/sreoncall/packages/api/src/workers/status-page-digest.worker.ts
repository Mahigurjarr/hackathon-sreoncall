/**
 * Status Page Weekly Digest Worker
 *
 * Runs once per hour, checks if a weekly digest is due (every Monday 9:00 UTC),
 * and sends digest emails to confirmed subscribers of status pages that have
 * `show_weekly_summary` enabled.
 */

import { StatusPage } from '../models/status-page.model';
import { StatusUpdate } from '../models/status-update.model';
import { StatusPageSubscriber } from '../models/status-page-subscriber.model';
import { sendWeeklyDigestEmail } from '../services/email.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastDigestWeek = '';

export function startStatusPageDigestWorker(): void {
  if (intervalHandle) return;
  logger.info('Status page digest worker starting');
  intervalHandle = setInterval(runDigestCycle, POLL_INTERVAL_MS);
}

export function stopStatusPageDigestWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Status page digest worker stopped');
}

function getWeekKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return `${year}-W${week}`;
}

async function runDigestCycle(): Promise<void> {
  try {
    const now = new Date();

    // Only send on Mondays between 9:00-9:59 UTC
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 9) return;

    const weekKey = getWeekKey();
    if (lastDigestWeek === weekKey) return; // Already sent this week
    lastDigestWeek = weekKey;

    logger.info('Running weekly status page digest');

    // Find pages with weekly summary enabled
    const pages = await StatusPage.find({
      'settings.display_options.show_weekly_summary': true,
      is_public: true,
    });

    if (pages.length === 0) {
      logger.info('No status pages with weekly summary enabled');
      return;
    }

    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const page of pages) {
      try {
        // Get updates from the past week
        const updates = await StatusUpdate.find({
          status_page_id: page._id,
          visibility: 'public',
          created_at: { $gte: oneWeekAgo },
        })
          .sort({ created_at: -1 })
          .lean();

        // Get confirmed email subscribers
        const subscribers = await StatusPageSubscriber.find({
          status_page_id: page._id,
          channel: 'email',
          confirmed: true,
        });

        if (subscribers.length === 0) continue;

        // Build digest data
        const incidentCount = updates.filter(
          (u) => u.status !== 'informational'
        ).length;
        const resolvedCount = updates.filter(
          (u) => u.status === 'resolved'
        ).length;

        const digest = {
          pageName: page.name,
          slug: page.slug,
          weekStart: oneWeekAgo.toISOString().slice(0, 10),
          weekEnd: now.toISOString().slice(0, 10),
          totalUpdates: updates.length,
          incidentCount,
          resolvedCount,
          updates: updates.slice(0, 10).map((u) => ({
            title: u.title,
            status: u.status,
            created_at: u.created_at,
          })),
        };

        // Send to each subscriber in batches
        const BATCH_SIZE = 10;
        for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
          const batch = subscribers.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map((sub) =>
              sendWeeklyDigestEmail({
                to: sub.email,
                unsubscribeToken: sub.unsubscribe_token,
                ...digest,
              })
            )
          );
        }

        logger.info('Weekly digest sent for status page', {
          pageSlug: page.slug,
          subscriberCount: subscribers.length,
          updateCount: updates.length,
        });
      } catch (err: any) {
        logger.error('Failed to send weekly digest for status page', {
          pageSlug: page.slug,
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Weekly digest cycle error', { error: err.message });
  }
}
