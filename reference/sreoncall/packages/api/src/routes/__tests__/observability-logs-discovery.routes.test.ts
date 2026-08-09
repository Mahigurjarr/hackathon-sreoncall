import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_r: any, _s: any, n: any) => n() }));

const resolveLogsEndpoint = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveLogsEndpoint: (...a: any[]) => resolveLogsEndpoint(...a),
  MANAGED_LOKI_URL: 'http://managed-loki',
}));

const listLogLabelNames = vi.fn();
const listLogLabelValues = vi.fn();
vi.mock('../../services/observability-logs-discovery.service', async (orig) => {
  const actual = await orig<any>();
  return { ...actual, listLogLabelNames: (...a: any[]) => listLogLabelNames(...a), listLogLabelValues: (...a: any[]) => listLogLabelValues(...a) };
});

import routes from '../observability-logs-discovery.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => { req.tenantId = 't1'; next(); });
  a.use('/logs-discovery', routes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

beforeEach(() => {
  resolveLogsEndpoint.mockReset().mockResolvedValue({ url: 'http://byos-loki', orgId: 't1' });
  listLogLabelNames.mockReset().mockResolvedValue({ values: ['cluster', 'namespace'], total: 2, truncated: false });
  listLogLabelValues.mockReset().mockResolvedValue({ values: ['payments'], total: 1, truncated: false });
});

describe('GET /logs-discovery/labels', () => {
  it('returns the facet list from the resolved (BYOS) endpoint', async () => {
    const res = await request(app()).get('/logs-discovery/labels');
    expect(res.status).toBe(200);
    expect(res.body.labels).toEqual(['cluster', 'namespace']);
    expect(listLogLabelNames).toHaveBeenCalledWith('http://byos-loki', 't1');
  });
});

describe('GET /logs-discovery/label/:name/values', () => {
  it('sanitizes the selection and scopes values', async () => {
    const res = await request(app()).get('/logs-discovery/label/namespace/values?cluster=eks&consumer_id=x&bad.key=y');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: 'namespace', values: ['payments'] });
    expect(listLogLabelValues).toHaveBeenCalledWith('http://byos-loki', 't1', 'namespace', { cluster: 'eks' });
  });
  it('rejects an invalid label name', async () => {
    const res = await request(app()).get('/logs-discovery/label/bad.name/values');
    expect(res.status).toBe(400);
  });
});
