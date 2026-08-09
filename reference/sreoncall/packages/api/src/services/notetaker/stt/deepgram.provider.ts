import { logger } from '../../../utils/logger';
import { TranscriptionProvider, TranscribeInput, TranscriptResult, ProviderSegment, segmentsToText } from './types';

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  speaker?: number;
  punctuated_word?: string;
}

/**
 * Deepgram batch transcription with speaker diarization. Used when
 * STT_PROVIDER=deepgram and DEEPGRAM_API_KEY is set. Diarized output gives the
 * notetaker real "who said what", which materially improves summary quality.
 */
export class DeepgramProvider implements TranscriptionProvider {
  readonly name = 'deepgram';
  readonly supportsLive = true;

  async transcribeBatch(input: TranscribeInput): Promise<TranscriptResult> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not set — Deepgram transcription unavailable');

    const url = 'https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&smart_format=true';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': input.mimeType || 'application/octet-stream',
      },
      body: input.buffer,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Deepgram API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as any;
    const alt = data?.results?.channels?.[0]?.alternatives?.[0];
    const words: DeepgramWord[] = alt?.words || [];

    // Group consecutive words by speaker into segments.
    const segments: ProviderSegment[] = [];
    let current: ProviderSegment | null = null;
    for (const w of words) {
      const speaker = `Speaker ${w.speaker ?? 0}`;
      const token = w.punctuated_word || w.word;
      if (!current || current.speaker !== speaker) {
        if (current) segments.push(current);
        current = { speaker, text: token, start_ms: Math.round(w.start * 1000), end_ms: Math.round(w.end * 1000) };
      } else {
        current.text += ` ${token}`;
        current.end_ms = Math.round(w.end * 1000);
      }
    }
    if (current) segments.push(current);

    const text = segments.length ? segmentsToText(segments) : (alt?.transcript || '').trim();
    logger.info('Deepgram transcription complete', { segments: segments.length, chars: text.length });

    return { text, segments, language: data?.results?.channels?.[0]?.detected_language, provider: this.name };
  }
}
