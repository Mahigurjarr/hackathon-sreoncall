// packages/api/src/routes/public/__tests__/leads.routes.test.ts
import { describe, it, expect } from 'vitest';
import { leadSchema } from '../leads.routes';

describe('public leads validation schema', () => {
  it('accepts a valid full payload', () => {
    const result = leadSchema.safeParse({
      name: 'Jane Smith',
      email: 'JANE@Acme.com',
      company: 'Acme Corp',
      role: 'CTO',
      company_size: '51-200',
      message: 'Interested in Growth plan',
      track: 'demo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('jane@acme.com'); // lowercased
    }
  });

  it('accepts minimal payload with defaults', () => {
    const result = leadSchema.safeParse({ name: 'Bob', email: 'bob@x.com', company: 'X' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.track).toBe('general');
    }
  });

  it('rejects missing required fields', () => {
    expect(leadSchema.safeParse({ email: 'a@b.com', company: 'X' }).success).toBe(false);
    expect(leadSchema.safeParse({ name: 'Bob', company: 'X' }).success).toBe(false);
    expect(leadSchema.safeParse({ name: 'Bob', email: 'a@b.com' }).success).toBe(false);
  });

  it('rejects invalid email format', () => {
    expect(leadSchema.safeParse({ name: 'Bob', email: 'notanemail', company: 'X' }).success).toBe(false);
  });

  it('rejects invalid track value', () => {
    expect(leadSchema.safeParse({ name: 'Bob', email: 'a@b.com', company: 'X', track: 'invalid' }).success).toBe(false);
  });

  it('rejects message longer than 2000 chars', () => {
    const result = leadSchema.safeParse({
      name: 'Bob', email: 'a@b.com', company: 'X',
      message: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});
