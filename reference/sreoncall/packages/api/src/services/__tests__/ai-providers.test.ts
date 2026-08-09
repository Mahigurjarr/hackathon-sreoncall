import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, AI_MODELS, isValidProviderModel } from '../ai-providers';

describe('ai-providers', () => {
  it('exports three providers', () => {
    expect(AI_PROVIDERS).toEqual(['openai', 'anthropic', 'google']);
  });

  it('has models for every provider', () => {
    for (const p of AI_PROVIDERS) {
      expect(AI_MODELS[p].length).toBeGreaterThan(0);
    }
  });

  it('validates a known provider/model pair', () => {
    expect(isValidProviderModel('openai', 'gpt-4o')).toBe(true);
    expect(isValidProviderModel('anthropic', 'claude-sonnet-5')).toBe(true);
    expect(isValidProviderModel('google', 'gemini-2.0-flash')).toBe(true);
  });

  it('rejects unknown model for valid provider', () => {
    expect(isValidProviderModel('openai', 'gpt-99')).toBe(false);
  });

  it('rejects unknown provider', () => {
    expect(isValidProviderModel('cohere', 'command')).toBe(false);
  });
});
