import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantType } from '../middleware/tenantType.middleware';
import * as channelService from '../services/communication-channel.service';
import * as installationService from '../services/slack-installation.service';

const router = Router();

// Communication-channel management is tenant-scoped and works for both
// standalone and consumer tenants.
router.use(requireTenantType('consumer', 'provider', 'standalone'));

function serializeChannel(ch: any) {
  const base: Record<string, unknown> = {
    _id: ch._id.toString(),
    consumer_tenant_id: ch.consumer_tenant_id.toString(),
    platform: ch.platform,
    external_channel_id: ch.external_channel_id,
    display_name: ch.display_name,
    channel_role: ch.channel_role || 'bidirectional',
    installation_id: ch.installation_id?.toString() || null,
    app_id: ch.app_id || null,
    aad_tenant_id: ch.aad_tenant_id || null,
    team_id: ch.team_id || null,
    token_prefix: ch.token_prefix || null,
    is_active: ch.is_active,
    createdAt: ch.createdAt?.toISOString?.() || ch.createdAt,
    updatedAt: ch.updatedAt?.toISOString?.() || ch.updatedAt,
  };
  return base;
}

function serializeInstallation(inst: any) {
  return {
    _id: inst._id.toString(),
    consumer_tenant_id: inst.consumer_tenant_id.toString(),
    team_id: inst.team_id,
    team_name: inst.team_name,
    bot_user_id: inst.bot_user_id,
    scopes: inst.scopes,
    is_active: inst.is_active,
    createdAt: inst.createdAt?.toISOString?.() || inst.createdAt,
    updatedAt: inst.updatedAt?.toISOString?.() || inst.updatedAt,
  };
}

const objectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ObjectId');

const createChannelSchema = z.object({
  platform: z.enum(['slack', 'teams']),
  external_channel_id: z.string().min(1).max(200),
  display_name: z.string().min(1).max(200),
  channel_role: z.enum(['bidirectional', 'ingest_only', 'notify_only']).optional(),
  access_token: z.string().min(1),
  signing_secret: z.string().min(1),
  // Teams-only: Microsoft Graph app-only auth config (the consumer org's own
  // Azure AD app registration, granted ChannelMessage.Send with admin consent).
  app_id: z.string().min(1).optional(),
  aad_tenant_id: z.string().min(1).optional(),
  team_id: z.string().min(1).optional(),
});

const updateChannelSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
  channel_role: z.enum(['bidirectional', 'ingest_only', 'notify_only']).optional(),
  source_consumer_tenant_ids: z.array(objectIdString).max(50).optional(),
});

const selectChannelsSchema = z.object({
  channels: z.array(
    z.object({
      slack_channel_id: z.string().min(1),
      display_name: z.string().min(1).max(200),
      channel_role: z.enum(['bidirectional', 'ingest_only', 'notify_only']).optional(),
      source_consumer_tenant_ids: z.array(objectIdString).max(50).optional(),
    })
  ).min(1).max(50),
});

// ─── Slack Installation endpoints (must come before /:id routes) ─────────

// GET /consumer/channels/slack-installations
router.get('/slack-installations', async (req: Request, res: Response) => {
  const installations = await installationService.listInstallations(req.tenantId);
  res.json({ data: installations.map(serializeInstallation) });
});

// GET /consumer/channels/slack-installations/:id/channels
router.get('/slack-installations/:id/channels', async (req: Request, res: Response) => {
  try {
    const installation = await installationService.getInstallationById(req.params['id'] as string);
    if (!installation || installation.consumer_tenant_id.toString() !== req.tenantId.toString()) {
      res.status(404).json({
        type: 'https://sreoncall.io/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'Slack installation not found.',
      });
      return;
    }

    const channels = await installationService.fetchSlackChannels(req.params['id'] as string);
    res.json({ data: channels });
  } catch (err: any) {
    res.status(502).json({
      type: 'https://sreoncall.io/problems/slack-api-error',
      title: 'Slack API Error',
      status: 502,
      detail: err.message || 'Failed to fetch Slack channels.',
    });
  }
});

// POST /consumer/channels/slack-installations/:id/select
router.post('/slack-installations/:id/select', async (req: Request, res: Response) => {
  const installation = await installationService.getInstallationById(req.params['id'] as string);
  if (!installation || installation.consumer_tenant_id.toString() !== req.tenantId.toString()) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Slack installation not found.',
    });
    return;
  }

  const body = selectChannelsSchema.parse(req.body);
  const created = [];

  for (const ch of body.channels) {
    const { channel } = await channelService.createChannel({
      consumer_tenant_id: req.tenantId.toString(),
      platform: 'slack',
      external_channel_id: ch.slack_channel_id,
      display_name: ch.display_name,
      channel_role: ch.channel_role,
      installation_id: installation._id.toString(),
    });
    created.push(serializeChannel(channel));
  }

  res.status(201).json({ data: created });
});

// DELETE /consumer/channels/slack-installations/:id
router.delete('/slack-installations/:id', async (req: Request, res: Response) => {
  const installation = await installationService.deleteInstallation(
    req.params['id'] as string,
    req.tenantId.toString()
  );
  if (!installation) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Slack installation not found.',
    });
    return;
  }
  res.status(204).send();
});

// ─── Channel CRUD endpoints ──────────────────────────────────────────────

// GET /consumer/channels
router.get('/', async (req: Request, res: Response) => {
  const channels = await channelService.listChannels(req.tenantId);
  res.json({ data: channels.map(ch => serializeChannel(ch)) });
});

// POST /consumer/channels
router.post('/', async (req: Request, res: Response) => {
  const body = createChannelSchema.parse(req.body);
  const { channel } = await channelService.createChannel({
    consumer_tenant_id: req.tenantId.toString(),
    ...body,
  });
  res.status(201).json(serializeChannel(channel));
});

// PATCH /consumer/channels/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const body = updateChannelSchema.parse(req.body);
  const channel = await channelService.updateChannel(
    req.params['id'] as string,
    req.tenantId.toString(),
    body
  );
  if (!channel) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Communication channel not found.',
    });
    return;
  }
  res.json(serializeChannel(channel));
});

// DELETE /consumer/channels/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const channel = await channelService.deleteChannel(
    req.params['id'] as string,
    req.tenantId.toString()
  );
  if (!channel) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Communication channel not found.',
    });
    return;
  }
  res.status(204).send();
});

export default router;
