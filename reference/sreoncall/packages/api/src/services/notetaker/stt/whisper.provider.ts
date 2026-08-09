import OpenAI, { toFile } from 'openai';
import { logger } from '../../../utils/logger';
import { TranscriptionProvider, TranscribeInput, TranscriptResult, ProviderSegment, segmentsToText } from './types';

/**
 * OpenAI Whisper batch transcription. Reuses the existing OPENAI_API_KEY.
 * Whisper does not diarize, so every segment is attributed to a single
 * "Speaker" label — good enough for summarization, and the cheapest path
 * since the platform already depends on OpenAI.
 */
export class WhisperProvider implements TranscriptionProvider {
  readonly name = 'whisper';
  readonly supportsLive = false;

  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set — Whisper transcription unavailable');
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  async transcribeBatch(input: TranscribeInput): Promise<TranscriptResult> {
    const client = this.getClient();
    const file = await toFile(input.buffer, input.filename, { type: input.mimeType });

    const response = await client.audio.transcriptions.create({
      file,
      model: process.env.WHISPER_MODEL || 'whisper-1',
      response_format: 'verbose_json',
    });

    const raw = response as unknown as {
      text?: string;
      language?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    const segments: ProviderSegment[] = (raw.segments || []).map((s) => ({
      speaker: 'Speaker',
      text: (s.text || '').trim(),
      start_ms: Math.round((s.start || 0) * 1000),
      end_ms: Math.round((s.end || 0) * 1000),
    }));

    const text = raw.text?.trim() || segmentsToText(segments);
    logger.info('Whisper transcription complete', { segments: segments.length, chars: text.length });

    return { text, segments, language: raw.language, provider: this.name };
  }
}
