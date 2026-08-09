import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { getConfig } from '../config/index';
import { logger } from '../utils/logger';
import { encryptToken } from '../utils/encryption';
import { CalendarConnection, CalendarPlatform } from '../models/calendar-connection.model';
import { createCalendar, resolveCalendarOAuth } from '../services/recall-calendar.service';

/**
 * Developer-hosted OAuth for calendar auto-capture. We obtain a Google/Microsoft
 * refresh token, register the calendar with Recall (Calendar V2), and store a
 * CalendarConnection. Mounted under the PUBLIC router at `/oauth` (callbacks are
 * hit by the provider). The `/start` leg is authenticated via a signed JWT query
 * param, mirroring the Slack OAuth flow in oauth-comms.routes.ts.
 *
 * Credentials are resolved per-tenant (BYO app) with fallback to the platform's
 * global OAuth app — see resolveCalendarOAuth.
 */
const router = Router();

interface ProviderUrls {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  extraAuthParams: Record<string, string>;
}

function providerUrls(platform: CalendarPlatform, microsoftTenant: string): ProviderUrls {
  if (platform === 'google') {
    return {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events.readonly',
      // access_type=offline + prompt=consent are required to receive a refresh_token.
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    };
  }
  const t = microsoftTenant || 'common';
  return {
    authUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    scope: 'openid email offline_access https://graph.microsoft.com/Calendars.Read',
    extraAuthParams: {},
  };
}

function redirectUri(platform: CalendarPlatform): string {
  const cfg = getConfig();
  const base = cfg.APP_URL || cfg.INTERNAL_API_URL;
  return `${base}/api/v1/oauth/calendar/${platform}/callback`;
}

/** Decode a JWT (id_token) payload without verification — for the email claim only. */
function emailFromIdToken(idToken?: string): string {
  if (!idToken) return '';
  try {
    const payload = idToken.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return claims.email || claims.preferred_username || claims.upn || '';
  } catch {
    return '';
  }
}

function isValidPlatform(p: string): p is CalendarPlatform {
  return p === 'google' || p === 'microsoft';
}

// GET /oauth/calendar/:platform/start  (authenticated via signed JWT query param)
router.get('/calendar/:platform/start', async (req: Request, res: Response) => {
  const config = getConfig();
  const platform = req.params.platform as string;
  if (!isValidPlatform(platform)) {
    res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'Unknown calendar platform.' });
    return;
  }

  const tenantId = req.query.tenant_id as string;
  const token = req.query.token as string;
  if (!tenantId || !token) {
    res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'tenant_id and token query params are required.' });
    return;
  }

  let userId = '';
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    userId = decoded.sub || decoded.user_id || '';
  } catch {
    res.status(401).json({ type: 'https://sreoncall.io/problems/unauthorized', title: 'Unauthorized', status: 401, detail: 'Invalid or expired token.' });
    return;
  }

  const creds = await resolveCalendarOAuth(new Types.ObjectId(tenantId), platform);
  if (!creds) {
    res.status(501).json({ type: 'https://sreoncall.io/problems/not-configured', title: 'Not Configured', status: 501, detail: `${platform} calendar OAuth is not configured for this tenant.` });
    return;
  }

  const origin = (req.query.origin as string) || '';
  const state = jwt.sign({ tenant_id: tenantId, user_id: userId, origin, platform }, config.JWT_SECRET, { expiresIn: '10m' });

  const urls = providerUrls(platform, creds.microsoftTenant);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri(platform),
    response_type: 'code',
    scope: urls.scope,
    state,
    ...urls.extraAuthParams,
  });
  res.redirect(`${urls.authUrl}?${params.toString()}`);
});

// GET /oauth/calendar/:platform/callback  (public — provider redirects here)
router.get('/calendar/:platform/callback', async (req: Request, res: Response) => {
  const config = getConfig();
  const platform = req.params.platform as string;
  const { code, state } = req.query;
  if (!isValidPlatform(platform) || !code || !state) {
    res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'Missing code/state or unknown platform.' });
    return;
  }

  let statePayload: { tenant_id: string; user_id: string; origin?: string; platform: string };
  try {
    statePayload = jwt.verify(state as string, config.JWT_SECRET) as any;
  } catch {
    res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'Invalid or expired state token.' });
    return;
  }
  if (statePayload.platform !== platform) {
    res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'State/platform mismatch.' });
    return;
  }

  const base = statePayload.origin ? `https://${statePayload.origin}` : config.APP_URL || 'http://localhost:3000';
  const failRedirect = (reason: string) => res.redirect(`${base}/settings/calendar?calendar_error=${encodeURIComponent(reason)}`);

  try {
    const tenantOid = new Types.ObjectId(statePayload.tenant_id);
    const creds = await resolveCalendarOAuth(tenantOid, platform);
    if (!creds) return failRedirect('not_configured');

    const urls = providerUrls(platform, creds.microsoftTenant);
    const tokenRes = await fetch(urls.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: code as string,
        redirect_uri: redirectUri(platform),
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = (await tokenRes.json()) as any;
    if (!tokenRes.ok || !tokenData.refresh_token) {
      logger.error('Calendar OAuth token exchange failed', { platform, error: tokenData.error || tokenData.error_description, hasRefresh: !!tokenData.refresh_token });
      return failRedirect(tokenData.error || 'no_refresh_token');
    }

    const refreshToken: string = tokenData.refresh_token;
    const email = emailFromIdToken(tokenData.id_token);

    // Register the calendar with Recall (Calendar V2) using the resolved creds.
    const cal = await createCalendar({ platform, refreshToken, clientId: creds.clientId, clientSecret: creds.clientSecret });

    const userOid = new Types.ObjectId(statePayload.user_id || '000000000000000000000000');
    const conn = await CalendarConnection.findOneAndUpdate(
      { tenant_id: tenantOid, user_id: userOid, platform, email },
      {
        tenant_id: tenantOid,
        user_id: userOid,
        platform,
        email,
        recall_calendar_id: cal.id,
        status: 'connected',
        error: null,
        refresh_token_encrypted: encryptToken(refreshToken),
        created_by: userOid,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info('Calendar connected', { platform, tenantId: statePayload.tenant_id, calendarId: cal.id, perTenant: creds.perTenant, connId: conn?._id?.toString() });
    res.redirect(`${base}/settings/calendar?calendar_connected=${platform}`);
  } catch (err: any) {
    logger.error('Calendar OAuth callback error', { platform, error: err.message });
    return failRedirect('connect_failed');
  }
});

export default router;
