import { Types } from 'mongoose';
import { getConfig } from '../config/index';
import { logger } from '../utils/logger';
import { recallFetch } from './recall.service';
import { decryptToken } from '../utils/encryption';
import { CalendarOAuthConfig } from '../models/calendar-oauth-config.model';

/**
 * Wrapper over Recall.ai's Calendar V2 API. We run the Google/Microsoft OAuth
 * ourselves and hand the refresh token to Recall, which then syncs the calendar
 * and dispatches bots to the events we explicitly schedule.
 *
 * NOTE: Calendar V2 lives under the `/api/v2` prefix (distinct from the bot API
 * at `/api/v1`). Confirm against a live calendar during Phase-2 verification and
 * adjust CAL if Recall returns 404s.
 */
const CAL = '/api/v2';

export type CalendarProvider = 'google' | 'microsoft';
export type RecallCalendarPlatform = 'google_calendar' | 'microsoft_outlook';

function platformToRecall(platform: CalendarProvider): RecallCalendarPlatform {
  return platform === 'google' ? 'google_calendar' : 'microsoft_outlook';
}

export interface ResolvedCalendarOAuth {
  clientId: string;
  clientSecret: string;
  microsoftTenant: string;
  /** true when these came from a per-tenant BYO config (vs the global app). */
  perTenant: boolean;
}

/**
 * Resolve the OAuth app credentials to use for a tenant + platform: a per-tenant
 * "bring your own" config takes precedence; otherwise the platform-owned global
 * env app. Returns null when neither is configured.
 */
export async function resolveCalendarOAuth(
  tenantId: Types.ObjectId,
  platform: CalendarProvider,
): Promise<ResolvedCalendarOAuth | null> {
  const cfg = await CalendarOAuthConfig.findOne({ tenant_id: tenantId, platform, is_active: true }).lean();
  if (cfg?.client_id && cfg?.client_secret_encrypted) {
    try {
      return {
        clientId: cfg.client_id,
        clientSecret: decryptToken(cfg.client_secret_encrypted),
        microsoftTenant: cfg.microsoft_tenant || 'common',
        perTenant: true,
      };
    } catch (err: any) {
      logger.error('Failed to decrypt per-tenant calendar OAuth secret; falling back to global', { error: err.message });
    }
  }
  const g = getConfig();
  if (platform === 'google' && g.GOOGLE_CALENDAR_CLIENT_ID && g.GOOGLE_CALENDAR_CLIENT_SECRET) {
    return { clientId: g.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: g.GOOGLE_CALENDAR_CLIENT_SECRET, microsoftTenant: 'common', perTenant: false };
  }
  if (platform === 'microsoft' && g.MICROSOFT_CALENDAR_CLIENT_ID && g.MICROSOFT_CALENDAR_CLIENT_SECRET) {
    return { clientId: g.MICROSOFT_CALENDAR_CLIENT_ID, clientSecret: g.MICROSOFT_CALENDAR_CLIENT_SECRET, microsoftTenant: g.MICROSOFT_CALENDAR_TENANT || 'common', perTenant: false };
  }
  return null;
}

/**
 * Register a user's calendar with Recall using an OAuth refresh token and the
 * resolved OAuth app credentials (per-tenant or global).
 */
export async function createCalendar(input: {
  platform: CalendarProvider;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ id: string; raw: any }> {
  if (!input.clientId || !input.clientSecret) {
    throw new Error(`Calendar OAuth for ${input.platform} is not configured.`);
  }
  const body = {
    platform: platformToRecall(input.platform),
    oauth_client_id: input.clientId,
    oauth_client_secret: input.clientSecret,
    oauth_refresh_token: input.refreshToken,
  };
  const data = await recallFetch(`${CAL}/calendars/`, { method: 'POST', body: JSON.stringify(body) });
  logger.info('Recall calendar registered', { platform: input.platform, calendarId: data.id });
  return { id: data.id, raw: data };
}

export async function deleteCalendar(calendarId: string): Promise<void> {
  await recallFetch(`${CAL}/calendars/${calendarId}/`, { method: 'DELETE' });
  logger.info('Recall calendar deleted', { calendarId });
}

export interface RecallCalendarEvent {
  id: string;
  title?: string;
  meeting_url?: string | null;
  start_time?: string;
  end_time?: string;
  raw: any;
}

/**
 * List events for a calendar, optionally only those updated since `updatedAfter`
 * (ISO 8601 — from the calendar.sync_events webhook's last_updated_ts).
 */
export async function listEvents(calendarId: string, updatedAfter?: string): Promise<RecallCalendarEvent[]> {
  const params = new URLSearchParams({ calendar_id: calendarId });
  if (updatedAfter) params.set('updated_at__gte', updatedAfter);
  const data = await recallFetch(`${CAL}/calendar_events/?${params.toString()}`);
  const items: any[] = data?.results || (Array.isArray(data) ? data : []);
  return items.map((e) => ({
    id: e.id,
    title: e.raw?.summary || e.title || e.raw?.subject || '',
    meeting_url: e.meeting_url || e.meeting_platform_url || null,
    start_time: e.start_time,
    end_time: e.end_time,
    raw: e,
  }));
}

/**
 * Schedule a bot for a specific calendar event. `botConfig` is passed through to
 * Recall (bot_name, recording_config, realtime webhook, etc.). Calling again
 * overrides the previously scheduled bot for the event.
 */
export async function scheduleBotForEvent(eventId: string, botConfig: Record<string, unknown>): Promise<{ bot_id: string | null; raw: any }> {
  const data = await recallFetch(`${CAL}/calendar_events/${eventId}/bot/`, {
    method: 'POST',
    body: JSON.stringify(botConfig),
  });
  // Recall returns the scheduled bot(s) for the event.
  const botId = data?.bot_id || data?.bots?.[0]?.bot_id || data?.id || null;
  logger.info('Recall bot scheduled for calendar event', { eventId, botId });
  return { bot_id: botId, raw: data };
}

export async function removeBotFromEvent(eventId: string): Promise<void> {
  await recallFetch(`${CAL}/calendar_events/${eventId}/bot/`, { method: 'DELETE' });
  logger.info('Recall bot removed from calendar event', { eventId });
}
