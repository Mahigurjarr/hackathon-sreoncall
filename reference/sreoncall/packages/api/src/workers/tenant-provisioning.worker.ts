import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { getJetStream, getJetStreamManager } from '../config/nats';
import {
  TenantProvisioningPayload,
  provisionTenant,
  deprovisionTenant,
} from '../services/tenant-provisioning.service';
import { logger } from '../utils/logger';

const CONSUMER_NAME = 'tenant-provisioning';
const STREAM_NAME = 'TENANTS';
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
      deliver_policy: DeliverPolicy.All,
      // Provisioning (DNS propagation + ansible run + LE issuance) can take
      // several minutes; allow generous ack_wait and limited retries.
      ack_wait: 15 * 60 * 1_000_000_000, // 15 min
      max_deliver: 3,
    });
    logger.info('Tenant provisioning consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const payload = JSON.parse(new TextDecoder().decode(msg.data)) as TenantProvisioningPayload;
    logger.info('Tenant provisioning event received', {
      slug: payload.slug,
      action: payload.action,
      subject: msg.subject,
    });

    if (payload.action === 'create') {
      await provisionTenant(payload.slug);
    } else if (payload.action === 'delete') {
      await deprovisionTenant(payload.slug);
    } else {
      logger.warn('Unknown tenant provisioning action — ignoring', { action: payload.action });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Tenant provisioning failed', {
      subject: msg.subject,
      error: err.message,
      stack: err.stack,
    });
    msg.nak();
  }
}

export async function startTenantProvisioningWorker(): Promise<void> {
  if (running) return;

  await ensureConsumer();
  const js = getJetStream();

  consumer = (await js.consumers.get(STREAM_NAME, CONSUMER_NAME)) as any;
  running = true;

  (async () => {
    const messages = await (consumer as any).consume();
    for await (const msg of messages) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    logger.error('Tenant provisioning worker loop error', { error: err.message });
    running = false;
  });

  logger.info('Tenant provisioning worker started');
}

export async function stopTenantProvisioningWorker(): Promise<void> {
  running = false;
  consumer = null;
  logger.info('Tenant provisioning worker stopped');
}
