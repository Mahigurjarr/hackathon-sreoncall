import { describe, it, expect } from 'vitest';
import { classifyAiResult, AiResultState } from '../ai-query-result';

const base: AiResultState = {
  hasActiveQuery: true,
  aiOriginated: true,
  isError: false,
  isSuccess: true,
  seriesCount: 3,
  repairCount: 0,
};

describe('classifyAiResult', () => {
  it('returns "none" for manual (non-AI) queries', () => {
    expect(classifyAiResult({ ...base, aiOriginated: false, isError: true })).toBe('none');
  });

  it('returns "none" when there is no active query', () => {
    expect(classifyAiResult({ ...base, hasActiveQuery: false })).toBe('none');
  });

  it('repairs once on a Mimir error', () => {
    expect(classifyAiResult({ ...base, isError: true, isSuccess: false, repairCount: 0 })).toBe('repair');
  });

  it('does NOT repair again after the cap is spent', () => {
    expect(classifyAiResult({ ...base, isError: true, isSuccess: false, repairCount: 1 })).toBe('none');
  });

  it('spends the shared repair on a valid-but-empty result (budget untouched)', () => {
    expect(classifyAiResult({ ...base, seriesCount: 0, repairCount: 0 })).toBe('empty-repair');
  });

  it('shows the honest empty note when valid-but-empty AND the repair budget is spent', () => {
    expect(classifyAiResult({ ...base, seriesCount: 0, repairCount: 1 })).toBe('empty-note');
  });

  it('is "ok" when data comes back', () => {
    expect(classifyAiResult({ ...base, seriesCount: 5 })).toBe('ok');
  });

  it('is "none" while still loading (neither error nor success)', () => {
    expect(classifyAiResult({ ...base, isError: false, isSuccess: false })).toBe('none');
  });
});
