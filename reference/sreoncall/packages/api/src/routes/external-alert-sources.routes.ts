import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as svc from '../services/external-alert-ingest.service';
import { ExternalAlertPlatform } from '../models/external-alert-source.model';

const router = Router();

// Use PUBLIC_API_BASE_URL env var when set (e.g. https://app.sreoncall.com).
// Falls back to the request host, replacing "web." prefix with "app." so that
// requests arriving via the web frontend still produce a canonical API URL.
function buildWebhookUrl(req: Request): string {
  if (process.env['PUBLIC_API_BASE_URL']) {
    return `${process.env['PUBLIC_API_BASE_URL']}/api/v1/public/alerts/ingest`;
  }
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const rawHost = req.get('x-forwarded-host') || req.get('host') || 'app.sreoncall.com';
  const host = rawHost.replace(/^web\./, 'app.');
  return `${proto}://${host}/api/v1/public/alerts/ingest`;
}

const PLATFORMS = ['groundcover', 'alertmanager', 'grafana', 'datadog', 'generic'] as const;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  platform: z.enum(PLATFORMS),
  default_severity: z.number().int().min(1).max(4).optional(),
  auto_create_incident: z.boolean().optional(),
  auto_resolve: z.boolean().optional(),
  escalation_policy_id: z.string().optional(),
  service_id: z.string().optional(),
  labels: z.array(z.string().max(100)).max(20).optional(),
});

function serialize(source: any, rawToken?: string) {
  return {
    id: source._id?.toString() ?? source.id,
    name: source.name,
    description: source.description,
    platform: source.platform,
    token_prefix: source.token_prefix,
    ...(rawToken ? { token: rawToken } : {}),
    default_severity: source.default_severity,
    auto_create_incident: source.auto_create_incident,
    auto_resolve: source.auto_resolve,
    escalation_policy_id: source.escalation_policy_id?.toString() ?? null,
    service_id: source.service_id?.toString() ?? null,
    labels: source.labels,
    last_used_at: source.last_used_at,
    created_at: source.created_at,
    updated_at: source.updated_at,
    // Convenience — external platforms paste this URL directly
    webhook_url: `/api/v1/public/alerts/ingest`,
  };
}

// GET /api/v1/external-alert-sources
router.get(
  '/',
  rbac('external-alert-sources:read'),
  async (req: Request, res: Response) => {
    const sources = await svc.listSources(req.tenantId.toString());
    res.json({ data: sources.map((s) => serialize(s)) });
  },
);

// POST /api/v1/external-alert-sources
router.post(
  '/',
  rbac('external-alert-sources:create'),
  auditMiddleware({ action: 'external_alert_source.created', resourceType: 'external_alert_source' }),
  async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const { source, rawToken } = await svc.createSource(
      req.tenantId.toString(),
      req.userId.toString(),
      body as { name: string; platform: ExternalAlertPlatform } & typeof body,
    );
    const webhookUrl = buildWebhookUrl(req);
    res.status(201).json({
      data: {
        ...serialize(source, rawToken),
        webhook_url: webhookUrl,
      },
      note: 'Save the token now — it will not be shown again.',
    });
  },
);

// DELETE /api/v1/external-alert-sources/:id
router.delete(
  '/:id',
  rbac('external-alert-sources:delete'),
  auditMiddleware({
    action: 'external_alert_source.deleted',
    resourceType: 'external_alert_source',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    await svc.deleteSource(req.tenantId.toString(), req.params['id'] as string);
    res.status(204).send();
  },
);

// POST /api/v1/external-alert-sources/:id/rotate-token
router.post(
  '/:id/rotate-token',
  rbac('external-alert-sources:create'),
  auditMiddleware({
    action: 'external_alert_source.token_rotated',
    resourceType: 'external_alert_source',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    const { source, rawToken } = await svc.rotateToken(
      req.tenantId.toString(),
      req.params['id'] as string,
    );
    const webhookUrl = buildWebhookUrl(req);
    res.json({
      data: {
        ...serialize(source, rawToken),
        webhook_url: webhookUrl,
      },
      note: 'Previous token is now invalid. Save the new token — it will not be shown again.',
    });
  },
);

export default router;
