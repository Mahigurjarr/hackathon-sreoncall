import type { MetricSample } from '@/lib/hooks/useObservabilityProxy';

export interface ChartDataPoint {
  time: number;
  timestamp: string;
  [seriesKey: string]: number | string;
}

/**
 * Labels that are most useful for distinguishing series, in priority order.
 */
const PREFERRED_LABELS = [
  'instance', 'host_name', 'device', 'name', 'container', 'pod',
  'namespace', 'node', 'cpu', 'mode', 'mountpoint', 'interface',
  'method', 'handler', 'path', 'code', 'le',
];

/**
 * Labels that are noisy / duplicated / rarely useful for legend display.
 */
const NOISE_LABELS = new Set([
  '__name__', 'job', 'http_scheme', 'os_type', 'url_scheme',
  'service_name', 'service_instance_id', 'server_address',
  'net_host_name',
]);

/**
 * Generate a readable label from metric labels.
 * Picks the most meaningful labels instead of dumping the full label set.
 */
export function getSeriesLabel(metric: Record<string, string>): string {
  const { __name__, ...rest } = metric;
  const parts = Object.entries(rest);
  if (parts.length === 0) return __name__ || 'value';
  if (parts.length === 1) return parts[0][1];

  // Pick preferred labels that exist in this metric
  const picked: string[] = [];
  for (const key of PREFERRED_LABELS) {
    if (rest[key]) picked.push(rest[key]);
    if (picked.length >= 2) break;
  }

  // If no preferred labels found, pick the first non-noise labels
  if (picked.length === 0) {
    for (const [k, v] of parts) {
      if (!NOISE_LABELS.has(k)) {
        picked.push(v);
        if (picked.length >= 2) break;
      }
    }
  }

  // Final fallback: first label value
  if (picked.length === 0) return parts[0][1];

  return picked.join(' / ');
}

/**
 * Transform Prometheus matrix results into recharts-compatible format.
 * Returns { data, seriesKeys } where data is an array of { time, timestamp, series1, series2, ... }
 */
export function matrixToChartData(result: MetricSample[]): {
  data: ChartDataPoint[];
  seriesKeys: string[];
} {
  if (!result || result.length === 0) return { data: [], seriesKeys: [] };

  // Generate labels, then deduplicate collisions by appending a suffix
  const rawLabels = result.map((s) => getSeriesLabel(s.metric));
  const labelCounts = new Map<string, number>();
  for (const l of rawLabels) labelCounts.set(l, (labelCounts.get(l) || 0) + 1);

  const usedLabels = new Map<string, number>();
  const seriesKeys: string[] = [];
  const timeMap = new Map<number, ChartDataPoint>();

  for (let i = 0; i < result.length; i++) {
    let label = rawLabels[i];
    // Disambiguate if multiple series share the same short label
    if ((labelCounts.get(label) || 0) > 1) {
      const idx = (usedLabels.get(label) || 0) + 1;
      usedLabels.set(label, idx);
      if (idx > 1) label = `${label} (${idx})`;
    }
    seriesKeys.push(label);

    const values = result[i].values || (result[i].value ? [result[i].value!] : []);
    for (const [ts, val] of values) {
      const time = Math.floor(ts);
      if (!timeMap.has(time)) {
        timeMap.set(time, {
          time,
          timestamp: new Date(ts * 1000).toISOString(),
        });
      }
      const point = timeMap.get(time)!;
      point[label] = parseFloat(val);
    }
  }

  const data = Array.from(timeMap.values()).sort((a, b) => a.time - b.time);
  return { data, seriesKeys };
}

/**
 * Get the latest value from a metric result (for stat panels).
 */
export function getLatestValue(result: MetricSample[]): number | null {
  if (!result || result.length === 0) return null;

  const sample = result[0];
  if (sample.value) return parseFloat(sample.value[1]);
  if (sample.values && sample.values.length > 0) {
    return parseFloat(sample.values[sample.values.length - 1][1]);
  }
  return null;
}

/**
 * Parse relative time expressions like "now-1h", "now-6h" to epoch seconds.
 */
export function parseRelativeTime(expr: string): number {
  const now = Math.floor(Date.now() / 1000);
  if (expr === 'now') return now;

  // Absolute Unix timestamp (used by custom date picker)
  const asNum = Number(expr);
  if (!isNaN(asNum) && asNum > 1_000_000_000) return asNum;

  const match = expr.match(/^now-(\d+)([smhd])$/);
  if (!match) return now;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

  return now - value * (multipliers[unit] || 1);
}

/**
 * Compute step size based on time range for reasonable data point density.
 */
export function computeStep(fromSec: number, toSec: number): string {
  const rangeSec = toSec - fromSec;
  if (rangeSec <= 3600) return '15s';        // <= 1h
  if (rangeSec <= 21600) return '60s';       // <= 6h
  if (rangeSec <= 86400) return '300s';      // <= 24h
  if (rangeSec <= 604800) return '1800s';    // <= 7d
  return '3600s';                            // > 7d
}
