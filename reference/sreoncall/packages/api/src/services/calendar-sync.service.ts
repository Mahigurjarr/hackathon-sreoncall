import { getConfig } from '../config/index';
import { logger } from '../utils/logger';
import { CalendarConnection } from '../models/calendar-connection.model';
import { Incident } from '../models/incident.model';
import { NotetakerSession, NotetakerPlatform } from '../models/notetaker-session.model';
import { listEvents, scheduleBotForEvent } from './recall-calendar.service';
import { assertNotetakerMinutesAvailable } from './notetaker.service';

/** Parse an incident number from an event title, e.g. "INC-0670 bridge" → 670. */
export function parseIncidentNumber(title?: string): number | null {
  if (!title) return null;
  const m = title.match(/INC[-\s]?0*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function inferPlatform(url?: string | null): NotetakerPlatform {
  const u = (url || '').toLowerCase();
  if (u.includes('meet.google')) return 'meet';
  if (u.includes('teams.microsoft') || u.includes('teams.live')) return 'teams';
  if (u.includes('slack.com')) return 'slack_huddle';
  return 'zoom';
}

/**
 * React to a Recall `calendar.sync_events` webhook: list the calendar's changed
 * events, match each to an incident by `INC-####` in the title, and — only for
 * matches on active incidents (and within the tenant's notetaker minutes) —
 * create a session and schedule a Recall bot. Unmatched events get no bot.
 */
export async function syncCalendarEvents(calendarId: string, since?: string): Promise<void> {
  const conn = await CalendarConnection.findOne({ recall_calendar_id: calendarId, status: 'connected' });
  if (!conn) {
    logger.debug('calendar_sync: no active connection for calendar', { calendarId });
    return;
  }

  let events;
  try {
    events = await listEvents(calendarId, since);
  } catch (err: any) {
    logger.error('calendar_sync: listEvents failed', { calendarId, error: err.message });
    return;
  }

  const base = getConfig().NOTETAKER_PUBLIC_BASE_URL;
  const webhookUrl = base ? `${base.replace(/\/$/, '')}/api/v1/webhooks/recall/transcript` : undefined;

  for (const ev of events) {
    const num = parseIncidentNumber(ev.title);
    if (!num) continue; // not incident-linked → never record
    if (!ev.meeting_url) continue; // no join link

    const incident = await Incident.findOne({ tenant_id: conn.tenant_id, number: num });
    if (!incident) continue;
    if (['resolved', 'closed'].includes(incident.status)) continue;

    // Dedupe: one session per calendar event.
    const existing = await NotetakerSession.findOne({ tenant_id: conn.tenant_id, calendar_event_id: ev.id });
    if (existing) continue;

    // Respect the tenant's monthly notetaker minutes.
    try {
      await assertNotetakerMinutesAvailable(conn.tenant_id);
    } catch {
      logger.warn('calendar_sync: notetaker minutes exhausted — skipping', { tenantId: conn.tenant_id.toString(), incident: num });
      continue;
    }

    const session = await NotetakerSession.create({
      tenant_id: conn.tenant_id,
      created_by: conn.user_id,
      title: ev.title || `INC-${String(num).padStart(4, '0')}`,
      source: 'recall_bot',
      platform: inferPlatform(ev.meeting_url),
      channel_id: incident.war_room_channel_id,
      incident_id: incident._id,
      meeting_url: ev.meeting_url,
      status: 'scheduled',
      stt_provider: getConfig().STT_PROVIDER,
      recall_calendar_id: calendarId,
      calendar_event_id: ev.id,
    });

    // Schedule the bot for this specific event. bot_config mirrors createBot so
    // the scheduled bot transcribes + streams to our webhook like a manual one.
    const botConfig: Record<string, unknown> = {
      deduplication_key: session._id.toString(),
      bot_config: {
        bot_name: 'SREonCall Notetaker',
        recording_config: {
          transcript: { provider: { meeting_captions: {} } },
          ...(webhookUrl
            ? { realtime_endpoints: [{ type: 'webhook', url: webhookUrl, events: ['transcript.data', 'transcript.partial_data'] }] }
            : {}),
        },
      },
    };

    try {
      const r = await scheduleBotForEvent(ev.id, botConfig);
      if (r.bot_id) {
        session.recall_bot_id = r.bot_id;
        session.status = 'joining';
        await session.save();
      }
      logger.info('calendar_sync: scheduled notetaker bot', { incident: num, eventId: ev.id, sessionId: session._id.toString(), botId: r.bot_id });
    } catch (err: any) {
      session.status = 'failed';
      session.error = String(err.message).slice(0, 1000);
      await session.save();
      logger.error('calendar_sync: scheduleBotForEvent failed', { eventId: ev.id, error: err.message });
    }
  }

  conn.last_synced_at = new Date();
  await conn.save();
}
