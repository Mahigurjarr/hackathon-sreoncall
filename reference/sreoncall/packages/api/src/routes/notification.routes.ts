import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import * as notificationService from '../services/notification.service';
import { Notification } from '../models/notification.model';
import { rbac } from '../middleware/rbac.middleware';
import { parsePaginationParams } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';

const router = Router();

// ── Zod Schemas ──

const createNotificationSchema = z.object({
  user_id: z.string().min(1),
  type: z.string().min(1).max(50),
  priority: z.enum(['info', 'warning', 'error', 'critical']).optional().default('info'),
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(5000),
  resource_type: z.string().max(50).optional(),
  resource_id: z.string().max(100).optional(),
});

// ── Serialization ──

function serializeNotification(n: any) {
  return {
    id: n._id.toString(),
    type: n.type,
    priority: n.priority || 'info',
    title: n.title,
    body: n.body,
    read: n.read,
    read_at: n.read_at?.toISOString() || null,
    archived: n.archived || false,
    resource_type: n.resource_type || null,
    resource_id: n.resource_id || null,
    created_at: n.created_at?.toISOString() || n.created_at,
  };
}

// ── Static routes (must come before parameterized /:id routes) ──

// GET /api/v1/notifications/stats
router.get('/stats', rbac('notifications:read'), async (req: Request, res: Response) => {
  const [unread, total, byType] = await Promise.all([
    Notification.countDocuments({ tenant_id: req.tenantId, user_id: req.userId, read: false }),
    Notification.countDocuments({ tenant_id: req.tenantId, user_id: req.userId }),
    Notification.aggregate([
      { $match: { tenant_id: req.tenantId, user_id: req.userId, read: false } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    unread,
    total,
    by_type: byType.reduce((acc: Record<string, number>, item: any) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
  });
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', rbac('notifications:read'), async (req: Request, res: Response) => {
  const count = await notificationService.getUnreadCount(req.tenantId, req.userId);
  res.json({ count });
});

// POST /api/v1/notifications/read-all
router.post('/read-all', rbac('notifications:update'), async (req: Request, res: Response) => {
  const count = await notificationService.markAllAsRead(req.tenantId, req.userId);
  res.json({ updated: count });
});

// POST /api/v1/notifications
router.post('/', rbac('notifications:create'), async (req: Request, res: Response) => {
  const body = createNotificationSchema.parse(req.body);
  const notification = await notificationService.createNotification({
    tenant_id: req.tenantId,
    user_id: new Types.ObjectId(body.user_id),
    type: body.type,
    priority: body.priority,
    title: body.title,
    body: body.body,
    resource_type: body.resource_type,
    resource_id: body.resource_id,
  });
  res.status(201).json(serializeNotification(notification));
});

// GET /api/v1/notifications
router.get('/', rbac('notifications:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    read: req.query.read !== undefined ? req.query.read === 'true' : undefined,
    type: req.query.type as string | undefined,
  };

  const result = await notificationService.getNotifications(
    req.tenantId,
    req.userId,
    pagination,
    filters,
  );

  res.json({
    data: result.data.map(serializeNotification),
    pagination: result.pagination,
  });
});

// ── Notification Preferences ──

const updatePreferencesSchema = z.object({
  email: z.boolean().optional(),
  in_app: z.boolean().optional(),
  ticket_assigned: z.boolean().optional(),
  ticket_updated: z.boolean().optional(),
  ticket_commented: z.boolean().optional(),
  mention: z.boolean().optional(),
  sla_breach: z.boolean().optional(),
  channels: z.object({
    incident: z.boolean().optional(),
    ticket: z.boolean().optional(),
    oncall: z.boolean().optional(),
    system: z.boolean().optional(),
    comms: z.boolean().optional(),
  }).optional(),
  comms_sound: z.boolean().optional(),
  comms_browser_notifications: z.boolean().optional(),
  quiet_hours: z.object({
    enabled: z.boolean().optional(),
    start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    timezone: z.string().min(1).max(100).optional(),
  }).optional(),
});

// GET /api/v1/notifications/preferences
router.get('/preferences', rbac('notifications:read'), async (req: Request, res: Response) => {
  const prefs = await notificationService.getNotificationPreferences(req.tenantId, req.userId);
  res.json(prefs);
});

// PATCH /api/v1/notifications/preferences
router.patch('/preferences', rbac('notifications:update'), async (req: Request, res: Response) => {
  const body = updatePreferencesSchema.parse(req.body);
  const prefs = await notificationService.updateNotificationPreferences(req.tenantId, req.userId, body);
  res.json(prefs);
});

// POST /api/v1/notifications/test — send a test notification to yourself
router.post('/test', rbac('notifications:read'), async (req: Request, res: Response) => {
  const notification = await notificationService.createNotification({
    tenant_id: req.tenantId,
    user_id: req.userId,
    type: 'system',
    priority: 'info',
    title: 'Test Notification',
    body: 'This is a test notification to verify your notification settings are working correctly.',
  });
  res.status(201).json(serializeNotification(notification));
});

// DELETE /api/v1/notifications/by-resource/:resourceType/:resourceId
router.delete(
  '/by-resource/:resourceType/:resourceId',
  rbac('notifications:update'),
  async (req: Request, res: Response) => {
    const count = await notificationService.deleteByResource(
      req.tenantId,
      req.params.resourceType as string,
      req.params.resourceId as string,
    );
    res.json({ deleted: count });
  }
);

// ── Parameterized routes ──

// GET /api/v1/notifications/:id
router.get('/:id', rbac('notifications:read'), async (req: Request, res: Response) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenantId,
    user_id: req.userId,
  });

  if (!notification) {
    throw AppError.notFound('Notification');
  }

  res.json(serializeNotification(notification));
});

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', rbac('notifications:update'), async (req: Request, res: Response) => {
  const notification = await notificationService.markAsRead(
    req.tenantId,
    req.userId,
    req.params.id as string,
  );
  res.json(serializeNotification(notification));
});

// DELETE /api/v1/notifications/:id
router.delete('/:id', rbac('notifications:update'), async (req: Request, res: Response) => {
  await notificationService.deleteNotification(
    req.tenantId,
    req.userId,
    req.params.id as string,
  );
  res.status(204).send();
});

export default router;
