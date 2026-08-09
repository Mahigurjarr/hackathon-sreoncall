import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../../services/observability-upstream.service', () => ({ resolveOwnOrgId: async (t: string) => `org-${t}` }));
const getChildren = vi.fn();
const getLevelHealth = vi.fn();
vi.mock('../../services/observability-discovery.service', () => ({
  getChildren: (...a: any[]) => getChildren(...a),
  getLevelHealth: (...a: any[]) => getLevelHealth(...a),
  listLabelValues: vi.fn(),
}));

import discoveryRoutes from '../observability-discovery.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => {
    req.tenantId = 't1';
    req.roles = ['tenant_admin'];
    next();
  });
  a.use('/observability/discovery', discoveryRoutes);
  // minimal RFC7807-ish error serializer
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

describe('GET /observability/discovery/children', () => {
  it('returns capped values for the requested level + scope', async () => {
    getChildren.mockResolvedValue({ values: ['payments'], total: 1, truncated: false });
    getLevelHealth.mockResolvedValue({ healthy: 1, total: 1 });
    const res = await request(app()).get('/observability/discovery/children?level=namespace&cluster=eks-prod-eu');
    expect(res.status).toBe(200);
    expect(getChildren).toHaveBeenCalledWith('org-t1', 'namespace', { cluster: 'eks-prod-eu' });
    expect(getLevelHealth).toHaveBeenCalledWith('org-t1', 'namespace', { cluster: 'eks-prod-eu' });
    expect(res.body).toEqual({
      level: 'namespace',
      values: ['payments'],
      total: 1,
      truncated: false,
      health: { healthy: 1, total: 1 },
    });
  });

  it('400 on invalid level', async () => {
    const res = await request(app()).get('/observability/discovery/children?level=bogus');
    expect(res.status).toBe(400);
  });
});
