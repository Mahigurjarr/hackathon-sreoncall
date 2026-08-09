import { describe, it, expect } from 'vitest';
import { parseIncidentNumber } from '../../calendar-sync.service';

describe('parseIncidentNumber', () => {
  it('extracts the number from common INC title formats', () => {
    expect(parseIncidentNumber('INC-0670 bridge call')).toBe(670);
    expect(parseIncidentNumber('INC-42 sync')).toBe(42);
    expect(parseIncidentNumber('inc 0007 standup')).toBe(7);
    expect(parseIncidentNumber('Weekly [INC-1234] review')).toBe(1234);
  });

  it('returns null when there is no incident reference', () => {
    expect(parseIncidentNumber('Weekly team sync')).toBeNull();
    expect(parseIncidentNumber('')).toBeNull();
    expect(parseIncidentNumber(undefined)).toBeNull();
  });
});
