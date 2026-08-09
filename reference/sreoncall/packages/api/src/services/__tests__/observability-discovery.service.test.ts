import { describe, it, expect, vi, beforeEach } from 'vitest';

const mimirGet = vi.fn();
vi.mock('../observability-upstream.service', () => ({ mimirGet: (...a: any[]) => mimirGet(...a) }));
const redisGet = vi.fn();
const redisSetex = vi.fn();
vi.mock('../../config/redis', () => ({ getRedis: () => ({ get: redisGet, setex: redisSetex }) }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { listLabelValues, getChildren, listMetricNames, listLabelNames } from '../observability-discovery.service';

describe('observability-discovery', () => {
  beforeEach(() => {
    mimirGet.mockReset();
    redisGet.mockReset();
    redisSetex.mockReset();
    redisGet.mockResolvedValue(null);
  });

  it('getChildren("namespace") queries label namespace with a cluster matcher', async () => {
    mimirGet.mockResolvedValue({ status: 'success', data: ['payments', 'checkout'] });
    const res = await getChildren('org1', 'namespace', { cluster: 'eks-prod-eu' });
    const [path, params, org] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/label/namespace/values');
    expect(params['match[]']).toEqual(['{cluster="eks-prod-eu"}']);
    expect(org).toBe('org1');
    expect(res.values).toEqual(['payments', 'checkout']);
    expect(res.truncated).toBe(false);
  });

  it('caps cardinality and sets truncated', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => `v${i}`);
    mimirGet.mockResolvedValue({ status: 'success', data: many });
    const res = await listLabelValues('org1', 'pod', {});
    expect(res.values).toHaveLength(1000);
    expect(res.total).toBe(1500);
    expect(res.truncated).toBe(true);
  });

  it('serves from Redis cache without calling Mimir', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ values: ['cached'], total: 1, truncated: false }));
    const res = await getChildren('org1', 'cluster', {});
    expect(mimirGet).not.toHaveBeenCalled();
    expect(res.values).toEqual(['cached']);
  });

  it('writes Mimir result to cache with 60s TTL', async () => {
    mimirGet.mockResolvedValue({ status: 'success', data: ['c1'] });
    await getChildren('org1', 'cluster', {});
    expect(redisSetex).toHaveBeenCalledWith(expect.stringContaining('obsdisc:org1:'), 60, expect.any(String));
  });

  it('listMetricNames queries __name__ with the scope matcher and caps at 80', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `m${i}`);
    mimirGet.mockResolvedValue({ status: 'success', data: many });
    const res = await listMetricNames('org1', { service: 'checkout-api' });
    const [path, params] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/label/__name__/values');
    expect(params['match[]']).toEqual(['{service_name="checkout-api"}']);
    expect(res.values).toHaveLength(80);
    expect(res.total).toBe(120);
    expect(res.truncated).toBe(true);
  });

  it('listLabelNames queries /labels and caps at 40 (no matcher for empty scope)', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `l${i}`);
    mimirGet.mockResolvedValue({ status: 'success', data: many });
    const res = await listLabelNames('org1', {});
    const [path, params] = mimirGet.mock.calls[0];
    expect(path).toBe('/prometheus/api/v1/labels');
    expect(params['match[]']).toBeUndefined();
    expect(res.values).toHaveLength(40);
    expect(res.truncated).toBe(true);
  });

  it('grounding reads never throw — empty result when Mimir misbehaves', async () => {
    // Malformed (undefined) response → the SUT's own .data access throws inside its try/catch.
    mimirGet.mockResolvedValue(undefined);
    const metrics = await listMetricNames('org1', {});
    const labels = await listLabelNames('org1', {});
    expect(metrics).toEqual({ values: [], total: 0, truncated: false });
    expect(labels).toEqual({ values: [], total: 0, truncated: false });
  });
});
