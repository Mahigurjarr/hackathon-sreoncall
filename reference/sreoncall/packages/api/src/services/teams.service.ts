/**
 * Microsoft Teams messaging wrapper — uses Microsoft Graph API.
 * Uses raw fetch (no SDK dependency).
 */

import { logger } from '../utils/logger';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

// ─── App-only (client-credentials) token acquisition ───────────────────────

interface CachedGraphToken {
  token: string;
  expiresAt: number;
}

// Keyed by `${aadTenantId}:${clientId}` — each Communication Hub Teams
// channel may belong to a different consumer org's own Azure AD app.
const tokenCache = new Map<string, CachedGraphToken>();

/**
 * Acquire an app-only Microsoft Graph token via the client-credentials grant.
 * The consumer org registers its own Azure AD app (in their own tenant) and
 * grants it `ChannelMessage.Send` application permission with admin consent;
 * we never need delegated/per-user auth for posting channel messages.
 */
export async function getAppOnlyGraphToken(
  aadTenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${aadTenantId}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const res = await fetch(`https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

/**
 * Post a message to a Teams channel.
 * Requires a bot/application token with ChannelMessage.Send permission.
 */
export async function postMessage(
  token: string,
  teamId: string,
  channelId: string,
  text: string
): Promise<string | null> {
  try {
    const resp = await fetch(
      `${GRAPH_API}/teams/${teamId}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: { contentType: 'text', content: text },
        }),
      }
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Graph API HTTP ${resp.status}: ${errBody}`);
    }

    const data = await resp.json() as { id?: string };
    return data.id || null;
  } catch (err: any) {
    logger.error('Teams postMessage failed', { teamId, channelId, error: err.message });
    return null;
  }
}

/**
 * Send a direct message (chat) to a user.
 * Requires Chat.Create and ChatMessage.Send permissions.
 */
export async function sendDirectMessage(
  token: string,
  userPrincipalName: string,
  text: string
): Promise<string | null> {
  try {
    // Create or get one-on-one chat
    const chatResp = await fetch(`${GRAPH_API}/chats`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatType: 'oneOnOne',
        members: [
          {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            roles: ['owner'],
            'user@odata.bind': `${GRAPH_API}/users('${userPrincipalName}')`,
          },
        ],
      }),
    });

    if (!chatResp.ok) {
      const errBody = await chatResp.text();
      throw new Error(`Create chat failed: ${chatResp.status}: ${errBody}`);
    }

    const chat = await chatResp.json() as { id: string };

    // Send message in chat
    const msgResp = await fetch(`${GRAPH_API}/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: { contentType: 'text', content: text },
      }),
    });

    if (!msgResp.ok) {
      const errBody = await msgResp.text();
      throw new Error(`Send message failed: ${msgResp.status}: ${errBody}`);
    }

    const msg = await msgResp.json() as { id?: string };
    return msg.id || null;
  } catch (err: any) {
    logger.error('Teams sendDirectMessage failed', { user: userPrincipalName, error: err.message });
    return null;
  }
}
