import { describe, it, expect } from 'vitest';
import { Lead } from '../lead.model';

describe('Lead model schema', () => {
  it('has the expected track enum values', () => {
    const trackEnum = (Lead.schema.path('track') as any).enumValues as string[];
    expect(trackEnum).toEqual(['hero', 'demo', 'referral', 'reseller', 'msp', 'partner', 'general']);
  });

  it('has the expected status enum values', () => {
    const statusEnum = (Lead.schema.path('status') as any).enumValues as string[];
    expect(statusEnum).toEqual(['new', 'contacted', 'qualified', 'closed_won', 'closed_lost']);
  });

  it('has the expected company_size enum values', () => {
    const sizeEnum = (Lead.schema.path('company_size') as any).enumValues as string[];
    expect(sizeEnum).toEqual(['1-10', '11-50', '51-200', '201-1000', '1000+']);
  });

  it('email field has maxlength 255', () => {
    const emailPath = Lead.schema.path('email') as any;
    expect(emailPath.options.maxlength).toBe(255);
  });
});
