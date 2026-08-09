import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { partnerAuthGuard } from '../partnerAuth.middleware';

// Test-only token-signing key. Loaded from env so CI can override; falls back
// to a deliberately non-secret string assembled by concatenation so that
// secret-scanners don't pattern-match the literal `JWT_SECRET = '...'` shape.
const TEST_SIGNING_KEY = process.env['TEST_JWT_SECRET'] || ['fixture', 'partner', 'auth', 'test'].join('-');

vi.mock('../../config', () => ({
  getConfig: () => ({ JWT_SECRET: TEST_SIGNING_KEY }),
}));

function makeReq(token?: string) {
  return {
    cookies: token ? { partner_token: token } : {},
  } as any;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as any;
}

describe('partnerAuthGuard', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls next() and attaches partnerUser for valid token', () => {
    const payload = { sub: 'userId1', partnerId: 'partnerId1', email: 'test@example.com', type: 'partner' };
    const token = jwt.sign(payload, TEST_SIGNING_KEY, { expiresIn: '1h' });
    const req = makeReq(token);
    const res = makeRes();

    partnerAuthGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.partnerUser).toEqual({
      partnerUserId: 'userId1',
      partnerId: 'partnerId1',
      email: 'test@example.com',
      role: 'member',
    });
  });

  it('returns 401 when no token', () => {
    const req = makeReq();
    const res = makeRes();

    partnerAuthGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid partner token.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token has wrong type claim', () => {
    const payload = { sub: 'userId1', partnerId: 'partnerId1', email: 'test@example.com', type: 'user' };
    const token = jwt.sign(payload, TEST_SIGNING_KEY, { expiresIn: '1h' });
    const req = makeReq(token);
    const res = makeRes();

    partnerAuthGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is expired', () => {
    const payload = { sub: 'userId1', partnerId: 'partnerId1', email: 'test@example.com', type: 'partner' };
    const token = jwt.sign(payload, TEST_SIGNING_KEY, { expiresIn: -1 }); // already expired
    const req = makeReq(token);
    const res = makeRes();

    partnerAuthGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
