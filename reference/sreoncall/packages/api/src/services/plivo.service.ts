/**
 * Plivo service — sends SMS, voice calls, and WhatsApp messages via Plivo REST API.
 *
 * Env vars:
 *   PLIVO_AUTH_ID
 *   PLIVO_AUTH_TOKEN
 *   PLIVO_SMS_NUMBER      — Plivo number for outbound SMS
 *   PLIVO_VOICE_NUMBER    — Plivo number for outbound voice calls
 *   PLIVO_WHATSAPP_NUMBER — WhatsApp Business-enabled Plivo number
 *   PLIVO_WEBHOOK_BASE_URL — Public base URL for Plivo webhooks (e.g. https://app.sreoncall.com)
 */

import { logger } from '../utils/logger';

const PLIVO_AUTH_ID = process.env.PLIVO_AUTH_ID || '';
const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN || '';
const PLIVO_SMS_NUMBER = process.env.PLIVO_SMS_NUMBER || '';
const PLIVO_VOICE_NUMBER = process.env.PLIVO_VOICE_NUMBER || '';
const PLIVO_WHATSAPP_NUMBER = process.env.PLIVO_WHATSAPP_NUMBER || '';
const PLIVO_WEBHOOK_BASE_URL = process.env.PLIVO_WEBHOOK_BASE_URL || '';

const BASE_URL = `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}`;

function authHeader(): string {
  return `Basic ${Buffer.from(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`).toString('base64')}`;
}

function isConfigured(): boolean {
  return !!(PLIVO_AUTH_ID && PLIVO_AUTH_TOKEN);
}

/**
 * Send an SMS via Plivo.
 * Returns the message UUID if successful, null otherwise.
 */
export async function sendSms(to: string, body: string): Promise<string | null> {
  if (!isConfigured() || !PLIVO_SMS_NUMBER) {
    logger.warn('SMS not configured — missing Plivo credentials or SMS number');
    return null;
  }

  try {
    const resp = await fetch(`${BASE_URL}/Message/`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src: PLIVO_SMS_NUMBER,
        dst: to.replace(/[^+\d]/g, ''),
        text: body.slice(0, 1600),
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Plivo HTTP ${resp.status}: ${errBody}`);
    }

    const data = (await resp.json()) as { message_uuid?: string[] };
    const uuid = data.message_uuid?.[0] || null;
    logger.info('SMS sent via Plivo', { to, uuid });
    return uuid;
  } catch (err: any) {
    logger.error('Failed to send SMS via Plivo', { to, error: err.message });
    return null;
  }
}

/**
 * Initiate an outbound voice call via Plivo.
 * The answer_url returns Plivo XML with TTS of the message and "press 1 to acknowledge".
 */
export async function makeVoiceCall(
  to: string,
  message: string,
  callbackData: { incidentId: string; tenantId: string; userId: string }
): Promise<string | null> {
  if (!isConfigured() || !PLIVO_VOICE_NUMBER) {
    logger.warn('Voice call not configured — missing Plivo credentials or voice number');
    return null;
  }

  if (!PLIVO_WEBHOOK_BASE_URL) {
    logger.warn('Voice call not configured — missing PLIVO_WEBHOOK_BASE_URL');
    return null;
  }

  const answerParams = new URLSearchParams({
    message,
    incidentId: callbackData.incidentId,
    tenantId: callbackData.tenantId,
    userId: callbackData.userId,
  });

  const answerUrl = `${PLIVO_WEBHOOK_BASE_URL}/api/v1/plivo/voice/answer?${answerParams.toString()}`;
  const statusUrl = `${PLIVO_WEBHOOK_BASE_URL}/api/v1/plivo/voice/status`;

  try {
    const resp = await fetch(`${BASE_URL}/Call/`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: PLIVO_VOICE_NUMBER,
        to: to.replace(/[^+\d]/g, ''),
        answer_url: answerUrl,
        answer_method: 'GET',
        hangup_url: statusUrl,
        hangup_method: 'POST',
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Plivo HTTP ${resp.status}: ${errBody}`);
    }

    const data = (await resp.json()) as { request_uuid?: string };
    logger.info('Voice call initiated via Plivo', { to, uuid: data.request_uuid });
    return data.request_uuid || null;
  } catch (err: any) {
    logger.error('Failed to initiate voice call via Plivo', { to, error: err.message });
    return null;
  }
}

/**
 * Send a WhatsApp message via Plivo.
 * Returns the message UUID if successful, null otherwise.
 */
export async function sendWhatsApp(to: string, body: string): Promise<string | null> {
  if (!isConfigured() || !PLIVO_WHATSAPP_NUMBER) {
    logger.warn('WhatsApp not configured — missing Plivo credentials or WhatsApp number');
    return null;
  }

  try {
    const resp = await fetch(`${BASE_URL}/Message/`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src: PLIVO_WHATSAPP_NUMBER,
        dst: to.replace(/[^+\d]/g, ''),
        text: body.slice(0, 4096),
        type: 'whatsapp',
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Plivo HTTP ${resp.status}: ${errBody}`);
    }

    const data = (await resp.json()) as { message_uuid?: string[] };
    const uuid = data.message_uuid?.[0] || null;
    logger.info('WhatsApp message sent via Plivo', { to, uuid });
    return uuid;
  } catch (err: any) {
    logger.error('Failed to send WhatsApp via Plivo', { to, error: err.message });
    return null;
  }
}
