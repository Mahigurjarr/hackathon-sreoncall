/**
 * Work Log Digest Worker
 *
 * Polls every hour. For each tenant whose digest_interval_days has elapsed,
 * sends an email to each designated approver with their pending work logs.
 * Project-scoped approvers only see work logs for tickets in their project.
 */

import { WorkLog } from '../models/work-log.model';
import { Ticket } from '../models/ticket.model';
import { User } from '../models/user.model';
import { Tenant } from '../models/tenant.model';
import * as workLogSettingsService from '../services/work-log-settings.service';
import { sendWorkLogDigestEmail, type WorkLogDigestItem } from '../services/email.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startWorkLogDigestWorker(): void {
  if (intervalHandle) return;
  logger.info('Work log digest worker starting');
  intervalHandle = setInterval(runDigestCycle, POLL_INTERVAL_MS);
  setTimeout(() => {
    runDigestCycle().catch((err) =>
      logger.error('Work log digest cycle error', { error: err.message }),
    );
  }, 30_000);
}

export function stopWorkLogDigestWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Work log digest worker stopped');
}

async function runDigestCycle(): Promise<void> {
  try {
    const now = new Date();
    const allSettings = await workLogSettingsService.getTenantsNeedingDigest();

    for (const settings of allSettings) {
      if (settings.last_digest_sent_at) {
        const elapsed = now.getTime() - settings.last_digest_sent_at.getTime();
        const intervalMs = settings.digest_interval_days * 24 * 60 * 60 * 1000;
        if (elapsed < intervalMs) continue;
      }

      const pendingLogs = await WorkLog.find({
        tenant_id: settings.tenant_id,
        status: 'pending',
      })
        .sort({ logged_at: -1 })
        .limit(20)
        .lean();

      if (pendingLogs.length === 0) {
        await workLogSettingsService.markDigestSent(settings.tenant_id);
        continue;
      }

      const pendingCount = await WorkLog.countDocuments({
        tenant_id: settings.tenant_id,
        status: 'pending',
      });

      // Build digest items
      const ticketIds = [...new Set(pendingLogs.filter((l) => l.entity_type === 'ticket').map((l) => l.entity_id))];
      const tickets = await Ticket.find({ _id: { $in: ticketIds } }, 'number title project_id').lean();
      const ticketMap = new Map(tickets.map((t) => [t._id.toString(), t]));

      // Build ticket → project mapping for scope filtering
      const ticketProjectMap = new Map<string, string>();
      for (const t of tickets) {
        if (t.project_id) ticketProjectMap.set(t._id.toString(), t.project_id.toString());
      }

      const userIds = [...new Set(pendingLogs.map((l) => l.user_id.toString()))];
      const users = await User.find({ _id: { $in: userIds } }, 'name email').lean();
      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      const tenant = await Tenant.findById(settings.tenant_id, 'name slug').lean();
      const tenantName = (tenant as any)?.name || 'Unknown';
      const tenantSlug = (tenant as any)?.slug || '';

      const allItems: (WorkLogDigestItem & { entityId: string })[] = pendingLogs.map((l) => {
        const ticket = ticketMap.get(l.entity_id.toString());
        const user = userMap.get(l.user_id.toString());
        const userName = l.source === 'provider'
          ? (l.source_user_name || 'Provider User')
          : ((user as any)?.name || 'Unknown');
        return {
          ticket_number: ticket ? `TKT-${String(ticket.number).padStart(4, '0')}` : '-',
          ticket_title: ticket?.title || '-',
          user_name: userName,
          duration_minutes: l.duration_minutes,
          logged_at: l.logged_at.toISOString().split('T')[0],
          ticket_id: l.entity_id.toString(),
          entityId: l.entity_id.toString(),
        };
      });

      // Send to each approver (filtered by scope)
      const approverIds = settings.approvers.map((a) => a.user_id);
      const approvers = await User.find({ _id: { $in: approverIds } }, 'name email').lean();
      const approverMap = new Map(approvers.map((a) => [(a as any)._id.toString(), a]));

      const approvalUrl = `https://${tenantSlug}.sreoncall.com/work-log-approvals?status=pending`;

      for (const approverConfig of settings.approvers) {
        const approver = approverMap.get(approverConfig.user_id.toString());
        if (!approver || !(approver as any).email) continue;

        // Filter items by approver scope
        const approverItems: WorkLogDigestItem[] = approverConfig.scope === 'project' && approverConfig.project_id
          ? allItems.filter((item) => {
              const projectId = ticketProjectMap.get(item.entityId);
              return projectId === approverConfig.project_id?.toString();
            })
          : allItems;

        if (approverItems.length === 0) continue;

        try {
          await sendWorkLogDigestEmail({
            to: (approver as any).email,
            approverName: (approver as any).name || 'Approver',
            tenantName,
            pendingCount: approverItems.length,
            items: approverItems,
            approvalUrl,
          });
        } catch (err) {
          logger.warn('Failed to send work log digest email', {
            approver: (approver as any).email,
            error: (err as Error).message,
          });
        }
      }

      await workLogSettingsService.markDigestSent(settings.tenant_id);
      logger.info('Work log digest sent', { tenant: tenantName, approverCount: approvers.length, pendingCount });
    }

    // SLA enforcement pass
    for (const settings of allSettings) {
      if (settings.approval_sla_days <= 0) continue;

      const slaDeadline = new Date(now.getTime() - settings.approval_sla_days * 24 * 60 * 60 * 1000);
      const overdueLogs = await WorkLog.find({
        tenant_id: settings.tenant_id,
        status: 'pending',
        createdAt: { $lte: slaDeadline },
      }).lean();

      if (overdueLogs.length === 0) continue;

      if (settings.approval_sla_action === 'auto_approve') {
        await WorkLog.updateMany(
          { _id: { $in: overdueLogs.map((l) => l._id) } },
          { $set: { status: 'approved', approved_at: new Date() } },
        );
        logger.info('Auto-approved overdue work logs', { tenant: settings.tenant_id.toString(), count: overdueLogs.length });
      } else if (settings.approval_sla_action === 'notify_admin' || settings.approval_sla_action === 'escalate') {
        // Dedup: only send SLA breach notification once per digest interval
        const shouldNotify = !settings.sla_breach_notified_at ||
          (now.getTime() - settings.sla_breach_notified_at.getTime()) >= settings.digest_interval_days * 24 * 60 * 60 * 1000;

        if (shouldNotify) {
          const { createNotification } = await import('../services/notification.service');
          for (const approver of settings.approvers) {
            await createNotification({
              tenant_id: settings.tenant_id,
              user_id: approver.user_id,
              type: 'work_log.approval_sla_breach',
              priority: 'warning' as const,
              title: 'Overdue work log approvals',
              body: `${overdueLogs.length} work log(s) have been pending approval for over ${settings.approval_sla_days} days.`,
              resource_type: 'work_log_approval',
              resource_id: 'pending',
            });
          }
          const { WorkLogSettings } = await import('../models/work-log-settings.model');
          await WorkLogSettings.updateOne(
            { tenant_id: settings.tenant_id },
            { $set: { sla_breach_notified_at: now } },
          );
        }
      }
    }
  } catch (err: any) {
    logger.error('Work log digest cycle failed', { error: err.message });
  }
}
