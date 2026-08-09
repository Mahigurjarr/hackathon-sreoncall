import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before the service import (vitest hoists them).
const mockCreate = vi.fn();

vi.mock('../../models/alert-rule.model', () => ({
  AlertRule: {
    create: (...args: any[]) => mockCreate(...args),
  },
}));

vi.mock('../../models/synthetic-check.model', () => ({
  SyntheticCheck: { findOne: vi.fn() },
}));

vi.mock('../../config/redis', () => ({
  getRedis: () => ({ get: async () => null, setex: async () => undefined, del: async () => undefined }),
}));

import { createAlertRule } from '../alert-rule.service';

beforeEach(() => {
  mockCreate.mockReset();
  // Echo back what was persisted so we can assert on it.
  mockCreate.mockImplementation(async (doc: any) => ({ toObject: () => doc }));
});

describe('createAlertRule — compound conditions', () => {
  it('persists conditions[] + condition_logic and mirrors the first into condition', async () => {
    const doc = await createAlertRule('t1', 'u1', {
      name: 'CPU AND memory high',
      source_type: 'managed_promql',
      condition_logic: 'and',
      condition: { metric: 'cpu_pct', operator: 'gt', threshold: 80 },
      conditions: [
        { metric: 'cpu_pct', operator: 'gt', threshold: 80 },
        { metric: 'mem_pct', operator: 'gt', threshold: 90 },
      ],
    } as any);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(doc.condition_logic).toBe('and');
    expect(doc.conditions).toHaveLength(2);
    expect(doc.conditions[1]).toMatchObject({ metric: 'mem_pct', operator: 'gt', threshold: 90 });
    // Mirror: legacy `condition` reflects the first compound condition.
    expect(doc.condition).toMatchObject({ metric: 'cpu_pct', operator: 'gt', threshold: 80 });
    // A rule-level query is back-filled so the PromQL source stays valid.
    expect(doc.query).toBe('cpu_pct');
  });

  it('reduces a single-element compound list to a plain single-condition rule', async () => {
    const doc = await createAlertRule('t1', 'u1', {
      name: 'single',
      source_type: 'managed_promql',
      condition: { metric: 'x', operator: 'gt', threshold: 1 },
      conditions: [{ metric: 'x', operator: 'gt', threshold: 1 }],
    } as any);
    expect(doc.conditions).toHaveLength(0);
    expect(doc.condition).toMatchObject({ metric: 'x', operator: 'gt', threshold: 1 });
  });

  it('rejects a compound threshold condition with no metric', async () => {
    await expect(createAlertRule('t1', 'u1', {
      name: 'bad',
      source_type: 'managed_promql',
      condition: { metric: 'cpu', operator: 'gt', threshold: 80 },
      conditions: [
        { metric: 'cpu', operator: 'gt', threshold: 80 },
        { metric: '', operator: 'lt', threshold: 5 },
      ],
    } as any)).rejects.toThrow(/Condition 2: metric is required/);
  });
});

describe('createAlertRule — native PromQL expression', () => {
  it('accepts a single expr condition using the rule-level query, no metric needed', async () => {
    const doc = await createAlertRule('t1', 'u1', {
      name: 'up down',
      source_type: 'managed_promql',
      query: 'up == 0',
      condition: { metric: '', operator: 'expr', threshold: 0 },
    } as any);
    expect(doc.condition.operator).toBe('expr');
    // metric back-fills to the query for display / worst-series labelling.
    expect(doc.condition.metric).toBe('up == 0');
    expect(doc.query).toBe('up == 0');
  });

  it('rejects an expr compound condition with neither query nor rule-level query', async () => {
    await expect(createAlertRule('t1', 'u1', {
      name: 'bad expr',
      source_type: 'managed_promql',
      condition: { metric: '', operator: 'expr', threshold: 0, query: 'up == 0' },
      conditions: [
        { operator: 'expr', query: 'rate(errors[5m]) > 0' },
        { operator: 'expr' },
      ],
    } as any)).rejects.toThrow(/Condition 2: PromQL expression is required/);
  });
});

describe('createAlertRule — absence (does-not-match) operator', () => {
  it('accepts an absent condition using its query, no metric/threshold needed', async () => {
    const doc = await createAlertRule('t1', 'u1', {
      name: 'logs went dark',
      source_type: 'managed_logql',
      query: '{service_name="authlog"}',
      condition: { metric: '', operator: 'absent', threshold: 0, query: '{service_name="authlog"}' },
      conditions: [{ operator: 'absent', query: '{service_name="authlog"}' }],
    } as any);
    // Single-element compound collapses; the mirrored condition keeps `absent`.
    expect(doc.condition.operator).toBe('absent');
    expect(doc.condition.metric).toBe('{service_name="authlog"}');
    expect(doc.query).toBe('{service_name="authlog"}');
  });

  it('rejects an absent condition with neither query nor rule-level query', async () => {
    await expect(createAlertRule('t1', 'u1', {
      name: 'bad absent',
      source_type: 'managed_promql',
      condition: { metric: '', operator: 'expr', threshold: 0, query: 'up' },
      conditions: [
        { operator: 'expr', query: 'up' },
        { operator: 'absent' },
      ],
    } as any)).rejects.toThrow(/Condition 2: PromQL expression is required for the "absent" operator/);
  });
});
