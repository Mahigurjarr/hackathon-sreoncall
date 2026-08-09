import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockLinkFind = vi.fn();
const mockObsFind  = vi.fn();
const mockFetch    = vi.fn();

vi.mock('../../models/provider-consumer-link.model', () => ({
  ProviderConsumerLink: { find: (...a: any[]) => mockLinkFind(...a) },
}));

vi.mock('../../models/observability-connection.model', () => ({
  ObservabilityConnection: { find: (...a: any[]) => mockObsFind(...a) },
}));

vi.mock('../../middleware/rbac.middleware', () => ({
  rbac: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/tenantType.middleware', () => ({
  requireTenantType: () => (_req: any, _res: any, next: any) => next(),
}));

vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chainable mock for .find().select().lean() and .find().populate().lean() */
function chainMock(rows: any[]) {
  const lean = vi.fn().mockResolvedValue(rows);
  return { select: vi.fn().mockReturnValue({ lean }), populate: vi.fn().mockReturnValue({ lean }) };
}

function okFetch(body: any = {}) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
}
function errFetch(status = 502, text = 'upstream down') {
  return Promise.resolve({ ok: false, status, text: () => Promise.resolve(text), json: () => Promise.resolve({}) });
}

const PROVIDER = 'aaa000000000000000000001';
const C1       = 'bbb000000000000000000001';
const C2       = 'bbb000000000000000000002';
const C_BYOS   = 'ccc000000000000000000001';

const MIMIR_RESP  = { status: 'success', data: { resultType: 'vector', result: [] } };
const LOKI_RESP   = { status: 'success', data: { resultType: 'streams', result: [] } };
const TEMPO_RESP  = { traces: [] };

function mkLink(id: string) { return { consumer_tenant_id: id }; }

/** Default: two managed consumers, no BYOS. */
function setupManaged(ids = [C1, C2]) {
  mockLinkFind.mockReturnValue(chainMock(ids.map(mkLink)));
  mockObsFind.mockReturnValue(chainMock([]));
}

let router: any;

beforeEach(async () => {
  vi.resetModules();
  mockLinkFind.mockReset();
  mockObsFind.mockReset();
  mockFetch.mockReset();
  router = (await import('../provider-observability.routes')).default;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.tenantId = PROVIDER; next(); });
  a.use('/', router);
  a.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof z.ZodError) return res.status(422).json({ issues: err.issues });
    res.status(500).json({ detail: err.message });
  });
  return a;
}

// ── resolveConsumerOrgId ──────────────────────────────────────────────────────

describe('resolveConsumerOrgId', () => {
  it('returns 400 when no links with observability scope exist', async () => {
    mockLinkFind.mockReturnValue(chainMock([]));
    mockObsFind.mockReturnValue(chainMock([]));

    const res = await request(app()).get('/metrics/query?query=up');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No managed consumers/i);
  });

  it('returns 400 when every linked consumer is on a BYOS stack', async () => {
    mockLinkFind.mockReturnValue(chainMock([mkLink(C_BYOS)]));
    mockObsFind.mockReturnValue(chainMock([{ tenant_id: C_BYOS }]));

    const res = await request(app()).get('/metrics/query?query=up');

    expect(res.status).toBe(400);
  });

  it('builds a pipe-joined orgId across all managed consumers', async () => {
    setupManaged([C1, C2]);
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    await request(app()).get('/metrics/query?query=up');

    const [[, opts]] = mockFetch.mock.calls;
    expect(opts.headers['X-Scope-OrgID']).toBe(`${C1}|${C2}`);
  });

  it('excludes BYOS consumers from the orgId while keeping managed ones', async () => {
    mockLinkFind.mockReturnValue(chainMock([mkLink(C1), mkLink(C_BYOS)]));
    mockObsFind.mockReturnValue(chainMock([{ tenant_id: C_BYOS }]));
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    await request(app()).get('/metrics/query?query=up');

    const [[, opts]] = mockFetch.mock.calls;
    expect(opts.headers['X-Scope-OrgID']).toBe(C1);
    expect(opts.headers['X-Scope-OrgID']).not.toContain(C_BYOS);
  });

  it('scopes to a single consumer when ?consumer_id is present', async () => {
    mockLinkFind.mockReturnValue(chainMock([mkLink(C1)]));
    mockObsFind.mockReturnValue(chainMock([]));
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    await request(app()).get(`/metrics/query?query=up&consumer_id=${C1}`);

    const [[, opts]] = mockFetch.mock.calls;
    expect(opts.headers['X-Scope-OrgID']).toBe(C1);
  });

  it('passes the provider_tenant_id filter to ProviderConsumerLink.find', async () => {
    setupManaged();
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    await request(app()).get('/metrics/query?query=up');

    const [filter] = mockLinkFind.mock.calls[0];
    expect(String(filter.provider_tenant_id)).toBe(PROVIDER);
    expect(filter.status).toBe('active');
    expect(filter.scope).toBe('observability');
  });
});

// ── Metrics proxy (Mimir) ─────────────────────────────────────────────────────

describe('GET /metrics/query', () => {
  it('proxies to Mimir instant query endpoint with the query param', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    const res = await request(app()).get('/metrics/query?query=up');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/prometheus\/api\/v1\/query/);
    expect(url).toContain('query=up');
  });

  it('returns 422 when the query param is missing', async () => {
    setupManaged([C1]);
    const res = await request(app()).get('/metrics/query');
    expect(res.status).toBe(422);
  });
});

describe('GET /metrics/query_range', () => {
  it('passes start, end, and step to Mimir', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    await request(app()).get('/metrics/query_range?query=up&start=1000&end=2000&step=30s');

    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/prometheus\/api\/v1\/query_range/);
    expect(url).toContain('start=1000');
    expect(url).toContain('end=2000');
    expect(url).toContain('step=30s');
  });

  it('applies a default step of 60s when not provided', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(MIMIR_RESP));

    await request(app()).get('/metrics/query_range?query=up');

    const [[url]] = mockFetch.mock.calls;
    expect(url).toContain('step=60s');
  });
});

describe('GET /metrics/labels and /metrics/label/:name/values', () => {
  it('hits the Mimir labels endpoint', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch({ status: 'success', data: ['__name__', 'job'] }));

    const res = await request(app()).get('/metrics/labels');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/prometheus\/api\/v1\/labels/);
  });

  it('encodes the label name in the URL', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch({ status: 'success', data: [] }));

    await request(app()).get('/metrics/label/__name__/values');

    const [[url]] = mockFetch.mock.calls;
    expect(url).toContain(encodeURIComponent('__name__'));
  });
});

// ── Logs proxy (Loki) ─────────────────────────────────────────────────────────

describe('GET /logs/query_range', () => {
  it('proxies to Loki with the LogQL query', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(LOKI_RESP));

    const res = await request(app()).get('/logs/query_range?query=%7Bjob%3D%22api%22%7D');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/loki\/api\/v1\/query_range/);
  });

  it('defaults direction to backward when not specified', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(LOKI_RESP));

    await request(app()).get('/logs/query_range?query=%7Bjob%3D%22api%22%7D');

    const [[url]] = mockFetch.mock.calls;
    expect(url).toContain('direction=backward');
  });
});

describe('GET /logs/volume', () => {
  it('returns 400 when query param is missing', async () => {
    setupManaged([C1]);
    const res = await request(app()).get('/logs/volume');
    expect(res.status).toBe(400);
  });

  it('hits the Loki query_range endpoint with the volume query', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(LOKI_RESP));

    const res = await request(app()).get('/logs/volume?query=%7Bjob%3D%22api%22%7D');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/loki\/api\/v1\/query_range/);
  });
});

describe('GET /logs/labels', () => {
  it('hits the Loki labels endpoint', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch({ status: 'success', data: ['tenant_id', 'job'] }));

    const res = await request(app()).get('/logs/labels');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/loki\/api\/v1\/labels/);
  });
});

// ── Traces proxy (Tempo) ──────────────────────────────────────────────────────

describe('GET /traces', () => {
  it('proxies to Tempo search with the TraceQL query', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(TEMPO_RESP));

    const res = await request(app()).get('/traces?q=%7B.http.status_code%3D500%7D');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/api\/search/);
  });

  it('passes all optional search params to Tempo', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch(TEMPO_RESP));

    await request(app()).get('/traces?start=1000&end=2000&limit=50&minDuration=100ms');

    const [[url]] = mockFetch.mock.calls;
    expect(url).toContain('start=1000');
    expect(url).toContain('end=2000');
    expect(url).toContain('limit=50');
    expect(url).toContain('minDuration=100ms');
  });
});

describe('GET /traces/:traceId', () => {
  it('proxies to Tempo trace fetch with the traceId path param', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(okFetch({ resourceSpans: [] }));

    const res = await request(app()).get('/traces/abc123def456');

    expect(res.status).toBe(200);
    const [[url]] = mockFetch.mock.calls;
    expect(url).toMatch(/\/api\/traces\/abc123def456/);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('upstream error handling', () => {
  it('returns 502 when Mimir returns a non-OK status', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(errFetch(500, 'internal error'));

    const res = await request(app()).get('/metrics/query?query=up');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Upstream 500/);
  });

  it('returns 502 when the fetch call throws (e.g. timeout/abort)', async () => {
    setupManaged([C1]);
    mockFetch.mockRejectedValue(new Error('AbortError: request timed out'));

    const res = await request(app()).get('/metrics/query?query=up');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/timed out/i);
  });

  it('returns 502 when Loki returns a non-OK status', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(errFetch(503, 'service unavailable'));

    const res = await request(app()).get('/logs/query_range?query=%7Bjob%3D%22api%22%7D');

    expect(res.status).toBe(502);
  });

  it('returns 502 when Tempo returns a non-OK status', async () => {
    setupManaged([C1]);
    mockFetch.mockReturnValue(errFetch(429, 'rate limited'));

    const res = await request(app()).get('/traces');

    expect(res.status).toBe(502);
  });
});

// ── GET /consumers ────────────────────────────────────────────────────────────

describe('GET /consumers', () => {
  it('labels managed consumers as included_in_cross_tenant_query: true', async () => {
    mockLinkFind.mockReturnValue(chainMock([
      { consumer_tenant_id: { _id: C1, name: 'Acme', slug: 'acme' } },
    ]));
    mockObsFind.mockReturnValue(chainMock([]));

    const res = await request(app()).get('/consumers');

    expect(res.status).toBe(200);
    expect(res.body.data[0].included_in_cross_tenant_query).toBe(true);
    expect(res.body.data[0].observability_mode).toBe('managed');
  });

  it('labels BYOS consumers as included_in_cross_tenant_query: false', async () => {
    mockLinkFind.mockReturnValue(chainMock([
      { consumer_tenant_id: { _id: C_BYOS, name: 'Byos Corp', slug: 'byos' } },
    ]));
    mockObsFind.mockReturnValue(chainMock([{ tenant_id: C_BYOS }]));

    const res = await request(app()).get('/consumers');

    expect(res.status).toBe(200);
    expect(res.body.data[0].included_in_cross_tenant_query).toBe(false);
    expect(res.body.data[0].observability_mode).toBe('byos');
  });

  it('returns an empty data array when no consumers have observability scope', async () => {
    mockLinkFind.mockReturnValue(chainMock([]));
    mockObsFind.mockReturnValue(chainMock([]));

    const res = await request(app()).get('/consumers');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
