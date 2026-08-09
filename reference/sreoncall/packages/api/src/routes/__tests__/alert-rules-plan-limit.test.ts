/**
 * Regression test: the plan-limit counter for alert rules must only count
 * ACTIVE CUSTOM rules — not disabled rules, and not activated predefined
 * templates. Previously it counted every row in the collection, which
 * surfaced 82 rules against a 50-cap even though only 29 were
 * tenant-created + enabled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

const mockCountDocuments = vi.fn();

// `requirePlanLimit` internally calls `tenant.plan_limits[key]` and the
// provided counter. We pass through and observe the exact filter shape.
vi.mock('../../models/alert-rule.model', () => ({
  AlertRule: {
    countDocuments: (...args: any[]) => mockCountDocuments(...args),
  },
}));

vi.mock('../../middleware/rbac.middleware', () => ({
  rbac: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/audit.middleware', () => ({
  auditMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/alert-rule.service', () => ({
  createAlertRule: async () => ({ _id: 'new-rule', name: 'created' }),
  getAlertRuleById: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  listAlertRules: vi.fn(),
}));

vi.mock('../../services/alert-rule-evaluator.service', () => ({
  dryRunAlertRule: vi.fn(),
  testSavedAlertRule: vi.fn(),
}));

vi.mock('../../data/alert-templates', () => ({
  ALERT_TEMPLATES: [],
  getTemplatesByCategory: () => ({}),
}));

// Use the real signature: (planLimits, plan, limitKey, currentCount)
vi.mock('../../services/billing.service', () => ({
  checkLimit: (planLimits: any, plan: string, limitKey: string, current: number) => {
    const limit = planLimits[limitKey];
    const isUnlimited = limit === -1 || limit >= 9999;
    return { allowed: isUnlimited || current < limit, current, limit, plan, limit_key: limitKey };
  },
}));

async function buildApp(activeCustomCount: number, planLimit = 50) {
  mockCountDocuments.mockResolvedValue(activeCustomCount);
  const router = (await import('../alert-rules.routes')).default;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-1';
    req.userId = 'user-1';
    req.tenant = { plan: 'enterprise', plan_limits: { max_alert_rules: planLimit } };
    next();
  });
  app.use('/api/v1/alert-rules', router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof z.ZodError) return res.status(422).json({ issues: err.issues });
    res.status(500).json({ detail: err.message });
  });
  return app;
}

describe('POST /api/v1/alert-rules plan limit counter', () => {
  beforeEach(() => {
    mockCountDocuments.mockReset();
  });

  it('filters count to active + non-predefined rules only', async () => {
    const app = await buildApp(29);
    await request(app)
      .post('/api/v1/alert-rules')
      .send({
        name: 'Test',
        condition: { metric: 'up', operator: 'lt', threshold: 1 },
        source_type: 'managed_promql',
        query: 'up',
      });

    expect(mockCountDocuments).toHaveBeenCalledTimes(1);
    const filter = mockCountDocuments.mock.calls[0][0];
    expect(filter).toMatchObject({ tenant_id: 'tenant-1', status: 'active' });
    expect(filter.$or).toEqual([{ is_predefined: false }, { is_predefined: { $exists: false } }]);
  });

  it('allows creation when 29 active custom rules exist under a 50 cap', async () => {
    const app = await buildApp(29, 50);
    const res = await request(app)
      .post('/api/v1/alert-rules')
      .send({
        name: 'New',
        service_id: 'service-1',
        condition: { metric: 'up', operator: 'lt', threshold: 1 },
        source_type: 'managed_promql',
        query: 'up',
      });
    expect(res.status).toBe(201);
  });

  it('rejects with 402 when already at the cap', async () => {
    const app = await buildApp(50, 50);
    const res = await request(app)
      .post('/api/v1/alert-rules')
      .send({
        name: 'Over',
        condition: { metric: 'up', operator: 'lt', threshold: 1 },
        source_type: 'managed_promql',
        query: 'up',
      });
    expect(res.status).toBe(402);
    expect(res.body.title).toBe('Plan Limit Reached');
    expect(res.body.limit_key).toBe('max_alert_rules');
  });
});
