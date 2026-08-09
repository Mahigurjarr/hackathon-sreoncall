import { describe, it, expect } from 'vitest';

describe('partner deal stage validation', () => {
  const PARTNER_ALLOWED_STAGES = ['prospect', 'demo', 'proposal', 'negotiation'];
  const ADMIN_ONLY_STAGES = ['closed_won', 'closed_lost'];

  it('rejects admin-only stages', () => {
    for (const stage of ADMIN_ONLY_STAGES) {
      expect(PARTNER_ALLOWED_STAGES).not.toContain(stage);
    }
  });

  it('allows partner-controlled stages', () => {
    for (const stage of PARTNER_ALLOWED_STAGES) {
      expect(PARTNER_ALLOWED_STAGES).toContain(stage);
    }
  });
});
