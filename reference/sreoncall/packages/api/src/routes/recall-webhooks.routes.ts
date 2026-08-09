import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { getConfig } from '../config/index';
import { NotetakerSession } from '../models/notetaker-session.model';
import { appendLiveSegment, enqueueRecallDone, enqueueCalendarSync } from '../services/notetaker.service';
import { parseRealtimeTranscript } from '../services/recall.service';
import { NotetakerStatus } from '../models/notetaker-session.model';

/**
 * Public webhook endpoint for Recall.ai. Mounted before auth (raw body) so we
 * can verify the Svix-style signature. Two kinds of events arrive here:
 *   - bot status changes (joining / in_call / done / fatal)
 *   - real-time transcript data (when realtime capture is enabled)
 */
const router = Router();

/**
 * Verify the Recall webhook signature. Recall uses Svix-style signing:
 * `svix-signature: v1,<base64>` over `${id}.${timestamp}.${body}` with the
 * webhook secret (base64, optionally `whsec_`-prefixed). When no secret is
 * configured we skip verification (dev only) and log a warning.
 */
function verifySignature(req: Request, rawBody: Buffer): boolean {
  const secret = getConfig().RECALL_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('RECALL_WEBHOOK_SECRET unset — skipping Recall webhook signature verification');
    return true;
  }

  const id = req.header('svix-id') || req.header('webhook-id') || '';
  const timestamp = req.header('svix-timestamp') || req.header('webhook-timestamp') || '';
  const sigHeader = req.header('svix-signature') || req.header('webhook-signature') || '';
  if (!id || !timestamp || !sigHeader) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  // Header may carry multiple space-delimited `v1,<sig>` pairs.
  return sigHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

// Map Recall bot status codes to our session status.
const STATUS_MAP: Record<string, NotetakerStatus> = {
  joining_call: 'joining',
  in_waiting_room: 'joining',
  in_call_not_recording: 'recording',
  in_call_recording: 'recording',
  recording_permission_allowed: 'recording',
  call_ended: 'processing',
  done: 'processing',
  fatal: 'failed',
};

router.post('/transcript', async (req: Request, res: Response) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

  if (!verifySignature(req, rawBody)) {
    logger.warn('Rejected Recall webhook: bad signature');
    res.status(401).json({ detail: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ detail: 'Invalid JSON' });
    return;
  }

  // Acknowledge fast — do the work without blocking Recall's delivery.
  res.status(200).json({ ok: true });

  try {
    const event: string = payload.event || payload.type || '';
    const botId: string | undefined =
      payload?.data?.bot?.id || payload?.data?.bot_id || payload?.bot_id || payload?.data?.id;
    if (!botId) return;

    const session = await NotetakerSession.findOne({ recall_bot_id: botId });
    if (!session) {
      logger.debug('Recall webhook for unknown bot', { botId, event });
      return;
    }

    // Real-time transcript chunk → store + fan out to the war room.
    if (event.startsWith('transcript.')) {
      const segments = parseRealtimeTranscript(payload);
      const isFinal = event === 'transcript.data';
      for (const seg of segments) {
        if (seg.text) await appendLiveSegment(session, seg, isFinal);
      }
      return;
    }

    // Bot status change.
    const statusCode: string =
      payload?.data?.status?.code || payload?.data?.code || payload?.status?.code || '';
    const mapped = STATUS_MAP[statusCode];
    if (mapped && session.status !== 'completed') {
      session.status = mapped;
      if (mapped === 'failed') session.error = payload?.data?.status?.message || 'Recall reported a fatal error';
      await session.save();
    }

    // Call finished → pull the finalized transcript and summarize.
    if (statusCode === 'done' || statusCode === 'call_ended' || event === 'bot.done') {
      await enqueueRecallDone(session._id.toString());
    }
  } catch (err: any) {
    logger.error('Failed to handle Recall webhook', { error: err.message });
  }
});

/**
 * Recall Calendar V2 account-level webhook: `calendar.sync_events` (events
 * changed) and `calendar.update`. We enqueue a sync job that lists the changed
 * events, matches INC-#### to incidents, and schedules bots for matches only.
 */
router.post('/calendar', async (req: Request, res: Response) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

  if (!verifySignature(req, rawBody)) {
    logger.warn('Rejected Recall calendar webhook: bad signature');
    res.status(401).json({ detail: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ detail: 'Invalid JSON' });
    return;
  }

  res.status(200).json({ ok: true });

  try {
    const event: string = payload.event || payload.type || '';
    const calendarId: string | undefined =
      payload?.data?.calendar_id || payload?.calendar_id || payload?.data?.calendar?.id;
    if (!calendarId) return;

    if (event === 'calendar.sync_events' || event === 'calendar.update') {
      const since: string | undefined = payload?.data?.last_updated_ts || undefined;
      await enqueueCalendarSync(calendarId, since);
    } else {
      logger.debug('Unhandled Recall calendar event', { event });
    }
  } catch (err: any) {
    logger.error('Failed to handle Recall calendar webhook', { error: err.message });
  }
});

export default router;
