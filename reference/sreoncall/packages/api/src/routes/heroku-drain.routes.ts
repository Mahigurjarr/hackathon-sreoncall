import { Router, Request, Response } from 'express';
import express from 'express';
import { logger } from '../utils/logger';
import { validateProviderDrainToken } from '../services/provider-drain-auth.service';
import { getJetStream } from '../config/nats';

const router = Router();

// Heroku sends logplex as application/logplex-1 or text/plain — parse as raw text
router.use(express.text({ type: ['application/logplex-1', 'text/plain', 'application/octet-stream'], limit: '1mb' }));

/**
 * Heroku Log Drain Receiver
 *
 * Heroku sends logs via HTTP POST in logplex/syslog format. The syslog
 * APP-NAME field is always literally "app" or "heroku" — it is NOT the
 * real Heroku app name. The real app identity must therefore come from
 * the drain URL; customers add one drain per Heroku app with the app
 * slug in the path:
 *
 *   POST /api/v1/webhooks/heroku/logs/:tenantId/:drainToken/:appName
 *
 * Validates the drain token and publishes the raw logplex body to NATS
 * JetStream (DRAIN stream) for async processing by heroku-drain.worker.ts.
 * Returns 200 immediately so Heroku does not retry.
 */

// POST /api/v1/webhooks/heroku/logs/:tenantId/:drainToken[/:appName]
async function handleHerokuDrain(req: Request, res: Response) {
  const tenantId = String(req.params['tenantId'] || '');
  const drainToken = String(req.params['drainToken'] || '');
  const appName = String(req.params['appName'] || '').trim() || 'unknown';

  const body = typeof req.body === 'string' ? req.body : req.body?.toString?.() || '';
  if (!body) {
    res.status(204).send();
    return;
  }

  const isAuthorized = await validateProviderDrainToken(tenantId, 'heroku', drainToken);
  if (!isAuthorized) {
    logger.warn('Rejected Heroku drain with invalid token', { tenantId });
    res.status(404).send();
    return;
  }

  try {
    const js = getJetStream();
    await js.publish(
      `drain.heroku.${tenantId}.${appName}`,
      new TextEncoder().encode(JSON.stringify({
        tenantId,
        appName,
        body,
        msgCount: req.headers['logplex-msg-count'],
        drainId: req.headers['logplex-drain-token'],
        frameId: req.headers['logplex-frame-id'],
      })),
    );
  } catch (err: any) {
    logger.error('Failed to publish Heroku drain to NATS', { error: err.message, tenantId });
    res.status(500).send();
    return;
  }

  // Always return 200 quickly — Heroku will retry on non-2xx
  res.status(200).send('OK');
}

// Legacy 2-segment URL (no app identity — kept for backward compat)
router.post('/:tenantId/:drainToken', handleHerokuDrain);
// New 3-segment URL with app slug — preferred
router.post('/:tenantId/:drainToken/:appName', handleHerokuDrain);

export default router;
