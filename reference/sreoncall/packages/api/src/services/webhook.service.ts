import crypto from 'crypto';
import { Types } from 'mongoose';
import { Webhook, WebhookDocument } from '../models/webhook.model';
import { AppError } from '../middleware/errorHandler.middleware';

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export async function listWebhooks(tenantId: Types.ObjectId): Promise<WebhookDocument[]> {
  return Webhook.find({ tenant_id: tenantId }).sort({ created_at: -1 });
}

export async function createWebhook(input: {
  tenant_id: Types.ObjectId;
  url: string;
  description?: string;
  secret: string;
  events: string[];
}): Promise<WebhookDocument> {
  const secret_hash = hashSecret(input.secret);
  const secret_prefix = input.secret.slice(0, 8) + '...';
  return Webhook.create({
    tenant_id: input.tenant_id,
    url: input.url,
    description: input.description || '',
    secret_hash,
    secret_prefix,
    events: input.events,
    active: true,
    delivery_stats: { success: 0, failed: 0 },
  });
}

export async function updateWebhook(
  tenantId: Types.ObjectId,
  id: string,
  update: Partial<{ url: string; description: string; events: string[]; active: boolean }>
): Promise<WebhookDocument> {
  const webhook = await Webhook.findOne({ _id: id, tenant_id: tenantId });
  if (!webhook) throw AppError.notFound('Webhook');
  Object.assign(webhook, update);
  await webhook.save();
  return webhook;
}

export async function deleteWebhook(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await Webhook.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Webhook');
}

export async function testWebhook(
  tenantId: Types.ObjectId,
  id: string
): Promise<{ success: boolean; status?: number }> {
  const webhook = await Webhook.findOne({ _id: id, tenant_id: tenantId });
  if (!webhook) throw AppError.notFound('Webhook');

  const payload = {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test payload from SREonCall' },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SREonCall-Event': 'webhook.test',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    webhook.last_triggered_at = new Date();
    if (res.ok) {
      webhook.delivery_stats.success += 1;
    } else {
      webhook.delivery_stats.failed += 1;
    }
    await webhook.save();
    return { success: res.ok, status: res.status };
  } catch {
    webhook.delivery_stats.failed += 1;
    await webhook.save();
    return { success: false };
  }
}
