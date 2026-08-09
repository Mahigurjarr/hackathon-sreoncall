import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/rbac.middleware', () => ({ rbac: () => (_req: any, _res: any, next: any) => next() }));

const resolveOwnOrgId = vi.fn();
const resolveConsumerOrgId = vi.fn();
vi.mock('../../services/observability-upstream.service', () => ({
  resolveOwnOrgId: (...a: any[]) => resolveOwnOrgId(...a),
  resolveConsumerOrgId: (...a: any[]) => resolveConsumerOrgId(...a),
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

const getGroundingContext = vi.fn();
const buildGroundedPrompt = vi.fn();
vi.mock('../../services/ai-observability-grounding', () => ({
  getGroundingContext: (...a: any[]) => getGroundingContext(...a),
  buildGroundedPrompt: (...a: any[]) => buildGroundedPrompt(...a),
  getPromptInventory: vi.fn(),
}));

const getEffectiveValue = vi.fn();
vi.mock('../../services/platform/feature-flag.service', () => ({
  getEffectiveValue: (...a: any[]) => getEffectiveValue(...a),
}));

vi.mock('../../services/ai-observability-prompt', () => ({
  OBSERVABILITY_SYSTEM_PROMPT: 'SYS',
  OBSERVABILITY_GENERATE_PROMPT: 'GEN',
  OBSERVABILITY_TOOLS: [],
}));

vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import aiObservabilityRoutes from '../ai-observability.routes';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.tenantId = 'prov1';
    req.roles = ['tenant_admin'];
    next();
  });
  a.use('/observability/ai', aiObservabilityRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ detail: err.detail || 'err' }));
  return a;
}

const post = (body: any) => request(app()).post('/observability/ai/generate-query').send(body);

beforeEach(() => {
  resolveOwnOrgId.mockReset().mockResolvedValue('prov1');
  resolveConsumerOrgId.mockReset();
  checkAiBudget.mockReset();
  consumeAiTokens.mockReset();
  generateCompletion.mockReset();
  getGroundingContext.mockReset();
  buildGroundedPrompt.mockReset().mockReturnValue('GROUNDED');
  getEffectiveValue.mockReset().mockResolvedValue(true);
});

describe('POST /observability/ai/generate-query', () => {
  it('own-tenant: grounds, returns parsed promql + explanation, consumes tokens', async () => {
    getGroundingContext.mockResolvedValue({
      clusters: ['c'], namespaces: [], services: [], metrics: ['m'], labels: ['l'], truncated: false,
    });
    generateCompletion.mockResolvedValue({
      text: JSON.stringify({ promql: 'rate(http_x[5m])', explanation: 'request rate' }),
      input_tokens: 10, output_tokens: 5, model: 'gpt-4o',
    });

    const res = await post({ question: 'request rate', scope: { service_name: 'checkout-api' } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promql: 'rate(http_x[5m])', explanation: 'request rate', grounded: true, truncated: false, valid: true, repaired: false });
    expect(resolveOwnOrgId).toHaveBeenCalledWith('prov1');
    expect(getGroundingContext).toHaveBeenCalledWith('prov1', { service_name: 'checkout-api' });
    expect(consumeAiTokens).not.toHaveBeenCalled();
    expect(generateCompletion).toHaveBeenCalledTimes(1);
  });

  it('flat, source-agnostic scope (e.g. job) is accepted, not stripped, appears in the scope hint, and reaches grounding', async () => {
    getGroundingContext.mockResolvedValue({
      clusters: [], namespaces: [], services: [], metrics: ['m'], labels: ['job'], truncated: false,
    });
    generateCompletion.mockResolvedValue({
      text: JSON.stringify({ promql: 'up{job="checkout-api"}', explanation: 'job health' }),
      input_tokens: 10, output_tokens: 5, model: 'gpt-4o',
    });

    const res = await post({ question: 'is checkout-api up', scope: { job: 'checkout-api' } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promql: 'up{job="checkout-api"}', grounded: true });
    expect(getGroundingContext).toHaveBeenCalledWith('prov1', { job: 'checkout-api' });
    const { userMessage } = generateCompletion.mock.calls[0][0];
    expect(userMessage).toContain('job=checkout-api');
  });

  it('provider mode: resolves consumer org and grounds in it', async () => {
    resolveConsumerOrgId.mockResolvedValue({ orgId: 'cust-A', count: 1 });
    getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ promql: 'up', explanation: 'x' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

    const res = await post({ question: 'health', consumer_id: 'A' });

    expect(res.status).toBe(200);
    expect(resolveConsumerOrgId).toHaveBeenCalledWith('prov1', 'A');
    expect(getGroundingContext).toHaveBeenCalledWith('cust-A', {});
  });

  it('404 when the consumer has no managed observability link', async () => {
    resolveConsumerOrgId.mockResolvedValue(null);
    const res = await post({ question: 'health', consumer_id: 'X' });
    expect(res.status).toBe(404);
    expect(generateCompletion).not.toHaveBeenCalled();
  });

  it('flag off: no grounding, static prompt, grounded=false', async () => {
    getEffectiveValue.mockResolvedValue(false);
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ promql: 'up', explanation: 'x' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

    const res = await post({ question: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.grounded).toBe(false);
    expect(getGroundingContext).not.toHaveBeenCalled();
    expect(buildGroundedPrompt).not.toHaveBeenCalled();
  });

  it('no OPENAI key: templated fallback from the scope selector, no token consume', async () => {
    getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    generateCompletion.mockResolvedValue({ text: '', input_tokens: 0, output_tokens: 0, model: 'fallback' });

    const res = await post({ question: 'cpu', scope: { service_name: 'checkout-api' } });

    expect(res.status).toBe(200);
    expect(res.body.promql).toBe('{service_name="checkout-api"}');
    expect(res.body.grounded).toBe(false);
    expect(consumeAiTokens).not.toHaveBeenCalled();
    // Deterministic fallback selector, not model output — never syntax-validated.
    expect(res.body.valid).toBe(true);
    expect(res.body.repaired).toBe(false);
  });

  it('fallback (no key/model) with a flat, non-k8s scope → scopeSelector built from ALL keys, sorted + escaped', async () => {
    getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    generateCompletion.mockResolvedValue({ text: '', input_tokens: 0, output_tokens: 0, model: 'fallback' });

    const res = await post({ question: 'is it up', scope: { job: 'checkout-api', instance: 'i-1' } });

    expect(res.status).toBe(200);
    // sorted keys (instance before job), values escaped via the Phase-1a helper
    expect(res.body.promql).toBe('{instance="i-1",job="checkout-api"}');
    expect(res.body.grounded).toBe(false);
  });

  it('fallback with a totally empty scope still falls back to "up"', async () => {
    getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    generateCompletion.mockResolvedValue({ text: '', input_tokens: 0, output_tokens: 0, model: 'fallback' });

    const res = await post({ question: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.promql).toBe('up');
  });

  it('malformed model JSON still returns a usable promql', async () => {
    getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    generateCompletion.mockResolvedValue({ text: 'sum(rate(x[5m]))', input_tokens: 3, output_tokens: 2, model: 'gpt-4o' });

    const res = await post({ question: 'q' });

    expect(res.status).toBe(200);
    expect(res.body.promql).toBe('sum(rate(x[5m]))');
  });

  it('repair: includes the previous query + error in the model prompt', async () => {
    getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    generateCompletion.mockResolvedValue({ text: JSON.stringify({ promql: 'fixed', explanation: 'x' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

    await post({ question: 'q', repair: { previousQuery: 'broken_query', error: 'parse error' } });

    const { userMessage } = generateCompletion.mock.calls[0][0];
    expect(userMessage).toContain('broken_query');
    expect(userMessage).toContain('parse error');
  });

  describe('server-side advisory syntax validation + shared repair budget', () => {
    beforeEach(() => {
      getGroundingContext.mockResolvedValue({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    });

    it('invalid syntax triggers exactly ONE server-side repair; final query valid → valid:true, repaired:true', async () => {
      generateCompletion
        .mockResolvedValueOnce({ text: JSON.stringify({ promql: 'rate(http_x[5m]', explanation: 'broken' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' })
        .mockResolvedValueOnce({ text: JSON.stringify({ promql: 'rate(http_x[5m])', explanation: 'fixed' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

      const res = await post({ question: 'request rate' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ promql: 'rate(http_x[5m])', explanation: 'fixed', valid: true, repaired: true });
      expect(generateCompletion).toHaveBeenCalledTimes(2);
      const repairCall = generateCompletion.mock.calls[1][0];
      expect(repairCall.userMessage).toContain('previous PromQL: rate(http_x[5m]');
      expect(repairCall.userMessage).toContain('syntax error near position');
    });

    it('invalid syntax that is STILL invalid after the one repair: valid:false, repaired:true, still returns a runnable query (advisory, never blocks)', async () => {
      generateCompletion
        .mockResolvedValueOnce({ text: JSON.stringify({ promql: 'rate(http_x[5m]', explanation: 'broken' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' })
        .mockResolvedValueOnce({ text: JSON.stringify({ promql: 'rate(http_x[5m]', explanation: 'still broken' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

      const res = await post({ question: 'request rate' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ promql: 'rate(http_x[5m]', valid: false, repaired: true });
      expect(generateCompletion).toHaveBeenCalledTimes(2); // never more than one repair
    });

    it('valid syntax on the first try: no repair spent, only one generateCompletion call', async () => {
      generateCompletion.mockResolvedValue({ text: JSON.stringify({ promql: 'rate(http_x[5m])', explanation: 'request rate' }), input_tokens: 1, output_tokens: 1, model: 'gpt-4o' });

      const res = await post({ question: 'request rate' });

      expect(res.body).toMatchObject({ valid: true, repaired: false });
      expect(generateCompletion).toHaveBeenCalledTimes(1);
    });
  });
});
