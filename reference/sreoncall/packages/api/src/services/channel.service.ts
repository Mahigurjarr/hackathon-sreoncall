import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { Channel, ChannelDocument, Message, MessageDocument, ChannelType, SlackIntegration, TeamsIntegration } from '../models/channel.model';
import { PaginationParams, PaginatedResult, buildCursorFilter, paginateResults } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';
import { getJetStream } from '../config/nats';
import { logger } from '../utils/logger';

const sc = StringCodec();

export async function listChannels(
  tenantId: Types.ObjectId,
  pagination: PaginationParams,
  type?: string,
  opts?: { is_archived?: boolean }
): Promise<PaginatedResult<ChannelDocument>> {
  const baseFilter: Record<string, any> = { tenant_id: tenantId };
  if (type) baseFilter.type = type;
  if (opts?.is_archived !== undefined) baseFilter.is_archived = opts.is_archived;
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'created_at' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);
  const results = await Channel.find(cursorFilter)
    .populate('created_by', 'name email')
    .sort(sort)
    .limit(pagination.limit + 1);
  const total = await Channel.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function getChannelById(tenantId: Types.ObjectId, id: string): Promise<ChannelDocument> {
  const channel = await Channel.findOne({ _id: id, tenant_id: tenantId }).populate('created_by', 'name email');
  if (!channel) throw AppError.notFound('Channel');
  return channel;
}

export async function createChannel(input: {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  name: string;
  type?: ChannelType;
  description?: string;
  incident_id?: string;
  slack_integration?: SlackIntegration;
  teams_integration?: TeamsIntegration;
}): Promise<ChannelDocument> {
  return Channel.create({
    tenant_id: input.tenant_id,
    name: input.name,
    type: input.type || 'general',
    description: input.description || '',
    incident_id: input.incident_id ? new Types.ObjectId(input.incident_id) : undefined,
    members: [{ user_id: input.created_by, role: 'owner', joined_at: new Date() }],
    slack_integration: input.slack_integration || undefined,
    teams_integration: input.teams_integration || undefined,
    created_by: input.created_by,
  });
}

export async function updateChannel(
  tenantId: Types.ObjectId,
  id: string,
  update: Partial<{
    name: string;
    description: string;
    is_archived: boolean;
    slack_integration: SlackIntegration | null;
    teams_integration: TeamsIntegration | null;
  }>
): Promise<ChannelDocument> {
  const channel = await Channel.findOne({ _id: id, tenant_id: tenantId });
  if (!channel) throw AppError.notFound('Channel');

  if (update.name !== undefined) channel.name = update.name;
  if (update.description !== undefined) channel.description = update.description;
  if (update.is_archived !== undefined) channel.is_archived = update.is_archived;
  if (update.slack_integration !== undefined) {
    channel.slack_integration = update.slack_integration || undefined;
  }
  if (update.teams_integration !== undefined) {
    channel.teams_integration = update.teams_integration || undefined;
  }

  await channel.save();
  return channel;
}

export async function deleteChannel(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await Channel.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Channel');
}

// --- Messages ---

export async function listMessages(
  tenantId: Types.ObjectId,
  channelId: string,
  limit = 100
): Promise<MessageDocument[]> {
  // Verify channel belongs to tenant
  const channel = await Channel.findOne({ _id: channelId, tenant_id: tenantId });
  if (!channel) throw AppError.notFound('Channel');
  return Message.find({ channel_id: new Types.ObjectId(channelId) })
    .populate('author_id', 'name email')
    .sort({ created_at: 1 })
    .limit(limit);
}

export async function createMessage(input: {
  tenant_id: Types.ObjectId;
  channel_id: string;
  author_id: Types.ObjectId;
  body: string;
}): Promise<MessageDocument> {
  const channel = await Channel.findOne({ _id: input.channel_id, tenant_id: input.tenant_id });
  if (!channel) throw AppError.notFound('Channel');
  const msg = await Message.create({
    tenant_id: input.tenant_id,
    channel_id: new Types.ObjectId(input.channel_id),
    body: input.body,
    author_id: input.author_id,
  });

  // Update last_message_at on channel
  channel.last_message_at = new Date();
  await channel.save();

  // Publish message event for outbound relay (Slack/Teams)
  try {
    const js = getJetStream();
    await js.publish(
      'messages.created',
      sc.encode(JSON.stringify({
        message_id: msg._id.toString(),
        channel_id: input.channel_id,
        tenant_id: input.tenant_id.toString(),
      }))
    );
  } catch (err: any) {
    logger.debug('Failed to publish messages.created event', { error: err.message });
  }

  return Message.findById(msg._id).populate('author_id', 'name email') as Promise<MessageDocument>;
}
