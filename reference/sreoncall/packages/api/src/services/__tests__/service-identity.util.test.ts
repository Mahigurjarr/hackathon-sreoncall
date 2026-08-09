import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

const findMock = vi.fn();
const updateOneMock = vi.fn();

vi.mock('../../models/service.model', () => ({
  Service: {
    find: (...args: any[]) => findMock(...args),
    updateOne: (...args: any[]) => updateOneMock(...args),
  },
}));

import {
  normalizeServiceName,
  buildServiceNameIndex,
  registerServiceInIndex,
  resolveServiceByName,
} from '../service-identity.util';

const TENANT = new Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
  updateOneMock.mockResolvedValue({});
});

describe('normalizeServiceName', () => {
  it('strips generic workload suffixes', () => {
    expect(normalizeServiceName('checkout-svc')).toBe('checkout');
    expect(normalizeServiceName('checkout-service')).toBe('checkout');
    expect(normalizeServiceName('checkout-deployment')).toBe('checkout');
    expect(normalizeServiceName('checkout-deploy')).toBe('checkout');
  });

  it('leaves semantically meaningful suffixes untouched', () => {
    expect(normalizeServiceName('payment-api')).toBe('payment-api');
    expect(normalizeServiceName('payment-worker')).toBe('payment-worker');
    expect(normalizeServiceName('order-gateway')).toBe('order-gateway');
    expect(normalizeServiceName('user-cache')).toBe('user-cache');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeServiceName('  Checkout-SVC  ')).toBe('checkout');
    expect(normalizeServiceName('Checkout')).toBe('checkout');
  });

  it('leaves a bare name with no matching suffix unchanged', () => {
    expect(normalizeServiceName('checkout')).toBe('checkout');
  });
});

function mockExistingServices(services: Array<{ _id: Types.ObjectId; name: string; aliases?: string[] }>) {
  findMock.mockReturnValue({
    select: () => ({
      lean: () => Promise.resolve(services),
    }),
  });
}

describe('buildServiceNameIndex + resolveServiceByName', () => {
  it('resolves an exact name match without touching the database', async () => {
    const id = new Types.ObjectId();
    mockExistingServices([{ _id: id, name: 'checkout-svc' }]);

    const index = await buildServiceNameIndex(TENANT);
    const result = await resolveServiceByName(index, 'checkout-svc');

    expect(result?.serviceId).toEqual(id);
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('resolves an exact alias match', async () => {
    const id = new Types.ObjectId();
    mockExistingServices([{ _id: id, name: 'checkout-svc', aliases: ['checkout'] }]);

    const index = await buildServiceNameIndex(TENANT);
    const result = await resolveServiceByName(index, 'checkout');

    expect(result?.serviceId).toEqual(id);
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('resolves a normalized match and records the raw name as a new alias', async () => {
    const id = new Types.ObjectId();
    mockExistingServices([{ _id: id, name: 'checkout-svc' }]);

    const index = await buildServiceNameIndex(TENANT);
    const result = await resolveServiceByName(index, 'checkout');

    expect(result?.serviceId).toEqual(id);
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: id },
      { $addToSet: { aliases: 'checkout' } },
    );
  });

  it('does not re-write the alias on a second lookup within the same index', async () => {
    const id = new Types.ObjectId();
    mockExistingServices([{ _id: id, name: 'checkout-svc' }]);

    const index = await buildServiceNameIndex(TENANT);
    await resolveServiceByName(index, 'checkout');
    await resolveServiceByName(index, 'checkout');

    expect(updateOneMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for a genuinely different service name (no false merge)', async () => {
    const id = new Types.ObjectId();
    mockExistingServices([{ _id: id, name: 'payment-api' }]);

    const index = await buildServiceNameIndex(TENANT);
    const result = await resolveServiceByName(index, 'payment-worker');

    expect(result).toBeNull();
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('registerServiceInIndex makes a newly-created service resolvable without a DB round trip', async () => {
    mockExistingServices([]);
    const index = await buildServiceNameIndex(TENANT);

    const newId = new Types.ObjectId();
    registerServiceInIndex(index, { _id: newId, name: 'checkout-svc' });

    const exact = await resolveServiceByName(index, 'checkout-svc');
    expect(exact?.serviceId).toEqual(newId);

    const normalized = await resolveServiceByName(index, 'checkout');
    expect(normalized?.serviceId).toEqual(newId);
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: newId },
      { $addToSet: { aliases: 'checkout' } },
    );
  });
});
