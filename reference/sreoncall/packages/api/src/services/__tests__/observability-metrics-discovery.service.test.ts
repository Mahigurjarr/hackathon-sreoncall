import { describe, it, expect, vi, beforeEach } from 'vitest';

const mimirGet = vi.fn();
const getMimirBaseUrl = vi.fn(() => 'http://mimir-test:9009');
vi.mock('../observability-upstream.service', () => ({
  mimirGet: (...a: any[]) => mimirGet(...a),
  getMimirBaseUrl: () => getMimirBaseUrl(),
}));

const redisGet = vi.fn();
const redisSetex = vi.fn();
vi.mock('../../config/redis', () => ({ getRedis: () => ({ get: redisGet, setex: redisSetex }) }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  sanitizeMetricScope, buildMetricMatcher, buildScopeMatcher, listMetricNames, listMetricLabelNames,
  listMetricLabelNamesForScope, listMetricLabelValues, getMetricType,
} from '../observability-metrics-discovery.service';

beforeEach(() => {
  mimirGet.mockReset();
  getMimirBaseUrl.mockReset().mockReturnValue('http://mimir-test:9009');
  redisGet.mockReset().mockResolvedValue(null);
  redisSetex.mockReset().mockResolvedValue('OK');
});

describe('sanitizeMetricScope', () => {
  it('strips reserved control params', () => {
    expect(sanitizeMetricScope({ metric: 'x', name: 'x', label: 'x', consumer_id: 'c', start: '1', end: '2', window: '1h', limit: '10', namespace: 'p' }))
      .toEqual({ namespace: 'p' });
  });
  it('drops array values and invalid keys', () => {
    expect(sanitizeMetricScope({ svc: ['a', 'b'], 'bad.key': 'x', 'ok_key': 'v' })).toEqual({ ok_key: 'v' });
  });
  it('keeps service_name and job (valid filter labels, not rejected) — critical review fix', () => {
    expect(sanitizeMetricScope({ service_name: 'api', job: 'j' })).toEqual({ service_name: 'api', job: 'j' });
  });
  it('drops values with control chars / over length via validateLabelValue', () => {
    expect(sanitizeMetricScope({ a: 'line\nbreak', b: 'x'.repeat(300), c: 'ok' })).toEqual({ c: 'ok' });
  });
});

describe('buildMetricMatcher', () => {
  it('clean metric name + empty scope → bare metric name', () => {
    expect(buildMetricMatcher('http_requests_total', {})).toBe('http_requests_total');
  });
  it('clean metric name + scope → metric{k="v",...} with sorted keys', () => {
    expect(buildMetricMatcher('http_requests_total', { namespace: 'p', cluster: 'c' }))
      .toBe('http_requests_total{cluster="c",namespace="p"}');
  });
  it('metric name with colon (recording rule) → __name__ fallback form', () => {
    expect(buildMetricMatcher('job:http_requests:rate5m', {})).toBe('{__name__="job:http_requests:rate5m"}');
  });
  it('metric name with other odd chars (vendor name) → __name__ fallback form, with scope', () => {
    expect(buildMetricMatcher('http.server.duration', { cluster: 'c' }))
      .toBe('{__name__="http.server.duration",cluster="c"}');
  });
  it('escapes quotes and backslashes in values so they cannot break out', () => {
    expect(buildMetricMatcher('up', { instance: 'foo"} or 1==1 \\' }))
      .toBe('up{instance="foo\\"} or 1==1 \\\\"}');
  });
  it('escapes the metric name itself when using the __name__ fallback form', () => {
    expect(buildMetricMatcher('weird"name', {})).toBe('{__name__="weird\\"name"}');
  });
});

describe('buildScopeMatcher', () => {
  it('empty scope → empty string', () => {
    expect(buildScopeMatcher({})).toBe('');
  });
  it('sorts keys and escapes values, no metric name involved', () => {
    expect(buildScopeMatcher({ job: 'checkout-api', instance: 'foo"} or 1==1 \\' }))
      .toBe('{instance="foo\\"} or 1==1 \\\\",job="checkout-api"}');
  });
});

describe('listMetricNames', () => {
  it('empty scope → no match[], correct Mimir path', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['up', 'http_requests_total'] });
    const out = await listMetricNames('org1', {});
    expect(out.values).toEqual(['up', 'http_requests_total']);
    expect(out.total).toBe(2);
    expect(mimirGet).toHaveBeenCalledTimes(1);
    const [path, params, orgId] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/label/__name__/values');
    expect(params).not.toHaveProperty('match[]');
    expect(params.start).toEqual(expect.any(String));
    expect(params.end).toEqual(expect.any(String));
    expect(orgId).toBe('org1');
  });
  it('non-empty scope → match[] built from scope only (no metric)', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['up'] });
    await listMetricNames('org1', { namespace: 'payments' });
    const [, params] = mimirGet.mock.calls[0];
    expect(params['match[]']).toEqual(['{namespace="payments"}']);
  });
  it('caps and marks truncated when over DISCOVERY_MAX_VALUES', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => `metric_${i}`);
    mimirGet.mockResolvedValueOnce({ data: many });
    const out = await listMetricNames('org1', {});
    expect(out.values).toHaveLength(1000);
    expect(out.total).toBe(1200);
    expect(out.truncated).toBe(true);
  });
  it('serves from cache without hitting Mimir', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ values: ['cached'], total: 1, truncated: false }));
    const out = await listMetricNames('org1', {});
    expect(out.values).toEqual(['cached']);
    expect(mimirGet).not.toHaveBeenCalled();
  });
});

describe('listMetricLabelNames', () => {
  it('queries /prometheus/api/v1/labels with match[] from the metric matcher, filters __* names', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['cluster', 'namespace', '__name__', '__foo'] });
    const out = await listMetricLabelNames('org1', 'http_requests_total', { cluster: 'c' });
    expect(out.values).toEqual(['cluster', 'namespace']);
    const [path, params, orgId] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/labels');
    expect(params['match[]']).toEqual(['http_requests_total{cluster="c"}']);
    expect(orgId).toBe('org1');
  });
  it('always includes match[] even with an empty scope (matcher still has the metric)', async () => {
    mimirGet.mockResolvedValueOnce({ data: [] });
    await listMetricLabelNames('org1', 'up', {});
    const [, params] = mimirGet.mock.calls[0];
    expect(params['match[]']).toEqual(['up']);
  });
});

describe('listMetricLabelNamesForScope', () => {
  it('queries /prometheus/api/v1/labels with match[] built from the scope only (no metric), filters __* names', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['job', 'instance', '__name__', '__foo'] });
    const out = await listMetricLabelNamesForScope('org1', { job: 'checkout-api' });
    expect(out.values).toEqual(['job', 'instance']);
    const [path, params, orgId] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/labels');
    expect(params['match[]']).toEqual(['{job="checkout-api"}']);
    expect(orgId).toBe('org1');
  });
  it('empty scope → no match[] param (mirrors listMetricNames)', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['job'] });
    await listMetricLabelNamesForScope('org1', {});
    const [, params] = mimirGet.mock.calls[0];
    expect(params).not.toHaveProperty('match[]');
  });
  it('caps and caches', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => `label_${i}`);
    mimirGet.mockResolvedValueOnce({ data: many });
    const out = await listMetricLabelNamesForScope('org1', { job: 'x' });
    expect(out.values).toHaveLength(1000);
    expect(out.truncated).toBe(true);
    expect(redisSetex).toHaveBeenCalled();
  });
  it('serves from cache without hitting Mimir', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ values: ['cached'], total: 1, truncated: false }));
    const out = await listMetricLabelNamesForScope('org1', { job: 'x' });
    expect(out.values).toEqual(['cached']);
    expect(mimirGet).not.toHaveBeenCalled();
  });
});

describe('listMetricLabelValues', () => {
  it('queries /prometheus/api/v1/label/:label/values with match[] from the metric matcher', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['payments', 'billing'] });
    const out = await listMetricLabelValues('org1', 'http_requests_total', 'namespace', { cluster: 'c' });
    expect(out.values).toEqual(['payments', 'billing']);
    const [path, params] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/label/namespace/values');
    expect(params['match[]']).toEqual(['http_requests_total{cluster="c"}']);
  });
  it('self-excludes the queried label from the scope matcher', async () => {
    mimirGet.mockResolvedValueOnce({ data: ['payments'] });
    await listMetricLabelValues('org1', 'http_requests_total', 'namespace', { cluster: 'c', namespace: 'stale' });
    const [, params] = mimirGet.mock.calls[0];
    // namespace must NOT appear in the matcher even though it was passed in scope
    expect(params['match[]']).toEqual(['http_requests_total{cluster="c"}']);
  });
  it('caps and caches', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => `v${i}`);
    mimirGet.mockResolvedValueOnce({ data: many });
    const out = await listMetricLabelValues('org1', 'up', 'instance', {});
    expect(out.values).toHaveLength(1000);
    expect(out.truncated).toBe(true);
    expect(redisSetex).toHaveBeenCalled();
  });
});

describe('getMetricType', () => {
  it('parses data[metric][0].type', async () => {
    mimirGet.mockResolvedValueOnce({ data: { http_requests_total: [{ type: 'counter', help: '', unit: '' }] } });
    const out = await getMetricType('org1', 'http_requests_total');
    expect(out).toBe('counter');
    const [path, params] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/metadata');
    expect(params).toEqual({ metric: 'http_requests_total' });
  });
  it('missing metric in response → unknown, never throws', async () => {
    mimirGet.mockResolvedValueOnce({ data: {} });
    const out = await getMetricType('org1', 'no_such_metric');
    expect(out).toBe('unknown');
  });
  it('upstream error → unknown, never throws', async () => {
    mimirGet.mockRejectedValueOnce(new Error('mimir down'));
    const out = await getMetricType('org1', 'up');
    expect(out).toBe('unknown');
  });
  it('serves from cache without hitting Mimir', async () => {
    redisGet.mockResolvedValue('gauge');
    const out = await getMetricType('org1', 'up');
    expect(out).toBe('gauge');
    expect(mimirGet).not.toHaveBeenCalled();
  });

  it('metadata miss on a _bucket name → name-suffix fallback to histogram (review fix)', async () => {
    mimirGet.mockResolvedValueOnce({ data: {} });
    const out = await getMetricType('org1', 'http_request_duration_seconds_bucket');
    expect(out).toBe('histogram');
    expect(redisSetex).toHaveBeenCalledWith(expect.any(String), expect.any(Number), 'histogram');
  });

  it('metadata miss on a _total name → name-suffix fallback to counter', async () => {
    mimirGet.mockResolvedValueOnce({ data: {} });
    const out = await getMetricType('org1', 'http_requests_total');
    expect(out).toBe('counter');
  });

  it('metadata miss on a name with no recognized suffix → still unknown', async () => {
    mimirGet.mockResolvedValueOnce({ data: {} });
    const out = await getMetricType('org1', 'no_such_metric');
    expect(out).toBe('unknown');
  });
});
