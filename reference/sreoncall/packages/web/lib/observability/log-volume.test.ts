import { describe, it, expect } from 'vitest';
import { toVolumeRows } from './log-volume';

describe('toVolumeRows', () => {
  it('returns [] for an empty/missing matrix', () => {
    expect(toVolumeRows(undefined)).toEqual([]);
    expect(toVolumeRows([])).toEqual([]);
  });

  it('maps a single per-level series into rows keyed by timestamp', () => {
    const rows = toVolumeRows([
      { metric: { level: 'error' }, values: [[1000, '3'], [1060, '5']] },
    ]);
    expect(rows).toEqual([
      { t: 1000, error: 3, warn: 0, info: 0, debug: 0 },
      { t: 1060, error: 5, warn: 0, info: 0, debug: 0 },
    ]);
  });

  it('merges multiple level series sharing the same timestamps into one row per t', () => {
    const rows = toVolumeRows([
      { metric: { level: 'error' }, values: [[1000, '2']] },
      { metric: { level: 'warn' }, values: [[1000, '4']] },
      { metric: { level: 'info' }, values: [[1000, '10']] },
    ]);
    expect(rows).toEqual([{ t: 1000, error: 2, warn: 4, info: 10, debug: 0 }]);
  });

  it('sums multiple series for the same level/timestamp instead of overwriting', () => {
    const rows = toVolumeRows([
      { metric: { level: 'error' }, values: [[1000, '2']] },
      { metric: { level: 'error' }, values: [[1000, '3']] },
    ]);
    expect(rows).toEqual([{ t: 1000, error: 5, warn: 0, info: 0, debug: 0 }]);
  });

  it('normalizes level synonyms and defaults unrecognized/missing labels to info', () => {
    const rows = toVolumeRows([
      { metric: { level: 'warning' }, values: [[1000, '1']] },
      { metric: { level: 'crit' }, values: [[1000, '1']] },
      { metric: { level: 'trace' }, values: [[1000, '1']] },
      { metric: {}, values: [[1000, '1']] },
      { metric: { level: 'weird' }, values: [[1000, '1']] },
    ]);
    expect(rows).toEqual([{ t: 1000, error: 1, warn: 1, info: 2, debug: 1 }]);
  });

  it('sorts rows ascending by timestamp regardless of input order', () => {
    const rows = toVolumeRows([
      { metric: { level: 'info' }, values: [[3000, '1'], [1000, '2'], [2000, '3']] },
    ]);
    expect(rows.map((r) => r.t)).toEqual([1000, 2000, 3000]);
  });
});
