import { describe, it, expect } from 'vitest';
import { Partner } from '../partner.model';

describe('Partner model schema', () => {
  it('has the expected partnerType enum values', () => {
    const typeEnum = (Partner.schema.path('partnerType') as any).enumValues as string[];
    expect(typeEnum).toEqual(['referral', 'reseller', 'msp']);
  });

  it('has the expected status enum values', () => {
    const statusEnum = (Partner.schema.path('status') as any).enumValues as string[];
    expect(statusEnum).toEqual(['pending', 'active', 'inactive', 'rejected']);
  });

  it('status defaults to pending', () => {
    const statusPath = Partner.schema.path('status') as any;
    expect(statusPath.options.default).toBe('pending');
  });

  it('commissionRate defaults to 0 with min 0 and max 100', () => {
    const ratePath = Partner.schema.path('commissionRate') as any;
    expect(ratePath.options.default).toBe(0);
    expect(ratePath.options.min).toBe(0);
    expect(ratePath.options.max).toBe(100);
  });

  it('email field is lowercase with maxlength 255', () => {
    const emailPath = Partner.schema.path('email') as any;
    expect(emailPath.options.maxlength).toBe(255);
    expect(emailPath.options.lowercase).toBe(true);
  });
});
