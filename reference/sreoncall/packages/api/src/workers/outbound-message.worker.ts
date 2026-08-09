/**
 * Outbound Message Worker
 *
 * NATS consumer on `messages.created`.
 * When a message is posted to a channel with slack_integration or teams_integration,
 * relays the message to the external platform and stores the external message ID.
 */

import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { Channel } from '../models/channel.model';
import { Message } from '../models/channel.model';
import { TenantIntegration } from '../models/tenant-integration.model';
import { decryptToken } from '../utils/encryption';
import * as slackService from '../services/slack.service';
import * as teamsService from '../services/teams.service';
import { logger } from '../utils/logger';

const CONSUMER_NAME = 'outbound-message-delivery';
const STREAM_NAME = 'MESSAGES';
let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();
  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['messages.>'],
      max_age: 24 * 60 * 60 * 1_000_000_000, // 24h in nanoseconds
    });
    logger.info('MESSAGES stream created');
  }
}

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();
  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      max_deliver: 3,
      ack_wait: 30_000_000_000,
    });
    logger.info('Outbound message worker consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { message_id, channel_id, tenant_id } = data;

    if (!message_id || !channel_id) {
      msg.ack();
      return;
    }

    const channel = await Channel.findById(channel_id);
    if (!channel) {
      msg.ack();
      return;
    }

    const messageDoc = await Message.findById(message_id);
    if (!messageDoc) {
      msg.ack();
      return;
    }

    // Relay to Slack
    if (channel.slack_integration) {
      const integration = await TenantIntegration.findOne({
        tenant_id: new Types.ObjectId(tenant_id),
        platform: 'slack',
        is_active: true,
      });

      if (integration) {
        try {
          const token = decryptToken(integration.bot_token_encrypted);
          const slackTs = await slackService.postMessage(
            token,
            channel.slack_integration.channel_id,
            messageDoc.body
          );
          if (slackTs) {
            await Message.updateOne({ _id: message_id }, { $set: { slack_message_id: slackTs } });
          }
        } catch (err: any) {
          logger.error('Failed to relay message to Slack', { messageId: message_id, error: err.message });
        }
      }
    }

    // Relay to Teams
    if (channel.teams_integration) {
      const integration = await TenantIntegration.findOne({
        tenant_id: new Types.ObjectId(tenant_id),
        platform: 'teams',
        is_active: true,
      });

      if (integration) {
        try {
          const token = decryptToken(integration.bot_token_encrypted);
          const teamsId = await teamsService.postMessage(
            token,
            channel.teams_integration.team_id,
            channel.teams_integration.channel_id,
            messageDoc.body
          );
          if (teamsId) {
            await Message.updateOne({ _id: message_id }, { $set: { teams_message_id: teamsId } });
          }
        } catch (err: any) {
          logger.error('Failed to relay message to Teams', { messageId: message_id, error: err.message });
        }
      }
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Outbound message worker failed', { error: err.message, subject: msg.subject });
    msg.nak(5000);
  }
}

export async function startOutboundMessageWorker(): Promise<void> {
  if (running) return;

  await ensureStream();
  await ensureConsumer();
  const js = getJetStream();
  consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME).then((c) => c.consume());
  running = true;

  (async () => {
    if (!consumer) return;
    for await (const msg of consumer) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Outbound message worker loop error', { error: err.message });
    }
  });

  logger.info('Outbound message worker started');
}

export async function stopOutboundMessageWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Outbound message worker stopped');
}
