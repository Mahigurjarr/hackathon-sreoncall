import { describe, it, expect, vi, beforeEach } from 'vitest';

const { find } = vi.hoisted(() => ({
  find: vi.fn(),
}));

vi.mock('../../models/observability-connection.model', () => ({
  ObservabilityConnection: {
    find,
  },
}));

const redisGet = vi.fn();
const redisSetex = vi.fn();

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    get: redisGet,
    setex: redisSetex,
  }),
}));

import { validateProviderDrainToken } from '../provider-drain-auth.service';

describe('validateProviderDrainToken', () => {
  beforeEach(() => {
    find.mockReset();
    redisGet.mockReset();
    redisSetex.mockReset();
    redisGet.mockResolvedValue(null);
    redisSetex.mockResolvedValue(undefined);
  });

  it('returns false for unsupported providers', async () => {
    await expect(validateProviderDrainToken('tenant-1', 'aws', 'secret')).resolves.toBe(false);
    expect(find).not.toHaveBeenCalled();
  });

  it('returns false when no matching connection exists', async () => {
    find.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(validateProviderDrainToken('tenant-1', 'vercel', 'secret')).resolves.toBe(false);
    expect(find).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      status: { $in: ['pending', 'connected', 'error'] },
      'config.cloud_provider': 'vercel',
    });
  });

  it('allows legacy provider drains when enforcement is not enabled', async () => {
    find.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: 'conn-1', config: {} }]),
      }),
    });

    await expect(validateProviderDrainToken('tenant-1', 'supabase', 'secret')).resolves.toBe(true);
  });

  it('requires an exact token match for new enforced connections', async () => {
    find.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          { _id: 'conn-1', config: { enforce_drain_token: true, drain_token: 'correct-token' } },
        ]),
      }),
    });

    await expect(validateProviderDrainToken('tenant-1', 'supabase', 'wrong-token')).resolves.toBe(false);
    await expect(validateProviderDrainToken('tenant-1', 'supabase', 'correct-token')).resolves.toBe(true);
  });
});
