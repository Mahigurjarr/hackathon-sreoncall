import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { Webhook } from '../models/webhook.model';
import { WebhookDelivery } from '../models/webhook-delivery.model';
import {
  deliverWebhook,
  getFailedDeliveriesForRetry,
} from '../services/webhook-delivery.service';
import { logger } from '../utils/logger';
import { withMsgTraceContext } from '../utils/nats-trace';

const STREAMS_TO_CONSUME = [
  { stream: 'TICKETS', consumer: 'webhook-tickets', filterSubject: 'tickets.>' },
  { stream: 'INCIDENTS', consumer: 'webhook-incidents', filterSubject: 'incidents.>' },
  { stream: 'CHANGES', consumer: 'webhook-changes', filterSubject: 'changes.>' },
];

let consumers: ConsumerMessages[] = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function mapSubjectToEventType(subject: string): string {
  // tickets.created -> ticket.created, incidents.updated -> incident.updated
  const parts = subject.split('.');
  if (parts.length >= 2) {
    // Remove trailing 's' from first segment to get event type
    const resource = parts[0].replace(/s$/, '');
    return `${resource}.${parts.slice(1).join('.')}`;
  }
  return subject;
}

async function ensureConsumers(): Promise<void> {
  const jsm = getJetStreamManager();

  for (const cfg of STREAMS_TO_CONSUME) {
    try {
      await jsm.consumers.info(cfg.stream, cfg.consumer);
    } catch {
      await jsm.consumers.add(cfg.stream, {
        durable_name: cfg.consumer,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subject: cfg.filterSubject,
        max_deliver: 3,
        ack_wait: 30_000_000_000,
      });
      logger.info(`Webhook delivery consumer created: ${cfg.consumer}`);
    }
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  await withMsgTraceContext(msg, async () => {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const eventType = mapSubjectToEventType(msg.subject);
    const tenantId = data.tenant_id;

    if (!tenantId) {
      msg.ack();
      return;
    }

    // Find matching active webhooks
    const webhooks = await Webhook.find({
      tenant_id: tenantId,
      active: true,
      events: eventType,
    });

    if (webhooks.length === 0) {
      msg.ack();
      return;
    }

    // Create delivery records and attempt immediate delivery
    for (const webhook of webhooks) {
      try {
        const delivery = await WebhookDelivery.create({
          tenant_id: tenantId,
          webhook_id: webhook._id,
          event_type: eventType,
          payload: {
            event: eventType,
            timestamp: data.timestamp || new Date().toISOString(),
            data,
          },
          status: 'pending',
          attempts: 0,
          max_attempts: 6,
        });

        const success = await deliverWebhook(delivery, webhook.url, webhook.secret_hash);

        // Update webhook stats
        if (success) {
          await Webhook.updateOne(
            { _id: webhook._id },
            { $inc: { 'delivery_stats.success': 1 }, $set: { last_triggered_at: new Date() } },
          );
        } else {
          await Webhook.updateOne(
            { _id: webhook._id },
            { $inc: { 'delivery_stats.failed': 1 }, $set: { last_triggered_at: new Date() } },
          );
        }
      } catch (err: any) {
        logger.error('Failed to process webhook delivery', {
          webhookId: webhook._id.toString(),
          eventType,
          error: err.message,
        });
      }
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Webhook delivery worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(5000);
  }
  });
}

async function retryFailedDeliveries(): Promise<void> {
  try {
    const deliveries = await getFailedDeliveriesForRetry();
    if (deliveries.length === 0) return;

    logger.debug(`Retrying ${deliveries.length} failed webhook deliveries`);

    for (const delivery of deliveries) {
      const webhook = await Webhook.findById(delivery.webhook_id);
      if (!webhook || !webhook.active) {
        delivery.status = 'dead_letter';
        delivery.error_message = 'Webhook no longer active';
        await delivery.save();
        continue;
      }

      const success = await deliverWebhook(delivery, webhook.url, webhook.secret_hash);
      if (success) {
        await Webhook.updateOne(
          { _id: webhook._id },
          { $inc: { 'delivery_stats.success': 1 } },
        );
      } else if (delivery.status === 'dead_letter') {
        await Webhook.updateOne(
          { _id: webhook._id },
          { $inc: { 'delivery_stats.failed': 1 } },
        );
      }
    }
  } catch (err: any) {
    logger.error('Webhook retry poll error', { error: err.message });
  }
}

export async function startWebhookDeliveryWorker(): Promise<void> {
  if (running) return;

  await ensureConsumers();
  const js = getJetStream();
  running = true;

  for (const cfg of STREAMS_TO_CONSUME) {
    const consumer = await js.consumers.get(cfg.stream, cfg.consumer).then((c) => c.consume());
    consumers.push(consumer);

    (async () => {
      for await (const msg of consumer) {
        if (!running) break;
        await processMessage(msg);
      }
    })().catch((err) => {
      if (running) {
        logger.error(`Webhook consumer ${cfg.consumer} error`, { error: err.message });
      }
    });
  }

  // Retry poller every 30 seconds
  retryTimer = setInterval(() => {
    retryFailedDeliveries();
  }, 30_000);

  logger.info('Webhook delivery worker started');
}

export async function stopWebhookDeliveryWorker(): Promise<void> {
  running = false;
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  for (const consumer of consumers) {
    consumer.stop();
  }
  consumers = [];
  logger.info('Webhook delivery worker stopped');
}
