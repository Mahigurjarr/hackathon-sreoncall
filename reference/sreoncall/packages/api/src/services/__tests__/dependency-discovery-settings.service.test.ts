import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

const findOneMock = vi.fn();
const createMock = vi.fn();

vi.mock('../../models/dependency-discovery-settings.model', () => ({
  DependencyDiscoverySettings: {
    findOne: (...args: any[]) => findOneMock(...args),
    create: (...args: any[]) => createMock(...args),
  },
}));

import { getSettings, updateSettings, bumpNextRunAfterManualTrigger, intervalToMs } from '../dependency-discovery-settings.service';

const TENANT = new Types.ObjectId();

interface MockSettingsDoc {
  tenant_id: Types.ObjectId;
  otel_trace_scanning_enabled: boolean;
  schedule_interval: '1h' | '6h' | '12h' | '24h';
  observability_connection_id: Types.ObjectId | null;
  next_run_at: Date | null;
  save: () => Promise<void>;
}

function buildDoc(overrides: Partial<MockSettingsDoc> = {}): MockSettingsDoc {
  return {
    tenant_id: TENANT,
    otel_trace_scanning_enabled: false,
    schedule_interval: '6h',
    observability_connection_id: null,
    next_run_at: null,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('intervalToMs', () => {
  it('maps each interval to the correct millisecond value', () => {
    expect(intervalToMs('1h')).toBe(60 * 60_000);
    expect(intervalToMs('6h')).toBe(6 * 60 * 60_000);
    expect(intervalToMs('12h')).toBe(12 * 60 * 60_000);
    expect(intervalToMs('24h')).toBe(24 * 60 * 60_000);
  });
});

describe('getSettings', () => {
  it('returns the existing doc without creating one', async () => {
    const doc = buildDoc();
    findOneMock.mockResolvedValue(doc);

    const result = await getSettings(TENANT);
    expect(result).toBe(doc);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('lazily creates a doc when none exists', async () => {
    findOneMock.mockResolvedValue(null);
    const created = buildDoc();
    createMock.mockResolvedValue(created);

    const result = await getSettings(TENANT);
    expect(result).toBe(created);
    expect(createMock).toHaveBeenCalledWith({ tenant_id: TENANT });
  });
});

describe('updateSettings', () => {
  it('sets next_run_at on fresh enable', async () => {
    const doc = buildDoc({ otel_trace_scanning_enabled: false, next_run_at: null });
    findOneMock.mockResolvedValue(doc);

    const before = Date.now();
    await updateSettings(TENANT, { otel_trace_scanning_enabled: true });

    expect(doc.otel_trace_scanning_enabled).toBe(true);
    expect(doc.next_run_at).not.toBeNull();
    expect(doc.next_run_at!.getTime()).toBeGreaterThanOrEqual(before + intervalToMs('6h') - 1000);
    expect(doc.save).toHaveBeenCalled();
  });

  it('recomputes next_run_at when the interval changes while enabled', async () => {
    const doc = buildDoc({ otel_trace_scanning_enabled: true, schedule_interval: '24h', next_run_at: new Date(Date.now() + 999_999) });
    findOneMock.mockResolvedValue(doc);

    await updateSettings(TENANT, { schedule_interval: '1h' });

    expect(doc.schedule_interval).toBe('1h');
    const expectedApprox = Date.now() + intervalToMs('1h');
    expect(Math.abs(doc.next_run_at!.getTime() - expectedApprox)).toBeLessThan(2000);
  });

  it('does not touch next_run_at when nothing relevant changed', async () => {
    const fixedDate = new Date(Date.now() + 12345);
    const doc = buildDoc({ otel_trace_scanning_enabled: true, schedule_interval: '6h', next_run_at: fixedDate });
    findOneMock.mockResolvedValue(doc);

    await updateSettings(TENANT, { observability_connection_id: null });

    expect(doc.next_run_at).toBe(fixedDate);
  });

  it('clears next_run_at when disabled', async () => {
    const doc = buildDoc({ otel_trace_scanning_enabled: true, next_run_at: new Date() });
    findOneMock.mockResolvedValue(doc);

    await updateSettings(TENANT, { otel_trace_scanning_enabled: false });

    expect(doc.next_run_at).toBeNull();
  });

  it('sets observability_connection_id from a string id, or null', async () => {
    const doc = buildDoc();
    findOneMock.mockResolvedValue(doc);
    const connId = new Types.ObjectId().toString();

    await updateSettings(TENANT, { observability_connection_id: connId });
    expect(doc.observability_connection_id?.toString()).toBe(connId);

    await updateSettings(TENANT, { observability_connection_id: null });
    expect(doc.observability_connection_id).toBeNull();
  });
});

describe('bumpNextRunAfterManualTrigger', () => {
  it('no-ops when the tenant has no settings doc', async () => {
    findOneMock.mockResolvedValue(null);
    await bumpNextRunAfterManualTrigger(TENANT);
    // nothing to assert on save since there's no doc — absence of a throw is the assertion
  });

  it('no-ops when scanning is disabled', async () => {
    const doc = buildDoc({ otel_trace_scanning_enabled: false });
    findOneMock.mockResolvedValue(doc);

    await bumpNextRunAfterManualTrigger(TENANT);
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('pushes next_run_at forward by a full interval when enabled', async () => {
    const doc = buildDoc({ otel_trace_scanning_enabled: true, schedule_interval: '12h', next_run_at: new Date(0) });
    findOneMock.mockResolvedValue(doc);

    await bumpNextRunAfterManualTrigger(TENANT);

    expect(doc.save).toHaveBeenCalled();
    const expectedApprox = Date.now() + intervalToMs('12h');
    expect(Math.abs(doc.next_run_at!.getTime() - expectedApprox)).toBeLessThan(2000);
  });
});
