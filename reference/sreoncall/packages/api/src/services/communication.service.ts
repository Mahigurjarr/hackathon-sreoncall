import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { CommunicationThread } from '../models/communication-thread.model';
import { CommunicationMessage } from '../models/communication-message.model';
import { CommunicationChannel } from '../models/communication-channel.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { SlackInstallation } from '../models/slack-installation.model';
import { getConversationMembers } from './slack.service';
import { decryptToken } from '../utils/encryption';
import { getJetStream } from '../config/nats';
import { buildCursorFilter, paginateResults, PaginationParams } from '../utils/pagination';
import { logger } from '../utils/logger';

const sc = StringCodec();

/**
 * Guard that checks the provider-consumer link has 'communications' scope.
 */
export async function assertCommunicationsScope(
  providerTenantId: string,
  consumerTenantId: string
): Promise<void> {
  const link = await ProviderConsumerLink.findOne({
    provider_tenant_id: new Types.ObjectId(providerTenantId),
    consumer_tenant_id: new Types.ObjectId(consumerTenantId),
    status: 'active',
    scope: { $in: ['communications'] },
  });

  if (!link) {
    const err: any = new Error('No active provider-consumer link with communications scope');
    err.status = 403;
    throw err;
  }
}

/**
 * Get the provider's unified inbox — aggregate unread counts per consumer.
 */
export async function getProviderInbox(
  providerTenantId: string,
  options?: { search?: string; sort?: string; has_unread?: boolean }
) {
  const pipeline: any[] = [
    {
      $match: {
        provider_tenant_id: new Types.ObjectId(providerTenantId),
        status: 'open',
      },
    },
    {
      $group: {
        _id: '$consumer_tenant_id',
        total_unread: { $sum: '$unread_by_provider' },
        thread_count: { $sum: 1 },
        last_message_at: { $max: '$last_message_at' },
        oldest_unanswered_at: {
          $min: {
            $cond: [{ $gt: ['$unread_by_provider', 0] }, '$last_message_at', null],
          },
        },
      },
    },
    {
      $lookup: {
        from: 'tenants',
        localField: '_id',
        foreignField: '_id',
        as: 'consumer',
      },
    },
    { $unwind: '$consumer' },
    {
      $project: {
        consumer_tenant_id: '$_id',
        consumer_name: '$consumer.name',
        consumer_slug: '$consumer.slug',
        total_unread: 1,
        thread_count: 1,
        last_message_at: 1,
        oldest_unanswered_at: 1,
      },
    },
  ];

  // Search filter on consumer name
  if (options?.search) {
    pipeline.push({
      $match: { consumer_name: { $regex: options.search, $options: 'i' } },
    });
  }

  // Filter to only consumers with unread
  if (options?.has_unread) {
    pipeline.push({ $match: { total_unread: { $gt: 0 } } });
  }

  // Sort strategy
  const sort = options?.sort || 'recent';
  if (sort === 'unread_desc') {
    pipeline.push({ $sort: { total_unread: -1 as const, last_message_at: -1 as const } });
  } else if (sort === 'oldest_unanswered') {
    pipeline.push({ $sort: { oldest_unanswered_at: 1 as const, last_message_at: -1 as const } });
  } else {
    pipeline.push({ $sort: { last_message_at: -1 as const } });
  }

  return CommunicationThread.aggregate(pipeline);
}

/**
 * Get threads for a specific consumer, from the provider's perspective.
 */
export async function getThreadsForConsumer(
  providerTenantId: string,
  consumerTenantId: string,
  pagination: PaginationParams,
  filters?: { status?: string; tag?: string }
) {
  await assertCommunicationsScope(providerTenantId, consumerTenantId);

  const baseFilter: Record<string, any> = {
    provider_tenant_id: new Types.ObjectId(providerTenantId),
    consumer_tenant_id: new Types.ObjectId(consumerTenantId),
  };

  if (filters?.status) baseFilter.status = filters.status;
  if (filters?.tag) baseFilter.tag = filters.tag;

  const paginationWithSort = { ...pagination, sort_by: 'last_message_at', sort_order: pagination.sort_order || 'desc' as const };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithSort, baseFilter);

  const results = await CommunicationThread.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await CommunicationThread.countDocuments(baseFilter);
  return paginateResults(results, paginationWithSort, total);
}

/**
 * Get messages for a specific thread. Resets unread_by_provider on access.
 */
export async function getThreadMessages(
  providerTenantId: string,
  threadId: string,
  pagination: PaginationParams
) {
  const thread = await CommunicationThread.findOne({
    _id: new Types.ObjectId(threadId),
    provider_tenant_id: new Types.ObjectId(providerTenantId),
  });

  if (!thread) {
    const err: any = new Error('Thread not found');
    err.status = 404;
    throw err;
  }

  // Reset unread count when provider views thread
  if (thread.unread_by_provider > 0) {
    await CommunicationThread.updateOne(
      { _id: thread._id },
      { $set: { unread_by_provider: 0 } }
    );
  }

  // Mark individual consumer messages as read by provider
  await CommunicationMessage.updateMany(
    { thread_id: thread._id, origin: { $ne: 'provider' }, read_by_provider: false },
    { $set: { read_by_provider: true, read_at: new Date() } }
  );

  const baseFilter = { thread_id: thread._id };
  const paginationWithSort = { ...pagination, sort_by: 'sent_at', sort_order: 'asc' as const };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithSort, baseFilter);

  const results = await CommunicationMessage.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1);

  return paginateResults(results, paginationWithSort);
}

/**
 * Send a reply from the provider to a thread.
 */
export async function sendProviderReply(
  providerTenantId: string,
  threadId: string,
  body: string,
  senderUserId: string,
  senderDisplayName: string,
  tag?: string
) {
  const thread = await CommunicationThread.findOne({
    _id: new Types.ObjectId(threadId),
    provider_tenant_id: new Types.ObjectId(providerTenantId),
  });

  if (!thread) {
    const err: any = new Error('Thread not found');
    err.status = 404;
    throw err;
  }

  // Create the message
  const message = await CommunicationMessage.create({
    thread_id: thread._id,
    provider_tenant_id: thread.provider_tenant_id,
    consumer_tenant_id: thread.consumer_tenant_id,
    origin: 'provider',
    sender_user_id: senderUserId,
    sender_display_name: senderDisplayName,
    body,
    tag: tag || undefined,
    delivery_status: 'pending',
    sent_at: new Date(),
  });

  // Update thread last_message_at
  await CommunicationThread.updateOne(
    { _id: thread._id },
    { $set: { last_message_at: new Date() } }
  );

  // Publish outbound message to NATS
  try {
    const js = getJetStream();
    await js.publish(
      'comms.outbound',
      sc.encode(JSON.stringify({
        message_id: message._id.toString(),
        channel_id: thread.channel_id.toString(),
        thread_external_id: thread.external_thread_id,
        body,
      }))
    );
  } catch (err: any) {
    logger.error('Failed to publish outbound message', { error: err.message, messageId: message._id.toString() });
  }

  return message;
}

/**
 * Create a new thread initiated by the provider.
 */
export async function createProviderThread(
  providerTenantId: string,
  consumerTenantId: string,
  channelId: string,
  subject: string,
  body: string,
  senderUserId: string,
  senderDisplayName: string,
  tag?: string
) {
  await assertCommunicationsScope(providerTenantId, consumerTenantId);

  const thread = await CommunicationThread.create({
    provider_tenant_id: new Types.ObjectId(providerTenantId),
    consumer_tenant_id: new Types.ObjectId(consumerTenantId),
    channel_id: new Types.ObjectId(channelId),
    subject,
    status: 'open',
    tag: tag || undefined,
    unread_by_provider: 0,
    last_message_at: new Date(),
    initiated_by: 'provider',
  });

  const message = await CommunicationMessage.create({
    thread_id: thread._id,
    provider_tenant_id: thread.provider_tenant_id,
    consumer_tenant_id: thread.consumer_tenant_id,
    origin: 'provider',
    sender_user_id: senderUserId,
    sender_display_name: senderDisplayName,
    body,
    tag: tag || undefined,
    delivery_status: 'pending',
    sent_at: new Date(),
  });

  // Publish outbound message to NATS
  try {
    const js = getJetStream();
    await js.publish(
      'comms.outbound',
      sc.encode(JSON.stringify({
        message_id: message._id.toString(),
        channel_id: thread.channel_id.toString(),
        thread_external_id: thread.external_thread_id,
        body,
      }))
    );
  } catch (err: any) {
    logger.error('Failed to publish outbound message for new thread', { error: err.message });
  }

  return { thread, message };
}

/**
 * Update thread tag or status.
 */
export async function updateThread(
  providerTenantId: string,
  threadId: string,
  updates: { tag?: string; status?: string }
) {
  const setFields: Record<string, any> = {};
  if (updates.tag) setFields.tag = updates.tag;
  if (updates.status) setFields.status = updates.status;

  const thread = await CommunicationThread.findOneAndUpdate(
    {
      _id: new Types.ObjectId(threadId),
      provider_tenant_id: new Types.ObjectId(providerTenantId),
    },
    { $set: setFields },
    { new: true }
  );

  if (!thread) {
    const err: any = new Error('Thread not found');
    err.status = 404;
    throw err;
  }

  return thread;
}

/**
 * Get members of the Slack channel associated with a thread.
 */
export async function getChannelMembers(
  providerTenantId: string,
  threadId: string
): Promise<{ id: string; display_name: string }[]> {
  const thread = await CommunicationThread.findOne({
    _id: new Types.ObjectId(threadId),
    provider_tenant_id: new Types.ObjectId(providerTenantId),
  });

  if (!thread) {
    const err: any = new Error('Thread not found');
    err.status = 404;
    throw err;
  }

  const channel = await CommunicationChannel.findById(thread.channel_id);
  if (!channel || channel.platform !== 'slack') {
    return [];
  }

  let botToken: string;
  if (channel.installation_id) {
    const installation = await SlackInstallation.findById(channel.installation_id);
    if (!installation || !installation.is_active) return [];
    botToken = decryptToken(installation.bot_token_encrypted);
  } else if (channel.access_token_encrypted) {
    botToken = decryptToken(channel.access_token_encrypted);
  } else {
    return [];
  }

  return getConversationMembers(botToken, channel.external_channel_id);
}
