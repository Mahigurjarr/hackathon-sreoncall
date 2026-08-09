import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantType } from '../middleware/tenantType.middleware';
import { rbac } from '../middleware/rbac.middleware';
import * as communicationService from '../services/communication.service';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

// All routes require provider tenant
router.use(requireTenantType('provider'));

function serializeThread(t: any) {
  return {
    _id: t._id.toString(),
    provider_tenant_id: t.provider_tenant_id.toString(),
    consumer_tenant_id: t.consumer_tenant_id.toString(),
    channel_id: t.channel_id.toString(),
    subject: t.subject,
    status: t.status,
    tag: t.tag,
    unread_by_provider: t.unread_by_provider,
    last_message_at: t.last_message_at?.toISOString?.() || t.last_message_at,
    external_thread_id: t.external_thread_id,
    initiated_by: t.initiated_by,
    createdAt: t.createdAt?.toISOString?.() || t.createdAt,
    updatedAt: t.updatedAt?.toISOString?.() || t.updatedAt,
  };
}

function serializeMessage(m: any) {
  return {
    _id: m._id.toString(),
    thread_id: m.thread_id.toString(),
    origin: m.origin,
    sender_user_id: m.sender_user_id,
    sender_display_name: m.sender_display_name,
    body: m.body,
    tag: m.tag,
    delivery_status: m.delivery_status,
    external_message_id: m.external_message_id,
    read_by_provider: m.read_by_provider ?? false,
    read_at: m.read_at?.toISOString?.() || m.read_at || null,
    sent_at: m.sent_at?.toISOString?.() || m.sent_at,
  };
}

const sendMessageSchema = z.object({
  body: z.string().min(1).max(10000),
  tag: z.enum(['question', 'request', 'update', 'fyi']).optional(),
});

const createThreadSchema = z.object({
  channel_id: z.string().min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(10000),
  tag: z.enum(['question', 'request', 'update', 'fyi']).optional(),
});

const updateThreadSchema = z.object({
  tag: z.enum(['question', 'request', 'update', 'fyi']).optional(),
  status: z.enum(['open', 'closed']).optional(),
});

// GET /provider/communications — unified inbox
router.get('/', rbac('communications:read'), async (req: Request, res: Response) => {
  const inbox = await communicationService.getProviderInbox(req.tenantId.toString(), {
    search: req.query.search as string | undefined,
    sort: req.query.sort as string | undefined,
    has_unread: req.query.has_unread === 'true',
  });
  res.json({ data: inbox });
});

// GET /provider/communications/:consumerId — thread list for a consumer
router.get('/:consumerId', rbac('communications:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    status: req.query.status as string | undefined,
    tag: req.query.tag as string | undefined,
  };

  const result = await communicationService.getThreadsForConsumer(
    req.tenantId.toString(),
    req.params['consumerId'] as string,
    pagination,
    filters
  );

  res.json({
    data: result.data.map(serializeThread),
    pagination: result.pagination,
  });
});

// GET /provider/communications/threads/:threadId — messages in a thread
router.get('/threads/:threadId', rbac('communications:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await communicationService.getThreadMessages(
    req.tenantId.toString(),
    req.params['threadId'] as string,
    pagination
  );

  res.json({
    data: result.data.map(serializeMessage),
    pagination: result.pagination,
  });
});

// GET /provider/communications/threads/:threadId/members — channel members for @mention
router.get('/threads/:threadId/members', rbac('communications:read'), async (req: Request, res: Response) => {
  const members = await communicationService.getChannelMembers(
    req.tenantId.toString(),
    req.params['threadId'] as string
  );
  res.json({ data: members });
});

// POST /provider/communications/threads/:threadId/messages — reply to thread
router.post('/threads/:threadId/messages', rbac('communications:create'), async (req: Request, res: Response) => {
  const body = sendMessageSchema.parse(req.body);
  const message = await communicationService.sendProviderReply(
    req.tenantId.toString(),
    req.params['threadId'] as string,
    body.body,
    req.userId.toString(),
    (req.user as any)?.name || 'Provider Agent',
    body.tag
  );
  res.status(201).json(serializeMessage(message));
});

// POST /provider/communications/:consumerId/threads — initiate new thread
router.post('/:consumerId/threads', rbac('communications:create'), async (req: Request, res: Response) => {
  const body = createThreadSchema.parse(req.body);
  const result = await communicationService.createProviderThread(
    req.tenantId.toString(),
    req.params['consumerId'] as string,
    body.channel_id,
    body.subject,
    body.body,
    req.userId.toString(),
    (req.user as any)?.name || 'Provider Agent',
    body.tag
  );
  res.status(201).json({
    thread: serializeThread(result.thread),
    message: serializeMessage(result.message),
  });
});

// PATCH /provider/communications/threads/:threadId — update tag/status
router.patch('/threads/:threadId', rbac('communications:create'), async (req: Request, res: Response) => {
  const body = updateThreadSchema.parse(req.body);
  const thread = await communicationService.updateThread(
    req.tenantId.toString(),
    req.params['threadId'] as string,
    body
  );
  res.json(serializeThread(thread));
});

export default router;
