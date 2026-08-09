import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import {
  expandCoverageSchedule,
  coverageToBusinessHours,
  contractAppliesAt,
} from '../support-contract.service';
import { isWithinBusinessHours } from '../sla-calculator.service';
import type { SupportContractDocument } from '../../models/support-contract.model';

describe('support-contract.service: coverage window expansion', () => {
  it('24x7 expands to every day, full range', () => {
    const expanded = expandCoverageSchedule({ type: '24x7', timezone: 'UTC', schedule: [] });
    expect(expanded.schedule).toHaveLength(7);
    expect(expanded.schedule.every((s) => s.start === '00:00' && s.end === '23:59')).toBe(true);
  });

  it('8x5 expands to Mon-Fri 09:00-17:00', () => {
    const expanded = expandCoverageSchedule({ type: '8x5', timezone: 'UTC', schedule: [] });
    expect(expanded.schedule).toHaveLength(5);
    const days = expanded.schedule.map((s) => s.day).sort();
    expect(days).toEqual([1, 2, 3, 4, 5]);
    expect(expanded.schedule.every((s) => s.start === '09:00' && s.end === '17:00')).toBe(true);
  });

  it('custom with empty schedule throws', () => {
    expect(() =>
      expandCoverageSchedule({ type: 'custom', timezone: 'UTC', schedule: [] }),
    ).toThrowError(/Custom coverage window requires a schedule/);
  });

  it('custom with a schedule passes through unchanged', () => {
    const sched = [{ day: 1, start: '08:00', end: '20:00' }];
    const expanded = expandCoverageSchedule({ type: 'custom', timezone: 'UTC', schedule: sched });
    expect(expanded.schedule).toEqual(sched);
  });
});

describe('support-contract.service: coverageToBusinessHours + isWithinBusinessHours', () => {
  it('24x7 is always within business hours', () => {
    const bh = coverageToBusinessHours({ type: '24x7', timezone: 'UTC', schedule: [] });
    // Pick a weekend late-night moment — 24x7 should still cover it.
    const sat2am = new Date('2026-05-02T02:00:00Z'); // Saturday 02:00 UTC
    expect(isWithinBusinessHours(sat2am, bh)).toBe(true);
  });

  it('8x5 is NOT covered on Saturday', () => {
    const bh = coverageToBusinessHours({ type: '8x5', timezone: 'UTC', schedule: [] });
    const sat10am = new Date('2026-05-02T10:00:00Z'); // Saturday 10:00 UTC
    expect(isWithinBusinessHours(sat10am, bh)).toBe(false);
  });

  it('8x5 is covered Wednesday 14:00 UTC, not covered Wednesday 22:00 UTC', () => {
    const bh = coverageToBusinessHours({ type: '8x5', timezone: 'UTC', schedule: [] });
    const wedInside = new Date('2026-04-29T14:00:00Z'); // Wed 14:00
    const wedOutside = new Date('2026-04-29T22:00:00Z'); // Wed 22:00
    expect(isWithinBusinessHours(wedInside, bh)).toBe(true);
    expect(isWithinBusinessHours(wedOutside, bh)).toBe(false);
  });
});

describe('support-contract.service: contractAppliesAt', () => {
  function stubContract(overrides: Partial<any> = {}): SupportContractDocument {
    return {
      _id: new Types.ObjectId(),
      status: 'active',
      effective_from: new Date('2026-01-01T00:00:00Z'),
      effective_until: null,
      ...overrides,
    } as SupportContractDocument;
  }

  it('returns false when status is not active', () => {
    expect(contractAppliesAt(stubContract({ status: 'draft' }))).toBe(false);
    expect(contractAppliesAt(stubContract({ status: 'canceled' }))).toBe(false);
  });

  it('returns false before effective_from', () => {
    const c = stubContract({ effective_from: new Date('2026-06-01T00:00:00Z') });
    expect(contractAppliesAt(c, new Date('2026-05-01T00:00:00Z'))).toBe(false);
  });

  it('returns false after effective_until', () => {
    const c = stubContract({ effective_until: new Date('2026-03-01T00:00:00Z') });
    expect(contractAppliesAt(c, new Date('2026-04-01T00:00:00Z'))).toBe(false);
  });

  it('returns true inside the effective window', () => {
    expect(contractAppliesAt(stubContract(), new Date('2026-04-24T12:00:00Z'))).toBe(true);
  });
});
