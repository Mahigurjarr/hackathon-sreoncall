import { Types } from 'mongoose';
import { User } from '../models/user.model';
import { Tenant } from '../models/tenant.model';
import { createNotification } from './notification.service';
import { sendNotificationEmail } from './email-notification.service';
import { logger } from '../utils/logger';

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  business: 'Business',
  enterprise: 'Enterprise',
};

/**
 * Sends plan change notifications to all tenant admins:
 * - In-app notification (via createNotification + NATS WebSocket relay)
 * - Email notification
 */
export async function notifyPlanChange(
  tenantId: Types.ObjectId,
  previousPlan: string,
  newPlan: string,
  changedBy: 'admin' | 'stripe' | 'self' | 'activation_code',
): Promise<void> {
  try {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return;

    // Find all admin users for this tenant
    const adminUsers = await User.find({
      tenant_id: tenantId,
      status: 'active',
      roles: { $in: ['tenant_admin'] },
    });

    if (adminUsers.length === 0) return;

    const prevName = PLAN_DISPLAY_NAMES[previousPlan] || previousPlan;
    const newName = PLAN_DISPLAY_NAMES[newPlan] || newPlan;
    const orgName = tenant.name;

    const title = `Plan changed: ${prevName} → ${newName}`;
    const body = changedBy === 'admin'
      ? `Your organization "${orgName}" plan has been changed from ${prevName} to ${newName} by a platform administrator. Please review the updated features and limits.`
      : changedBy === 'stripe'
        ? `Your organization "${orgName}" plan has been updated from ${prevName} to ${newName} via billing. Please review the updated features and limits.`
        : `Your organization "${orgName}" plan has been changed from ${prevName} to ${newName}. Please review the updated features and limits.`;

    // Create in-app notifications and send emails in parallel
    const promises: Promise<any>[] = [];

    for (const user of adminUsers) {
      // In-app notification
      promises.push(
        createNotification({
          tenant_id: tenantId,
          user_id: user._id,
          type: 'plan_change',
          priority: 'warning',
          title,
          body,
          resource_type: 'billing',
          resource_id: tenantId.toString(),
        }),
      );

      // Email notification
      promises.push(
        sendNotificationEmail(
          user.email,
          title,
          body,
          '/settings/billing',
          tenantId.toString(),
        ),
      );
    }

    await Promise.allSettled(promises);
    logger.info('Plan change notifications sent', {
      tenantId: tenantId.toString(),
      previousPlan,
      newPlan,
      recipientCount: adminUsers.length,
    });
  } catch (err: any) {
    logger.error('Failed to send plan change notifications', {
      tenantId: tenantId.toString(),
      error: err.message,
    });
  }
}
