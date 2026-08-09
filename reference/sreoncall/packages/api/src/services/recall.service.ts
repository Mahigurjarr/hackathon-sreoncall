import { getConfig } from '../config/index';
import { logger } from '../utils/logger';
import { ProviderSegment, segmentsToText } from './notetaker/stt/types';

/**
 * Thin wrapper over the Recall.ai bot API. Recall sends a bot into a Zoom /
 * Google Meet / Teams / Slack Huddle call, records it, and (optionally) streams
 * real-time transcription to our webhook. We use it for the online-meeting
 * capture path; offline uploads never touch this.
 *
 * Region selects the data-residency endpoint (us-east-1 / us-west-2 /
 * eu-central-1). All calls are no-ops with a clear error when RECALL_API_KEY is
 * unset so the meeting-bot path degrades gracefully.
 */

export function isRecallConfigured(): boolean {
  return !!process.env.RECALL_API_KEY;
}

function baseUrl(): string {
  const region = getConfig().RECALL_API_REGION || 'us-east-1';
  return `https://${region}.recall.ai`;
}

export async function recallFetch(path: string, init: RequestInit = {}): Promise<any> {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) throw new Error('RECALL_API_KEY not set — Recall.ai meeting bot unavailable');

  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Recall API ${res.status} on ${path}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

export interface CreateBotInput {
  meeting_url: string;
  bot_name?: string;
  /** Our webhook for status + (optionally) real-time transcript events. */
  webhook_url?: string;
  /** Request real-time transcription streamed to the webhook. */
  realtime?: boolean;
}

export interface RecallBot {
  id: string;
  status?: string;
  raw: any;
}

interface RecallTranscriptWord {
  text?: string;
  start_timestamp?: { relative?: number | null };
  end_timestamp?: { relative?: number | null };
}

interface RecallTranscriptEntry {
  participant?: { name?: string | null };
  speaker?: string;
  text?: string;
  start_timestamp?: { relative?: number | null };
  end_timestamp?: { relative?: number | null };
  words?: RecallTranscriptWord[];
}

export async function createBot(input: CreateBotInput): Promise<RecallBot> {
  const body: any = {
    meeting_url: input.meeting_url,
    bot_name: input.bot_name || 'SREonCall Notetaker',
    // Provider-side transcription so we always get a final transcript even when
    // real-time is off. meeting_captions uses the platform's own captions.
    recording_config: {
      transcript: { provider: { meeting_captions: {} } },
    },
    // Ask Recall to leave shortly after it detects that everyone else has
    // left the meeting so sessions do not stay open indefinitely.
    automatic_leave: {
      everyone_left: { timeout: 10 },
    },
  };

  if (input.realtime && input.webhook_url) {
    // Stream transcript.data events to our webhook as the call happens.
    body.recording_config.realtime_endpoints = [
      {
        type: 'webhook',
        url: input.webhook_url,
        events: ['transcript.data', 'transcript.partial_data'],
      },
    ];
  }

  const data = await recallFetch('/api/v1/bot', { method: 'POST', body: JSON.stringify(body) });
  logger.info('Recall bot created', { botId: data.id, meeting_url: input.meeting_url });
  return { id: data.id, status: data.status_changes?.slice(-1)?.[0]?.code, raw: data };
}

export async function getBot(botId: string): Promise<RecallBot> {
  const data = await recallFetch(`/api/v1/bot/${botId}`);
  return { id: data.id, status: data.status_changes?.slice(-1)?.[0]?.code, raw: data };
}

export async function stopBot(botId: string): Promise<void> {
  await recallFetch(`/api/v1/bot/${botId}/leave_call`, { method: 'POST', body: '{}' });
  logger.info('Recall bot asked to leave call', { botId });
}

/**
 * Fetch the finalized transcript for a completed bot and normalize it into our
 * diarized segment shape.
 */
export async function getTranscript(
  botId: string
): Promise<{ segments: ProviderSegment[]; text: string }> {
  const bot = await getBot(botId);
  const recordings: any[] = Array.isArray(bot.raw?.recordings) ? bot.raw.recordings : [];
  const latestRecording = recordings
    .slice()
    .sort((a, b) => {
      const aTs = new Date(a?.completed_at || a?.started_at || a?.created_at || 0).getTime();
      const bTs = new Date(b?.completed_at || b?.started_at || b?.created_at || 0).getTime();
      return bTs - aTs;
    })[0];

  const transcriptShortcut = latestRecording?.media_shortcuts?.transcript;
  const downloadUrl: string | undefined = transcriptShortcut?.data?.download_url;

  if (!downloadUrl) {
    throw new Error('Recall transcript artifact is not ready yet.');
  }

  const res = await fetch(downloadUrl);
  const textBody = await res.text();
  if (!res.ok) {
    throw new Error(`Recall transcript download failed with ${res.status}: ${textBody.slice(0, 400)}`);
  }

  const data = textBody ? JSON.parse(textBody) : [];
  const utterances: RecallTranscriptEntry[] = Array.isArray(data) ? data : data?.transcript || [];

  const segments: ProviderSegment[] = utterances.map((u) => {
    const words = Array.isArray(u.words) ? u.words : [];
    const text = words.map((w) => w.text).join(' ').trim() || (u.text || '').trim();
    const start = words[0]?.start_timestamp?.relative ?? u.start_timestamp?.relative ?? 0;
    const end = words[words.length - 1]?.end_timestamp?.relative ?? u.end_timestamp?.relative ?? start;
    return {
      speaker: u.speaker || u.participant?.name || 'Speaker',
      text,
      start_ms: Math.round((start || 0) * 1000),
      end_ms: Math.round((end || 0) * 1000),
    };
  }).filter((segment) => !!segment.text);

  return { segments, text: segmentsToText(segments) };
}

/**
 * Normalize a single real-time transcript webhook payload into segments.
 * Handles Recall's `transcript.data` / `transcript.partial_data` event shape.
 */
export function parseRealtimeTranscript(payload: any): ProviderSegment[] {
  const data = payload?.data?.data || payload?.data || payload;
  const words: any[] = data?.words || [];
  if (!words.length && !data?.text) return [];

  const text = words.length ? words.map((w) => w.text).join(' ').trim() : String(data.text).trim();
  const start = words[0]?.start_timestamp?.relative ?? 0;
  const end = words[words.length - 1]?.end_timestamp?.relative ?? start;
  const speaker = data?.participant?.name || data?.speaker || 'Speaker';

  return [
    {
      speaker,
      text,
      start_ms: Math.round((start || 0) * 1000),
      end_ms: Math.round((end || 0) * 1000),
    },
  ];
}
