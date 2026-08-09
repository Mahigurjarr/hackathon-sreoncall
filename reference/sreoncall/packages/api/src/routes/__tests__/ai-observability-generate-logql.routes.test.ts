import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_req: any, _res: any, next: any) => next() }));

const resolveOwnOrgId = vi.fn();
const resolveConsumerOrgId = vi.fn();
const resolveLogsEndpoint = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveOwnOrgId: (...a: any[]) => resolveOwnOrgId(...a),
  resolveConsumerOrgId: (...a: any[]) => resolveConsumerOrgId(...a),
  resolveLogsEndpoint: (...a: any[]) => resolveLogsEndpoint(...a),
  MANAGED_LOKI_URL: 'http://managed-loki',
}));

const checkAiBudget = vi.fn();
const consumeAiTokens = vi.fn();
vi.mock('../../services/ai-budget.service', () => ({
  checkAiBudget: (...a: any[]) => checkAiBudget(...a),
  consumeAiTokens: (...a: any[]) => consumeAiTokens(...a),
  estimateTokens: () => 100,
}));

const generateCompletion = vi.fn();
vi.mock('../../services/ai.service', () => ({
  generateCompletion: (...a: any[]) => generateCompletion(...a),
  generateToolUseCompletion: vi.fn(),
}));

const getLogQLGroundingContext = vi.fn();
const buildGroundedPrompt = vi.fn().mockReturnValue('GROUNDED');
vi.mock('../../services/ai-observability-grounding', () => ({
  getLogQLGroundingContext: (...a: any[]) => getLogQLGroundingContext(...a),
  getGroundingContext: vi.fn(),
  getPromptInventory: vi.fn(),
  buildGroundedPrompt: (...a: any[]) => buildGroundedPrompt(...a),
}));

const getEffectiveValue = vi.fn();
vi.mock('../../services/platform/feature-flag.service', () => ({
  getEffectiveValue: (...a: any[]) => getEffectiveValue(...a),
}));

vi.mock('../../services/ai-observability-prompt', () => ({
  OBSERVABILITY_SYSTEM_PROMPT: 'SYS',
  OBSERVABILITY_GENERATE_PROMPT: 'GEN',
  OBSERVABILITY_GENERATE_LOGQL_PROMPT: 'GENLOG',
  OBSERVABILITY_TOOLS: [],
}));

vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import aiObservabilityRoutes from '../ai-observability.routes';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.tenantId = 't1';
    req.roles = ['tenant_admin'];
    next();
  });
  a.use('/observability/ai', aiObservabilityRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

const post = (body: any) => request(app()).post('/observability/ai/generate-logql').send(body);

beforeEach(() => {
  resolveOwnOrgId.mockReset().mockResolvedValue('t1');
  resolveConsumerOrgId.mockReset();
  resolveLogsEndpoint.mockReset().mockResolvedValue({ url: 'http://byos-loki', orgId: 't1' });
  getLogQLGroundingContext.mockReset().mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: ['cluster'], truncated: false });
  generateCompletion.mockReset();
  getEffectiveValue.mockReset().mockResolvedValue(true);
});

describe('POST /observability/ai/generate-logql', () => {
  it('own-tenant: grounds via resolveLogsEndpoint and returns parsed logql', async () => {
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ logql: '{service_name="api"} |= "error"', explanation: 'errors' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });
    const res = await post({ question: 'errors', scope: { service_name: 'api' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ logql: '{service_name="api"} |= "error"', explanation: 'errors', grounded: true, valid: true, repaired: false });
    expect(resolveLogsEndpoint).toHaveBeenCalledWith('t1');
    expect(getLogQLGroundingContext).toHaveBeenCalledWith('http://byos-loki', 't1', { service_name: 'api' });
    expect(generateCompletion).toHaveBeenCalledTimes(1);
  });

  it('provider mode: managed Loki + consumer org', async () => {
    resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ logql: '{cluster="x"}', explanation: 'x' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });
    const res = await post({ question: 'health', consumer_id: 'A' });
    expect(res.status).toBe(200);
    expect(getLogQLGroundingContext).toHaveBeenCalledWith('http://managed-loki', 'cust-A', {});
  });

  it('404 when consumer has no managed link', async () => {
    resolveConsumerOrgId.mockResolvedValue(null);
    expect((await post({ question: 'q', consumer_id: 'X' })).status).toBe(404);
  });

  it('flag off: no grounding, grounded=false', async () => {
    getEffectiveValue.mockResolvedValue(false);
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ logql: '{a="b"}', explanation: 'x' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });
    const res = await post({ question: 'anything', scope: { a: 'b' } });
    expect(res.body.grounded).toBe(false);
    expect(getLogQLGroundingContext).not.toHaveBeenCalled();
  });

  it('no key: fallback selector from sanitized scope', async () => {
    generateCompletion.mockResolvedValue({ text: '', input_tokens: 0, output_tokens: 0, model: 'fallback' });
    const res = await post({ question: 'cpu', scope: { service_name: 'api' } });
    expect(res.body.logql).toBe('{service_name="api"}');
    expect(res.body.grounded).toBe(false);
    // Deterministic fallback selector, not model output — never syntax-validated.
    expect(res.body.valid).toBe(true);
    expect(res.body.repaired).toBe(false);
  });

  it('empty scope + no key: returns empty logql with a guiding explanation (frontend must guard)', async () => {
    generateCompletion.mockResolvedValue({ text: '', input_tokens: 0, output_tokens: 0, model: 'fallback' });
    const res = await post({ question: 'anything' }); // no scope → buildLogSelector('') === ''
    expect(res.status).toBe(200);
    expect(res.body.logql).toBe('');
    expect(res.body.grounded).toBe(false);
    expect(res.body.explanation).toBeTruthy();
    expect(res.body.explanation).not.toBe('AI is unavailable — generated a basic query from your current selection.');
    expect(res.body.valid).toBe(true);
    expect(res.body.repaired).toBe(false);
  });

  it('malformed JSON still returns a usable logql', async () => {
    generateCompletion.mockResolvedValue({ text: '{service_name="api"} |= "x"', input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });
    const res = await post({ question: 'q' });
    expect(res.body.logql).toBe('{service_name="api"} |= "x"');
  });

  it('repair: includes previous query + error', async () => {
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ logql: '{fixed="1"}', explanation: 'x' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });
    await post({ question: 'q', repair: { previousQuery: 'broken', error: 'parse error' } });
    const { userMessage } = generateCompletion.mock.calls[0][0];
    expect(userMessage).toContain('broken');
    expect(userMessage).toContain('parse error');
  });

  describe('server-side advisory syntax validation + shared repair budget', () => {
    it('invalid syntax triggers exactly ONE server-side repair; final query valid → valid:true, repaired:true', async () => {
      generateCompletion
        .mockResolvedValueOnce({ text: JSON.stringify({ logql: '{service_name="api"', explanation: 'broken' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' })
        .mockResolvedValueOnce({ text: JSON.stringify({ logql: '{service_name="api"}', explanation: 'fixed' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

      const res = await post({ question: 'errors' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ logql: '{service_name="api"}', explanation: 'fixed', valid: true, repaired: true });
      expect(generateCompletion).toHaveBeenCalledTimes(2);
      const repairCall = generateCompletion.mock.calls[1][0];
      expect(repairCall.userMessage).toContain('previous LogQL: {service_name="api"');
      expect(repairCall.userMessage).toContain('syntax error near position');
    });

    it('invalid syntax that is STILL invalid after the one repair: valid:false, repaired:true, still returns a runnable query (advisory, never blocks)', async () => {
      generateCompletion
        .mockResolvedValueOnce({ text: JSON.stringify({ logql: '{service_name="api"', explanation: 'broken' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' })
        .mockResolvedValueOnce({ text: JSON.stringify({ logql: '{service_name="api"', explanation: 'still broken' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

      const res = await post({ question: 'errors' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ logql: '{service_name="api"', valid: false, repaired: true });
      expect(generateCompletion).toHaveBeenCalledTimes(2); // never more than one repair
    });

    it('valid syntax on the first try: no repair spent, only one generateCompletion call', async () => {
      generateCompletion.mockResolvedValue({ text: JSON.stringify({ logql: '{service_name="api"} |= "error"', explanation: 'errors' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

      const res = await post({ question: 'errors' });

      expect(res.body).toMatchObject({ valid: true, repaired: false });
      expect(generateCompletion).toHaveBeenCalledTimes(1);
    });
  });
});
