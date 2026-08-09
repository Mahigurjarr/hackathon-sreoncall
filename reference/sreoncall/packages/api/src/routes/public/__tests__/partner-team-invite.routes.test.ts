import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Mirrors the schema in partner-team-invite.routes.ts
const acceptBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200).trim(),
  password: z.string().min(8).max(128),
});

describe('partner team invite accept validation', () => {
  it('accepts a valid payload', () => {
    const ok = acceptBodySchema.safeParse({
      token: 'abc123',
      name: 'Jane Partner',
      password: 'correcthorse',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(
      acceptBodySchema.safeParse({ token: 'abc', name: 'Jane', password: 'short' }).success
    ).toBe(false);
  });

  it('rejects empty token', () => {
    expect(
      acceptBodySchema.safeParse({ token: '', name: 'Jane', password: 'validpass' }).success
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      acceptBodySchema.safeParse({ token: 'abc', name: '', password: 'validpass' }).success
    ).toBe(false);
  });

  it('rejects passwords exceeding max length', () => {
    expect(
      acceptBodySchema.safeParse({
        token: 'abc',
        name: 'Jane',
        password: 'a'.repeat(129),
      }).success
    ).toBe(false);
  });
});

describe('invite expiration logic', () => {
  function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
    return expiresAt < now;
  }

  it('treats past expiresAt as expired', () => {
    const past = new Date(Date.now() - 1000);
    expect(isExpired(past)).toBe(true);
  });

  it('treats future expiresAt as active', () => {
    const future = new Date(Date.now() + 60_000);
    expect(isExpired(future)).toBe(false);
  });
});
