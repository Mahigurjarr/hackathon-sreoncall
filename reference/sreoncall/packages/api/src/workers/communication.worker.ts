import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
  StringCodec,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { CommunicationChannel } from '../models/communication-channel.model';
import { CommunicationThread } from '../models/communication-thread.model';
import { CommunicationMessage } from '../models/communication-message.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { SlackInstallation } from '../models/slack-installation.model';
import { publishAgentTrigger } from '../services/agent-trigger.service';
import { getUserInfo } from '../services/slack.service';
import * as teamsService from '../services/teams.service';
import { decryptToken } from '../utils/encryption';
import { logger } from '../utils/logger';
import { withMsgTraceContext } from '../utils/nats-trace';

const STREAM_NAME = 'COMMUNICATIONS';
const INBOUND_CONSUMER = 'comms-inbound-delivery';
const OUTBOUND_CONSUMER = 'comms-outbound-delivery';
const sc = StringCodec();

let inboundConsumer: ConsumerMessages | null = null;
let outboundConsumer: ConsumerMessages | null = null;
let running = false;

async function ensureConsumer(consumerName: string, filterSubject: string): Promise<void> {
  const jsm = getJetStreamManager();
  try {
    await jsm.consumers.info(STREAM_NAME, consumerName);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: consumerName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      filter_subject: filterSubject,
      max_deliver: 3,
      ack_wait: 30_000_000_000, // 30s in nanoseconds
    });
    logger.info(`Communication worker consumer "${consumerName}" created`);
  }
}

async function handleInbound(msg: JsMsg): Promise<void> {
  await withMsgTraceContext(msg, async () => {
  try {
    const data = JSON.parse(sc.decode(msg.data));
    const { platform, external_channel_id, external_thread_id, external_message_id, sender_user_id, sender_display_name, body, team_id } = data;

    // Find the channel — try direct lookup first (backward compat for manual channels)
    let channel = await CommunicationChannel.findOne({
      platform,
      external_channel_id,
      deleted_at: null,
      is_active: true,
    });

    // If not found and we have a team_id, try installation-based lookup
    if (!channel && team_id) {
      const installation = await SlackInstallation.findOne({
        team_id,
        is_active: true,
        deleted_at: null,
      });
      if (installation) {
        channel = await CommunicationChannel.findOne({
          installation_id: installation._id,
          external_channel_id,
          deleted_at: null,
          is_active: true,
        });
      }
    }

    if (!channel) {
      logger.debug('No channel found for inbound message', { platform, external_channel_id, team_id });
      msg.ack();
      return;
    }

    // Find the provider link with communications scope
    const link = await ProviderConsumerLink.findOne({
      consumer_tenant_id: channel.consumer_tenant_id,
      status: 'active',
      scope: { $in: ['communications'] },
    });

    if (!link) {
      logger.debug('No provider link with communications scope', { consumerTenantId: channel.consumer_tenant_id.toString() });
      msg.ack();
      return;
    }

    // Resolve Slack user display name
    let resolvedDisplayName = sender_display_name;
    if (platform === 'slack' && sender_user_id && /^U[A-Z0-9]+$/.test(sender_user_id)) {
      try {
        let botToken: string;
        if (channel.installation_id) {
          const inst = await SlackInstallation.findById(channel.installation_id);
          if (inst) botToken = decryptToken(inst.bot_token_encrypted);
          else botToken = '';
        } else if (channel.access_token_encrypted) {
          botToken = decryptToken(channel.access_token_encrypted);
        } else {
          botToken = '';
        }
        if (botToken) {
          resolvedDisplayName = await getUserInfo(botToken, sender_user_id);
        }
      } catch (err: any) {
        logger.debug('Failed to resolve Slack user name, using raw ID', { sender_user_id, error: err.message });
      }
    }

    // Find or create thread
    let thread = await CommunicationThread.findOne({
      channel_id: channel._id,
      external_thread_id,
      status: 'open',
    });

    if (!thread) {
      thread = await CommunicationThread.create({
        provider_tenant_id: link.provider_tenant_id,
        consumer_tenant_id: channel.consumer_tenant_id,
        channel_id: channel._id,
        subject: body.slice(0, 100) || 'New conversation',
        status: 'open',
        unread_by_provider: 0,
        last_message_at: new Date(),
        external_thread_id,
        initiated_by: 'consumer',
      });
    }

    // Create message
    const origin = platform === 'slack' ? 'consumer_slack' : 'consumer_teams';
    await CommunicationMessage.create({
      thread_id: thread._id,
      provider_tenant_id: link.provider_tenant_id,
      consumer_tenant_id: channel.consumer_tenant_id,
      origin,
      sender_user_id,
      sender_display_name: resolvedDisplayName,
      body,
      delivery_status: 'delivered',
      external_message_id,
      sent_at: new Date(),
    });

    // Update thread: increment unread + update last_message_at
    await CommunicationThread.updateOne(
      { _id: thread._id },
      {
        $inc: { unread_by_provider: 1 },
        $set: { last_message_at: new Date() },
      }
    );

    // Publish real-time notification for provider inbox
    try {
      const js = getJetStream();
      await js.publish('comms.notify', sc.encode(JSON.stringify({
        event: 'comms.message.new',
        provider_tenant_id: link.provider_tenant_id.toString(),
        consumer_tenant_id: channel.consumer_tenant_id.toString(),
        thread_id: thread._id.toString(),
        sender_display_name: resolvedDisplayName,
        body_preview: body.slice(0, 100),
        timestamp: new Date().toISOString(),
      })));
    } catch (notifyErr: any) {
      logger.debug('Failed to publish comms notification', { error: notifyErr.message });
    }

    // Trigger comms-agent to draft a reply for the provider
    publishAgentTrigger('comms-agent', {
      type: 'event',
      event_type: 'comms.inbound',
      source_id: thread._id.toString(),
    }, link.provider_tenant_id.toString(), channel.consumer_tenant_id.toString()).catch(() => {});

    msg.ack();
  } catch (err: any) {
    logger.error('Communication inbound worker error', { error: err.message });
    msg.nak(5000);
  }
  });
}

async function handleOutbound(msg: JsMsg): Promise<void> {
  await withMsgTraceContext(msg, async () => {
  try {
    const data = JSON.parse(sc.decode(msg.data));
    const { message_id, channel_id, thread_external_id, body } = data;

    const channel = await CommunicationChannel.findById(channel_id);
    if (!channel || !channel.is_active || channel.deleted_at) {
      logger.warn('Outbound message: channel not found or inactive', { channel_id });
      // Mark message as failed
      if (message_id) {
        await CommunicationMessage.updateOne(
          { _id: new Types.ObjectId(message_id) },
          { $set: { delivery_status: 'failed' } }
        );
      }
      msg.ack();
      return;
    }

    let accessToken: string;
    try {
      if (channel.installation_id) {
        // Centralized: resolve token from SlackInstallation
        const installation = await SlackInstallation.findById(channel.installation_id);
        if (!installation || !installation.is_active || installation.deleted_at) {
          throw new Error('Linked Slack installation not found or inactive');
        }
        accessToken = decryptToken(installation.bot_token_encrypted);
      } else if (channel.access_token_encrypted) {
        // Legacy manual channel: token stored directly
        accessToken = decryptToken(channel.access_token_encrypted);
      } else {
        throw new Error('No token source available for channel');
      }
    } catch (err: any) {
      logger.error('Failed to resolve channel token', { channelId: channel._id.toString(), error: err.message });
      if (message_id) {
        await CommunicationMessage.updateOne(
          { _id: new Types.ObjectId(message_id) },
          { $set: { delivery_status: 'failed' } }
        );
      }
      msg.ack();
      return;
    }

    let externalMessageId: string | undefined;

    if (channel.platform === 'slack') {
      const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          channel: channel.external_channel_id,
          text: body,
          thread_ts: thread_external_id || undefined,
        }),
      });
      const slackData = await slackRes.json() as any;
      if (slackData.ok) {
        externalMessageId = slackData.ts;
      } else {
        logger.error('Slack API error', { error: slackData.error });
        if (message_id) {
          await CommunicationMessage.updateOne(
            { _id: new Types.ObjectId(message_id) },
            { $set: { delivery_status: 'failed' } }
          );
        }
        msg.ack();
        return;
      }
    } else if (channel.platform === 'teams') {
      const { app_id: appId, aad_tenant_id: aadTenantId, team_id: teamId } = channel;
      if (!appId || !aadTenantId || !teamId) {
        logger.error('Teams channel missing Graph API configuration (app_id/aad_tenant_id/team_id)', {
          channelId: channel._id.toString(),
        });
        if (message_id) {
          await CommunicationMessage.updateOne(
            { _id: new Types.ObjectId(message_id) },
            { $set: { delivery_status: 'failed' } }
          );
        }
        msg.ack();
        return;
      }

      try {
        // accessToken here is the decrypted Graph app password (client secret),
        // resolved via the same channel.access_token_encrypted path as Slack's
        // legacy manual channels above.
        const graphToken = await teamsService.getAppOnlyGraphToken(aadTenantId, appId, accessToken);
        const teamsMessageId = await teamsService.postMessage(graphToken, teamId, channel.external_channel_id, body);
        if (!teamsMessageId) {
          throw new Error('Graph API returned no message id');
        }
        externalMessageId = teamsMessageId;
      } catch (err: any) {
        logger.error('Teams delivery failed', { channelId: channel._id.toString(), error: err.message });
        if (message_id) {
          await CommunicationMessage.updateOne(
            { _id: new Types.ObjectId(message_id) },
            { $set: { delivery_status: 'failed' } }
          );
        }
        msg.ack();
        return;
      }
    }

    // Update message delivery status
    if (message_id) {
      await CommunicationMessage.updateOne(
        { _id: new Types.ObjectId(message_id) },
        {
          $set: {
            delivery_status: 'delivered',
            external_message_id: externalMessageId,
          },
        }
      );

      // Publish delivery confirmation for real-time UI update
      try {
        const js = getJetStream();
        const msgDoc = await CommunicationMessage.findById(message_id);
        if (msgDoc) {
          await js.publish('comms.notify', sc.encode(JSON.stringify({
            event: 'comms.delivered',
            provider_tenant_id: msgDoc.provider_tenant_id.toString(),
            thread_id: msgDoc.thread_id.toString(),
            message_id: message_id,
            timestamp: new Date().toISOString(),
          })));
        }
      } catch (notifyErr: any) {
        logger.debug('Failed to publish comms delivered notification', { error: notifyErr.message });
      }
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Communication outbound worker error', { error: err.message });
    msg.nak(5000);
  }
  });
}

export async function startCommunicationWorker(): Promise<void> {
  if (running) return;

  await ensureConsumer(INBOUND_CONSUMER, 'comms.inbound');
  await ensureConsumer(OUTBOUND_CONSUMER, 'comms.outbound');

  const js = getJetStream();

  inboundConsumer = await js.consumers.get(STREAM_NAME, INBOUND_CONSUMER).then((c) => c.consume());
  outboundConsumer = await js.consumers.get(STREAM_NAME, OUTBOUND_CONSUMER).then((c) => c.consume());
  running = true;

  // Inbound loop
  (async () => {
    if (!inboundConsumer) return;
    for await (const msg of inboundConsumer) {
      if (!running) break;
      await handleInbound(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Communication inbound worker loop error', { error: err.message });
    }
  });

  // Outbound loop
  (async () => {
    if (!outboundConsumer) return;
    for await (const msg of outboundConsumer) {
      if (!running) break;
      await handleOutbound(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Communication outbound worker loop error', { error: err.message });
    }
  });

  logger.info('Communication worker started', { stream: STREAM_NAME });
}

export async function stopCommunicationWorker(): Promise<void> {
  running = false;
  if (inboundConsumer) {
    inboundConsumer.stop();
    inboundConsumer = null;
  }
  if (outboundConsumer) {
    outboundConsumer.stop();
    outboundConsumer = null;
  }
  logger.info('Communication worker stopped');
}
