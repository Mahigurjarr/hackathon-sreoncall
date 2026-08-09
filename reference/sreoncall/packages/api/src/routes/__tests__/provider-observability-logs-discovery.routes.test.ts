import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_r: any, _s: any, n: any) => n() }));

const resolveConsumerOrgId = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveConsumerOrgId: (...a: any[]) => resolveConsumerOrgId(...a),
  MANAGED_LOKI_URL: 'http://managed-loki',
}));

const listLogLabelValues = vi.fn();
const listLogLabelNames = vi.fn();
vi.mock('../../services/observability-logs-discovery.service', async (orig) => {
  const actual = await orig<any>();
  return { ...actual, listLogLabelNames: (...a: any[]) => listLogLabelNames(...a), listLogLabelValues: (...a: any[]) => listLogLabelValues(...a) };
});

import routes from '../provider-observability-logs-discovery.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => { req.tenantId = 'prov1'; next(); });
  a.use('/logs-discovery', routes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

beforeEach(() => {
  resolveConsumerOrgId.mockReset();
  listLogLabelNames.mockReset().mockResolvedValue({ values: ['cluster'], total: 1, truncated: false });
  listLogLabelValues.mockReset().mockResolvedValue({ values: ['payments'], total: 1, truncated: false });
});

it('resolves the consumer org and queries MANAGED_LOKI_URL (managed-only)', async () => {
  resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
  const res = await request(app()).get('/logs-discovery/label/namespace/values?consumer_id=A&cluster=eks');
  expect(res.status).toBe(200);
  expect(resolveConsumerOrgId).toHaveBeenCalledWith('prov1', 'A');
  expect(listLogLabelValues).toHaveBeenCalledWith('http://managed-loki', 'cust-A', 'namespace', { cluster: 'eks' });
});

it('404 when the consumer has no managed observability link', async () => {
  resolveConsumerOrgId.mockResolvedValue(null);
  const res = await request(app()).get('/logs-discovery/labels?consumer_id=X');
  expect(res.status).toBe(404);
});
