import { describe, it, expect, vi, beforeEach } from 'vitest';

const { find } = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('../../models/observability-connection.model', () => ({
  ObservabilityConnection: { find },
  RESERVED_LABEL_KEYS: new Set(['tenant_id', 'source', 'service_name', 'job', 'emitter', '__name__']),
  validateLabelKey: (k: string) =>
    !k
      ? 'empty'
      : !/^[a-z_][a-z0-9_]*$/.test(k)
        ? 'bad'
        : ['tenant_id', 'source', 'service_name', 'job', 'emitter', '__name__'].includes(k)
          ? 'reserved'
          : null,
  validateLabelValue: (v: string) => (!v ? 'empty' : v.length > 256 ? 'long' : null),
}));

import {
  getDefaultLabels,
  invalidateLabelsCache,
  mergeLabels,
  enrichLogLine,
} from '../observability-labels.service';

function mockFind(docs: any[]) {
  find.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(docs),
    }),
  });
}

describe('mergeLabels', () => {
  it('lets platform labels override customer labels', () => {
    const out = mergeLabels(
      { source: 'heroku', service_name: 'api' },
      { source: 'hacker', environment: 'prod' },
    );
    expect(out.source).toBe('heroku');
    expect(out.service_name).toBe('api');
    expect(out.environment).toBe('prod');
  });

  it('strips empty-string values to prevent silent cardinality blowups', () => {
    const out = mergeLabels(
      { source: 'vercel', service_name: 'web', dyno: '', host: '' },
      { environment: 'prod' },
    );
    expect(out).not.toHaveProperty('dyno');
    expect(out).not.toHaveProperty('host');
    expect(out.environment).toBe('prod');
  });

  it('rejects reserved keys that leaked in from customer input', () => {
    const out = mergeLabels(
      { source: 'heroku' },
      { service_name: 'hijack', __name__: 'bad', environment: 'prod' },
    );
    expect(out.service_name).toBe(undefined); // reserved and not in base
    expect(out.__name__).toBe(undefined);
    expect(out.environment).toBe('prod');
  });
});

describe('enrichLogLine', () => {
  it('returns original message when no metadata', () => {
    expect(enrichLogLine('hello', {})).toBe('hello');
  });

  it('wraps plain text with metadata into JSON', () => {
    const r = enrichLogLine('oops', { request_id: 'abc', status_code: 500 });
    const parsed = JSON.parse(r);
    expect(parsed.request_id).toBe('abc');
    expect(parsed.status_code).toBe(500);
    expect(parsed.message).toBe('oops');
  });

  it('merges metadata into existing JSON payload without nesting', () => {
    const r = enrichLogLine('{"level":"error","msg":"boom"}', { request_id: 'r1' });
    const parsed = JSON.parse(r);
    expect(parsed.request_id).toBe('r1');
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('boom');
  });

  it('drops undefined/empty metadata fields', () => {
    const r = enrichLogLine('hi', { request_id: '', trace_id: undefined, foo: 'bar' });
    const parsed = JSON.parse(r);
    expect(parsed).toEqual({ foo: 'bar', message: 'hi' });
  });
});

describe('getDefaultLabels', () => {
  beforeEach(() => {
    find.mockReset();
    invalidateLabelsCache('tenant-1', 'heroku');
  });

  it('returns {} when no connection exists', async () => {
    mockFind([]);
    await expect(getDefaultLabels('tenant-1', 'heroku')).resolves.toEqual({});
  });

  it('merges labels from multiple connections, last wins on conflict', async () => {
    mockFind([
      { default_labels: { environment: 'staging', team: 'payments' } },
      { default_labels: { environment: 'production', tier: 'tier-1' } },
    ]);
    const r = await getDefaultLabels('tenant-1', 'heroku');
    expect(r).toEqual({ environment: 'production', team: 'payments', tier: 'tier-1' });
  });

  it('skips invalid keys/values instead of throwing', async () => {
    mockFind([
      {
        default_labels: {
          environment: 'prod',
          'BAD KEY': 'x', // invalid key
          __name__: 'nope', // reserved
          legit: 'yes',
        },
      },
    ]);
    const r = await getDefaultLabels('tenant-1', 'heroku');
    expect(r.environment).toBe('prod');
    expect(r.legit).toBe('yes');
    expect(r['BAD KEY']).toBeUndefined();
    expect(r.__name__).toBeUndefined();
  });

  it('caches results and respects invalidateLabelsCache', async () => {
    mockFind([{ default_labels: { environment: 'a' } }]);
    const first = await getDefaultLabels('tenant-1', 'heroku');
    expect(first.environment).toBe('a');

    // Second call should hit cache — changing mock wouldn't matter
    mockFind([{ default_labels: { environment: 'b' } }]);
    const second = await getDefaultLabels('tenant-1', 'heroku');
    expect(second.environment).toBe('a');

    invalidateLabelsCache('tenant-1', 'heroku');
    const third = await getDefaultLabels('tenant-1', 'heroku');
    expect(third.environment).toBe('b');
  });
});
