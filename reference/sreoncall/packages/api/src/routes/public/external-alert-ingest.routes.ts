import { Router, Request, Response } from 'express';
import * as svc from '../../services/external-alert-ingest.service';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/v1/public/alerts/ingest/:token
 *
 * Public webhook receiver for external monitoring platforms (Groundcover,
 * Alertmanager, Grafana, Datadog, etc.). The token in the URL identifies
 * the tenant and the platform format to use for parsing.
 *
 * Returns 202 immediately — incident creation is synchronous but best-effort
 * per alert so a single bad alert never blocks the rest.
 */
function extractToken(req: Request): string {
  // 1. URL path token (primary)
  if (req.params['token'] && req.params['token'] !== 'ingest') return req.params['token'] as string;
  // 2. Authorization: Bearer <token>
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  // 3. X-Api-Key header
  const xKey = req.headers['x-api-key'];
  if (typeof xKey === 'string' && xKey) return xKey.trim();
  return '';
}

export async function handleIngest(req: Request, res: Response) {
  const rawToken = extractToken(req);

  const source = await svc.validateToken(rawToken);
  if (!source) {
    res.status(401).json({ detail: 'Invalid or unknown integration token.' });
    return;
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ detail: 'Request body must be a JSON object.' });
    return;
  }

  logger.info('External alert ingest raw payload', { sourceId: source._id, platform: source.platform, body });
  const alerts = svc.parsePayload(source.platform, body, source.default_severity);
  logger.info('External alert ingest parsed alerts', { sourceId: source._id, alerts });

  if (alerts.length === 0) {
    logger.warn('External alert ingest: no alerts parsed from payload', {
      sourceId: source._id,
      platform: source.platform,
    });
    res.status(202).json({ accepted: true, processed: 0, detail: 'Payload parsed but no alerts found.' });
    return;
  }

  // Process asynchronously — don't make the external platform wait on full incident creation
  svc.ingestAlerts(source, alerts).then((result) => {
    logger.info('External alert ingest complete', {
      sourceId: source._id,
      platform: source.platform,
      ...result,
    });
  }).catch((err) => {
    logger.error('External alert ingest failed', { sourceId: source._id, error: err.message });
  });

  res.status(202).json({
    accepted: true,
    processed: alerts.length,
    source_id: source._id.toString(),
    source_name: source.name,
  });
}

// Token in URL path: POST /public/alerts/ingest/:token
router.post('/:token', handleIngest);

// Token in Authorization header or X-Api-Key: POST /public/alerts/ingest
router.post('/', handleIngest);

/**
 * GET /api/v1/public/alerts/ingest/:token/verify
 *
 * Quick connectivity test — lets the external platform verify the token
 * without sending a real alert.
 */
router.get('/:token/verify', async (req: Request, res: Response) => {
  const source = await svc.validateToken(extractToken(req));
  if (!source) {
    res.status(401).json({ ok: false, detail: 'Invalid or unknown integration token.' });
    return;
  }
  res.json({
    ok: true,
    source_id: source._id.toString(),
    source_name: source.name,
    platform: source.platform,
    auto_create_incident: source.auto_create_incident,
    auto_resolve: source.auto_resolve,
  });
});

export default router;
