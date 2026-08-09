import { describe, it, expect } from 'vitest';
import { buildPromQLSelector, clearFrom } from '../scope';

describe('buildPromQLSelector', () => {
  it('maps service to service_name and orders labels', () => {
    expect(buildPromQLSelector({ cluster: 'c', namespace: 'n', service: 's' }))
      .toBe('{cluster="c",namespace="n",service_name="s"}');
  });
  it('includes pod when present', () => {
    expect(buildPromQLSelector({ namespace: 'n', service: 's', pod: 'p-1' }))
      .toBe('{namespace="n",service_name="s",pod="p-1"}');
  });
  it('returns empty string for empty scope', () => {
    expect(buildPromQLSelector({})).toBe('');
  });
});

describe('clearFrom', () => {
  it('clears the key and deeper levels', () => {
    expect(clearFrom({ cluster: 'c', namespace: 'n', service: 's', pod: 'p' }, 'namespace'))
      .toEqual({ cluster: 'c' });
  });
  it('clearing pod keeps the rest', () => {
    expect(clearFrom({ cluster: 'c', namespace: 'n', service: 's', pod: 'p' }, 'pod'))
      .toEqual({ cluster: 'c', namespace: 'n', service: 's' });
  });
});
