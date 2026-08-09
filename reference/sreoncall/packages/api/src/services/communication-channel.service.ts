import { Types } from 'mongoose';
import { CommunicationChannel, CommunicationChannelDocument } from '../models/communication-channel.model';
import { encryptToken } from '../utils/encryption';
import { sha256 } from '../utils/crypto';
import { logger } from '../utils/logger';

export async function listChannels(
  consumerTenantId: string | Types.ObjectId
): Promise<CommunicationChannelDocument[]> {
  return CommunicationChannel.find({
    consumer_tenant_id: new Types.ObjectId(consumerTenantId.toString()),
    deleted_at: null,
  }).sort({ createdAt: -1 });
}

export async function createChannel(input: {
  consumer_tenant_id: string;
  platform: 'slack' | 'teams';
  external_channel_id: string;
  display_name: string;
  channel_role?: 'bidirectional' | 'ingest_only' | 'notify_only';
  access_token?: string;
  signing_secret?: string;
  installation_id?: string;
  app_id?: string;
  aad_tenant_id?: string;
  team_id?: string;
}): Promise<{ channel: CommunicationChannelDocument }> {
  const doc: Record<string, unknown> = {
    consumer_tenant_id: new Types.ObjectId(input.consumer_tenant_id),
    platform: input.platform,
    external_channel_id: input.external_channel_id,
    display_name: input.display_name,
    channel_role: input.channel_role || 'bidirectional',
    is_active: true,
  };

  if (input.installation_id) {
    doc.installation_id = new Types.ObjectId(input.installation_id);
  }

  if (input.app_id) doc.app_id = input.app_id;
  if (input.aad_tenant_id) doc.aad_tenant_id = input.aad_tenant_id;
  if (input.team_id) doc.team_id = input.team_id;

  if (input.access_token) {
    doc.access_token_encrypted = encryptToken(input.access_token);
    doc.token_prefix = input.access_token.slice(0, 8) + '...';
  }

  if (input.signing_secret) {
    doc.signing_secret_hash = sha256(input.signing_secret);
  }

  const channel = await CommunicationChannel.create(doc);

  logger.info('Communication channel created', {
    channelId: channel._id.toString(),
    platform: input.platform,
    consumerTenantId: input.consumer_tenant_id,
    installationId: input.installation_id || null,
  });

  return { channel };
}

export async function updateChannel(
  channelId: string,
  consumerTenantId: string,
  updates: {
    display_name?: string;
    is_active?: boolean;
    channel_role?: 'bidirectional' | 'ingest_only' | 'notify_only';
  }
): Promise<CommunicationChannelDocument | null> {
  return CommunicationChannel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(channelId),
      consumer_tenant_id: new Types.ObjectId(consumerTenantId),
      deleted_at: null,
    },
    { $set: updates },
    { new: true }
  );
}

export async function deleteChannel(
  channelId: string,
  consumerTenantId: string
): Promise<CommunicationChannelDocument | null> {
  return CommunicationChannel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(channelId),
      consumer_tenant_id: new Types.ObjectId(consumerTenantId),
      deleted_at: null,
    },
    { $set: { deleted_at: new Date(), is_active: false } },
    { new: true }
  );
}

export async function getChannelById(
  channelId: string | Types.ObjectId
): Promise<CommunicationChannelDocument | null> {
  return CommunicationChannel.findOne({
    _id: new Types.ObjectId(channelId.toString()),
    deleted_at: null,
  });
}

export async function findChannelByExternal(
  platform: string,
  externalChannelId: string
): Promise<CommunicationChannelDocument | null> {
  return CommunicationChannel.findOne({
    platform,
    external_channel_id: externalChannelId,
    deleted_at: null,
    is_active: true,
  });
}
