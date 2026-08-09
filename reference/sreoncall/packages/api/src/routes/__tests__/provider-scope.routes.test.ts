import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUpdateConsumerScope = vi.fn();

vi.mock('../../services/provider.service', () => ({
  updateConsumerScope:        (...a: any[]) => mockUpdateConsumerScope(...a),
  getLinkedConsumers:         vi.fn().mockResolvedValue({ data: [], pagination: {} }),
  getConsumerDetail:          vi.fn().mockResolvedValue(null),
  getConsumerIncidents:       vi.fn().mockResolvedValue({ data: [], pagination: {} }),
  getConsumerTickets:         vi.fn().mockResolvedValue({ data: [], pagination: {} }),
  getConsumerChangeRequests:  vi.fn().mockResolvedValue({ data: [], pagination: {} }),
}));

vi.mock('../../middleware/rbac.middleware', () => ({
  rbac: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/tenantType.middleware', () => ({
  requireTenantType: () => (_req: any, _res: any, next: any) => next(),
}));

// Stub heavy service imports that provider.routes.ts transitively uses
vi.mock('../../services/provider/sla-tracking.service', () => ({ getSLAMetrics: vi.fn() }));
vi.mock('../../services/ticket.service', () => ({ createTicket: vi.fn() }));
vi.mock('../../services/ticket-bridge.service', () => ({
  createTicketBridge: vi.fn(),
  linkProviderTicketToConsumer: vi.fn(),
}));
vi.mock('../../models/project.model', () => ({ Project: { findOne: vi.fn() } }));
vi.mock('../../models/tenant.model', () => ({ Tenant: { findById: vi.fn() } }));
vi.mock('../../models/provider-consumer-link.model', () => ({
  ProviderConsumerLink: { findOne: vi.fn() },
}));
vi.mock('../../utils/pagination', () => ({
  parsePaginationParams: () => ({ limit: 20 }),
  buildCursorFilter: () => ({ filter: {}, sort: {} }),
  paginateResults: (_items: any[], _p: any, total: number) => ({ data: [], pagination: { total } }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_ID  = 'aaa000000000000000000001';
const CONSUMER_ID  = 'bbb000000000000000000001';

function mkUpdatedLink(scope: string[]) {
  return {
    _id: 'link-id',
    consumer_tenant_id: { _id: CONSUMER_ID, slug: 'acme', name: 'Acme Corp' },
    scope,
    status: 'active',
  };
}

let router: any;

beforeEach(async () => {
  vi.resetModules();
  mockUpdateConsumerScope.mockReset();
  router = (await import('../provider.routes')).default;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.tenantId = PROVIDER_ID;
    req.userId = 'user-1';
    next();
  });
  a.use('/', router);
  a.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof z.ZodError) return res.status(422).json({ issues: err.issues });
    res.status(err.status ?? 500).json({ detail: err.message });
  });
  return a;
}

// ── PATCH /consumers/:consumerId/scope ────────────────────────────────────────

describe('PATCH /consumers/:consumerId/scope', () => {
  it('updates scope and returns the refreshed link', async () => {
    const scope = ['incidents', 'observability'];
    mockUpdateConsumerScope.mockResolvedValue(mkUpdatedLink(scope));

    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope });

    expect(res.status).toBe(200);
    expect(res.body.scope).toEqual(scope);
    expect(res.body.consumer_name).toBe('Acme Corp');
  });

  it('calls updateConsumerScope with the correct tenantId, consumerId, and scope', async () => {
    const scope = ['observability', 'incidents'];
    mockUpdateConsumerScope.mockResolvedValue(mkUpdatedLink(scope));

    await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope });

    const [tenantId, consumerId, calledScope] = mockUpdateConsumerScope.mock.calls[0];
    expect(String(tenantId)).toBe(PROVIDER_ID);
    expect(consumerId).toBe(CONSUMER_ID);
    expect(calledScope).toEqual(scope);
  });

  it('accepts an empty scope array (removes all permissions)', async () => {
    mockUpdateConsumerScope.mockResolvedValue(mkUpdatedLink([]));

    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope: [] });

    expect(res.status).toBe(200);
    expect(res.body.scope).toEqual([]);
  });

  it('returns 422 when scope contains an unknown value', async () => {
    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope: ['incidents', 'unknown_scope'] });

    expect(res.status).toBe(422);
    expect(mockUpdateConsumerScope).not.toHaveBeenCalled();
  });

  it('returns 422 when scope is not an array', async () => {
    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope: 'observability' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when the request body is missing scope entirely', async () => {
    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('surfaces 404 when the consumer link does not exist', async () => {
    const err: any = new Error('Consumer link not found');
    err.status = 404;
    mockUpdateConsumerScope.mockRejectedValue(err);

    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope: ['observability'] });

    expect(res.status).toBe(404);
  });

  it('accepts all valid scope values without error', async () => {
    const allScopes = [
      'incidents', 'escalations', 'oncall', 'runbooks',
      'communications', 'tickets', 'changes', 'managed_support', 'observability',
    ];
    mockUpdateConsumerScope.mockResolvedValue(mkUpdatedLink(allScopes));

    const res = await request(app())
      .patch(`/consumers/${CONSUMER_ID}/scope`)
      .send({ scope: allScopes });

    expect(res.status).toBe(200);
    expect(res.body.scope).toHaveLength(allScopes.length);
  });
});
