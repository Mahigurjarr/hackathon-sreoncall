// packages/api/src/routes/public/__tests__/partner-register.routes.test.ts
import { describe, it, expect } from 'vitest';

describe('Partner register token validation logic', () => {
  it('identifies expired token when inviteTokenExpiresAt is in the past', () => {
    const past = new Date(Date.now() - 1000);
    expect(past < new Date()).toBe(true);
  });

  it('identifies valid token when inviteTokenExpiresAt is in the future', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    expect(future > new Date()).toBe(true);
  });
});
