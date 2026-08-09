import { Router, Request, Response } from 'express';
import express from 'express';
import zlib from 'zlib';
import { logger } from '../utils/logger';
import { validateProviderDrainToken } from '../services/provider-drain-auth.service';
import { getDefaultLabels, mergeLabels, enrichLogLine } from '../services/observability-labels.service';

const router = Router();

// Vercel log drains support application/json (array) or application/x-ndjson (line-delimited).
// Accept both content types and fall back to text parsing for raw bodies.
router.use(
  express.raw({ type: ['application/json', 'application/x-ndjson', 'text/plain'], limit: '5mb' }),
);

/**
 * Vercel Log Drain Receiver
 *
 * Vercel sends logs via HTTP POST to a drain URL you configure in the dashboard
 * (Team Settings → Log Drains → Add). Payload format:
 *   - Content-Type: application/json      → JSON array of log events
 *   - Content-Type: application/x-ndjson  → one JSON object per line
 *
 * Drain URL format: POST /api/v1/webhooks/vercel/logs/:tenantId/:drainToken
 *
 * Event shape (simplified, see https://vercel.com/docs/observability/log-drains):
 *   {
 *     id, message, timestamp, type, source, projectId, projectName, deploymentId,
 *     host, level, requestId, statusCode, path, proxy: {...}
 *   }
 */

interface VercelLogEvent {
  id?: string;
  message?: string;
  timestamp?: number | string;
  type?: string;
  source?: string;
  projectId?: string;
  projectName?: string;
  deploymentId?: string;
  host?: string;
  level?: string;
  requestId?: string;
  statusCode?: number;
  path?: string;
  proxy?: Record<string, unknown>;
  [key: string]: unknown;
}

function parseVercelBody(body: string, contentType: string): VercelLogEvent[] {
  if (!body) return [];

  // NDJSON: one JSON object per line
  if (contentType.includes('x-ndjson')) {
    return body
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as VercelLogEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is VercelLogEvent => e !== null);
  }

  // Plain JSON — usually an array but support single object as well
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed as VercelLogEvent[];
    if (parsed && typeof parsed === 'object') return [parsed as VercelLogEvent];
  } catch {
    // Fallback: try NDJSON even without the header
    return body
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as VercelLogEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is VercelLogEvent => e !== null);
  }
  return [];
}

function decodeVercelBody(raw: Buffer, contentEncoding: string): string {
  if (!raw.length) return '';
  const encoding = contentEncoding.toLowerCase();
  if (!encoding || encoding === 'identity') return raw.toString('utf8');
  if (encoding.includes('gzip')) return zlib.gunzipSync(raw).toString('utf8');
  if (encoding.includes('deflate')) return zlib.inflateSync(raw).toString('utf8');
  return raw.toString('utf8');
}

// POST /api/v1/webhooks/vercel/logs/:tenantId/:drainToken[/:project]
// No auth middleware — the drain token in the URL is the secret. :project is
// optional; when present it pins the project label (handy when a single team
// has multiple projects and you prefer one drain per project).
async function handleVercelDrain(req: Request, res: Response) {
  const tenantId = String(req.params['tenantId'] || '');
  const drainToken = String(req.params['drainToken'] || '');
  const projectFromUrl = String(req.params['project'] || '').trim();
  const contentType = String(req.headers['content-type'] || '');
  const contentEncoding = String(req.headers['content-encoding'] || '');
  const rawBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === 'string'
      ? Buffer.from(req.body, 'utf8')
      : Buffer.from(JSON.stringify(req.body || ''), 'utf8');

  const isAuthorized = await validateProviderDrainToken(tenantId, 'vercel', drainToken);
  if (!isAuthorized) {
    logger.warn('Rejected Vercel drain with invalid token', { tenantId });
    res.status(404).send();
    return;
  }

  try {
    const raw = decodeVercelBody(rawBuffer, contentEncoding);
    const events = parseVercelBody(raw, contentType);
    if (events.length === 0) {
      logger.warn('Vercel drain delivered no parseable events', {
        tenantId,
        contentType,
        contentEncoding,
        bodyBytes: rawBuffer.length,
      });
      res.status(200).send('OK');
      return;
    }

    const LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';
    const customLabels = await getDefaultLabels(tenantId, 'vercel');
    const streams = events.map((evt) => {
      const tsMs =
        typeof evt.timestamp === 'number'
          ? evt.timestamp
          : typeof evt.timestamp === 'string'
            ? new Date(evt.timestamp).getTime()
            : Date.now();
      const tsNano = `${tsMs * 1_000_000}`;
      const line = evt.message ? String(evt.message) : JSON.stringify(evt);
      const project = projectFromUrl || evt.projectName || evt.projectId || 'unknown';
      const level =
        evt.level || (typeof evt.statusCode === 'number' && evt.statusCode >= 500 ? 'error' : 'info');

      return {
        stream: mergeLabels(
          {
            // Platform-enforced (unified cross-source schema)
            source: 'vercel',
            service_name: project,
            // Vercel-specific, bounded cardinality only
            project,
            host: evt.host || '',
            level,
            event_type: evt.type || 'stdout',
            tenant_id: tenantId,
            job: 'vercel',
          },
          customLabels,
        ),
        // High-cardinality context (deployment id, request id, path,
        // status code) goes into the line body, not stream labels.
        values: [[
          tsNano,
          enrichLogLine(line, {
            deployment_id: evt.deploymentId,
            request_id: evt.requestId,
            status_code: evt.statusCode,
            path: evt.path,
          }),
        ]],
      };
    });

    fetch(`${LOKI_URL}/loki/api/v1/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scope-OrgID': tenantId,
      },
      body: JSON.stringify({ streams }),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      logger.warn('Failed to push Vercel logs to Loki', { error: err.message, tenantId });
    });

    logger.debug('Vercel drain received', {
      tenantId,
      events: events.length,
      project: events[0]?.projectName || events[0]?.projectId,
      contentEncoding: contentEncoding || 'identity',
    });
  } catch (err: any) {
    logger.warn('Vercel drain parse error', {
      error: err.message,
      tenantId,
      contentType,
      contentEncoding,
      bodyBytes: rawBuffer.length,
    });
  }

  // Always return 200 — Vercel retries on non-2xx and will disable a drain after repeated failures.
  res.status(200).send('OK');
}

router.post('/:tenantId/:drainToken', handleVercelDrain);
router.post('/:tenantId/:drainToken/:project', handleVercelDrain);

export default router;
