import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// ─── Mock dependencies ───────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockFindOne = vi.fn();
const mockFind = vi.fn();
const mockFindById = vi.fn();
vi.mock('../../models/activation-code.model', () => ({
  ActivationCode: {
    create: (...args: any[]) => mockCreate(...args),
    findOne: (...args: any[]) => mockFindOne(...args),
    find: (...args: any[]) => ({
      sort: () => ({ skip: () => ({ limit: () => mockFind() }) }),
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
    findByIdAndUpdate: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../models/tenant.model', () => ({
  Tenant: {
    findById: (...args: any[]) => mockFindById(...args),
  },
}));

vi.mock('../../models/billing.model', () => ({
  Subscription: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../services/billing.service', () => ({
  getPlanLimitsFromDB: vi.fn().mockResolvedValue({ max_users: 50 }),
  notifyPlanChange: vi.fn(),
}));

vi.mock('../../services/plan-change-notification.service', () => ({
  notifyPlanChange: vi.fn(),
}));

vi.mock('../../services/email.service', () => ({
  sendActivationCodeEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    ...actual,
    startSession: () =>
      Promise.resolve({
        withTransaction: async (fn: Function) => fn(),
        endSession: vi.fn(),
      }),
  };
});

import * as service from '../activation-code.service';

// ─── Tests ────────────────────────────────────────────────────────────────────

const TENANT_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

describe('generateCode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a code with SREOC- prefix and correct shape', async () => {
    mockCreate.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      code: 'SREOC-TEST-CODE-ABCD',
      tenant_id: TENANT_ID,
      plan: 'growth',
      duration_months: 12,
      status: 'pending',
      expires_at: new Date(),
      generated_by: 'admin@sreoncall.com',
      email_sent: false,
    });

    const result = await service.generateCode({
      tenantId: TENANT_ID.toString(),
      plan: 'growth',
      durationMonths: 12,
      expiresAt: new Date(Date.now() + 14 * 86400_000),
      generatedBy: 'admin@sreoncall.com',
      sendEmail: false,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.code).toMatch(/^SREOC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(callArg.plan).toBe('growth');
    expect(callArg.duration_months).toBe(12);
    expect(result.status).toBe('pending');
  });
});

describe('redeemCode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when code not found', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    await expect(
      service.redeemCode({ code: 'SREOC-FAKE-CODE-1234', tenantId: TENANT_ID, userId: USER_ID })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 when tenant_id does not match', async () => {
    const otherTenant = new Types.ObjectId();
    mockFindOne.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      code: 'SREOC-A3KM-7PXR-9VWZ',
      tenant_id: otherTenant,
      plan: 'growth',
      duration_months: 12,
      status: 'pending',
      expires_at: new Date(Date.now() + 86400_000),
    });
    await expect(
      service.redeemCode({ code: 'SREOC-A3KM-7PXR-9VWZ', tenantId: TENANT_ID, userId: USER_ID })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 400 when code is already redeemed', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      code: 'SREOC-A3KM-7PXR-9VWZ',
      tenant_id: TENANT_ID,
      status: 'redeemed',
      expires_at: new Date(Date.now() + 86400_000),
    });
    await expect(
      service.redeemCode({ code: 'SREOC-A3KM-7PXR-9VWZ', tenantId: TENANT_ID, userId: USER_ID })
    ).rejects.toMatchObject({ statusCode: 400, message: 'This code has already been used' });
  });

  it('throws 400 when code is expired', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      code: 'SREOC-A3KM-7PXR-9VWZ',
      tenant_id: TENANT_ID,
      status: 'pending',
      expires_at: new Date(Date.now() - 86400_000), // past
    });
    await expect(
      service.redeemCode({ code: 'SREOC-A3KM-7PXR-9VWZ', tenantId: TENANT_ID, userId: USER_ID })
    ).rejects.toMatchObject({ statusCode: 400, message: 'This code has expired' });
  });

  it('throws 400 when code is revoked', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      code: 'SREOC-A3KM-7PXR-9VWZ',
      tenant_id: TENANT_ID,
      status: 'revoked',
      expires_at: new Date(Date.now() + 86400_000),
    });
    await expect(
      service.redeemCode({ code: 'SREOC-A3KM-7PXR-9VWZ', tenantId: TENANT_ID, userId: USER_ID })
    ).rejects.toMatchObject({ statusCode: 400, message: 'This code is no longer valid' });
  });
});

describe('generateCodeString', () => {
  it('produces SREOC-XXXX-XXXX-XXXX format with no ambiguous chars in segments', () => {
    for (let i = 0; i < 20; i++) {
      const code = service.generateCodeString();
      expect(code).toMatch(/^SREOC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      // Segments only (after the fixed SREOC- prefix) must not contain ambiguous chars
      const segments = code.slice('SREOC-'.length);
      expect(segments).not.toMatch(/[01ILO]/);
    }
  });
});
