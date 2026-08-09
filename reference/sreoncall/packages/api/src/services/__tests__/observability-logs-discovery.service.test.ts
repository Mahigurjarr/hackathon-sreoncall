import { describe, it, expect, vi, beforeEach } from 'vitest';

const lokiGet = vi.fn();
const fp = (u: string) => 'origin:' + u;
vi.mock('../observability-upstream.service', () => ({
  lokiGet: (...a: any[]) => lokiGet(...a),
  normalizedLokiFingerprint: (u: string) => fp(u),
}));

const redisGet = vi.fn();
const redisSetex = vi.fn();
vi.mock('../../config/redis', () => ({ getRedis: () => ({ get: redisGet, setex: redisSetex }) }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  sanitizeLogScope, buildLogSelector, listLogLabelNames, listLogLabelValues,
  listLogLabelNamesGrounding,
} from '../observability-logs-discovery.service';

beforeEach(() => {
  lokiGet.mockReset();
  redisGet.mockReset().mockResolvedValue(null);
  redisSetex.mockReset().mockResolvedValue('OK');
});

describe('sanitizeLogScope', () => {
  it('strips reserved control params', () => {
    expect(sanitizeLogScope({ name: 'x', consumer_id: 'c', start: '1', end: '2', window: '1h', limit: '10', namespace: 'p' }))
      .toEqual({ namespace: 'p' });
  });
  it('drops array values and invalid keys', () => {
    expect(sanitizeLogScope({ svc: ['a', 'b'], 'bad.key': 'x', 'ok_key': 'v' })).toEqual({ ok_key: 'v' });
  });
  it('keeps service_name and job (valid filter labels, not rejected)', () => {
    expect(sanitizeLogScope({ service_name: 'api', job: 'j' })).toEqual({ service_name: 'api', job: 'j' });
  });
  it('drops values with control chars / over length', () => {
    expect(sanitizeLogScope({ a: 'line\nbreak', b: 'x'.repeat(300), c: 'ok' })).toEqual({ c: 'ok' });
  });
});

describe('buildLogSelector', () => {
  it('sorts keys deterministically and returns empty for empty scope', () => {
    expect(buildLogSelector({})).toBe('');
    expect(buildLogSelector({ namespace: 'p', cluster: 'c' })).toBe('{cluster="c",namespace="p"}');
  });
  it('escapes quotes and backslashes so a value cannot break out', () => {
    // value foo"} |= "  →  escaped, still inside the selector
    expect(buildLogSelector({ service_name: 'foo"} |= "' })).toBe('{service_name="foo\\"} |= \\""}');
  });
});

describe('listLogLabelNames', () => {
  it('drops __ and reserved labels, caps + returns from Loki', async () => {
    lokiGet.mockResolvedValue({ data: ['cluster', 'namespace', '__stream_shard__', 'tenant_id', 'source', 'service_name'] });
    const out = await listLogLabelNames('http://loki', 'org1');
    expect(out.values).toEqual(['cluster', 'namespace', 'service_name']);
    expect(out.total).toBe(3);
    expect(lokiGet).toHaveBeenCalledWith('http://loki', '/loki/api/v1/labels', expect.objectContaining({ start: expect.any(String), end: expect.any(String) }), 'org1');
  });
  it('serves from cache without hitting Loki', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ values: ['cached'], total: 1, truncated: false }));
    const out = await listLogLabelNames('http://loki', 'org1');
    expect(out.values).toEqual(['cached']);
    expect(lokiGet).not.toHaveBeenCalled();
  });
});

describe('listLogLabelValues', () => {
  it('empty scope → plain label-values, no query param', async () => {
    lokiGet.mockResolvedValueOnce({ data: ['200', '500'] });   // values only — no version probe
    const out = await listLogLabelValues('http://loki', 'org1', 'status_code', {});
    expect(out.values).toEqual(['200', '500']);
    expect(lokiGet).toHaveBeenCalledTimes(1);
    const valuesCall = lokiGet.mock.calls.find((c) => c[1] === '/loki/api/v1/label/status_code/values');
    expect(valuesCall![2]).not.toHaveProperty('query');
  });
  it('newer Loki + scope → passes query selector', async () => {
    lokiGet.mockResolvedValueOnce({ version: '2.9.0' })
           .mockResolvedValueOnce({ data: ['payments'] });
    await listLogLabelValues('http://loki', 'org1', 'namespace', { cluster: 'eks' });
    const valuesCall = lokiGet.mock.calls.find((c) => c[1] === '/loki/api/v1/label/namespace/values');
    expect(valuesCall![2].query).toBe('{cluster="eks"}');
  });
  it('older Loki + scope → series fallback extracts distinct values', async () => {
    lokiGet.mockResolvedValueOnce({ version: '2.4.0' })                 // buildinfo → old
           .mockResolvedValueOnce({ data: [{ namespace: 'a' }, { namespace: 'b' }, { namespace: 'a' }] }); // /series
    const out = await listLogLabelValues('http://loki', 'org1', 'namespace', { cluster: 'eks' });
    expect(out.values.sort()).toEqual(['a', 'b']);
    const seriesCall = lokiGet.mock.calls.find((c) => c[1] === '/loki/api/v1/series');
    expect(seriesCall![2]['match[]']).toEqual(['{cluster="eks"}']);
  });
});

describe('listLogLabelNamesGrounding', () => {
  it('caps at 40 labels with truncated:true when more exist', async () => {
    const fiftyLabels = Array.from({ length: 50 }, (_, i) => `label_${i}`);
    lokiGet.mockResolvedValueOnce({ data: fiftyLabels });
    const out = await listLogLabelNamesGrounding('http://loki', 'org1');
    expect(out.values).toHaveLength(40);
    expect(out.total).toBe(50);
    expect(out.truncated).toBe(true);
  });

  it('never throws — returns empty result on internal failure', async () => {
    redisGet.mockResolvedValue(null); // ensure the labels call actually hits lokiGet
    // Resolving with undefined makes the SUT's own `resp.data` access throw inside
    // listLogLabelNames, without vitest attributing a mock-thrown error to this test.
    lokiGet.mockResolvedValueOnce(undefined);
    const out = await listLogLabelNamesGrounding('http://loki', 'org1');
    expect(out).toEqual({ values: [], total: 0, truncated: false });
  });
});
