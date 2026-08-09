import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as channelService from '../services/channel.service';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

const slackIntegrationSchema = z.object({
  workspace_id: z.string().min(1),
  channel_id: z.string().min(1),
  channel_name: z.string().min(1),
}).optional();

const teamsIntegrationSchema = z.object({
  team_id: z.string().min(1),
  channel_id: z.string().min(1),
}).optional();

const createChannelSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['general', 'incident_war_room', 'dm', 'customer', 'topic', 'broadcast', 'internal_escalation']).optional(),
  description: z.string().max(1000).optional(),
  incident_id: z.string().optional(),
  slack_integration: slackIntegrationSchema,
  teams_integration: teamsIntegrationSchema,
});

const updateChannelSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  is_archived: z.boolean().optional(),
  slack_integration: slackIntegrationSchema.nullable(),
  teams_integration: teamsIntegrationSchema.nullable(),
}).partial();

const sendMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

function serializeChannel(c: any) {
  const createdBy =
    c.created_by && typeof c.created_by === 'object' && c.created_by.name
      ? { _id: c.created_by._id?.toString(), name: c.created_by.name }
      : { _id: c.created_by?.toString(), name: 'Unknown' };
  return {
    _id: c._id.toString(),
    name: c.name,
    type: c.type,
    description: c.description,
    incident_id: c.incident_id?.toString() || null,
    members: (c.members || []).map((m: any) => {
      // Support both old ObjectId format and new structured format
      if (m?.user_id) {
        return { user_id: m.user_id?.toString(), role: m.role, joined_at: m.joined_at };
      }
      return { user_id: m?.toString(), role: 'member', joined_at: null };
    }),
    slack_integration: c.slack_integration || null,
    teams_integration: c.teams_integration || null,
    is_archived: c.is_archived ?? false,
    last_message_at: c.last_message_at || null,
    created_by: createdBy,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function serializeMessage(m: any) {
  const author =
    m.author_id && typeof m.author_id === 'object' && m.author_id.name
      ? { _id: m.author_id._id?.toString(), name: m.author_id.name }
      : { _id: m.author_id?.toString(), name: 'Unknown' };
  return {
    _id: m._id.toString(),
    body: m.body,
    author,
    channel_id: m.channel_id?.toString(),
    sender_type: m.sender_type || 'user',
    thread_parent_id: m.thread_parent_id?.toString() || null,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

// GET /api/v1/channels
router.get('/', rbac('channels:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const type = req.query.type as string;
  const isArchived = req.query.is_archived === 'true' ? true : req.query.is_archived === 'false' ? false : undefined;
  const result = await channelService.listChannels(req.tenantId, pagination, type, { is_archived: isArchived });
  res.json({ data: result.data.map(serializeChannel), pagination: result.pagination });
});

// GET /api/v1/channels/:id
router.get('/:id', rbac('channels:read'), async (req: Request, res: Response) => {
  const channel = await channelService.getChannelById(req.tenantId, req.params['id'] as string);
  res.json(serializeChannel(channel));
});

// POST /api/v1/channels
router.post('/', rbac('channels:create'), async (req: Request, res: Response) => {
  const body = createChannelSchema.parse(req.body);
  const channel = await channelService.createChannel({
    ...body,
    tenant_id: req.tenantId,
    created_by: req.userId,
  });
  res.status(201).json(serializeChannel(channel));
});

// PATCH /api/v1/channels/:id
router.patch('/:id', rbac('channels:update'), async (req: Request, res: Response) => {
  const body = updateChannelSchema.parse(req.body);
  const channel = await channelService.updateChannel(req.tenantId, req.params['id'] as string, body);
  res.json(serializeChannel(channel));
});

// DELETE /api/v1/channels/:id
router.delete('/:id', rbac('channels:delete'), async (req: Request, res: Response) => {
  await channelService.deleteChannel(req.tenantId, req.params['id'] as string);
  res.status(204).send();
});

// GET /api/v1/channels/:id/messages
router.get('/:id/messages', rbac('channels:read'), async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const messages = await channelService.listMessages(req.tenantId, req.params['id'] as string, limit);
  res.json(messages.map(serializeMessage));
});

// POST /api/v1/channels/:id/messages
router.post('/:id/messages', rbac('channels:create'), async (req: Request, res: Response) => {
  const { body } = sendMessageSchema.parse(req.body);
  const msg = await channelService.createMessage({
    tenant_id: req.tenantId,
    channel_id: req.params['id'] as string,
    author_id: req.userId,
    body,
  });
  res.status(201).json(serializeMessage(msg));
});

export default router;
