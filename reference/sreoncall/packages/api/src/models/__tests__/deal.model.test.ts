import { describe, it, expect } from 'vitest';
import { Deal } from '../deal.model';

describe('Deal model schema', () => {
  it('has the expected stage enum values', () => {
    const stageEnum = (Deal.schema.path('stage') as any).enumValues as string[];
    expect(stageEnum).toEqual([
      'pending_approval',
      'prospect',
      'demo',
      'proposal',
      'negotiation',
      'closed_won',
      'closed_lost',
      'rejected',
    ]);
  });

  it('has the expected productTier enum values', () => {
    const tierEnum = (Deal.schema.path('productTier') as any).enumValues as string[];
    expect(tierEnum).toEqual(['startup', 'growth', 'enterprise', 'self_hosted', 'services']);
  });

  it('stage defaults to pending_approval', () => {
    const stagePath = Deal.schema.path('stage') as any;
    expect(stagePath.options.default).toBe('pending_approval');
  });

  it('commissionEarned defaults to 0', () => {
    const earnedPath = Deal.schema.path('commissionEarned') as any;
    expect(earnedPath.options.default).toBe(0);
  });

  it('notes and adminNotes have maxlength 4000', () => {
    const notesPath = Deal.schema.path('notes') as any;
    const adminNotesPath = Deal.schema.path('adminNotes') as any;
    expect(notesPath.options.maxlength).toBe(4000);
    expect(adminNotesPath.options.maxlength).toBe(4000);
  });
});
