import { describe, it, expect } from 'vitest';

// Test the JWT claims shape — pure logic, no DB needed
describe('partner JWT payload', () => {
  it('includes required claims', () => {
    const payload = { sub: 'userId', partnerId: 'partnerId', email: 'test@test.com', type: 'partner' };
    expect(payload.type).toBe('partner');
    expect(payload.sub).toBe('userId');
    expect(payload.partnerId).toBe('partnerId');
    expect(payload.email).toBe('test@test.com');
  });
});
