import { describe, it, expect } from 'vitest';
import { effectiveLogQuery, canRunBarQuery } from './log-bar';

describe('effectiveLogQuery', () => {
  it('uses the bar query when it is non-empty, ignoring fetchLogql entirely', () => {
    expect(effectiveLogQuery('{service_name="checkout-api"}', '{job=~".+"}')).toBe(
      '{service_name="checkout-api"}',
    );
  });

  it('trims whitespace from a non-empty bar query', () => {
    expect(effectiveLogQuery('  {pod="x"}  ', '{job=~".+"}')).toBe('{pod="x"}');
  });

  it('falls back to fetchLogql when the bar query is empty', () => {
    expect(effectiveLogQuery('', '{job=~".+"}')).toBe('{job=~".+"}');
  });

  it('falls back to fetchLogql when the bar query is whitespace-only', () => {
    expect(effectiveLogQuery('   ', '{job=~".+"}')).toBe('{job=~".+"}');
  });
});

describe('canRunBarQuery', () => {
  it('is true for a non-empty bar query', () => {
    expect(canRunBarQuery('{service_name="checkout-api"}')).toBe(true);
  });

  it('is false for an empty bar query — the empty-logql Run guard', () => {
    expect(canRunBarQuery('')).toBe(false);
  });

  it('is false for a whitespace-only bar query', () => {
    expect(canRunBarQuery('   ')).toBe(false);
  });
});
