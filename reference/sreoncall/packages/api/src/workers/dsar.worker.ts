import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { DsarRequest } from '../models/dsar-request.model';
import * as dsarService from '../services/dsar.service';
import { logger } from '../utils/logger';

const CONSUMER_NAME = 'dsar-processor';
const STREAM_NAME = 'DSAR';
let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['DSAR.>'],
      retention: 'workqueue' as any,
      max_msgs: 10000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('DSAR stream created');
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
      ack_wait: 120_000_000_000, // 2 minutes (exports can be slow)
    });
    logger.info('DSAR worker consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { request_id, type, user_id, tenant_id } = data;

    logger.info('DSAR worker processing request', { request_id, type });

    // Update status to processing
    await dsarService.updateDsarStatus(request_id, 'processing');

    const userId = new Types.ObjectId(user_id);
    const tenantId = new Types.ObjectId(tenant_id);

    if (type === 'access' || type === 'portability') {
      const exportData = await dsarService.processExport(userId, tenantId);

      // Store export as JSON (in production, this would go to MinIO)
      const downloadUrl = `data:application/json;base64,${Buffer.from(
        JSON.stringify(exportData, null, 2)
      ).toString('base64')}`;

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await dsarService.updateDsarStatus(request_id, 'completed', {
        download_url: downloadUrl,
        download_expires_at: expiresAt,
      });

      logger.info('DSAR export completed', { request_id });
    } else if (type === 'erasure') {
      await dsarService.processErasure(userId, tenantId);
      await dsarService.updateDsarStatus(request_id, 'completed', {
        notes: 'User data anonymized successfully.',
      });

      logger.info('DSAR erasure completed', { request_id });
    } else {
      await dsarService.updateDsarStatus(request_id, 'completed', {
        notes: `Request type "${type}" acknowledged. Manual review required.`,
      });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('DSAR worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });

    // Try to update request status to failed
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.data));
      await dsarService.updateDsarStatus(data.request_id, 'failed', {
        notes: `Processing error: ${err.message}`,
      });
    } catch { /* best effort */ }

    msg.nak(10000);
  }
}

export async function startDsarWorker(): Promise<void> {
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
      logger.error('DSAR worker loop error', { error: err.message });
    }
  });

  logger.info('DSAR worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopDsarWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('DSAR worker stopped');
}
