import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before the service import (vitest hoists them).
const mockFindOne = vi.fn();
const mockFindOneAndUpdate = vi.fn();

vi.mock('../../models/alert-rule.model', () => ({
  AlertRule: {
    findOne: (...args: any[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: any[]) => mockFindOneAndUpdate(...args),
  },
}));

vi.mock('../../models/synthetic-check.model', () => ({
  SyntheticCheck: { findOne: vi.fn() },
}));

vi.mock('../../models/service.model', () => ({
  Service: { findOne: vi.fn() },
}));

vi.mock('../../models/alert-rule-telemetry-settings.model', () => ({
  AlertRuleTelemetrySettings: { findOne: vi.fn() },
}));

vi.mock('../../config/redis', () => ({
  getRedis: () => ({ get: async () => null, setex: async () => undefined, del: async () => undefined }),
}));

import { updateAlertRule } from '../alert-rule.service';

function mkLeanChain(doc: any) {
  return {
    select: () => ({ lean: async () => doc }),
  };
}

describe('updateAlertRule — status-only toggle', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockFindOneAndUpdate.mockReset();
  });

  it('does NOT throw "PromQL query is required" when toggling status only', async () => {
    const existingDoc = {
      _id: 'rule-1',
      source_type: 'managed_promql',
      synthetic_check_id: null,
      query: 'sum(rate(http_requests_total[5m]))',
      condition: { metric: 'sum(rate(http_requests_total[5m]))' },
      routing: null,
      name: 'High error rate',
    };

    // Route handler behaviour: two findOne calls — one for routing prefetch,
    // one for validation. Both hit the same lean doc in practice.
    mockFindOne
      .mockReturnValueOnce(mkLeanChain(existingDoc))
      .mockReturnValueOnce(mkLeanChain(existingDoc));

    const updatedDoc = { ...existingDoc, status: 'inactive' };
    mockFindOneAndUpdate.mockReturnValue({ populate: () => updatedDoc });

    // This is what the toggle route sends — ONLY status, nothing else.
    await expect(updateAlertRule('tenant-1', 'rule-1', { status: 'inactive' })).resolves.toBeDefined();
    expect(mockFindOneAndUpdate).toHaveBeenCalled();
  });

  it('still rejects a new rule with an empty PromQL query', async () => {
    // Simulate updating a rule to clear its query — should error.
    const existingDoc = {
      _id: 'rule-1',
      source_type: 'managed_promql',
      synthetic_check_id: null,
      query: 'sum(rate(http_requests_total[5m]))',
      condition: { metric: 'sum(rate(http_requests_total[5m]))' },
      routing: null,
      name: 'High error rate',
    };
    mockFindOne
      .mockReturnValueOnce(mkLeanChain(existingDoc))
      .mockReturnValueOnce(mkLeanChain(existingDoc));

    await expect(
      updateAlertRule('tenant-1', 'rule-1', { query: '  ' } as any),
    ).rejects.toThrow(/PromQL query is required/);
  });

  it('rejects a LogQL rule when an empty query is sent', async () => {
    const existingDoc = {
      _id: 'rule-2',
      source_type: 'managed_logql',
      synthetic_check_id: null,
      query: '{app="x"} |= "error"',
      condition: { metric: '{app="x"} |= "error"' },
      routing: null,
      name: 'Error logs',
    };
    mockFindOne
      .mockReturnValueOnce(mkLeanChain(existingDoc))
      .mockReturnValueOnce(mkLeanChain(existingDoc));

    await expect(
      updateAlertRule('tenant-1', 'rule-2', { query: '' } as any),
    ).rejects.toThrow(/LogQL query is required/);
  });
});
