/**
 * Pluggable speech-to-text provider interface for the AI Notetaker.
 *
 * The batch path (offline uploads, and the final recording from a Recall.ai bot)
 * runs audio through a TranscriptionProvider. Live transcription during a call
 * is handled by Recall.ai's real-time webhooks, not this interface.
 */

export interface ProviderSegment {
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscriptResult {
  /** Full plain-text transcript (speaker-prefixed when diarization is available). */
  text: string;
  segments: ProviderSegment[];
  language?: string;
  provider: string;
}

export interface TranscribeInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly supportsLive: boolean;
  transcribeBatch(input: TranscribeInput): Promise<TranscriptResult>;
}

/** Build a single speaker-prefixed transcript string from diarized segments. */
export function segmentsToText(segments: ProviderSegment[]): string {
  const lines: string[] = [];
  let lastSpeaker = '';
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    if (seg.speaker && seg.speaker !== lastSpeaker) {
      lines.push(`${seg.speaker}: ${text}`);
      lastSpeaker = seg.speaker;
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n');
}
