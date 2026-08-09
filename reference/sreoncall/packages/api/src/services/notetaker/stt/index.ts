import { getConfig } from '../../../config/index';
import { TranscriptionProvider } from './types';
import { WhisperProvider } from './whisper.provider';
import { DeepgramProvider } from './deepgram.provider';

export * from './types';

/**
 * Resolve the configured batch transcription provider. `STT_PROVIDER` selects
 * the default; pass an explicit name to override per call.
 *
 * 'recall' is a capture source, not a batch transcriber — when selected we fall
 * back to Whisper for any audio we transcribe ourselves (uploads), while the
 * Recall.ai meeting-bot path uses Recall's own transcript directly.
 */
export function getTranscriptionProvider(override?: string): TranscriptionProvider {
  const name = (override || getConfig().STT_PROVIDER || 'whisper').toLowerCase();
  switch (name) {
    case 'deepgram':
      return new DeepgramProvider();
    case 'whisper':
    case 'recall':
    default:
      return new WhisperProvider();
  }
}
