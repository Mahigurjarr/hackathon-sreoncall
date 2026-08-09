import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { generateCompletionWithOpenAI } from '../ai.service';

// Minimal fake OpenAI client: only chat.completions.create is exercised.
function fakeClient(create: any) {
  return { chat: { completions: { create } } } as any;
}
const okResponse = {
  choices: [{ message: { content: '{"logql":"{a=\\"b\\"}","explanation":"x"}' } }],
  usage: { prompt_tokens: 5, output_tokens: 2, completion_tokens: 2 },
};
const SCHEMA = { name: 'logql_generation', schema: { type: 'object', properties: { logql: { type: 'string' } }, required: ['logql'], additionalProperties: false } };

beforeEach(() => vi.clearAllMocks());

describe('generateCompletionWithOpenAI — response_format mode', () => {
  it('jsonSchema → response_format json_schema (strict)', async () => {
    const create = vi.fn().mockResolvedValue(okResponse);
    await generateCompletionWithOpenAI(fakeClient(create), { system: 's', userMessage: 'u', jsonMode: true, jsonSchema: SCHEMA, model: 'gpt-4o' });
    const rf = create.mock.calls[0][0].response_format;
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema).toMatchObject({ name: 'logql_generation', strict: true });
  });

  it('jsonMode only (no schema) → response_format json_object', async () => {
    const create = vi.fn().mockResolvedValue(okResponse);
    await generateCompletionWithOpenAI(fakeClient(create), { system: 's', userMessage: 'u', jsonMode: true, model: 'gpt-4o' });
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
  });

  it('o-series reasoning model → NO response_format even with a schema', async () => {
    const create = vi.fn().mockResolvedValue(okResponse);
    await generateCompletionWithOpenAI(fakeClient(create), { system: 's', userMessage: 'u', jsonMode: true, jsonSchema: SCHEMA, model: 'o3-mini' });
    expect(create.mock.calls[0][0].response_format).toBeUndefined();
    // o-series uses max_completion_tokens, not max_tokens
    expect(create.mock.calls[0][0].max_completion_tokens).toBeDefined();
    expect(create.mock.calls[0][0].max_tokens).toBeUndefined();
  });
});

describe('generateCompletionWithOpenAI — schema-error downgrade (no regression for BYOK models)', () => {
  it('json_schema 400 → retries ONCE with json_object and succeeds', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('response_format json_schema not supported'))
      .mockResolvedValueOnce(okResponse);
    const res = await generateCompletionWithOpenAI(fakeClient(create), { system: 's', userMessage: 'u', jsonMode: true, jsonSchema: SCHEMA, model: 'gpt-3.5-turbo' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].response_format.type).toBe('json_schema');
    expect(create.mock.calls[1][0].response_format).toEqual({ type: 'json_object' }); // downgrade
    expect(res.model).toBe('gpt-3.5-turbo'); // real result, NOT 'fallback'
    expect(res.text).toContain('logql');
  });

  it('both attempts fail → model:"fallback" (only then)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const res = await generateCompletionWithOpenAI(fakeClient(create), { system: 's', userMessage: 'u', jsonMode: true, jsonSchema: SCHEMA, model: 'gpt-4o' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(res.model).toBe('fallback');
  });

  it('non-schema request that errors → single attempt, model:"fallback" (no spurious retry)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const res = await generateCompletionWithOpenAI(fakeClient(create), { system: 's', userMessage: 'u', jsonMode: true, model: 'gpt-4o' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.model).toBe('fallback');
  });
});
