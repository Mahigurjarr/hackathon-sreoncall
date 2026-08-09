import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_req: any, _res: any, next: any) => next() }));

// The generate routes import these; stub so the module loads in isolation.
vi.mock('../../services/observability-upstream.service', () => ({
  resolveOwnOrgId: vi.fn(), resolveConsumerOrgId: vi.fn(), resolveLogsEndpoint: vi.fn(), MANAGED_LOKI_URL: 'http://loki',
}));
vi.mock('../../services/ai.service', () => ({ generateCompletion: vi.fn(), generateToolUseCompletion: vi.fn() }));
vi.mock('../../services/ai-observability-grounding', () => ({
  buildGroundedPrompt: vi.fn(), getPromptInventory: vi.fn(), getGroundingContext: vi.fn(), getLogQLGroundingContext: vi.fn(),
}));
vi.mock('../../services/platform/feature-flag.service', () => ({ getEffectiveValue: vi.fn() }));
vi.mock('../../services/ai-observability-prompt', () => ({
  OBSERVABILITY_SYSTEM_PROMPT: 'SYS', OBSERVABILITY_GENERATE_PROMPT: 'GEN', OBSERVABILITY_GENERATE_LOGQL_PROMPT: 'GENLOG', OBSERVABILITY_TOOLS: [],
}));
vi.mock('../../services/observability-logs-discovery.service', () => ({ sanitizeLogScope: (x: any) => x, buildLogSelector: () => '' }));
vi.mock('../../services/query-validation.service', () => ({ validateLogQL: () => ({ valid: true }), validatePromQL: () => ({ valid: true }) }));

const logInfo = vi.fn();
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: (...a: any[]) => logInfo(...a), error: vi.fn() } }));

import aiObservabilityRoutes from '../ai-observability.routes';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.tenantId = 't1'; req.roles = ['tenant_admin']; next(); });
  a.use('/observability/ai', aiObservabilityRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 400).json({ detail: err.detail || err.message || 'err' }));
  return a;
}
const post = (body: any) => request(app()).post('/observability/ai/ask-feedback').send(body);

beforeEach(() => logInfo.mockReset());

describe('POST /observability/ai/ask-feedback', () => {
  it('accepts a valid beacon → 204 and logs tenant-scoped ask-bar.feedback', async () => {
    const res = await post({ lang: 'logql', question: 'errors', generatedQuery: '{a="b"}', finalQuery: '{a="b"} |= "x"', edited: true, resultCount: 3 });
    expect(res.status).toBe(204);
    const call = logInfo.mock.calls.find((c) => c[0] === 'ask-bar.feedback');
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ tenantId: 't1', lang: 'logql', edited: true, resultCount: 3 });
  });

  it('requires `edited` (400 on invalid body)', async () => {
    const res = await post({ lang: 'logql' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown lang', async () => {
    const res = await post({ lang: 'sql', edited: false });
    expect(res.status).toBe(400);
  });
});
