import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { SupportContract } from '../support-contract.model';

function validContractInput() {
  return {
    tenant_id: new Types.ObjectId(),
    link_id: new Types.ObjectId(),
    consumer_tenant_id: new Types.ObjectId(),
    name: 'Acme L1 24x7',
    status: 'draft' as const,
    coverage_window: {
      type: '24x7' as const,
      timezone: 'UTC',
      schedule: [],
    },
    tiers: [
      {
        level: 1 as const,
        name: 'L1 Support',
        schedule_id: new Types.ObjectId(),
        escalation_timeout_minutes: null,
      },
    ],
    sla_targets: [
      { severity: 1 as const, response_minutes: 15, resolution_minutes: 240 },
    ],
    pricing: {
      amount_cents: 50000,
      currency: 'usd',
      provider_share_pct: 80,
      platform_share_pct: 20,
    },
    effective_from: new Date(),
    effective_until: null,
    created_by: new Types.ObjectId(),
  };
}

describe('SupportContract model validation', () => {
  it('accepts a minimal valid contract', () => {
    const doc = new SupportContract(validContractInput());
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('rejects an invalid status', () => {
    const doc = new SupportContract({ ...validContractInput(), status: 'bogus' as any });
    const err = doc.validateSync();
    expect(err).toBeTruthy();
    expect(err?.errors?.status).toBeTruthy();
  });

  it('rejects an invalid coverage type', () => {
    const input = validContractInput();
    (input.coverage_window as any).type = 'half-time';
    const doc = new SupportContract(input);
    const err = doc.validateSync();
    expect(err?.errors?.['coverage_window.type']).toBeTruthy();
  });

  it('rejects a tier level outside 1-3', () => {
    const input = validContractInput();
    (input.tiers[0] as any).level = 4;
    const doc = new SupportContract(input);
    const err = doc.validateSync();
    expect(err).toBeTruthy();
  });

  it('rejects an SLA severity outside 1-5', () => {
    const input = validContractInput();
    (input.sla_targets[0] as any).severity = 9;
    const doc = new SupportContract(input);
    const err = doc.validateSync();
    expect(err).toBeTruthy();
  });

  it('rejects a negative price', () => {
    const input = validContractInput();
    input.pricing.amount_cents = -100;
    const doc = new SupportContract(input);
    const err = doc.validateSync();
    expect(err?.errors?.['pricing.amount_cents']).toBeTruthy();
  });

  it('rejects provider_share_pct > 100', () => {
    const input = validContractInput();
    input.pricing.provider_share_pct = 150;
    const doc = new SupportContract(input);
    const err = doc.validateSync();
    expect(err?.errors?.['pricing.provider_share_pct']).toBeTruthy();
  });
});
