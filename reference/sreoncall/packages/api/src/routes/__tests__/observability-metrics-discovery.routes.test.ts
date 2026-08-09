import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_r: any, _s: any, n: any) => n() }));

const resolveOwnOrgId = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveOwnOrgId: (...a: any[]) => resolveOwnOrgId(...a),
}));

const listMetricNames = vi.fn();
const listMetricLabelNames = vi.fn();
const listMetricLabelValues = vi.fn();
const getMetricType = vi.fn();
vi.mock('../../services/observability-metrics-discovery.service', async (orig) => {
  const actual = await orig<any>();
  return {
    ...actual,
    listMetricNames: (...a: any[]) => listMetricNames(...a),
    listMetricLabelNames: (...a: any[]) => listMetricLabelNames(...a),
    listMetricLabelValues: (...a: any[]) => listMetricLabelValues(...a),
    getMetricType: (...a: any[]) => getMetricType(...a),
  };
});

import routes from '../observability-metrics-discovery.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => { req.tenantId = 't1'; next(); });
  a.use('/metrics-discovery', routes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

beforeEach(() => {
  resolveOwnOrgId.mockReset().mockResolvedValue('t1');
  listMetricNames.mockReset().mockResolvedValue({ values: ['up', 'http_requests_total'], total: 2, truncated: false });
  listMetricLabelNames.mockReset().mockResolvedValue({ values: ['cluster', 'namespace'], total: 2, truncated: false });
  listMetricLabelValues.mockReset().mockResolvedValue({ values: ['payments'], total: 1, truncated: false });
  getMetricType.mockReset().mockResolvedValue('counter');
});

describe('GET /metrics-discovery/metric-names', () => {
  it('returns the metric-name facet for the own tenant', async () => {
    const res = await request(app()).get('/metrics-discovery/metric-names?namespace=payments');
    expect(res.status).toBe(200);
    expect(res.body.metrics).toEqual(['up', 'http_requests_total']);
    expect(resolveOwnOrgId).toHaveBeenCalledWith('t1');
    expect(listMetricNames).toHaveBeenCalledWith('t1', { namespace: 'payments' });
  });
});

describe('GET /metrics-discovery/metric/:metric/labels', () => {
  it('returns label names for a clean metric name', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/http_requests_total/labels?cluster=c');
    expect(res.status).toBe(200);
    expect(res.body.labels).toEqual(['cluster', 'namespace']);
    expect(listMetricLabelNames).toHaveBeenCalledWith('t1', 'http_requests_total', { cluster: 'c' });
  });
  it('allows a metric name containing a colon (recording rule)', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/job:http_requests:rate5m/labels');
    expect(res.status).toBe(200);
    expect(listMetricLabelNames).toHaveBeenCalledWith('t1', 'job:http_requests:rate5m', {});
  });
  it('rejects an invalid metric name', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/bad name!/labels');
    expect(res.status).toBe(400);
  });
  it('allows a dotted vendor-style metric name (e.g. OTLP http.server.duration) — review fix #2', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/http.server.duration/labels');
    expect(res.status).toBe(200);
    expect(listMetricLabelNames).toHaveBeenCalledWith('t1', 'http.server.duration', {});
  });
});

describe('GET /metrics-discovery/metric/:metric/label/:name/values', () => {
  it('sanitizes the scope and returns values', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/http_requests_total/label/namespace/values?cluster=eks&consumer_id=x');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: 'namespace', values: ['payments'] });
    expect(listMetricLabelValues).toHaveBeenCalledWith('t1', 'http_requests_total', 'namespace', { cluster: 'eks' });
  });
  it('rejects an invalid label name', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/up/label/bad.name/values');
    expect(res.status).toBe(400);
  });
});

describe('GET /metrics-discovery/metric/:metric/type', () => {
  it('returns the metric type', async () => {
    const res = await request(app()).get('/metrics-discovery/metric/up/type');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ metric: 'up', type: 'counter' });
    expect(getMetricType).toHaveBeenCalledWith('t1', 'up');
  });
});
