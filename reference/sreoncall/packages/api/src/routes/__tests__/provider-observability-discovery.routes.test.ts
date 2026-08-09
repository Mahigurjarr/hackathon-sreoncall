import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_req: any, _res: any, next: any) => next() }));
const resolveConsumerOrgId = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveConsumerOrgId: (...a: any[]) => resolveConsumerOrgId(...a),
}));
const getChildren = vi.fn();
const getLevelHealth = vi.fn();
vi.mock('../../services/observability-discovery.service', () => ({
  getChildren: (...a: any[]) => getChildren(...a),
  getLevelHealth: (...a: any[]) => getLevelHealth(...a),
  listLabelValues: vi.fn(),
}));

import providerDiscoveryRoutes from '../provider-observability-discovery.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => {
    req.tenantId = 'prov1';
    req.roles = ['tenant_admin'];
    next();
  });
  a.use('/provider/observability/discovery', providerDiscoveryRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

describe('GET /provider/observability/discovery/children', () => {
  it('resolves consumer org and returns values', async () => {
    resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
    getChildren.mockResolvedValue({ values: ['eks-prod-eu'], total: 1, truncated: false });
    getLevelHealth.mockResolvedValue({ healthy: 1, total: 1 });
    const res = await request(app()).get('/provider/observability/discovery/children?level=cluster&consumer_id=A');
    expect(res.status).toBe(200);
    expect(resolveConsumerOrgId).toHaveBeenCalledWith('prov1', 'A');
    expect(getChildren).toHaveBeenCalledWith('cust-A', 'cluster', {});
    expect(getLevelHealth).toHaveBeenCalledWith('cust-A', 'cluster', {});
    expect(res.body.values).toEqual(['eks-prod-eu']);
    expect(res.body.health).toEqual({ healthy: 1, total: 1 });
  });

  it('404 when consumer has no managed observability', async () => {
    resolveConsumerOrgId.mockResolvedValue(null);
    const res = await request(app()).get('/provider/observability/discovery/children?level=cluster&consumer_id=X');
    expect(res.status).toBe(404);
  });
});
