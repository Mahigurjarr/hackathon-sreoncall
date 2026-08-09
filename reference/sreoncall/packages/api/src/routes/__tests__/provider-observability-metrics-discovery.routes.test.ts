import { it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_r: any, _s: any, n: any) => n() }));

const resolveConsumerOrgId = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveConsumerOrgId: (...a: any[]) => resolveConsumerOrgId(...a),
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

import routes from '../provider-observability-metrics-discovery.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => { req.tenantId = 'prov1'; next(); });
  a.use('/metrics-discovery', routes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

beforeEach(() => {
  resolveConsumerOrgId.mockReset();
  listMetricNames.mockReset().mockResolvedValue({ values: ['up'], total: 1, truncated: false });
  listMetricLabelNames.mockReset().mockResolvedValue({ values: ['cluster'], total: 1, truncated: false });
  listMetricLabelValues.mockReset().mockResolvedValue({ values: ['payments'], total: 1, truncated: false });
  getMetricType.mockReset().mockResolvedValue('gauge');
});

it('resolves the consumer org and queries managed Mimir for label values', async () => {
  resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
  const res = await request(app()).get('/metrics-discovery/metric/up/label/instance/values?consumer_id=A&cluster=eks');
  expect(res.status).toBe(200);
  expect(resolveConsumerOrgId).toHaveBeenCalledWith('prov1', 'A');
  expect(listMetricLabelValues).toHaveBeenCalledWith('cust-A', 'up', 'instance', { cluster: 'eks' });
});

it('resolves the consumer org for metric-names', async () => {
  resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
  const res = await request(app()).get('/metrics-discovery/metric-names?consumer_id=A');
  expect(res.status).toBe(200);
  expect(listMetricNames).toHaveBeenCalledWith('cust-A', {});
});

it('resolves the consumer org for metric type', async () => {
  resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
  const res = await request(app()).get('/metrics-discovery/metric/up/type?consumer_id=A');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ metric: 'up', type: 'gauge' });
});

it('404 when the consumer has no managed observability link', async () => {
  resolveConsumerOrgId.mockResolvedValue(null);
  const res = await request(app()).get('/metrics-discovery/metric-names?consumer_id=X');
  expect(res.status).toBe(404);
});

it('allows a dotted vendor-style metric name (e.g. OTLP http.server.duration) — review fix #2', async () => {
  resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
  const res = await request(app()).get('/metrics-discovery/metric/http.server.duration/labels?consumer_id=A');
  expect(res.status).toBe(200);
  expect(listMetricLabelNames).toHaveBeenCalledWith('cust-A', 'http.server.duration', {});
});
