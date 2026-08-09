import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/platform/feature-flag.service', () => ({
  getAllEffectiveValues: async (_t: string) => ({ observability_discovery_enabled: true, billing_enabled: false }),
}));

import featureFlagsRoutes from '../feature-flags.routes';

function app() {
  const a = express();
  a.use((req: any, _res, next) => {
    req.tenantId = 't1';
    req.roles = ['tenant_admin'];
    next();
  });
  a.use('/feature-flags', featureFlagsRoutes);
  return a;
}

describe('GET /feature-flags/effective', () => {
  it('returns the effective flag map for the current tenant', async () => {
    const res = await request(app()).get('/feature-flags/effective');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: { observability_discovery_enabled: true, billing_enabled: false } });
  });
});
