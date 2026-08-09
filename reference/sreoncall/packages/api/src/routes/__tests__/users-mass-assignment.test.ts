import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockUpdateUser = vi.fn();
const mockSetUserRoles = vi.fn();

vi.mock('../../services/user.service', () => ({
  updateUser: (...args: any[]) => mockUpdateUser(...args),
  setUserRoles: (...args: any[]) => mockSetUserRoles(...args),
  listUsers: vi.fn(),
  getUserById: vi.fn(),
  inviteUser: vi.fn(),
  acceptInvite: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('../../middleware/audit.middleware', () => ({
  auditMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/rbac.middleware', () => ({
  rbac: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../models/user.model', () => ({
  User: { findOne: vi.fn() },
}));

vi.mock('../../models/tenant.model', () => ({
  Tenant: { findById: vi.fn() },
}));

// Re-import schemas/routes AFTER mocks so the route file picks up the mocked deps.
let usersRouter: any;
beforeEach(async () => {
  vi.resetModules();
  // mocks must be hoisted above imports, so re-require
  mockUpdateUser.mockReset();
  mockSetUserRoles.mockReset();
  usersRouter = (await import('../users.routes')).default;
});

function buildTestApp(userId = 'caller-id', roles = ['tenant_admin']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.userId = { toString: () => userId };
    req.tenantId = 'tenant-1';
    req.roles = roles;
    req.requestId = 'req-test';
    next();
  });
  app.use('/api/v1/users', usersRouter);
  // Error handler that mirrors prod: returns 422 for Zod errors
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof z.ZodError) {
      res.status(422).json({ title: 'Validation Error', issues: err.issues });
      return;
    }
    res.status(500).json({ title: 'Internal Server Error', detail: err.message });
  });
  return app;
}

describe('F-01 Mass assignment protection on PATCH /users/:id', () => {
  it('PATCH /users/:id silently drops `roles` from the payload (not in schema)', async () => {
    mockUpdateUser.mockResolvedValue({
      _id: 'victim',
      name: 'Victim',
      email: 'v@x.com',
      roles: ['agent'],
      status: 'active',
    });

    const app = buildTestApp();
    const res = await request(app)
      .patch('/api/v1/users/victim-id')
      .send({ name: 'new name', roles: ['platform_admin'] });

    // With strict Zod parsing, unknown fields are stripped by default,
    // so the request still succeeds (200) but roles never reaches the service.
    expect(res.status).toBe(200);
    const serviceCall = mockUpdateUser.mock.calls[0];
    const updatePayload = serviceCall[2];
    expect(updatePayload).not.toHaveProperty('roles');
    expect(updatePayload.name).toBe('new name');
  });
});

describe('F-01 PUT /users/:id/roles hardening', () => {
  it('rejects a user changing their own roles', async () => {
    const app = buildTestApp('self-id', ['tenant_admin']);
    const res = await request(app)
      .put('/api/v1/users/self-id/roles')
      .send({ roles: ['tenant_admin'] });
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/cannot change your own roles/i);
    expect(mockSetUserRoles).not.toHaveBeenCalled();
  });

  it('rejects platform-level role names outright (schema enum)', async () => {
    const app = buildTestApp('caller-id', ['tenant_admin']);
    for (const bad of ['platform_admin', 'super_admin', 'root', 'admin']) {
      const res = await request(app)
        .put('/api/v1/users/other-id/roles')
        .send({ roles: [bad] });
      expect(res.status).toBe(422);
    }
    expect(mockSetUserRoles).not.toHaveBeenCalled();
  });

  it('rejects assigning a role higher than the caller’s own rank', async () => {
    const app = buildTestApp('caller-id', ['agent']);
    const res = await request(app)
      .put('/api/v1/users/other-id/roles')
      .send({ roles: ['tenant_admin'] });
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/higher than your own/i);
    expect(mockSetUserRoles).not.toHaveBeenCalled();
  });

  it('allows tenant_admin to assign equal rank (tenant_admin → tenant_admin)', async () => {
    mockSetUserRoles.mockResolvedValue({
      _id: 'other-id', name: 'O', email: 'o@x.com', roles: ['tenant_admin'], status: 'active',
    });
    const app = buildTestApp('caller-id', ['tenant_admin']);
    const res = await request(app)
      .put('/api/v1/users/other-id/roles')
      .send({ roles: ['tenant_admin'] });
    expect(res.status).toBe(200);
  });

  it('allows a manager to assign a lower-tier role (agent)', async () => {
    mockSetUserRoles.mockResolvedValue({
      _id: 'other-id', name: 'O', email: 'o@x.com', roles: ['agent'], status: 'active',
    });
    const app = buildTestApp('caller-id', ['manager']);
    const res = await request(app)
      .put('/api/v1/users/other-id/roles')
      .send({ roles: ['agent'] });
    expect(res.status).toBe(200);
  });

  it('allows tenant_admin to assign tenant-safe roles to others', async () => {
    mockSetUserRoles.mockResolvedValue({
      _id: 'other-id',
      name: 'Other',
      email: 'o@x.com',
      roles: ['agent'],
      status: 'active',
    });
    const app = buildTestApp('caller-id', ['tenant_admin']);
    const res = await request(app)
      .put('/api/v1/users/other-id/roles')
      .send({ roles: ['agent'] });
    expect(res.status).toBe(200);
    expect(mockSetUserRoles).toHaveBeenCalledWith('tenant-1', 'other-id', ['agent']);
  });

  it('platform_admin can assign tenant_admin even without holding it themselves', async () => {
    mockSetUserRoles.mockResolvedValue({
      _id: 'other-id',
      name: 'Other',
      email: 'o@x.com',
      roles: ['tenant_admin'],
      status: 'active',
    });
    const app = buildTestApp('caller-id', ['platform_admin']);
    const res = await request(app)
      .put('/api/v1/users/other-id/roles')
      .send({ roles: ['tenant_admin'] });
    expect(res.status).toBe(200);
  });

  it('empty roles array is rejected', async () => {
    const app = buildTestApp('caller-id', ['tenant_admin']);
    const res = await request(app)
      .put('/api/v1/users/other-id/roles')
      .send({ roles: [] });
    expect(res.status).toBe(422);
  });
});
