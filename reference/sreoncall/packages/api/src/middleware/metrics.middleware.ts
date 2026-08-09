import { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';
import mongoose from 'mongoose';

// ---------- Registry & default metrics ----------

const register = new Registry();

register.setDefaultLabels({ app: 'sreoncall-api' });

collectDefaultMetrics({ register });

// ---------- HTTP metrics ----------

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'] as const,
  registers: [register],
});

export const httpActiveRequests = new Gauge({
  name: 'http_active_requests',
  help: 'Number of active HTTP requests being processed',
  registers: [register],
});

// ---------- MongoDB metrics ----------

export const mongoOperationDuration = new Histogram({
  name: 'mongodb_operation_duration_seconds',
  help: 'Duration of MongoDB operations in seconds',
  labelNames: ['operation', 'collection'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

export const mongoOperationTotal = new Counter({
  name: 'mongodb_operations_total',
  help: 'Total number of MongoDB operations',
  labelNames: ['operation', 'collection'] as const,
  registers: [register],
});

// ---------- NATS metrics ----------

export const natsMessageTotal = new Counter({
  name: 'nats_messages_total',
  help: 'Total number of NATS messages published or received',
  labelNames: ['stream', 'direction'] as const,
  registers: [register],
});

export const natsMessageErrors = new Counter({
  name: 'nats_message_errors_total',
  help: 'Total number of NATS message processing errors',
  labelNames: ['stream'] as const,
  registers: [register],
});

// ---------- MongoDB command monitoring ----------

// Track in-flight commands by requestId to measure duration
const pendingCommands = new Map<number, { startTime: bigint; operation: string; collection: string }>();

/**
 * Call this once after mongoose.connect() to attach command monitoring
 * to the underlying MongoDB driver connection.
 */
export function setupMongooseMonitoring(): void {
  const connection = mongoose.connection;

  // Listen on the underlying driver's client for command events
  const client = connection.getClient();

  client.on('commandStarted', (event) => {
    // event.commandName: find, insert, update, delete, aggregate, etc.
    // event.command: the full command document
    const collection =
      (event.command[event.commandName] as string) || 'unknown';

    pendingCommands.set(event.requestId, {
      startTime: process.hrtime.bigint(),
      operation: event.commandName,
      collection,
    });
  });

  client.on('commandSucceeded', (event) => {
    const pending = pendingCommands.get(event.requestId);
    if (!pending) return;
    pendingCommands.delete(event.requestId);

    const durationSec = Number(process.hrtime.bigint() - pending.startTime) / 1e9;
    mongoOperationDuration.observe(
      { operation: pending.operation, collection: pending.collection },
      durationSec
    );
    mongoOperationTotal.inc({ operation: pending.operation, collection: pending.collection });
  });

  client.on('commandFailed', (event) => {
    const pending = pendingCommands.get(event.requestId);
    if (!pending) return;
    pendingCommands.delete(event.requestId);

    const durationSec = Number(process.hrtime.bigint() - pending.startTime) / 1e9;
    mongoOperationDuration.observe(
      { operation: pending.operation, collection: pending.collection },
      durationSec
    );
    mongoOperationTotal.inc({ operation: pending.operation, collection: pending.collection });
  });
}

// ---------- Helper: extract Express route pattern ----------

function getRoutePattern(req: Request): string {
  // Express 5 stores the matched route on req.route
  if (req.route?.path) {
    // Reconstruct full path from baseUrl + route.path
    const base = req.baseUrl || '';
    const routePath = req.route.path === '/' ? '' : req.route.path;
    return `${base}${routePath}` || '/';
  }
  // Fallback: use the base path to avoid cardinality explosion
  // Strip dynamic segments (UUIDs, ObjectIds, numbers) from the raw URL
  return req.baseUrl || req.path.replace(/\/[0-9a-f]{24}/g, '/:id').replace(/\/\d+/g, '/:id');
}

// ---------- Express middleware ----------

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip the /metrics endpoint itself to avoid recursion in metrics
  if (req.path === '/metrics') {
    next();
    return;
  }

  httpActiveRequests.inc();
  const end = httpRequestDuration.startTimer();

  // Hook into response finish
  res.on('finish', () => {
    httpActiveRequests.dec();

    const route = getRoutePattern(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
      tenant_id: req.tenantId ? String(req.tenantId) : 'unknown',
    };

    end(labels);
    httpRequestTotal.inc(labels);
  });

  next();
}

// ---------- /metrics endpoint handler ----------

export const metricsEndpoint: RequestHandler = async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (err) {
    res.status(500).end(String(err));
  }
};

export { register };
