import { Types } from 'mongoose';
import { SlackInstallation, SlackInstallationDocument } from '../models/slack-installation.model';
import { CommunicationChannel } from '../models/communication-channel.model';
import { encryptToken, decryptToken } from '../utils/encryption';
import { logger } from '../utils/logger';

export async function createInstallation(input: {
  consumer_tenant_id: string;
  team_id: string;
  team_name: string;
  bot_token: string;
  bot_user_id: string;
  scopes: string;
  installed_by_user_id?: string;
}): Promise<SlackInstallationDocument> {
  const bot_token_encrypted = encryptToken(input.bot_token);

  const installation = await SlackInstallation.findOneAndUpdate(
    {
      team_id: input.team_id,
      consumer_tenant_id: new Types.ObjectId(input.consumer_tenant_id),
      deleted_at: null,
    },
    {
      $set: {
        team_name: input.team_name,
        bot_token_encrypted,
        bot_user_id: input.bot_user_id,
        scopes: input.scopes,
        is_active: true,
        ...(input.installed_by_user_id
          ? { installed_by_user_id: new Types.ObjectId(input.installed_by_user_id) }
          : {}),
      },
      $setOnInsert: {
        team_id: input.team_id,
        consumer_tenant_id: new Types.ObjectId(input.consumer_tenant_id),
      },
    },
    { upsert: true, new: true }
  );

  logger.info('Slack installation upserted', {
    installationId: installation._id.toString(),
    teamId: input.team_id,
    consumerTenantId: input.consumer_tenant_id,
  });

  return installation;
}

export async function getInstallationById(
  id: string | Types.ObjectId
): Promise<SlackInstallationDocument | null> {
  return SlackInstallation.findOne({
    _id: new Types.ObjectId(id.toString()),
    deleted_at: null,
  });
}

export async function getInstallationByTeamId(
  teamId: string
): Promise<SlackInstallationDocument | null> {
  return SlackInstallation.findOne({
    team_id: teamId,
    is_active: true,
    deleted_at: null,
  });
}

export async function listInstallations(
  consumerTenantId: string | Types.ObjectId
): Promise<SlackInstallationDocument[]> {
  return SlackInstallation.find({
    consumer_tenant_id: new Types.ObjectId(consumerTenantId.toString()),
    is_active: true,
    deleted_at: null,
  }).sort({ createdAt: -1 });
}

export async function deleteInstallation(
  id: string,
  consumerTenantId: string
): Promise<SlackInstallationDocument | null> {
  const installation = await SlackInstallation.findOneAndUpdate(
    {
      _id: new Types.ObjectId(id),
      consumer_tenant_id: new Types.ObjectId(consumerTenantId),
      deleted_at: null,
    },
    { $set: { deleted_at: new Date(), is_active: false } },
    { new: true }
  );

  if (installation) {
    // Soft-delete all linked communication channels
    await CommunicationChannel.updateMany(
      { installation_id: installation._id, deleted_at: null },
      { $set: { deleted_at: new Date(), is_active: false } }
    );

    logger.info('Slack installation deleted with linked channels', {
      installationId: id,
      consumerTenantId,
    });
  }

  return installation;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
  topic?: string;
}

export async function fetchSlackChannels(
  installationId: string
): Promise<SlackChannel[]> {
  const installation = await getInstallationById(installationId);
  if (!installation) {
    throw new Error('Installation not found');
  }

  const botToken = decryptToken(installation.bot_token_encrypted);
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  // Paginate through Slack conversations.list
  do {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`https://slack.com/api/conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = await res.json() as any;

    if (!data.ok) {
      logger.error('Slack conversations.list failed', { error: data.error });
      throw new Error(`Slack API error: ${data.error}`);
    }

    for (const ch of data.channels || []) {
      channels.push({
        id: ch.id,
        name: ch.name,
        is_private: ch.is_private || false,
        num_members: ch.num_members || 0,
        topic: ch.topic?.value || undefined,
      });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return channels;
}
