import crypto from 'crypto';
import { WebhookDelivery, WebhookDeliveryDocument } from '../models/webhook-delivery.model';
import { logger } from '../utils/logger';
import { assertUrlSafe, SsrfError } from '../utils/ssrf-guard';

const RETRY_DELAYS_MS = [
  60_000,        // 1 minute
  300_000,       // 5 minutes
  1_800_000,     // 30 minutes
  7_200_000,     // 2 hours
  43_200_000,    // 12 hours
  86_400_000,    // 24 hours
];

export function signPayload(payload: string, secretHash: string): string {
  return crypto.createHmac('sha256', secretHash).update(payload).digest('hex');
}

export function getNextRetryAt(attempt: number): Date {
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  return new Date(Date.now() + delay);
}

export async function deliverWebhook(
  delivery: WebhookDeliveryDocument,
  webhookUrl: string,
  secretHash: string,
): Promise<boolean> {
  const payloadStr = JSON.stringify(delivery.payload);
  const signature = signPayload(payloadStr, secretHash);
  const timestamp = new Date().toISOString();

  delivery.attempts += 1;
  delivery.last_attempt_at = new Date();

  // SSRF protection: block deliveries to private/internal addresses
  try {
    await assertUrlSafe(webhookUrl);
  } catch (err) {
    if (err instanceof SsrfError) {
      delivery.error_message = `SSRF blocked: ${err.message}`;
      delivery.status = 'dead_letter';
      await delivery.save();
      return false;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SREonCall-Event': delivery.event_type,
        'X-SREonCall-Signature': `sha256=${signature}`,
        'X-SREonCall-Delivery': delivery._id.toString(),
        'X-SREonCall-Timestamp': timestamp,
      },
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await res.text().catch(() => '');
    delivery.response_status = res.status;
    delivery.response_body = responseBody.slice(0, 10_000);

    if (res.ok) {
      delivery.status = 'success';
      delivery.error_message = undefined;
      await delivery.save();
      return true;
    }

    delivery.error_message = `HTTP ${res.status}`;
  } catch (err: any) {
    delivery.error_message = err.name === 'AbortError' ? 'Request timeout (10s)' : err.message;
  }

  // Failed — schedule retry or mark dead letter
  if (delivery.attempts >= delivery.max_attempts) {
    delivery.status = 'dead_letter';
  } else {
    delivery.status = 'failed';
    delivery.next_retry_at = getNextRetryAt(delivery.attempts);
  }

  await delivery.save();
  return false;
}

export async function getDeliveriesForWebhook(
  tenantId: string,
  webhookId: string,
  limit = 25,
  skip = 0,
): Promise<{ data: WebhookDeliveryDocument[]; total: number }> {
  const filter = { tenant_id: tenantId, webhook_id: webhookId };
  const [data, total] = await Promise.all([
    WebhookDelivery.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WebhookDelivery.countDocuments(filter),
  ]);
  return { data, total };
}

export async function getFailedDeliveriesForRetry(): Promise<WebhookDeliveryDocument[]> {
  return WebhookDelivery.find({
    status: 'failed',
    next_retry_at: { $lte: new Date() },
    $expr: { $lt: ['$attempts', '$max_attempts'] },
  }).limit(100);
}
