import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/index';
import * as installationService from '../services/slack-installation.service';
import { logger } from '../utils/logger';

const router = Router();

// GET /oauth/slack/start (authenticated — session required via query param)
router.get('/slack/start', async (req: Request, res: Response) => {
  const config = getConfig();
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
    res.status(501).json({
      type: 'https://sreoncall.io/problems/not-configured',
      title: 'Not Configured',
      status: 501,
      detail: 'Slack OAuth is not configured on this server.',
    });
    return;
  }

  const tenantId = req.query.tenant_id as string;
  const token = req.query.token as string;
  if (!tenantId || !token) {
    res.status(400).json({
      type: 'https://sreoncall.io/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'tenant_id and token query params are required.',
    });
    return;
  }

  // Verify the JWT token to ensure this is an authenticated request
  try {
    jwt.verify(token, config.JWT_SECRET);
  } catch {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid or expired token.',
    });
    return;
  }

  // Capture the originating host so the callback redirects to the correct tenant subdomain
  const originHost = req.query.origin as string | undefined;

  // Create state JWT with tenant context
  const state = jwt.sign({ tenant_id: tenantId, origin: originHost || '' }, config.JWT_SECRET, { expiresIn: '10m' });

  const redirectUri = `${config.APP_URL || config.INTERNAL_API_URL}/api/v1/oauth/slack/callback`;
  const scopes = 'channels:read,channels:history,channels:join,channels:manage,chat:write,chat:write.public,groups:read,groups:history,im:read,im:history,users:read';

  const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${config.SLACK_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  res.redirect(slackUrl);
});

// GET /oauth/slack/callback (public — Slack redirects here)
router.get('/slack/callback', async (req: Request, res: Response) => {
  const config = getConfig();
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).json({
      type: 'https://sreoncall.io/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Missing code or state parameter.',
    });
    return;
  }

  // Verify state JWT
  let statePayload: { tenant_id: string; origin?: string };
  try {
    statePayload = jwt.verify(state as string, config.JWT_SECRET) as { tenant_id: string };
  } catch {
    res.status(400).json({
      type: 'https://sreoncall.io/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid or expired state token.',
    });
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.SLACK_CLIENT_ID!,
        client_secret: config.SLACK_CLIENT_SECRET!,
        code: code as string,
        redirect_uri: `${config.APP_URL || config.INTERNAL_API_URL}/api/v1/oauth/slack/callback`,
      }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenData.ok) {
      logger.error('Slack OAuth token exchange failed', { error: tokenData.error });
      res.status(400).json({
        type: 'https://sreoncall.io/problems/oauth-failed',
        title: 'OAuth Failed',
        status: 400,
        detail: `Slack OAuth error: ${tokenData.error}`,
      });
      return;
    }

    const accessToken = tokenData.access_token;
    const teamName = tokenData.team?.name || 'Slack Workspace';
    const teamId = tokenData.team?.id || 'unknown';
    const botUserId = tokenData.bot_user_id || '';
    const scopes = tokenData.scope || '';

    // Create or update SlackInstallation (not a channel — consumer picks channels next)
    const installation = await installationService.createInstallation({
      consumer_tenant_id: statePayload.tenant_id,
      team_id: teamId,
      team_name: teamName,
      bot_token: accessToken,
      bot_user_id: botUserId,
      scopes,
    });

    // Redirect to channel picker page on the originating tenant subdomain
    const baseUrl = statePayload.origin
      ? `https://${statePayload.origin}`
      : config.APP_URL || 'http://localhost:3000';
    const settingsUrl = `${baseUrl}/settings/communication-channels?slack_installation=${installation._id.toString()}&workspace=${encodeURIComponent(teamName)}`;
    res.redirect(settingsUrl);
  } catch (err: any) {
    logger.error('Slack OAuth callback error', { error: err.message });
    res.status(500).json({
      type: 'https://sreoncall.io/problems/internal-error',
      title: 'Internal Error',
      status: 500,
      detail: 'Failed to complete Slack OAuth flow.',
    });
  }
});

export default router;
