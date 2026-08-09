import { describe, it, expect } from 'vitest';
import { segmentsToText } from '../stt/types';
import { getTranscriptionProvider } from '../stt';
import { parseSummaryJson } from '../../../workers/notetaker.worker';

describe('segmentsToText', () => {
  it('prefixes a speaker label only when the speaker changes', () => {
    const text = segmentsToText([
      { speaker: 'Alice', text: 'we lost the database', start_ms: 0, end_ms: 1000 },
      { speaker: 'Alice', text: 'around 14:30', start_ms: 1000, end_ms: 2000 },
      { speaker: 'Bob', text: 'rolling back the deploy', start_ms: 2000, end_ms: 3000 },
    ]);
    expect(text).toBe('Alice: we lost the database\naround 14:30\nBob: rolling back the deploy');
  });

  it('skips empty segments', () => {
    const text = segmentsToText([
      { speaker: 'Alice', text: '  ', start_ms: 0, end_ms: 10 },
      { speaker: 'Alice', text: 'hello', start_ms: 10, end_ms: 20 },
    ]);
    expect(text).toBe('Alice: hello');
  });
});

describe('getTranscriptionProvider', () => {
  it('returns the whisper provider by override', () => {
    expect(getTranscriptionProvider('whisper').name).toBe('whisper');
  });
  it('returns the deepgram provider by override', () => {
    const p = getTranscriptionProvider('deepgram');
    expect(p.name).toBe('deepgram');
    expect(p.supportsLive).toBe(true);
  });
  it('falls back to whisper for the recall source (no batch transcriber)', () => {
    expect(getTranscriptionProvider('recall').name).toBe('whisper');
  });
});

describe('parseSummaryJson', () => {
  it('parses a clean JSON object', () => {
    const out = parseSummaryJson('{"summary":"hi","decisions":["roll back"]}');
    expect(out.summary).toBe('hi');
    expect(out.decisions).toEqual(['roll back']);
  });

  it('unwraps a fenced ```json block', () => {
    const out = parseSummaryJson('```json\n{"summary":"fenced"}\n```');
    expect(out.summary).toBe('fenced');
  });

  it('extracts the first object when surrounded by prose', () => {
    const out = parseSummaryJson('Here is the result: {"summary":"prose"} thanks');
    expect(out.summary).toBe('prose');
  });

  it('falls back to treating the whole text as the summary on invalid JSON', () => {
    const out = parseSummaryJson('not json at all');
    expect(out.summary).toBe('not json at all');
  });
});
