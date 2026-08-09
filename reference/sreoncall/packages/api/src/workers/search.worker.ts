import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { getMeiliClient } from '../config/meilisearch';
import { Ticket } from '../models/ticket.model';
import { User } from '../models/user.model';
import { logger } from '../utils/logger';

const CONSUMER_NAME = 'search-indexer';
const STREAM_NAME = 'SEARCH';
let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      max_deliver: 5,
      ack_wait: 30_000_000_000, // 30s in nanoseconds
    });
    logger.info('Search worker consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { action, entity_type, entity_id, tenant_id } = data;

    const client = getMeiliClient();

    switch (action) {
      case 'index': {
        if (entity_type === 'ticket') {
          const ticket = await Ticket.findById(entity_id);
          if (ticket && !ticket.deleted_at) {
            await client.index('tickets').addDocuments([
              {
                id: ticket._id.toString(),
                tenant_id: ticket.tenant_id.toString(),
                number: ticket.number,
                type: ticket.type,
                title: ticket.title,
                description: ticket.description || '',
                status: ticket.status,
                priority: ticket.priority,
                assignee_id: ticket.assignee_id?.toString() || null,
                team_id: ticket.team_id?.toString() || null,
                labels: ticket.labels,
                created_at: ticket.createdAt?.toISOString(),
                updated_at: ticket.updatedAt?.toISOString(),
              },
            ]);
          }
        } else if (entity_type === 'user') {
          const user = await User.findById(entity_id);
          if (user && user.status !== 'deleted') {
            await client.index('users').addDocuments([
              {
                id: user._id.toString(),
                tenant_id: user.tenant_id.toString(),
                name: user.name,
                email: user.email,
                status: user.status,
                roles: user.roles,
                created_at: user.createdAt?.toISOString(),
              },
            ]);
          }
        }
        break;
      }
      case 'delete': {
        const indexName = entity_type === 'ticket' ? 'tickets' : 'users';
        await client.index(indexName).deleteDocument(entity_id);
        break;
      }
      default:
        logger.warn('Unknown search action', { action, entity_type, entity_id });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Search worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    // Negative ack with delay for retry
    msg.nak(5000);
  }
}

export async function startSearchWorker(): Promise<void> {
  if (running) return;

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
      logger.error('Search worker loop error', { error: err.message });
    }
  });

  logger.info('Search worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopSearchWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Search worker stopped');
}
