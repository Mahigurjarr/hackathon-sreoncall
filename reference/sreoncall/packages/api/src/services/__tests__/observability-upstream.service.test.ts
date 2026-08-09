import { describe, it, expect, vi, beforeEach } from 'vitest';

const findLean = vi.fn();
vi.mock('../../models/provider-consumer-link.model', () => ({
  ProviderConsumerLink: { find: () => ({ select: () => ({ lean: findLean }) }) },
}));
const obsFindLean = vi.fn();
const obsFindOneSort = vi.fn();
const obsFindOne = vi.fn((..._a: any[]) => ({ sort: obsFindOneSort }));
vi.mock('../../models/observability-connection.model', () => ({
  ObservabilityConnection: {
    find: () => ({ select: () => ({ lean: obsFindLean }) }),
    findOne: (...a: any[]) => obsFindOne(...a),
  },
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const assertUrlSafe = vi.fn();
vi.mock('../../utils/ssrf-guard', () => ({ assertUrlSafe: (...a: any[]) => assertUrlSafe(...a) }));

import {
  resolveConsumerOrgId, mimirGet, getMimirBaseUrl,
  resolveLogsEndpoint, lokiGet, normalizedLokiFingerprint, MANAGED_LOKI_URL,
} from '../observability-upstream.service';

describe('observability-upstream', () => {
  beforeEach(() => {
    findLean.mockReset();
    obsFindLean.mockReset();
    vi.restoreAllMocks();
  });

  it('joins managed consumer ids with | and excludes BYOS', async () => {
    findLean.mockResolvedValue([{ consumer_tenant_id: 'a' }, { consumer_tenant_id: 'b' }]);
    obsFindLean.mockResolvedValue([{ tenant_id: 'b' }]); // b is BYOS → excluded
    const res = await resolveConsumerOrgId('prov1');
    expect(res).toEqual({ orgId: 'a', count: 1 });
  });

  it('returns null when no managed observability consumers', async () => {
    findLean.mockResolvedValue([]);
    expect(await resolveConsumerOrgId('prov1')).toBeNull();
  });

  it('mimirGet sets X-Scope-OrgID and builds match[] params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: ['x'] }) });
    vi.stubGlobal('fetch', fetchMock);
    const out = await mimirGet('/prometheus/api/v1/label/namespace/values', { 'match[]': ['{cluster="c"}'] }, 'org1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${getMimirBaseUrl()}/prometheus/api/v1/label/namespace/values?match%5B%5D=%7Bcluster%3D%22c%22%7D`);
    expect(opts.headers['X-Scope-OrgID']).toBe('org1');
    expect(out).toEqual({ status: 'success', data: ['x'] });
  });
});

describe('resolveLogsEndpoint', () => {
  beforeEach(() => { obsFindOneSort.mockReset(); obsFindOne.mockClear(); });

  it('managed tenant → MANAGED_LOKI_URL, orgId=tenantId, scoped by tenant+status', async () => {
    obsFindOneSort.mockResolvedValue(null);
    expect(await resolveLogsEndpoint('t1')).toEqual({ url: MANAGED_LOKI_URL, orgId: 't1' });
    // Tenant-isolation-critical: the connection lookup must filter by this tenant + active statuses, newest first.
    expect(obsFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', status: { $in: ['connected', 'pending'] } }),
    );
    expect(obsFindOneSort).toHaveBeenCalledWith({ created_at: -1 });
  });

  it('BYOS tenant → connection logs_url', async () => {
    obsFindOneSort.mockResolvedValue({ mode: 'byos', endpoints: { logs_url: 'https://loki.acme.io' } });
    expect(await resolveLogsEndpoint('t1')).toEqual({ url: 'https://loki.acme.io', orgId: 't1' });
    expect(obsFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', status: { $in: ['connected', 'pending'] } }),
    );
  });

  it('BYOS with blank logs_url → falls back to managed', async () => {
    obsFindOneSort.mockResolvedValue({ mode: 'byos', endpoints: { logs_url: '' } });
    expect(await resolveLogsEndpoint('t1')).toEqual({ url: MANAGED_LOKI_URL, orgId: 't1' });
  });
});

describe('normalizedLokiFingerprint', () => {
  it('is stable across trailing slash', () => {
    expect(normalizedLokiFingerprint('http://loki:3100')).toBe(normalizedLokiFingerprint('http://loki:3100/'));
  });
  it('differs by host', () => {
    expect(normalizedLokiFingerprint('http://a:3100')).not.toBe(normalizedLokiFingerprint('http://b:3100'));
  });
});

describe('lokiGet', () => {
  beforeEach(() => { assertUrlSafe.mockReset().mockResolvedValue(undefined); });

  it('skips assertUrlSafe for the managed URL (even with trailing slash) and sets X-Scope-OrgID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['x'] }) });
    vi.stubGlobal('fetch', fetchMock);
    await lokiGet(MANAGED_LOKI_URL + '/', '/loki/api/v1/labels', { start: '1' }, 'org1');
    expect(assertUrlSafe).not.toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url.startsWith(MANAGED_LOKI_URL)).toBe(true);
    expect(url).not.toContain('//loki/api'); // safe join, no double slash after host
    expect(opts.headers['X-Scope-OrgID']).toBe('org1');
  });

  it('calls assertUrlSafe for a BYOS (non-managed) URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await lokiGet('https://loki.acme.io', '/loki/api/v1/labels', {}, 'org1');
    expect(assertUrlSafe).toHaveBeenCalledTimes(1);
  });

  it('treats a look-alike host as non-managed (guards it)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await lokiGet('http://10.10.1.21:3100.evil.com', '/loki/api/v1/labels', {}, 'org1');
    expect(assertUrlSafe).toHaveBeenCalledTimes(1);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' }));
    await expect(lokiGet(MANAGED_LOKI_URL, '/x', {}, 'o')).rejects.toThrow(/Loki 503/);
  });
});
