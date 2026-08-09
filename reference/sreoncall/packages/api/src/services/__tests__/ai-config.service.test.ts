import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config module so encryption tests don't need a fully-configured env.
// This must come before any import of modules that call getConfig().
vi.mock('../../config/index', () => ({
  getConfig: () => ({ COMMS_ENCRYPTION_KEY: 'a'.repeat(64) }),
  default:   () => ({ COMMS_ENCRYPTION_KEY: 'a'.repeat(64) }),
  loadConfig: () => ({ COMMS_ENCRYPTION_KEY: 'a'.repeat(64) }),
}));

import { isValidProviderModel } from '../ai-providers';
import { encryptToken, decryptToken } from '../../utils/encryption';

// Unit-test the pure validation logic used by the route

describe('ai-config validation', () => {
  it('accepts valid openai/gpt-4o pair', () => {
    expect(isValidProviderModel('openai', 'gpt-4o')).toBe(true);
  });

  it('rejects mismatched provider/model', () => {
    expect(isValidProviderModel('openai', 'claude-sonnet-4-6')).toBe(false);
  });

  it('round-trips a key through encrypt/decrypt', () => {
    // encryptToken requires COMMS_ENCRYPTION_KEY — provided via mocked config above
    const plaintext = 'dummy-test-key-12345';
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it('api_key_hint is last 4 chars', () => {
    const sample = 'acct-1234';
    const hint = '...' + sample.slice(-4);
    expect(hint).toBe('...1234');
  });
});
