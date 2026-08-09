// Pure mapper: a Loki/Mimir volume-query matrix (per-level series from
// `sum by (level) (count_over_time(<logql> [<step>]))`) → stacked-bar rows for the
// LogsExploreV2 volume histogram. Extracted so the row-building logic can be unit-tested
// without React/Recharts — mirrors the `histogramData` builder idea in
// app/(app)/observability/logs/page.tsx (matrix `result[].metric.level` + `values:[[t,v]]`
// → rows `{t, error, warn, info, debug}`), simplified to the pure per-timestamp merge.

export interface VolumeSample {
  metric?: Record<string, string>;
  values?: [number, string][];
}

export interface VolumeRow {
  t: number;
  error: number;
  warn: number;
  info: number;
  debug: number;
}

type LevelKey = Exclude<keyof VolumeRow, 't'>;

// Canonicalize a `level` label value to one of the four histogram buckets. Unrecognized or
// missing labels default to 'info' — matches the level-detection default used elsewhere in
// this explorer (lib/observability/log-line.ts's getLevelColor).
function toLevelKey(raw?: string): LevelKey {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'error' || v === 'err' || v === 'fatal' || v === 'critical' || v === 'crit') return 'error';
  if (v === 'warn' || v === 'warning') return 'warn';
  if (v === 'debug' || v === 'trace') return 'debug';
  return 'info';
}

/**
 * Map a volume matrix (`data.result[]`, each `{ metric: { level }, values: [[t, v]] }`) into
 * rows keyed by timestamp: `{ t, error, warn, info, debug }`, sorted ascending by `t`.
 * Multiple series for the same level/timestamp are summed. An empty/missing matrix → [].
 */
export function toVolumeRows(matrix?: VolumeSample[]): VolumeRow[] {
  if (!matrix?.length) return [];
  const byTs = new Map<number, VolumeRow>();
  for (const sample of matrix) {
    const level = toLevelKey(sample.metric?.level);
    for (const [t, v] of sample.values ?? []) {
      let row = byTs.get(t);
      if (!row) {
        row = { t, error: 0, warn: 0, info: 0, debug: 0 };
        byTs.set(t, row);
      }
      row[level] += Number(v) || 0;
    }
  }
  return Array.from(byTs.values()).sort((a, b) => a.t - b.t);
}
