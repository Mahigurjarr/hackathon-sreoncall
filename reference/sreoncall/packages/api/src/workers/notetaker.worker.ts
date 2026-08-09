import { AckPolicy, DeliverPolicy, JsMsg, ConsumerMessages } from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { withMsgTraceContext } from '../utils/nats-trace';
import { NotetakerSession, NotetakerSessionDocument } from '../models/notetaker-session.model';
import { TranscriptSegment } from '../models/transcript-segment.model';
import { getTranscriptionProvider } from '../services/notetaker/stt';
import { segmentsToText } from '../services/notetaker/stt/types';
import { downloadFileBuffer } from '../services/storage.service';
import { getTranscript as getRecallTranscript } from '../services/recall.service';
import { syncCalendarEvents } from '../services/calendar-sync.service';
import { enqueueSummarize, meterMinutes, postSummaryToWarRoom } from '../services/notetaker.service';
import { generateCompletion } from '../services/ai.service';
import { NOTETAKER_SUMMARY_PROMPT } from '../services/ai-prompts';
import { checkAiBudget, consumeAiTokens, estimateTokens } from '../services/ai-budget.service';
import { buildIncidentContext, formatContextForPrompt } from '../services/ai-context.service';

const STREAM_NAME = 'NOTETAKER';
const CONSUMER_NAME = 'notetaker-processing';
let consumer: ConsumerMessages | null = null;
let running = false;
const TRANSCRIPT_TRANSLATION_PROMPT = `
You translate meeting transcript segments into natural English.

Rules:
- Input will be a JSON array of objects with: speaker, text, start_ms, end_ms.
- Return a JSON array with the exact same number of objects.
- Preserve speaker, start_ms, and end_ms exactly.
- Translate only the text field into English.
- If text is already English, keep it unchanged.
- If text mixes Hindi and English, convert it into clean English while preserving meaning.
- Do not summarize, omit, merge, or reorder entries.
- Return JSON only.
`.trim();

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();
  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      // Only durable jobs land on notetaker.> — live segment fan-out goes over
      // core NATS on the notetaker-live subject (off-stream), consumed by the
      // WebSocket gateway, so this consumer never sees high-volume live traffic.
      max_deliver: 3,
      ack_wait: 300_000_000_000, // 5 min — transcription + summarization can be slow
    });
    logger.info('Notetaker worker consumer created');
  }
}

async function markFailed(session: NotetakerSessionDocument, err: any): Promise<void> {
  session.status = 'failed';
  session.error = String(err?.message || err).slice(0, 1000);
  await session.save().catch(() => {});
}

async function processMessage(msg: JsMsg): Promise<void> {
  await withMsgTraceContext(msg, async () => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.data));
      const subject = msg.subject;

      if (subject === 'notetaker.transcribe') {
        await handleTranscribe(data.session_id);
      } else if (subject === 'notetaker.recall_done') {
        await handleRecallDone(data.session_id);
      } else if (subject === 'notetaker.summarize') {
        await handleSummarize(data.session_id);
      } else if (subject === 'notetaker.calendar_sync') {
        await syncCalendarEvents(data.calendar_id, data.since || undefined);
      } else {
        logger.debug('Unhandled notetaker subject', { subject });
      }

      msg.ack();
    } catch (err: any) {
      logger.error('Notetaker worker failed to process message', { error: err.message, subject: msg.subject });
      msg.nak(10000);
    }
  });
}

/** Offline-upload path: pull audio from MinIO, run STT, persist transcript. */
async function handleTranscribe(sessionId: string): Promise<void> {
  const session = await NotetakerSession.findById(sessionId);
  if (!session) return;
  if (!session.audio_file_id) {
    await markFailed(session, new Error('No recording attached.'));
    return;
  }

  try {
    session.status = 'transcribing';
    await session.save();

    const audio = await downloadFileBuffer(session.tenant_id, session.audio_file_id.toString());
    const provider = getTranscriptionProvider();
    const result = await provider.transcribeBatch({
      buffer: audio.buffer,
      mimeType: audio.mime_type,
      filename: audio.original_name,
    });

    await persistSegments(session, result.segments);
    session.transcript_text = result.text;
    session.stt_provider = result.provider;
    if (result.segments.length) {
      session.duration_seconds = Math.round((result.segments[result.segments.length - 1].end_ms || 0) / 1000);
    }
    if (!session.participants.length) {
      session.participants = [...new Set(result.segments.map((s) => s.speaker).filter(Boolean))];
    }
    await session.save();

    await enqueueSummarize(session._id.toString());
  } catch (err: any) {
    await markFailed(session, err);
    throw err; // let JetStream retry
  }
}

/** Recall meeting-bot path: pull the finalized transcript from Recall, persist. */
async function handleRecallDone(sessionId: string): Promise<void> {
  const session = await NotetakerSession.findById(sessionId);
  if (!session || !session.recall_bot_id) return;

  try {
    session.status = 'processing';
    await session.save();

    let segments: { speaker: string; text: string; start_ms: number; end_ms: number }[] = [];
    let text = '';
    try {
      const recallTranscript = await getRecallTranscript(session.recall_bot_id);
      segments = recallTranscript.segments;
      text = recallTranscript.text;
    } catch (err: any) {
      logger.warn('Failed to fetch finalized Recall transcript, falling back to live segments', {
        sessionId,
        error: err.message,
      });
    }

    if (!segments.length) {
      segments = await readExistingSegments(session._id);
      text = text || segmentsToText(segments);
    }

    const translatedSegments = await translateSegmentsToEnglish(session, segments);
    if (translatedSegments.length) {
      segments = translatedSegments;
      text = segmentsToText(segments);
    }

    // Only overwrite if Recall returned more than the live stream already captured.
    if (segments.length) {
      await persistSegments(session, segments, true);
      session.duration_seconds = Math.round((segments[segments.length - 1].end_ms || 0) / 1000);
      session.participants = [...new Set(segments.map((s) => s.speaker).filter(Boolean))];
    }
    session.transcript_text = text || (await rebuildTranscriptFromSegments(session._id));
    if (!session.transcript_text?.trim()) {
      throw new Error('No transcript available from Recall or live segments.');
    }
    session.stt_provider = 'recall';
    session.ended_at = new Date();
    await session.save();

    await enqueueSummarize(session._id.toString());
  } catch (err: any) {
    await markFailed(session, err);
    throw err;
  }
}

/** Run the AI summary + extraction, persist suggestions, post to the war room. */
async function handleSummarize(sessionId: string): Promise<void> {
  const session = await NotetakerSession.findById(sessionId);
  if (!session) return;

  const transcript = session.transcript_text?.trim();
  if (!transcript) {
    await markFailed(session, new Error('No transcript to summarize.'));
    return;
  }

  try {
    session.status = 'summarizing';
    await session.save();

    // Enrich with incident context when the session is linked to one.
    let contextBlock = '';
    if (session.incident_id) {
      const ctx = await buildIncidentContext(session.tenant_id, session.incident_id.toString());
      if (ctx) contextBlock = `\n\n=== LINKED INCIDENT CONTEXT ===\n${formatContextForPrompt(ctx)}`;
    }

    const userMessage = `Meeting title: ${session.title}\n\n=== TRANSCRIPT ===\n${transcript.slice(0, 48000)}${contextBlock}`;
    await checkAiBudget(session.tenant_id, estimateTokens(userMessage));

    const completion = await generateCompletion({
      system: NOTETAKER_SUMMARY_PROMPT,
      userMessage,
      maxTokens: 4000,
    });
    if (completion.model !== 'fallback') {
      await consumeAiTokens(session.tenant_id, completion.input_tokens, completion.output_tokens);
    }

    applyExtraction(session, parseSummaryJson(completion.text));

    session.status = 'completed';
    session.ended_at = session.ended_at || new Date();
    await session.save();

    await meterMinutes(session);
    await postSummaryToWarRoom(session).catch((err) =>
      logger.error('Failed to post notetaker summary to war room', { error: err.message })
    );
  } catch (err: any) {
    await markFailed(session, err);
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function persistSegments(
  session: NotetakerSessionDocument,
  segments: { speaker: string; text: string; start_ms: number; end_ms: number }[],
  replace = false
): Promise<void> {
  if (replace) {
    await TranscriptSegment.deleteMany({ session_id: session._id });
  }
  if (!segments.length) return;
  await TranscriptSegment.insertMany(
    segments.map((s) => ({
      tenant_id: session.tenant_id,
      session_id: session._id,
      speaker: s.speaker,
      text: s.text,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      is_final: true,
    }))
  );
}

async function rebuildTranscriptFromSegments(sessionId: Types.ObjectId): Promise<string> {
  const segments = await TranscriptSegment.find({ session_id: sessionId }).sort({ start_ms: 1 }).lean();
  return segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
}

async function readExistingSegments(
  sessionId: Types.ObjectId
): Promise<{ speaker: string; text: string; start_ms: number; end_ms: number }[]> {
  const segments = await TranscriptSegment.find({ session_id: sessionId }).sort({ start_ms: 1 }).lean();
  return segments.map((s) => ({
    speaker: s.speaker,
    text: s.text,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
  }));
}

function parseTranslatedSegments(
  text: string,
  fallback: { speaker: string; text: string; start_ms: number; end_ms: number }[]
): { speaker: string; text: string; start_ms: number; end_ms: number }[] {
  if (!text?.trim()) return fallback;
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) return fallback;
    return parsed.map((item, idx) => ({
      speaker: String(item?.speaker ?? fallback[idx]?.speaker ?? 'Speaker'),
      text: String(item?.text ?? fallback[idx]?.text ?? '').trim() || fallback[idx]?.text || '',
      start_ms: Number(item?.start_ms ?? fallback[idx]?.start_ms ?? 0),
      end_ms: Number(item?.end_ms ?? fallback[idx]?.end_ms ?? 0),
    }));
  } catch {
    return fallback;
  }
}

async function translateSegmentsToEnglish(
  session: NotetakerSessionDocument,
  segments: { speaker: string; text: string; start_ms: number; end_ms: number }[]
): Promise<{ speaker: string; text: string; start_ms: number; end_ms: number }[]> {
  const cleanSegments = segments.filter((segment) => segment.text?.trim());
  if (!cleanSegments.length) return cleanSegments;

  const translated: { speaker: string; text: string; start_ms: number; end_ms: number }[] = [];
  const chunkSize = 40;

  for (let i = 0; i < cleanSegments.length; i += chunkSize) {
    const chunk = cleanSegments.slice(i, i + chunkSize);
    const userMessage = JSON.stringify(chunk);
    await checkAiBudget(session.tenant_id, estimateTokens(userMessage));
    const completion = await generateCompletion({
      system: TRANSCRIPT_TRANSLATION_PROMPT,
      userMessage,
      maxTokens: 3000,
    });
    if (completion.model !== 'fallback') {
      await consumeAiTokens(session.tenant_id, completion.input_tokens, completion.output_tokens);
    }
    translated.push(...parseTranslatedSegments(completion.text, chunk));
  }

  return translated;
}

interface Extraction {
  summary?: string;
  key_points?: string[];
  decisions?: string[];
  participants?: string[];
  suggested_tickets?: any[];
  suggested_runbook?: any | null;
  incident_timeline_notes?: string[];
}

/** Parse the model's JSON output, tolerating stray code fences / prose. */
export function parseSummaryJson(text: string): Extraction {
  if (!text) return {};
  let cleaned = text.trim();
  // Strip code fences if the model wrapped the JSON.
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  // Fall back to the first {...} block.
  if (!cleaned.startsWith('{')) {
    const brace = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (brace >= 0 && end > brace) cleaned = cleaned.slice(brace, end + 1);
  }
  try {
    return JSON.parse(cleaned) as Extraction;
  } catch {
    // Last resort: treat the whole text as the summary.
    return { summary: text.slice(0, 5000) };
  }
}

function applyExtraction(session: NotetakerSessionDocument, ex: Extraction): void {
  session.summary = (ex.summary || '').trim() || null;
  session.key_points = arrayOfStrings(ex.key_points);
  session.decisions = arrayOfStrings(ex.decisions);
  if (Array.isArray(ex.participants) && ex.participants.length) {
    session.participants = arrayOfStrings(ex.participants);
  }

  const suggestions: any[] = [];
  for (const t of Array.isArray(ex.suggested_tickets) ? ex.suggested_tickets : []) {
    if (!t || !t.title) continue;
    suggestions.push({
      type: 'ticket',
      status: 'suggested',
      payload: {
        title: String(t.title),
        type: t.type === 'bug' ? 'bug' : 'task',
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        description: String(t.description || ''),
      },
    });
  }
  if (ex.suggested_runbook && ex.suggested_runbook.title) {
    suggestions.push({
      type: 'runbook',
      status: 'suggested',
      payload: {
        title: String(ex.suggested_runbook.title),
        description: String(ex.suggested_runbook.description || ''),
        steps: Array.isArray(ex.suggested_runbook.steps) ? ex.suggested_runbook.steps.map((s: any) => String(s)) : [],
      },
    });
  }
  if (session.incident_id) {
    for (const note of arrayOfStrings(ex.incident_timeline_notes)) {
      suggestions.push({ type: 'incident_timeline', status: 'suggested', payload: { note } });
    }
  }
  session.suggestions = suggestions as any;
}

function arrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
}

export async function startNotetakerWorker(): Promise<void> {
  if (running) return;
  await ensureConsumer();
  const js = getJetStream();
  consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME).then((c) => c.consume());
  running = true;

  (async () => {
    if (!consumer) return;
    for await (const msg of consumer) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) logger.error('Notetaker worker loop error', { error: err.message });
  });

  logger.info('Notetaker worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopNotetakerWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Notetaker worker stopped');
}
