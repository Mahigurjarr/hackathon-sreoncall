import { Types } from 'mongoose';
import { Tenant, PlanLimits } from '../models/tenant.model';
import { User } from '../models/user.model';
import { getRedis } from '../config/redis';
import { createNotification } from './notification.service';
import { logger } from '../utils/logger';

interface MeteredDimension {
  usageKey: string;       // key in the usage snapshot
  limitKey: keyof PlanLimits;
  label: string;          // human readable
}

const METERED_DIMENSIONS: MeteredDimension[] = [
  { usageKey: 'users',               limitKey: 'max_users',               label: 'users' },
  { usageKey: 'services',            limitKey: 'max_services',            label: 'services' },
  { usageKey: 'tickets',             limitKey: 'max_tickets_per_month',   label: 'tickets this month' },
  { usageKey: 'incidents',           limitKey: 'max_incidents_per_month', label: 'incidents this month' },
  { usageKey: 'sms_sent',            limitKey: 'max_sms_per_month',       label: 'SMS this month' },
  { usageKey: 'voice_calls',         limitKey: 'max_voice_per_month',     label: 'voice calls this month' },
  { usageKey: 'whatsapp_sent',       limitKey: 'max_whatsapp_per_month',  label: 'WhatsApp messages this month' },
  { usageKey: 'ai_tokens_used',      limitKey: 'max_ai_tokens_per_month', label: 'AI tokens this month' },
  { usageKey: 'dashboards',          limitKey: 'max_dashboards',          label: 'dashboards' },
  { usageKey: 'alert_rules',         limitKey: 'max_alert_rules',         label: 'alert rules' },
  { usageKey: 'slos',                limitKey: 'max_slos',                label: 'SLOs' },
  { usageKey: 'on_call_schedules',   limitKey: 'max_on_call_schedules',   label: 'on-call schedules' },
  { usageKey: 'escalation_policies', limitKey: 'max_escalation_policies', label: 'escalation policies' },
  { usageKey: 'synthetic_checks',    limitKey: 'max_synthetic_checks',    label: 'synthetic checks' },
  { usageKey: 'status_pages',        limitKey: 'max_status_pages',        label: 'status pages' },
];

const WARN_THRESHOLD = 0.80;
const CRITICAL_THRESHOLD = 0.95;

function yyyyMM(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check if any metered dimension is approaching its limit.
 * Sends an in-app notification to all tenant admins at 80% (once/month per dimension).
 * Also sends at 95% (separate Redis key — critical alert, once/month per dimension).
 */
export async function checkApproachingLimits(
  tenantId: Types.ObjectId,
  usageSnapshot: Record<string, number>
): Promise<void> {
  try {
    const tenant = await Tenant.findById(tenantId).select('plan plan_limits').lean();
    if (!tenant) return;

    const redis = getRedis();
    const period = yyyyMM();

    // Load admin user IDs to notify
    const admins = await User.find({
      tenant_id: tenantId,
      role: { $in: ['admin', 'superadmin'] },
      status: 'active',
    }).select('_id').lean();

    if (admins.length === 0) return;

    for (const dim of METERED_DIMENSIONS) {
      const limit = (tenant.plan_limits as any)[dim.limitKey] as number;
      if (!limit || limit === -1 || limit <= 0) continue;

      const current = usageSnapshot[dim.usageKey] || 0;
      const ratio = current / limit;

      if (ratio >= CRITICAL_THRESHOLD) {
        const critKey = `limit_critical:${tenantId}:${dim.limitKey}:${period}`;
        const alreadySent = await redis.exists(critKey);
        if (!alreadySent) {
          const pct = Math.round(ratio * 100);
          for (const admin of admins) {
            await createNotification({
              tenant_id: tenantId,
              user_id: admin._id as Types.ObjectId,
              type: 'plan_limit_critical',
              priority: 'error',
              title: `Critical: ${pct}% of ${dim.label} limit used`,
              body: `You've used ${current.toLocaleString()} of your ${limit.toLocaleString()} ${dim.label} limit (${pct}%). Upgrade now to avoid service disruption.`,
              resource_type: 'billing',
              resource_id: dim.limitKey,
            });
          }
          await redis.set(critKey, '1', 'EX', 32 * 24 * 3600);
        }
      } else if (ratio >= WARN_THRESHOLD) {
        const warnKey = `limit_warned:${tenantId}:${dim.limitKey}:${period}`;
        const alreadySent = await redis.exists(warnKey);
        if (!alreadySent) {
          const pct = Math.round(ratio * 100);
          for (const admin of admins) {
            await createNotification({
              tenant_id: tenantId,
              user_id: admin._id as Types.ObjectId,
              type: 'plan_limit_warning',
              priority: 'warning',
              title: `${pct}% of ${dim.label} limit used`,
              body: `You've used ${current.toLocaleString()} of your ${limit.toLocaleString()} ${dim.label} limit. Consider upgrading to avoid hitting the limit.`,
              resource_type: 'billing',
              resource_id: dim.limitKey,
            });
          }
          await redis.set(warnKey, '1', 'EX', 32 * 24 * 3600);
        }
      }
    }
  } catch (err: any) {
    logger.error('checkApproachingLimits failed', { error: err.message, tenantId });
  }
}
