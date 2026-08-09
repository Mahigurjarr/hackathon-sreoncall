import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindOneAndUpdate = vi.fn();

vi.mock('../../models/provider-consumer-link.model', () => ({
  ProviderConsumerLink: {
    findOneAndUpdate: (...a: any[]) => mockFindOneAndUpdate(...a),
  },
  ProviderConsumerLinkDocument: {},
}));

import { updateConsumerScope } from '../provider.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_ID  = new Types.ObjectId();
const CONSUMER_ID  = new Types.ObjectId();

function mockUpdatedLink(scope: string[]) {
  return {
    _id: new Types.ObjectId(),
    provider_tenant_id: PROVIDER_ID,
    consumer_tenant_id: { _id: CONSUMER_ID, slug: 'acme', name: 'Acme Corp' },
    scope,
    status: 'active',
  };
}

beforeEach(() => {
  mockFindOneAndUpdate.mockReset();
});

// ── updateConsumerScope ───────────────────────────────────────────────────────

describe('updateConsumerScope', () => {
  it('calls findOneAndUpdate with the correct filter, $set, and {new:true}', async () => {
    const scope = ['incidents', 'observability'];
    mockFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockResolvedValue(mockUpdatedLink(scope)),
    });

    await updateConsumerScope(PROVIDER_ID, CONSUMER_ID.toString(), scope);

    const [filter, update, opts] = mockFindOneAndUpdate.mock.calls[0];
    expect(String(filter.provider_tenant_id)).toBe(PROVIDER_ID.toString());
    expect(String(filter.consumer_tenant_id)).toBe(CONSUMER_ID.toString());
    expect(filter.status).toEqual({ $in: ['active', 'pending'] });
    expect(update).toEqual({ $set: { scope } });
    expect(opts).toMatchObject({ new: true });
  });

  it('populates consumer_tenant_id with slug and name', async () => {
    const scope = ['observability'];
    const populateMock = vi.fn().mockResolvedValue(mockUpdatedLink(scope));
    mockFindOneAndUpdate.mockReturnValue({ populate: populateMock });

    await updateConsumerScope(PROVIDER_ID, CONSUMER_ID.toString(), scope);

    expect(populateMock).toHaveBeenCalledWith('consumer_tenant_id', 'slug name');
  });

  it('returns the updated link document', async () => {
    const scope = ['incidents', 'tickets', 'observability'];
    mockFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockResolvedValue(mockUpdatedLink(scope)),
    });

    const result = await updateConsumerScope(PROVIDER_ID, CONSUMER_ID.toString(), scope);

    expect(result.scope).toEqual(scope);
    expect((result.consumer_tenant_id as any).slug).toBe('acme');
  });

  it('throws a 404 AppError when no matching link is found', async () => {
    mockFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockResolvedValue(null),
    });

    await expect(
      updateConsumerScope(PROVIDER_ID, CONSUMER_ID.toString(), ['observability']),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('works for pending links (not just active)', async () => {
    const scope = ['observability'];
    mockFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockResolvedValue({ ...mockUpdatedLink(scope), status: 'pending' }),
    });

    await updateConsumerScope(PROVIDER_ID, CONSUMER_ID.toString(), scope);

    const [filter] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter.status.$in).toContain('pending');
  });

  it('accepts an empty scope array (removes all scopes)', async () => {
    mockFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockResolvedValue(mockUpdatedLink([])),
    });

    const result = await updateConsumerScope(PROVIDER_ID, CONSUMER_ID.toString(), []);

    expect(result.scope).toEqual([]);
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set.scope).toEqual([]);
  });
});
