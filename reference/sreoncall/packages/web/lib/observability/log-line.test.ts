import { describe, it, expect } from 'vitest';
import { getLevelColor } from './log-line';

describe('getLevelColor', () => {
  it('detects the level from a stream label (most reliable source)', () => {
    expect(getLevelColor('connection refused to ledger-api:5432', { level: 'error' })).toBe('error');
  });

  it('detects the level from a JSON line field when no stream label is present', () => {
    expect(getLevelColor('{"level":"warn","msg":"slow query 1240ms"}', {})).toBe('warn');
  });

  it('falls back to a regex match over the raw text (e.g. a bracketed level tag)', () => {
    expect(getLevelColor('[ERROR] panic: nil pointer dereference in settleOrder()', {})).toBe('error');
  });

  it('defaults to info for a line with no recognizable level signal', () => {
    expect(getLevelColor('user authenticated uid=4821', {})).toBe('info');
  });

  it('normalizes level synonyms (severity=critical, JSON "warning") to the canonical bucket', () => {
    expect(getLevelColor('OOMKilled: container exceeded memory limit', { severity: 'critical' })).toBe('error');
    expect(getLevelColor('{"severity":"warning"}', {})).toBe('warn');
  });
});
