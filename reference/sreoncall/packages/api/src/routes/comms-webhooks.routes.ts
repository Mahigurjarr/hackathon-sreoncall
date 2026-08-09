import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { getJetStream } from '../config/nats';
import { getConfig } from '../config/index';
import * as incidentService from '../services/incident.service';
import * as slackAlertIngestionService from '../services/slack-alert-ingestion.service';
import * as slackInteractions from '../services/slack-interactions.service';
import { logger } from '../utils/logger';
import { StringCodec } from 'nats';

const router = Router();
const sc = StringCodec();

function verifySlackSignature(rawBody: Buffer, timestamp: string, signature: string, signingSecret: string): boolean {
  const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `v0=${hmac}`;

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify Teams webhook HMAC signature.
 * Computes HMAC-SHA256 over the raw request body using the shared secret.
 */
function verifyTeamsSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// POST /webhooks/slack/events
router.post('/events', async (req: Request, res: Response) => {
  const config = getConfig();
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  let payload: any;

  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Slack URL verification challenge (must respond before signature check)
  if (payload.type === 'url_verification') {
    res.json({ challenge: payload.challenge });
    return;
  }

  // Verify Slack signature — fail-closed: reject if secret not configured or headers missing
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    res.status(401).json({ error: 'Missing signature headers' });
    return;
  }

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    res.status(401).json({ error: 'Request too old' });
    return;
  }

  if (!config.SLACK_SIGNING_SECRET) {
    logger.error('SLACK_SIGNING_SECRET not configured — rejecting webhook');
    res.status(500).json({ error: 'Webhook signature verification not configured' });
    return;
  }

  const valid = verifySlackSignature(rawBody, timestamp, signature, config.SLACK_SIGNING_SECRET);
  if (!valid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Handle event callbacks
  if (payload.type === 'event_callback') {
    const event = payload.event;

    if (event?.type === 'message' && event.channel) {
      try {
        await slackAlertIngestionService.ingestSlackAlertMessage(payload);
      } catch (err: any) {
        logger.error('Slack alert ingestion failed', {
          error: err.message,
          teamId: payload.team_id,
          channelId: event.channel,
          messageTs: event.ts,
        });
      }
    }

    // Filter out bot messages and bot edits to avoid loops
    if (event?.bot_id || event?.subtype === 'bot_message' || event?.subtype === 'message_changed' || event?.message?.bot_id) {
      res.json({ ok: true });
      return;
    }

    if (event?.type === 'message' && event.channel) {
      try {
        const js = getJetStream();
        await js.publish(
          'comms.inbound',
          sc.encode(JSON.stringify({
            platform: 'slack',
            external_channel_id: event.channel,
            external_thread_id: event.thread_ts || event.ts,
            external_message_id: event.ts,
            sender_user_id: event.user,
            sender_display_name: event.user || 'Unknown',
            body: event.text || '',
            team_id: payload.team_id,
            timestamp: event.ts,
          }))
        );
      } catch (err: any) {
        logger.error('Failed to publish inbound Slack message', { error: err.message });
      }
    }
  }

  // Always respond 200 quickly to Slack
  res.json({ ok: true });
});

// POST /webhooks/slack/interactions (buttons, shortcuts, modal submissions)
router.post('/interactions', async (req: Request, res: Response) => {
  const config = getConfig();
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  let payload: any;
  try {
    const bodyStr = rawBody.toString('utf8');
    if (bodyStr.startsWith('payload=')) {
      payload = JSON.parse(decodeURIComponent(bodyStr.slice(8)));
    } else {
      payload = JSON.parse(bodyStr);
    }
  } catch {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  // Verify Slack signature — fail-closed: always required
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    res.status(401).json({ error: 'Missing signature headers' });
    return;
  }

  const interactionNow = Math.floor(Date.now() / 1000);
  if (Math.abs(interactionNow - parseInt(timestamp, 10)) > 300) {
    res.status(401).json({ error: 'Request too old' });
    return;
  }

  if (!config.SLACK_SIGNING_SECRET) {
    logger.error('SLACK_SIGNING_SECRET not configured — rejecting interaction webhook');
    res.status(500).json({ error: 'Webhook signature verification not configured' });
    return;
  }

  const interactionValid = verifySlackSignature(rawBody, timestamp, signature, config.SLACK_SIGNING_SECRET);
  if (!interactionValid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // view_submission needs a synchronous response (for validation errors)
  if (payload.type === 'view_submission') {
    try {
      const result = await slackInteractions.handleViewSubmission(payload);
      if (result) {
        res.json(result);
      } else {
        res.json({ response_action: 'clear' });
      }
    } catch (err: any) {
      logger.error('Slack view_submission failed', { error: err.message });
      res.json({ response_action: 'clear' });
    }
    return;
  }

  if (
    payload.type === 'block_actions' &&
    Array.isArray(payload.actions) &&
    payload.actions.some((a: any) => a.action_id === 'incident_create_from_alert')
  ) {
    try {
      await slackInteractions.handleBlockAction(payload);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Slack block action failed', { error: err.message });
      res.json({ ok: true });
    }
    return;
  }

  // All other types: respond immediately, process async
  res.json({ ok: true });

  try {
    switch (payload.type) {
      // Button clicks on incident messages
      case 'block_actions': {
        if (!payload.actions?.length) break;
        // AI Notetaker Accept/Dismiss buttons → dedicated handler (resolves the
        // Slack user, applies accept/dismiss, and updates the message in place).
        if (payload.actions.some((a: any) => a.action_id === 'notetaker_suggestion_accept' || a.action_id === 'notetaker_suggestion_dismiss')) {
          await slackInteractions.handleNotetakerSuggestionAction(payload);
          break;
        }
        for (const action of payload.actions) {
          try {
            const actionData = JSON.parse(action.value || '{}');
            const { incident_id, tenant_id } = actionData;
            if (!incident_id || !tenant_id) continue;

            const tenantOid = new Types.ObjectId(tenant_id);
            const systemActorId = new Types.ObjectId('000000000000000000000000');

            switch (action.action_id) {
              case 'incident_acknowledge':
                await incidentService.acknowledgeIncident(tenantOid, incident_id, systemActorId);
                logger.info('Incident acknowledged via Slack', { incident_id });
                break;
              case 'incident_resolve':
                await incidentService.resolveIncident(tenantOid, incident_id, systemActorId, 'Resolved via Slack');
                logger.info('Incident resolved via Slack', { incident_id });
                break;
              case 'incident_escalate':
                await incidentService.escalateIncident(tenantOid, incident_id, systemActorId, 'Escalated via Slack');
                logger.info('Incident escalated via Slack', { incident_id });
                break;
            }
          } catch (err: any) {
            logger.error('Slack button action failed', { action_id: action.action_id, error: err.message });
          }
        }
        break;
      }

      // Global shortcuts (lightning bolt menu)
      case 'shortcut':
        await slackInteractions.handleGlobalShortcut(payload);
        break;

      // Message shortcuts (right-click context menu)
      case 'message_action':
        await slackInteractions.handleMessageShortcut(payload);
        break;

      default:
        logger.debug('Unhandled Slack interaction type', { type: payload.type });
    }
  } catch (err: any) {
    logger.error('Slack interaction handler failed', { type: payload.type, error: err.message });
  }
});

// POST /webhooks/teams/messages
router.post('/messages', async (req: Request, res: Response) => {
  const config = getConfig();
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  // Verify Teams webhook signature — fail-closed
  const teamsSignature = req.headers['x-teams-signature'] as string;

  if (!config.TEAMS_WEBHOOK_SECRET) {
    logger.error('TEAMS_WEBHOOK_SECRET not configured — rejecting webhook');
    res.status(500).json({ error: 'Webhook signature verification not configured' });
    return;
  }

  if (!teamsSignature) {
    logger.warn('Teams webhook missing signature header', { ip: req.ip });
    res.status(401).json({ error: 'Missing signature header' });
    return;
  }

  if (!verifyTeamsSignature(rawBody, teamsSignature, config.TEAMS_WEBHOOK_SECRET)) {
    logger.warn('Teams webhook signature validation failed', { ip: req.ip });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Filter out bot messages
  if (payload.from?.role === 'bot') {
    res.status(200).json({ ok: true });
    return;
  }

  if (payload.type === 'message' && payload.text) {
    try {
      const js = getJetStream();
      await js.publish(
        'comms.inbound',
        sc.encode(JSON.stringify({
          platform: 'teams',
          external_channel_id: payload.channelId || payload.conversation?.id,
          external_thread_id: payload.replyToId || payload.id,
          external_message_id: payload.id,
          sender_user_id: payload.from?.id,
          sender_display_name: payload.from?.name || 'Unknown',
          body: payload.text || '',
          timestamp: payload.timestamp,
        }))
      );
    } catch (err: any) {
      logger.error('Failed to publish inbound Teams message', { error: err.message });
    }
  }

  res.status(200).json({ ok: true });
});

// POST /webhooks/slack/ingest
// Direct bearer-token Slack ingest has been retired.
// Incident auto-creation should now happen through Slack Events on linked channels.
router.post('/ingest', async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Direct Slack ingest has been removed. Link the Slack channel in SREonCall and use Slack Events API message delivery to auto-create incidents.',
  });
});

export default router;
