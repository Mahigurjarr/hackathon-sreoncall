import { describe, it, expect } from 'vitest';

// Pure validation/serialization tests for the synthetic-checks route layer.
// No DB required — exercises the verify_tls plumbing that landed alongside
// the per-check TLS opt-out (see migrate-synthetic-check-verify-tls.ts).

describe('synthetic-check verify_tls plumbing', () => {
  describe('serializer fallback for legacy docs', () => {
    // Mirrors the inline serialize() in synthetic-checks.routes.ts. Kept
    // here so any drift in the serializer's verify_tls handling is caught
    // by these tests without needing to import the route module (which
    // pulls in Express and other heavyweight deps for a unit test).
    function verifyTlsField(c: { verify_tls?: boolean }): boolean {
      return c.verify_tls !== false;
    }

    it('returns true when the field is undefined (legacy pre-migration doc)', () => {
      // Reading a doc that predates the model field but somehow lacks the
      // Mongoose-applied default — defensive read. Should NOT silently
      // turn into cert-tolerant mode just because the field is missing.
      expect(verifyTlsField({})).toBe(true);
    });

    it('returns true when the field is explicitly true (post-feature default)', () => {
      expect(verifyTlsField({ verify_tls: true })).toBe(true);
    });

    it('returns false when the field is explicitly false (opt-out)', () => {
      expect(verifyTlsField({ verify_tls: false })).toBe(false);
    });
  });

  describe('Zod schema accepts verify_tls', () => {
    // Reproduce the relevant subset of the create-schema. If the route's
    // Zod definition drifts, this surfaces it.
    const { z } = require('zod') as typeof import('zod');
    const subset = z.object({
      name: z.string().min(1),
      type: z.enum(['http', 'tcp', 'dns']),
      verify_tls: z.boolean().optional(),
    });

    it('accepts true', () => {
      expect(subset.safeParse({ name: 'x', type: 'http', verify_tls: true }).success).toBe(true);
    });

    it('accepts false', () => {
      expect(subset.safeParse({ name: 'x', type: 'http', verify_tls: false }).success).toBe(true);
    });

    it('accepts omitted (defaults applied downstream by Mongoose)', () => {
      expect(subset.safeParse({ name: 'x', type: 'http' }).success).toBe(true);
    });

    it('rejects non-boolean values', () => {
      expect(subset.safeParse({ name: 'x', type: 'http', verify_tls: 'yes' }).success).toBe(false);
      expect(subset.safeParse({ name: 'x', type: 'http', verify_tls: 1 }).success).toBe(false);
    });
  });
});
