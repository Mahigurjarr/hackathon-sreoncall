/**
 * Slack Web API wrapper — outbound messaging only.
 * Uses raw fetch (no SDK dependency).
 */

import { logger } from '../utils/logger';

const SLACK_API = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  channel?: { id: string; name: string };
  user?: { id: string; profile?: { email?: string }; real_name?: string };
  ts?: string;
  view?: { id: string };
  [key: string]: any;
}

async function slackFetch(method: string, token: string, body: Record<string, any>): Promise<SlackResponse> {
  const resp = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Slack API HTTP ${resp.status}`);
  }

  const data = await resp.json() as SlackResponse;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}

/**
 * Post a message to a Slack channel.
 * Returns the message timestamp (ts) for threading/tracking.
 */
export async function postMessage(token: string, channelId: string, text: string): Promise<string | null> {
  try {
    const data = await slackFetch('chat.postMessage', token, { channel: channelId, text });
    return data.ts || null;
  } catch (err: any) {
    // Auto-join channel if bot is not a member, then retry
    if (err.message?.includes('not_in_channel')) {
      try {
        await slackFetch('conversations.join', token, { channel: channelId });
        const data = await slackFetch('chat.postMessage', token, { channel: channelId, text });
        return data.ts || null;
      } catch (joinErr: any) {
        logger.error('Slack postMessage failed after join attempt', { channelId, error: joinErr.message });
        return null;
      }
    }
    logger.error('Slack postMessage failed', { channelId, error: err.message });
    return null;
  }
}

/**
 * Create a new Slack channel. Returns channel ID if successful.
 */
export async function createChannel(token: string, name: string): Promise<{ id: string; name: string } | null> {
  try {
    // Slack channel names: lowercase, no spaces, max 80 chars
    const safeName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 80);
    const data = await slackFetch('conversations.create', token, { name: safeName });
    return data.channel ? { id: data.channel.id, name: data.channel.name } : null;
  } catch (err: any) {
    logger.error('Slack createChannel failed', { name, error: err.message });
    return null;
  }
}

/**
 * Look up a Slack user by email. Returns user ID if found.
 */
export async function lookupUserByEmail(token: string, email: string): Promise<string | null> {
  try {
    const data = await slackFetch('users.lookupByEmail', token, { email });
    return data.user?.id || null;
  } catch (err: any) {
    // users.lookupByEmail returns error if user not found — not a failure
    logger.debug('Slack user lookup failed', { email, error: err.message });
    return null;
  }
}

// ─── User info cache ───────────────────────────────────────────────────
const userNameCache = new Map<string, string>();

/**
 * Resolve a Slack user ID to a display name.
 * Uses an in-memory cache to avoid repeated API calls.
 */
export async function getUserInfo(token: string, userId: string): Promise<string> {
  const cached = userNameCache.get(userId);
  if (cached) return cached;

  const resp = await fetch(`${SLACK_API}/users.info?user=${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    throw new Error(`Slack API HTTP ${resp.status}`);
  }

  const data = await resp.json() as any;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  const profile = data.user?.profile;
  const displayName = profile?.display_name || data.user?.real_name || data.user?.name || userId;
  userNameCache.set(userId, displayName);
  return displayName;
}

// ─── Channel members cache (5min TTL) ──────────────────────────────────
const channelMembersCache = new Map<string, { data: { id: string; display_name: string }[]; expires: number }>();

/**
 * Get all members of a Slack channel with resolved display names.
 */
export async function getConversationMembers(
  token: string,
  channelId: string
): Promise<{ id: string; display_name: string }[]> {
  const cached = channelMembersCache.get(channelId);
  if (cached && cached.expires > Date.now()) return cached.data;

  // Fetch member IDs (paginated)
  const memberIds: string[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${SLACK_API}/conversations.members`);
    url.searchParams.set('channel', channelId);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);

    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json() as any;
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    memberIds.push(...(data.members || []));
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  // Resolve display names
  const members = await Promise.all(
    memberIds.map(async (id) => {
      try {
        const name = await getUserInfo(token, id);
        return { id, display_name: name };
      } catch {
        return { id, display_name: id };
      }
    })
  );

  channelMembersCache.set(channelId, { data: members, expires: Date.now() + 5 * 60 * 1000 });
  return members;
}

/**
 * Send a direct message to a user via their email.
 * Opens a DM conversation and posts the message.
 */
/**
 * Post a Block Kit message to a Slack channel.
 * Returns the message timestamp (ts) for threading/updating.
 */
export async function postBlockMessage(
  token: string,
  channelId: string,
  blocks: any[],
  text: string,
  attachments?: any[],
): Promise<string | null> {
  const body: Record<string, any> = { channel: channelId, blocks, text };
  if (attachments) body.attachments = attachments;

  try {
    const data = await slackFetch('chat.postMessage', token, body);
    return data.ts || null;
  } catch (err: any) {
    if (err.message?.includes('not_in_channel')) {
      try {
        await slackFetch('conversations.join', token, { channel: channelId });
        const data = await slackFetch('chat.postMessage', token, body);
        return data.ts || null;
      } catch (joinErr: any) {
        logger.error('Slack postBlockMessage failed after join attempt', { channelId, error: joinErr.message });
        return null;
      }
    }
    logger.error('Slack postBlockMessage failed', { channelId, error: err.message });
    return null;
  }
}

/**
 * Update an existing Slack message using chat.update.
 */
export async function updateMessage(
  token: string,
  channelId: string,
  ts: string,
  blocks: any[],
  text: string,
  attachments?: any[],
): Promise<void> {
  const body: Record<string, any> = { channel: channelId, ts, blocks, text };
  if (attachments) body.attachments = attachments;

  try {
    await slackFetch('chat.update', token, body);
  } catch (err: any) {
    logger.error('Slack updateMessage failed', { channelId, ts, error: err.message });
  }
}

export async function sendDirectMessage(token: string, userEmail: string, text: string): Promise<string | null> {
  const userId = await lookupUserByEmail(token, userEmail);
  if (!userId) {
    logger.warn('Cannot send Slack DM — user not found', { email: userEmail });
    return null;
  }

  try {
    // Open DM conversation
    const convData = await slackFetch('conversations.open', token, { users: userId });
    const dmChannelId = convData.channel?.id;
    if (!dmChannelId) {
      logger.error('Failed to open Slack DM conversation', { userId });
      return null;
    }

    // Post message
    const msgData = await slackFetch('chat.postMessage', token, { channel: dmChannelId, text });
    return msgData.ts || null;
  } catch (err: any) {
    logger.error('Slack sendDirectMessage failed', { email: userEmail, error: err.message });
    return null;
  }
}

// ─── Modal / View helpers ─────────────────────────────────────────────

/**
 * Open a modal view using a trigger_id from a shortcut/interaction.
 */
export async function openView(token: string, triggerId: string, view: Record<string, any>): Promise<string | null> {
  try {
    const data = await slackFetch('views.open', token, { trigger_id: triggerId, view });
    return data.view?.id || null;
  } catch (err: any) {
    logger.error('Slack openView failed', { error: err.message });
    return null;
  }
}

/**
 * Update an existing modal view.
 */
export async function updateView(token: string, viewId: string, view: Record<string, any>): Promise<void> {
  try {
    await slackFetch('views.update', token, { view_id: viewId, view });
  } catch (err: any) {
    logger.error('Slack updateView failed', { error: err.message });
  }
}

/**
 * Get a Slack user's email by their user ID.
 */
export async function getUserEmail(token: string, userId: string): Promise<string | null> {
  const resp = await fetch(`${SLACK_API}/users.info?user=${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json() as any;
  if (!data.ok) return null;
  return data.user?.profile?.email || null;
}
