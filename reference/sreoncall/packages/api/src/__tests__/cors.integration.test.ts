import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';

vi.mock('../config/redis', () => ({
  getRedis: () => ({
    get: async () => null,
    setex: async () => undefined,
  }),
}));

vi.mock('../models/tenant.model', () => ({
  Tenant: {
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
  },
}));

import { isOriginAllowed } from '../utils/cors-allowlist';

function buildTestApp() {
  const app = express();
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        isOriginAllowed(origin)
          .then((allowed) => callback(null, allowed))
          .catch(() => callback(null, false));
      },
      credentials: true,
      maxAge: 86400,
    })
  );
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.options('/ping', (_req, res) => {
    res.status(204).end();
  });
  return app;
}

describe('CORS middleware', () => {
  const app = buildTestApp();

  it('does not set ACL headers for attacker origins', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://attacker.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not set ACL headers for null origin', async () => {
    const res = await request(app).get('/ping').set('Origin', 'null');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('echoes specific legitimate origin with credentials', async () => {
    const res = await request(app)
      .get('/ping')
      .set('Origin', 'https://web.sreoncall.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://web.sreoncall.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    // Explicit origin — never wildcard
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('does NOT trust customer tenant subdomains (attacker-controlled after signup)', async () => {
    const res = await request(app)
      .get('/ping')
      .set('Origin', 'https://attacker.sreoncall.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('preflight from attacker does not return ACL headers', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://attacker.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('preflight from legit origin allows credentials', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://web.sreoncall.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('https://web.sreoncall.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
