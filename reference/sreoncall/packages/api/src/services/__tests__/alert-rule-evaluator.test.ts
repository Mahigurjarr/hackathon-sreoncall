import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No BYOS connection → resolver falls back to the managed Mimir/Loki URL.
vi.mock('../../models/observability-connection.model', () => ({
  ObservabilityConnection: { findOne: () => ({ sort: async () => null }) },
}));
vi.mock('../../models/alert-rule.model', () => ({ AlertRule: { findOne: vi.fn() } }));
vi.mock('../../models/synthetic-check.model', () => ({ SyntheticCheck: { findOne: vi.fn() } }));

import { dryRunAlertRule } from '../alert-rule-evaluator.service';

/** Build a fake fetch Response. */
function resp(opts: { ok?: boolean; status?: number; json?: any; text?: string }) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => opts.json,
    text: async () => opts.text ?? '',
  } as any;
}

const promqlEmpty = { status: 'success', data: { resultType: 'vector', result: [] } };
const promqlOne = { status: 'success', data: { resultType: 'vector', result: [{ metric: { job: 'api' }, value: [0, '1'] }] } };

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('dryRunAlertRule — absent (does-not-match) operator', () => {
  it('FIRES when the PromQL result is empty (signal is absent)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ json: promqlEmpty })));
    const r = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'up{job="api"}',
      condition: { metric: 'up{job="api"}', operator: 'absent', threshold: 0, window_minutes: 5 },
    } as any);
    expect(r.triggered).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('stays OK when the PromQL result is non-empty (signal present)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ json: promqlOne })));
    const r = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'up{job="api"}',
      condition: { metric: 'up{job="api"}', operator: 'absent', threshold: 0, window_minutes: 5 },
    } as any);
    expect(r.triggered).toBe(false);
  });
});

describe('dryRunAlertRule — expr (matches) operator', () => {
  it('FIRES on a non-empty vector, stays OK on empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ json: promqlOne })));
    const fires = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'up == 0',
      condition: { metric: 'up == 0', operator: 'expr', threshold: 0, window_minutes: 5 },
    } as any);
    expect(fires.triggered).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ json: promqlEmpty })));
    const ok = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'up == 0',
      condition: { metric: 'up == 0', operator: 'expr', threshold: 0, window_minutes: 5 },
    } as any);
    expect(ok.triggered).toBe(false);
    expect(ok.error).toBeUndefined();
  });
});

describe('dryRunAlertRule — broken query (Bug 4)', () => {
  it('surfaces a query error instead of reporting "would stay OK"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      resp({ ok: false, status: 400, text: JSON.stringify({ error: 'parse error: unexpected end of input' }) }),
    ));
    const r = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'rate(errors[5m',
      condition: { metric: 'rate(errors[5m', operator: 'expr', threshold: 0, window_minutes: 5 },
    } as any);
    expect(r.triggered).toBe(false);
    expect(r.error).toContain('parse error');
    expect(r.explanation.toLowerCase()).toContain('query error');
  });

  it('surfaces a query error for a plain threshold rule too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      resp({ ok: false, status: 400, text: 'parse error at line 1' }),
    ));
    const r = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'node_cpu{',
      condition: { metric: 'node_cpu{', operator: 'gt', threshold: 90, window_minutes: 5 },
    } as any);
    expect(r.triggered).toBe(false);
    expect(r.error).toContain('parse error');
  });

  it('treats a transient 5xx as no-data (not a query error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ ok: false, status: 503, text: 'upstream down' })));
    const r = await dryRunAlertRule('t1', {
      name: 'x', source_type: 'managed_promql', query: 'up',
      condition: { metric: 'up', operator: 'gt', threshold: 0, window_minutes: 5 },
    } as any);
    expect(r.error).toBeUndefined();
    expect(r.triggered).toBe(false);
    expect(r.value).toBeNull();
  });
});
