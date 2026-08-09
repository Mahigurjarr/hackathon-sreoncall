import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { Notification, NotificationDocument } from '../models/notification.model';
import { UsageRecord } from '../models/billing.model';
import { Tenant } from '../models/tenant.model';
import { User, NotificationPreferences } from '../models/user.model';
import { getCurrentUsageForAlert } from './billing.service';
import { checkApproachingLimits } from './usage-alert.service';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';
import { getJetStream } from '../config/nats';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

const sc = StringCodec();

// ─── Outbound notification daily cap ──────────────────────────────────────────

/**
 * Check and increment the outbound notification counter for a tenant.
 * Returns true if the notification is allowed (under daily limit).
 * Returns false if the plan daily cap is reached — caller should drop the send.
 *
 * Uses Redis key: notif_daily:{tenantId}:{YYYY-MM-DD} (TTL 25 hrs)
 * Also increments the monthly UsageRecord.notifications_sent counter.
 */
export async function checkAndIncrementNotificationCount(
  tenantId: Types.ObjectId
): Promise<boolean> {
  try {
    const tenant = await Tenant.findById(tenantId).lean();
    if (!tenant) return true; // allow if tenant not found

    const limit: number = (tenant.plan_limits as any)?.max_notifications_per_day ?? 50;
    if (limit === -1) {
      // Unlimited — just track usage
      await incrementNotificationUsage(tenantId);
      return true;
    }

    const redis = getRedis();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `notif_daily:${tenantId.toString()}:${today}`;

    const current = await redis.incr(key);
    if (current === 1) {
      // First increment — set TTL of 25 hours
      await redis.expire(key, 25 * 3600);
    }

    if (current > limit) {
      logger.warn('Outbound notification daily cap reached', {
        tenantId: tenantId.toString(),
        current,
        limit,
        plan: tenant.plan,
      });
      return false;
    }

    await incrementNotificationUsage(tenantId);
    return true;
  } catch (err: any) {
    // On Redis/DB error, allow the notification through
    logger.error('Failed to check notification cap, allowing through', { error: err.message });
    return true;
  }
}

async function incrementNotificationUsage(tenantId: Types.ObjectId): Promise<void> {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await UsageRecord.findOneAndUpdate(
    { tenant_id: tenantId, period },
    { $inc: { notifications_sent: 1 } },
    { upsert: true }
  );
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check and increment a monthly communication channel counter.
 * Returns { allowed: boolean }. Uses UsageRecord $inc for monthly granularity.
 *
 * @param tenantId
 * @param usageField  - The UsageRecord field to increment (e.g. 'sms_sent')
 * @param limitKey    - The PlanLimits field to check (e.g. 'max_sms_per_month')
 */
export async function checkAndIncrementMonthlyCounter(
  tenantId: Types.ObjectId,
  usageField: 'sms_sent' | 'voice_calls' | 'whatsapp_sent',
  limitKey: 'max_sms_per_month' | 'max_voice_per_month' | 'max_whatsapp_per_month'
): Promise<{ allowed: boolean }> {
  try {
    const tenant = await Tenant.findById(tenantId).select('plan plan_limits').lean();
    if (!tenant) return { allowed: true };

    const limit: number = (tenant.plan_limits as any)?.[limitKey] ?? 0;
    if (limit === -1) {
      // Unlimited — increment and allow
      const period = currentPeriod();
      await UsageRecord.findOneAndUpdate(
        { tenant_id: tenantId, period },
        { $inc: { [usageField]: 1 } },
        { upsert: true }
      );
      return { allowed: true };
    }
    if (limit === 0) return { allowed: false };

    const period = currentPeriod();
    const record = await UsageRecord.findOne({ tenant_id: tenantId, period })
      .select(usageField)
      .lean();
    const current: number = (record as any)?.[usageField] || 0;

    if (current >= limit) {
      logger.warn('Monthly channel limit reached', { tenantId, usageField, current, limit });
      return { allowed: false };
    }

    await UsageRecord.findOneAndUpdate(
      { tenant_id: tenantId, period },
      { $inc: { [usageField]: 1 } },
      { upsert: true }
    );

    // Fire-and-forget: check if approaching limits
    getCurrentUsageForAlert(tenantId).then(snapshot => {
      checkApproachingLimits(tenantId, snapshot).catch(() => {});
    }).catch(() => {});

    return { allowed: true };
  } catch (err: any) {
    logger.error('checkAndIncrementMonthlyCounter failed, allowing through', { error: err.message });
    return { allowed: true };
  }
}

interface CreateNotificationInput {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  type: string;
  priority?: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  resource_type?: string;
  resource_id?: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationDocument> {
  const notification = await Notification.create({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    type: input.type,
    priority: input.priority || 'info',
    title: input.title,
    body: input.body,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    read: false,
    archived: false,
    created_at: new Date(),
  });

  // Publish to NATS so WebSocket gateway can relay in real-time
  try {
    const js = getJetStream();
    const payload = {
      event: 'notification.created',
      notification_id: notification._id.toString(),
      user_id: input.user_id.toString(),
      tenant_id: input.tenant_id.toString(),
      type: input.type,
      priority: input.priority || 'info',
      title: input.title,
      body: input.body,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      timestamp: new Date().toISOString(),
    };
    await js.publish(`notifications.${input.user_id.toString()}`, sc.encode(JSON.stringify(payload)));
  } catch (err: any) {
    logger.error('Failed to publish notification to NATS', { error: err.message });
  }

  return notification;
}

export async function createBulkNotifications(
  inputs: CreateNotificationInput[]
): Promise<NotificationDocument[]> {
  const docs = inputs.map((input) => ({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    type: input.type,
    priority: input.priority || 'info',
    title: input.title,
    body: input.body,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    read: false,
    archived: false,
    created_at: new Date(),
  }));

  return Notification.insertMany(docs);
}

export async function getNotifications(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  pagination: PaginationParams,
  filters?: { read?: boolean; type?: string }
): Promise<PaginatedResult<NotificationDocument>> {
  const baseFilter: Record<string, any> = {
    tenant_id: tenantId,
    user_id: userId,
  };

  if (filters?.read !== undefined) {
    baseFilter.read = filters.read;
  }

  if (filters?.type) {
    baseFilter.type = filters.type;
  }

  const paginationWithDefaults: PaginationParams = {
    ...pagination,
    sort_by: pagination.sort_by || 'created_at',
    sort_order: pagination.sort_order || 'desc',
  };

  const { filter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await Notification.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await Notification.countDocuments(baseFilter);

  return paginateResults(results, paginationWithDefaults, total);
}

export async function markAsRead(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  notificationId: string
): Promise<NotificationDocument> {
  const notification = await Notification.findOne({
    _id: notificationId,
    tenant_id: tenantId,
    user_id: userId,
  });

  if (!notification) {
    throw AppError.notFound('Notification');
  }

  notification.read = true;
  notification.read_at = new Date();
  await notification.save();

  return notification;
}

export async function markAllAsRead(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<number> {
  const result = await Notification.updateMany(
    { tenant_id: tenantId, user_id: userId, read: false },
    { $set: { read: true, read_at: new Date() } }
  );

  return result.modifiedCount;
}

export async function getUnreadCount(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<number> {
  return Notification.countDocuments({
    tenant_id: tenantId,
    user_id: userId,
    read: false,
  });
}

export async function deleteNotification(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  notificationId: string
): Promise<void> {
  const notification = await Notification.findOne({
    _id: notificationId,
    tenant_id: tenantId,
    user_id: userId,
  });

  if (!notification) {
    throw AppError.notFound('Notification');
  }

  await notification.deleteOne();
}

export async function deleteByResource(
  tenantId: Types.ObjectId,
  resourceType: string,
  resourceId: string
): Promise<number> {
  const result = await Notification.deleteMany({
    tenant_id: tenantId,
    resource_type: resourceType,
    resource_id: resourceId,
  });

  return result.deletedCount;
}

export async function getNotificationPreferences(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<NotificationPreferences> {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId });
  if (!user) throw AppError.notFound('User');
  return user.notification_preferences;
}

export async function updateNotificationPreferences(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  prefs: Record<string, any>
): Promise<NotificationPreferences> {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId });
  if (!user) throw AppError.notFound('User');

  const { channels, quiet_hours, ...flat } = prefs;
  Object.assign(user.notification_preferences, flat);
  if (channels) {
    Object.assign(user.notification_preferences.channels, channels);
  }
  if (quiet_hours) {
    Object.assign(user.notification_preferences.quiet_hours, quiet_hours);
  }
  user.markModified('notification_preferences');
  await user.save();
  return user.notification_preferences;
}
