import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as webhookService from '../services/webhook.service';
import { getDeliveriesForWebhook } from '../services/webhook-delivery.service';
import { assertUrlSafe, SsrfError } from '../utils/ssrf-guard';
import { AppError } from '../middleware/errorHandler.middleware';

/**
 * Reject webhook URLs pointing at private/reserved IP ranges, link-local
 * addresses, or internal hostnames at creation time (F-05 in security
 * assessment 2026-04-21). SSRF is already blocked at delivery time; this is
 * defense-in-depth so misconfigured webhooks fail fast before the first
 * delivery attempt and so DNS rebinding is harder (we resolve at both
 * creation and delivery).
 */
async function assertWebhookUrlSafe(urlString: string): Promise<void> {
  try {
    await assertUrlSafe(urlString);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw AppError.badRequest(
        `Webhook URL rejected: ${err.message}. Use a publicly-reachable https:// endpoint.`,
      );
    }
    throw err;
  }
}

const router = Router();

const createWebhookSchema = z.object({
  url: z.string().url(),
  description: z.string().max(500).optional(),
  secret: z.string().min(16),
  events: z.array(z.string()).min(1),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  description: z.string().max(500).optional(),
  events: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

function serializeWebhook(w: any) {
  const total = w.delivery_stats.success + w.delivery_stats.failed;
  const successRate =
    total > 0
      ? Math.round((w.delivery_stats.success / total) * 1000) / 10
      : 100;
  return {
    id: w._id.toString(),
    url: w.url,
    description: w.description,
    secret_prefix: w.secret_prefix,
    events: w.events,
    active: w.active,
    last_triggered_at: w.last_triggered_at || null,
    delivery_stats: w.delivery_stats,
    success_rate: successRate,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

// GET /api/v1/webhooks
router.get('/', rbac('webhooks:read'), async (req: Request, res: Response) => {
  const webhooks = await webhookService.listWebhooks(req.tenantId);
  res.json({ data: webhooks.map(serializeWebhook) });
});

// POST /api/v1/webhooks
router.post('/', rbac('webhooks:create'), async (req: Request, res: Response) => {
  const body = createWebhookSchema.parse(req.body);
  await assertWebhookUrlSafe(body.url);
  const webhook = await webhookService.createWebhook({ ...body, tenant_id: req.tenantId });
  res.status(201).json(serializeWebhook(webhook));
});

// PATCH /api/v1/webhooks/:id
router.patch('/:id', rbac('webhooks:update'), async (req: Request, res: Response) => {
  const body = updateWebhookSchema.parse(req.body);
  if (body.url) await assertWebhookUrlSafe(body.url);
  const webhook = await webhookService.updateWebhook(
    req.tenantId,
    req.params.id as string,
    body
  );
  res.json(serializeWebhook(webhook));
});

// DELETE /api/v1/webhooks/:id
router.delete('/:id', rbac('webhooks:delete'), async (req: Request, res: Response) => {
  await webhookService.deleteWebhook(req.tenantId, req.params.id as string);
  res.status(204).send();
});

// POST /api/v1/webhooks/:id/test
router.post('/:id/test', rbac('webhooks:update'), async (req: Request, res: Response) => {
  const result = await webhookService.testWebhook(req.tenantId, req.params.id as string);
  res.json(result);
});

// GET /api/v1/webhooks/:id/deliveries
router.get('/:id/deliveries', rbac('webhooks:read'), async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
  const skip = parseInt(req.query.skip as string, 10) || 0;

  const result = await getDeliveriesForWebhook(
    req.tenantId.toString(),
    req.params.id as string,
    limit,
    skip,
  );

  res.json({
    data: result.data.map((d) => ({
      id: d._id.toString(),
      event_type: d.event_type,
      status: d.status,
      attempts: d.attempts,
      response_status: d.response_status ?? null,
      error_message: d.error_message ?? null,
      last_attempt_at: d.last_attempt_at?.toISOString() ?? null,
      next_retry_at: d.next_retry_at?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
    })),
    total: result.total,
  });
});

export default router;
