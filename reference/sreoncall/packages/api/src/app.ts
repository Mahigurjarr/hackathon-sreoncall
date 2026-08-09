import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/requestId.middleware';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { rateLimitMiddleware } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/errorHandler.middleware';
import { metricsMiddleware, metricsEndpoint } from './middleware/metrics.middleware';
import { createPublicRouter, createAuthenticatedRouter } from './routes/index';
import { createBillingWebhookHandler } from './routes/billing.routes';
import commsWebhookRoutes from './routes/comms-webhooks.routes';
import plivoWebhookRoutes from './routes/plivo-webhooks.routes';
import recallWebhookRoutes from './routes/recall-webhooks.routes';
import scimRoutes from './routes/scim.routes';
import { scimAuthMiddleware } from './middleware/scim-auth.middleware';
import mcpRoutes from './routes/mcp.routes';
import { apiKeyAuthMiddleware } from './middleware/apiKeyAuth.middleware';
import { requirePlanFeature } from './middleware/planLimit.middleware';
import { isDatabaseConnected } from './config/database';
import { isOriginAllowed } from './utils/cors-allowlist';

export function createApp(): express.Application {
  const app = express();

  // Hide framework fingerprint (security: CWE-200)
  app.disable('x-powered-by');

  // Trust proxy for correct IP detection behind load balancer
  app.set('trust proxy', true);

  // Security headers. HSTS max-age is one year with `includeSubDomains`
  // AND `preload` so web.sreoncall.com qualifies for the Chromium HSTS
  // preload list (SRE-008 in security assessment 2026-04-22). Without
  // `preload` the first-ever visit still risks SSL stripping.
  app.use(
    helmet({
      strictTransportSecurity: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // CORS — explicit allowlist. Never reflect arbitrary origins with credentials.
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin / non-browser (curl, server-to-server): no Origin header — allow
        // without setting ACL-* headers (they have no effect here anyway).
        if (!origin) return callback(null, true);
        isOriginAllowed(origin)
          .then((allowed) => callback(null, allowed))
          .catch(() => callback(null, false));
      },
      credentials: true,
      maxAge: 86400,
    })
  );

  // Stripe webhook needs raw body — mount before JSON parsing
  app.post(
    '/api/v1/billing/webhook',
    express.raw({ type: 'application/json' }),
    createBillingWebhookHandler()
  );

  // Communication webhooks need raw body for signature verification
  app.use(
    '/api/v1/webhooks/slack',
    express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'] }),
    commsWebhookRoutes
  );
  app.use(
    '/api/v1/webhooks/teams',
    express.raw({ type: 'application/json' }),
    commsWebhookRoutes
  );

  // Plivo webhooks (voice answer/ack use query params, status/whatsapp use form/json body)
  app.use(
    '/api/v1/plivo',
    express.urlencoded({ extended: false }),
    express.json(),
    plivoWebhookRoutes
  );

  // Recall.ai notetaker webhooks need raw body for Svix signature verification.
  // Router defines /transcript (bot events) and /calendar (Calendar V2 sync).
  app.use(
    '/api/v1/webhooks/recall',
    express.raw({ type: '*/*' }),
    recallWebhookRoutes
  );

  // Body parsing
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Prometheus metrics collection (before routes, after security headers)
  app.use(metricsMiddleware);

  // Request ID on all routes
  app.use(requestIdMiddleware);

  // Prometheus metrics endpoint (unauthenticated, for scraping)
  app.get('/metrics', metricsEndpoint);

  // Public health check — returns an empty 200 so the endpoint is useful
  // for uptime monitors without confirming anything about internal state
  // (F-07 in security assessment 2026-04-17 + SRE-006 in assessment
  // 2026-04-22). For detailed health including DB connectivity, use
  // /health/detailed which is restricted by nginx to internal networks.
  app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  // Detailed health — intended for internal monitoring only. nginx should
  // restrict this path to loopback/internal networks (e.g.
  // `allow 127.0.0.1; allow 10.10.0.0/16; deny all;`).
  app.get('/health/detailed', (_req, res) => {
    const dbHealthy = isDatabaseConnected();
    const status = dbHealthy ? 200 : 503;
    res.status(status).json({
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealthy ? 'connected' : 'disconnected',
      },
    });
  });

  // Public routes (no tenant/auth middleware)
  app.use('/api/v1', createPublicRouter());

  // SCIM 2.0 routes (bearer token auth + plan gate: requires scim_enabled)
  app.use('/scim/v2', scimAuthMiddleware, requirePlanFeature('scim_enabled'), scimRoutes);

  // MCP server (bearer API-key auth + plan gate: requires mcp_enabled).
  // Deliberately outside tenantMiddleware/authMiddleware — there is no
  // session here, only a per-tenant API key. rateLimitMiddleware only needs
  // req.tenantId/req.tenant, both of which apiKeyAuthMiddleware sets — this
  // mount is otherwise never touched by the authenticated router chain
  // below, so without listing it explicitly here /mcp would have no
  // per-tenant rate limiting at all (the gateway's own limiter in front of
  // this is IP-based and not identity-aware).
  app.use(
    '/mcp',
    apiKeyAuthMiddleware,
    requirePlanFeature('mcp_enabled'),
    rateLimitMiddleware,
    mcpRoutes
  );

  // Authenticated routes (tenant + auth + rate limit)
  app.use(
    '/api/v1',
    tenantMiddleware,
    authMiddleware,
    rateLimitMiddleware,
    createAuthenticatedRouter()
  );

  // 404 handler — avoids echoing the requested path in production to reduce
  // information available to attackers during API enumeration (F-11 in
  // security assessment 2026-04-17).
  app.use((req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: isProd ? 'Not Found.' : `Route ${req.method} ${req.path} not found.`,
      instance: req.requestId,
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
