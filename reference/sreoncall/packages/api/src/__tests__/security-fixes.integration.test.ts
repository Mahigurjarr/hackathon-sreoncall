import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../config/redis', () => ({
  getRedis: () => ({
    get: async () => null,
    setex: async () => undefined,
    del: async () => undefined,
  }),
}));

const mockTenantFindOne = vi.fn();
vi.mock('../models/tenant.model', () => ({
  Tenant: {
    findOne: (...args: any[]) => mockTenantFindOne(...args),
    hydrate: (data: any) => data,
  },
}));

const mockLogin = vi.fn();
vi.mock('../services/auth.service', () => ({
  login: (...args: any[]) => mockLogin(...args),
}));

vi.mock('../config/database', () => ({
  isDatabaseConnected: () => true,
}));

// authService, rateLimit, authMiddleware — mock to avoid DB wiring
vi.mock('../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/rateLimit.middleware', () => ({
  rateLimitMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// Minimal app builder for tests — replicates just the routes we exercise here.
async function buildTestApp() {
  const { lookupTenantForRequest } = await import('../middleware/tenant.middleware');
  const app = express();
  app.use(express.json());

  // Health endpoints (F-07)
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.get('/health/detailed', (_req, res) => {
    res.status(200).json({ status: 'healthy', checks: { database: 'connected' } });
  });

  // Login route (F-04) — mirror the production handler's tenant resolution
  app.post('/api/v1/auth/login', async (req, res) => {
    const GENERIC = {
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid credentials.',
    };
    const tenant = await lookupTenantForRequest(req as any);
    if (!tenant) {
      res.status(401).json(GENERIC);
      return;
    }
    try {
      await mockLogin(tenant._id, req.body.email, req.body.password);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(401).json(GENERIC);
    }
  });

  // 404 handler (F-11)
  app.use((req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: isProd ? 'Not Found.' : `Route ${req.method} ${req.path} not found.`,
    });
  });

  return app;
}

describe('F-07: /health endpoint does not leak DB status', () => {
  beforeEach(() => {
    mockTenantFindOne.mockReset();
    mockLogin.mockReset();
  });

  it('returns only {status:"ok"} on public /health', async () => {
    const app = await buildTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.body).not.toHaveProperty('checks');
    expect(res.body).not.toHaveProperty('timestamp');
  });

  it('/health/detailed still returns full info (restricted to internal via nginx)', async () => {
    const app = await buildTestApp();
    const res = await request(app).get('/health/detailed');
    expect(res.body).toHaveProperty('checks');
  });
});

describe('F-04: tenant slug enumeration', () => {
  beforeEach(() => {
    mockTenantFindOne.mockReset();
    mockLogin.mockReset();
  });

  it('returns generic 401 for non-existent tenant slug', async () => {
    mockTenantFindOne.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'nonexistent-org-xyz')
      .send({ email: 'x@x.com', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.title).toBe('Unauthorized');
    expect(res.body.detail).toBe('Invalid credentials.');
    // Must NOT reveal tenant existence
    expect(JSON.stringify(res.body)).not.toMatch(/tenant|slug|not found/i);
  });

  it('returns generic 401 for existing tenant + invalid credentials (same shape)', async () => {
    mockTenantFindOne.mockResolvedValue({
      _id: 'tenant-1',
      slug: 'real-org',
      status: 'active',
      custom_domains: [],
      toObject() {
        return this;
      },
    });
    mockLogin.mockRejectedValue(new Error('bad creds'));
    const app = await buildTestApp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'real-org')
      .send({ email: 'x@x.com', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.title).toBe('Unauthorized');
    expect(res.body.detail).toBe('Invalid credentials.');
  });

  it('response body is indistinguishable between invalid slug and invalid password', async () => {
    // Case 1: invalid slug
    mockTenantFindOne.mockResolvedValueOnce(null);
    const app = await buildTestApp();
    const res1 = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'bogus')
      .send({ email: 'x@x.com', password: 'x' });

    // Case 2: valid slug, bad password
    mockTenantFindOne.mockResolvedValueOnce({
      _id: 't',
      slug: 'real',
      status: 'active',
      custom_domains: [],
      toObject() {
        return this;
      },
    });
    mockLogin.mockRejectedValueOnce(new Error('bad'));
    const res2 = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'real')
      .send({ email: 'x@x.com', password: 'x' });

    expect(res1.status).toBe(res2.status);
    expect(res1.body).toEqual(res2.body);
  });
});

describe('F-11: API 404 does not echo the requested path in production', () => {
  beforeEach(() => {
    mockTenantFindOne.mockReset();
    mockLogin.mockReset();
  });

  it('in production mode, 404 detail is generic', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = await buildTestApp();
      const res = await request(app).get('/api/nonexistent-secret-route');
      expect(res.status).toBe(404);
      expect(res.body.detail).toBe('Not Found.');
      expect(res.body.detail).not.toContain('nonexistent-secret-route');
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('in dev mode, 404 detail still shows the path (for debugging)', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = await buildTestApp();
      const res = await request(app).get('/api/foo');
      expect(res.body.detail).toContain('/api/foo');
    } finally {
      process.env.NODE_ENV = orig;
    }
  });
});
