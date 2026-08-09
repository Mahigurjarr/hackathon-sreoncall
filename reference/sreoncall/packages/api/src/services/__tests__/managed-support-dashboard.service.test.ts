import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { buildAtRiskEntries } from '../managed-support.service';
import type { IncidentSLAStateDocument } from '../../models/incident-sla-state.model';

function stubState(overrides: Partial<any> = {}): IncidentSLAStateDocument {
  const now = new Date('2026-04-24T12:00:00Z');
  return {
    _id: new Types.ObjectId(),
    incident_bridge_id: new Types.ObjectId(),
    contract_id: new Types.ObjectId(),
    consumer_incident_id: new Types.ObjectId(),
    provider_incident_id: new Types.ObjectId(),
    current_tier: 1,
    tier_started_at: now,
    tier_deadline: null,
    response_sla: {
      target_minutes: 30,
      deadline_at: new Date(now.getTime() + 60 * 60_000),
      met_at: null,
      breached: false,
    },
    resolution_sla: {
      target_minutes: 240,
      deadline_at: new Date(now.getTime() + 4 * 60 * 60_000),
      met_at: null,
      breached: false,
    },
    tier_history: [],
    status: 'active',
    ...overrides,
  } as unknown as IncidentSLAStateDocument;
}

describe('buildAtRiskEntries', () => {
  const now = new Date('2026-04-24T12:00:00Z');

  it('skips states that are not active', () => {
    const s = stubState({
      status: 'resolved',
      tier_deadline: new Date(now.getTime() + 5 * 60_000), // 5 min out
    });
    expect(buildAtRiskEntries([s], now)).toHaveLength(0);
  });

  it('includes tier timeout within 15-min window', () => {
    const s = stubState({
      tier_deadline: new Date(now.getTime() + 10 * 60_000), // 10 min out
    });
    const out = buildAtRiskEntries([s], now);
    expect(out).toHaveLength(1);
    expect(out[0].deadline_kind).toBe('tier');
    expect(out[0].minutes_remaining).toBeCloseTo(10, 1);
  });

  it('excludes tier deadline outside the 15-min window', () => {
    const s = stubState({
      tier_deadline: new Date(now.getTime() + 30 * 60_000), // 30 min out (beyond tier window)
    });
    // response/resolution are both outside 30-min window by construction (60min/240min)
    expect(buildAtRiskEntries([s], now)).toHaveLength(0);
  });

  it('includes response SLA within 30-min window and picks it as the closest deadline', () => {
    const s = stubState({
      tier_deadline: new Date(now.getTime() + 60 * 60_000), // 60 min — outside tier window
      response_sla: {
        target_minutes: 30,
        deadline_at: new Date(now.getTime() + 20 * 60_000), // 20 min — within SLA window
        met_at: null,
        breached: false,
      },
    });
    const out = buildAtRiskEntries([s], now);
    expect(out).toHaveLength(1);
    expect(out[0].deadline_kind).toBe('response');
  });

  it('picks the soonest deadline when multiple are within window', () => {
    const s = stubState({
      tier_deadline: new Date(now.getTime() + 12 * 60_000), // 12 min (tier)
      response_sla: {
        target_minutes: 30,
        deadline_at: new Date(now.getTime() + 5 * 60_000), // 5 min (response) — closer
        met_at: null,
        breached: false,
      },
    });
    const out = buildAtRiskEntries([s], now);
    expect(out).toHaveLength(1);
    expect(out[0].deadline_kind).toBe('response');
    expect(out[0].minutes_remaining).toBeCloseTo(5, 1);
  });

  it('skips response SLA that has already been met', () => {
    const s = stubState({
      response_sla: {
        target_minutes: 30,
        deadline_at: new Date(now.getTime() + 5 * 60_000),
        met_at: new Date(now.getTime() - 60_000), // already ACKed
        breached: false,
      },
    });
    // No tier deadline, response met → nothing at risk
    expect(buildAtRiskEntries([s], now)).toHaveLength(0);
  });

  it('skips response SLA already marked breached (recent-breach section handles it)', () => {
    const s = stubState({
      response_sla: {
        target_minutes: 30,
        deadline_at: new Date(now.getTime() - 5 * 60_000),
        met_at: null,
        breached: true,
      },
    });
    expect(buildAtRiskEntries([s], now)).toHaveLength(0);
  });

  it('treats already-past (negative) deadlines as most urgent, not filtered out', () => {
    const s = stubState({
      tier_deadline: new Date(now.getTime() - 2 * 60_000), // 2 min past
    });
    const out = buildAtRiskEntries([s], now);
    expect(out).toHaveLength(1);
    expect(out[0].minutes_remaining).toBeLessThan(0);
  });

  it('sorts entries by minutes_remaining ascending', () => {
    const s1 = stubState({ tier_deadline: new Date(now.getTime() + 10 * 60_000) }); // 10 min
    const s2 = stubState({ tier_deadline: new Date(now.getTime() + 3 * 60_000) });  // 3 min
    const s3 = stubState({ tier_deadline: new Date(now.getTime() + 1 * 60_000) });  // 1 min
    const out = buildAtRiskEntries([s1, s2, s3], now);
    expect(out.map((e) => Math.round(e.minutes_remaining))).toEqual([1, 3, 10]);
  });
});
