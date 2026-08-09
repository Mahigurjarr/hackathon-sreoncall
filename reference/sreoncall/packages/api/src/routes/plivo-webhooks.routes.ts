/**
 * Plivo webhook routes — called by Plivo servers.
 * All routes are protected by Plivo signature validation (X-Plivo-Signature-V3).
 *
 * - GET  /voice/answer  — Returns Plivo XML with TTS + GetDigits for ack/escalate
 * - GET  /voice/ack     — Receives digit press: 1=acknowledge, 2=escalate
 * - POST /voice/status  — Logs call status (hangup, failed, etc.)
 * - POST /whatsapp/inbound — Logs inbound WhatsApp messages
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { acknowledgeIncident, escalateIncident } from '../services/incident.service';
import { Tenant } from '../models/tenant.model';
import { getConfig } from '../config/index';
import { logger } from '../utils/logger';

const router = Router();

// Query-param schemas. These webhooks are gated by Plivo signature
// verification (or Plivo IP allowlist) so the inputs are not directly
// end-user-controlled — but the values originate from URLs we constructed
// when initiating outbound calls, so defensive validation here closes any
// gap if those upstream construction sites ever stop sanitizing. Pinning
// ObjectId shape on tenantId/userId/incidentId also defends against XML
// injection via the values being reflected back into Plivo TTS XML.
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const voiceAnswerQuerySchema = z.object({
  message: z.string().max(500).optional(),
  incidentId: z.string().regex(objectIdRegex).optional(),
  tenantId: z.string().regex(objectIdRegex).optional(),
  userId: z.string().regex(objectIdRegex).optional(),
});

export const voiceAckQuerySchema = z.object({
  Digits: z.string().max(20).optional(),
  incidentId: z.string().regex(objectIdRegex).optional(),
  tenantId: z.string().regex(objectIdRegex).optional(),
  userId: z.string().regex(objectIdRegex).optional(),
});

const PLIVO_WEBHOOK_BASE_URL = process.env.PLIVO_WEBHOOK_BASE_URL || '';
const DEFAULT_GREETING = 'Hello. You have a notification from SRE on Call.';

/**
 * Verify Plivo webhook signature (V3).
 *
 * Plivo signs requests by computing HMAC-SHA256 over:
 *   base_url + nonce
 * using the auth token as the key.
 *
 * For GET requests the full URL (with query params) is the base_url.
 * For POST requests it's the URL + the sorted POST body params joined.
 */
function verifyPlivoSignature(req: Request): boolean {
  const config = getConfig();
  const authToken = config.PLIVO_AUTH_TOKEN;
  if (!authToken) {
    logger.error('PLIVO_AUTH_TOKEN not configured — rejecting webhook');
    return false;
  }

  const signature = req.headers['x-plivo-signature-v3'] as string;
  const nonce = req.headers['x-plivo-signature-v3-nonce'] as string;

  if (!signature || !nonce) {
    return false;
  }

  // Use PLIVO_WEBHOOK_BASE_URL to reconstruct the exact URL Plivo used to
  // compute its signature. Deriving from request headers fails when behind
  // a reverse proxy that rewrites Host / X-Forwarded-Host.
  const fullUrl = PLIVO_WEBHOOK_BASE_URL
    ? `${PLIVO_WEBHOOK_BASE_URL}${req.originalUrl}`
    : `${req.headers['x-forwarded-proto'] || req.protocol || 'https'}://${req.headers['x-forwarded-host'] || req.headers['host'] || ''}${req.originalUrl}`;

  // For POST, append sorted body params
  let baseString = fullUrl;
  if (req.method === 'POST' && req.body && typeof req.body === 'object') {
    const sortedParams = Object.keys(req.body)
      .sort()
      .map((k) => `${k}${req.body[k]}`)
      .join('');
    baseString += sortedParams;
  }

  baseString += `.${nonce}`;

  const expected = crypto
    .createHmac('sha256', authToken)
    .update(baseString)
    .digest('base64');

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Known Plivo IP ranges (from https://www.plivo.com/docs/sip-trunking/inbound/ip-addresses/)
 */
const PLIVO_IP_PREFIXES = ['3.7.', '52.9.', '52.66.', '13.126.', '13.235.', '15.206.'];

/**
 * Middleware: validate Plivo webhook requests.
 * Attempts signature validation first. If that fails, falls back to IP allowlist
 * to avoid dropping calls due to signature mismatches behind reverse proxies.
 */
function requirePlivoAuth(req: Request, res: Response, next: NextFunction): void {
  if (verifyPlivoSignature(req)) {
    next();
    return;
  }

  // Fallback: allow if request comes from a known Plivo IP
  const clientIp = req.ip || req.socket.remoteAddress || '';
  const isPlivo = PLIVO_IP_PREFIXES.some((prefix) => clientIp.includes(prefix));
  if (isPlivo) {
    logger.info('Plivo webhook accepted via IP allowlist', { path: req.path, ip: clientIp });
    next();
    return;
  }

  logger.warn('Plivo webhook rejected — signature invalid and IP not allowlisted', {
    path: req.path,
    ip: clientIp,
  });
  res.status(403).json({ error: 'Invalid Plivo signature' });
}

// Apply Plivo signature validation to all routes
router.use(requirePlivoAuth);

// GET /api/v1/plivo/voice/answer
// Plivo calls this when the recipient picks up. Returns XML with TTS + digit collection.
router.get('/voice/answer', async (req: Request, res: Response) => {
  const parsed = voiceAnswerQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    logger.warn('Plivo /voice/answer rejected — invalid query params', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    });
    res.status(400).set('Content-Type', 'application/xml').send(
      buildXmlDocument({
        tag: 'Response',
        children: [speakNode('Invalid request. Goodbye.')],
      }),
    );
    return;
  }
  const message = parsed.data.message || 'You have an alert.';
  const incidentId = parsed.data.incidentId || '';
  const tenantId = parsed.data.tenantId || '';
  const userId = parsed.data.userId || '';

  // Look up tenant greeting
  let greeting = DEFAULT_GREETING;
  if (tenantId) {
    try {
      const tenant = await Tenant.findById(tenantId).lean();
      if (tenant?.voice_call_settings?.greeting) {
        greeting = tenant.voice_call_settings.greeting;
      }
    } catch {
      // Use default
    }
  }

  const ackParams = new URLSearchParams({ incidentId, tenantId, userId });
  const ackUrl = PLIVO_WEBHOOK_BASE_URL + '/api/v1/plivo/voice/ack?' + ackParams.toString();

  const speakBody = greeting + ' ' + message + ' Press 1 to acknowledge. Press 2 to escalate.';
  const xml = buildXmlDocument({
    tag: 'Response',
    children: [
      {
        tag: 'GetDigits',
        attrs: {
          action: ackUrl,
          method: 'GET',
          timeout: '15',
          digitTimeout: '7',
          numDigits: '1',
          retries: '3',
          validDigits: '12',
        },
        children: [speakNode(speakBody)],
      },
      speakNode('No input received. The incident will be escalated automatically. Goodbye.'),
    ],
  });

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// GET /api/v1/plivo/voice/ack
// Plivo calls this when the user presses a digit during the call.
router.get('/voice/ack', async (req: Request, res: Response) => {
  const parsed = voiceAckQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    logger.warn('Plivo /voice/ack rejected — invalid query params', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    });
    res.status(400).set('Content-Type', 'application/xml').send(
      buildXmlDocument({
        tag: 'Response',
        children: [speakNode('Invalid input. Goodbye.')],
      }),
    );
    return;
  }
  const digits = parsed.data.Digits || '';
  const incidentId = parsed.data.incidentId || '';
  const tenantId = parsed.data.tenantId || '';
  const userId = parsed.data.userId || '';

  let responseMessage: string;

  if (digits === '1' && incidentId && tenantId && userId) {
    try {
      await acknowledgeIncident(
        new Types.ObjectId(tenantId),
        incidentId,
        new Types.ObjectId(userId)
      );
      responseMessage = 'Incident acknowledged. Thank you.';
      logger.info('Incident acknowledged via voice call', { incidentId, userId });
    } catch (err: any) {
      responseMessage = 'Unable to acknowledge incident. It may already be acknowledged.';
      logger.error('Failed to acknowledge incident via voice', {
        incidentId,
        userId,
        error: err.message,
      });
    }
  } else if (digits === '2' && incidentId && tenantId && userId) {
    try {
      await escalateIncident(
        new Types.ObjectId(tenantId),
        incidentId,
        new Types.ObjectId(userId),
        'Escalated via voice call'
      );
      responseMessage = 'Incident escalated to the next level. Thank you.';
      logger.info('Incident escalated via voice call', { incidentId, userId });
    } catch (err: any) {
      responseMessage = 'Unable to escalate incident.';
      logger.error('Failed to escalate incident via voice', {
        incidentId,
        userId,
        error: err.message,
      });
    }
  } else {
    responseMessage = 'Invalid input. Goodbye.';
  }

  const xml = buildXmlDocument({
    tag: 'Response',
    children: [speakNode(responseMessage)],
  });

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// POST /api/v1/plivo/voice/status
// Plivo sends call status updates (completed, busy, failed, no-answer, etc.)
router.post('/voice/status', (req: Request, res: Response) => {
  const { CallUUID, CallStatus, Duration, To } = req.body || {};
  logger.info('Plivo voice call status', { callUuid: CallUUID, status: CallStatus, duration: Duration, to: To });
  res.status(204).send();
});

// POST /api/v1/plivo/whatsapp/inbound
// Logs inbound WhatsApp messages (future: parse "ACK INC-xxx" commands)
router.post('/whatsapp/inbound', (req: Request, res: Response) => {
  const { From, Text, MessageUUID } = req.body || {};
  logger.info('Plivo inbound WhatsApp message', { from: From, text: Text, uuid: MessageUUID });
  // Future: parse "ACK INC-xxxx" and auto-acknowledge
  res.status(200).json({ status: 'received' });
});

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Tiny safe XML builder. Constructs Plivo TTS XML programmatically
// (no string templates that look like HTML), so attribute values and
// text content go through `escapeXml` exactly once, in one place. Any
// `${}` interpolation of user-controlled values into HTML-shaped string
// templates is intentionally avoided here.
export interface XmlNode {
  tag: string;
  attrs?: Record<string, string>;
  children?: Array<string | XmlNode>;
}

export function renderXml(node: XmlNode): string {
  const attrParts: string[] = [];
  if (node.attrs) {
    for (const [k, v] of Object.entries(node.attrs)) {
      attrParts.push(' ' + k + '="' + escapeXml(v) + '"');
    }
  }
  const children = node.children ?? [];
  const inner = children
    .map((c) => (typeof c === 'string' ? escapeXml(c) : renderXml(c)))
    .join('');
  return '<' + node.tag + attrParts.join('') + '>' + inner + '</' + node.tag + '>';
}

export function buildXmlDocument(root: XmlNode): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + renderXml(root);
}

function speakNode(text: string): XmlNode {
  return { tag: 'Speak', attrs: { voice: 'WOMAN', language: 'en-US' }, children: [text] };
}

export default router;
