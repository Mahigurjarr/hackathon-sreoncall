import { beforeEach, describe, it, expect, vi } from 'vitest';
import { Types } from 'mongoose';

// Mock the model layer so we can run service logic in isolation.
const saveMock = vi.fn();

vi.mock('../../models/incident-sla-state.model', () => ({
  IncidentSLAState: {
    create: vi.fn(async (doc: any) => ({ ...doc, _id: new Types.ObjectId(), save: saveMock })),
  },
}));

vi.mock('../../models/support-contract.model', () => ({
  SupportContract: {
    findOne: vi.fn(),
    findById: vi.fn(),
  },
}));

const consumerManagedTierFindOne = vi.fn();

vi.mock('../../models/consumer-managed-tier.model', () => ({
  ConsumerManagedTier: {
    findOne: (...args: any[]) => consumerManagedTierFindOne(...args),
  },
}));

import { createSlaStateForBridge, escalateTier } from '../managed-support.service';
import { SupportContract } from '../../models/support-contract.model';

function buildContract(sevTargets = [{ severity: 1, response_minutes: 30, resolution_minutes: 240 }]) {
  return {
    _id: new Types.ObjectId(),
    coverage_window: { type: '24x7', timezone: 'UTC', schedule: [] },
    tiers: [
      { level: 1, name: 'L1', schedule_id: new Types.ObjectId(), escalation_timeout_minutes: 15 },
      { level: 2, name: 'L2', schedule_id: new Types.ObjectId(), escalation_timeout_minutes: 30 },
      { level: 3, name: 'L3', schedule_id: new Types.ObjectId(), escalation_timeout_minutes: null },
    ],
    sla_targets: sevTargets,
  };
}

describe('managed-support.service: createSlaStateForBridge', () => {
  it('sets response and resolution deadlines based on the severity match', async () => {
    const contract = buildContract([{ severity: 2, response_minutes: 45, resolution_minutes: 360 }]) as any;
    const startedAt = new Date('2026-04-24T10:00:00Z');

    const state = await createSlaStateForBridge({
      contract,
      bridgeId: new Types.ObjectId(),
      consumerIncidentId: new Types.ObjectId(),
      providerIncidentId: new Types.ObjectId(),
      consumerTenantId: new Types.ObjectId(),
      providerTenantId: new Types.ObjectId(),
      severity: 2,
      startedAt,
    });

    expect(state.current_tier).toBe(1);
    expect(state.response_sla.target_minutes).toBe(45);
    expect(state.resolution_sla.target_minutes).toBe(360);
    expect(state.tier_history).toHaveLength(1);
    expect(state.tier_history[0].reason).toBe('initial');
    // 24x7 coverage: response deadline = start + 45min
    expect(state.response_sla.deadline_at.getTime()).toBe(startedAt.getTime() + 45 * 60_000);
    // tier_deadline uses L1 escalation_timeout_minutes=15
    expect(state.tier_deadline?.getTime()).toBe(startedAt.getTime() + 15 * 60_000);
  });

  it('falls back to the last SLA target when severity is unmatched', async () => {
    const contract = buildContract([{ severity: 3, response_minutes: 120, resolution_minutes: 1440 }]) as any;
    const startedAt = new Date('2026-04-24T10:00:00Z');
    const state = await createSlaStateForBridge({
      contract,
      bridgeId: new Types.ObjectId(),
      consumerIncidentId: new Types.ObjectId(),
      providerIncidentId: new Types.ObjectId(),
      consumerTenantId: new Types.ObjectId(),
      providerTenantId: new Types.ObjectId(),
      severity: 5,
      startedAt,
    });
    expect(state.response_sla.target_minutes).toBe(120);
  });
});

describe('managed-support.service: escalateTier', () => {
  beforeEach(() => {
    consumerManagedTierFindOne.mockReset();
    consumerManagedTierFindOne.mockResolvedValue(null);
  });

  it('advances L1 → L2 and returns the next schedule ID', async () => {
    const contract = buildContract() as any;
    (SupportContract.findById as any).mockResolvedValue(contract);

    const state = {
      _id: new Types.ObjectId(),
      contract_id: contract._id,
      current_tier: 1,
      tier_started_at: new Date(),
      tier_deadline: new Date(),
      tier_history: [{ level: 1, started_at: new Date(), ended_at: null, reason: 'initial' }],
      save: saveMock,
    } as any;

    const { state: next, nextTierScheduleId } = await escalateTier(state, 'escalation_timeout');
    expect(next.current_tier).toBe(2);
    expect(next.tier_history).toHaveLength(2);
    expect(next.tier_history[0].ended_at).toBeTruthy();
    expect(next.tier_history[1].reason).toBe('escalation_timeout');
    expect(nextTierScheduleId).toEqual(contract.tiers[1].schedule_id);
    expect(saveMock).toHaveBeenCalled();
  });

  it('returns null schedule when already at L3', async () => {
    const contract = buildContract() as any;
    (SupportContract.findById as any).mockResolvedValue(contract);
    const state = {
      _id: new Types.ObjectId(),
      contract_id: contract._id,
      current_tier: 3,
      tier_started_at: new Date(),
      tier_deadline: null,
      tier_history: [],
      save: saveMock,
    } as any;

    const { nextTierScheduleId } = await escalateTier(state, 'manual_escalation');
    expect(nextTierScheduleId).toBeNull();
  });
});
