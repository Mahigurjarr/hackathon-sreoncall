'use client';

import type { MetricSample } from '@/lib/hooks/useObservabilityProxy';
import { getLatestValue, getSeriesLabel } from '@/lib/panel-data-transform';

function formatStatValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
}

function getThresholdColor(
  value: number,
  thresholds: Array<{ value: number; color: string }>,
): string {
  if (!thresholds || thresholds.length === 0) return '#FF6B2B';

  // Sort descending by threshold value, pick first one where value >= threshold
  const sorted = [...thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) {
    if (value >= t.value) return t.color;
  }
  return '#16A34A'; // green by default (below all thresholds)
}

function getTrend(result: MetricSample[]): 'up' | 'down' | 'flat' {
  if (!result || result.length === 0) return 'flat';
  const sample = result[0];
  const values = sample.values;
  if (!values || values.length < 2) return 'flat';

  const recent = parseFloat(values[values.length - 1][1]);
  const earlier = parseFloat(values[Math.floor(values.length / 2)][1]);
  if (recent > earlier * 1.01) return 'up';
  if (recent < earlier * 0.99) return 'down';
  return 'flat';
}

export default function StatPanel({
  result,
  thresholds,
}: {
  result: MetricSample[];
  thresholds?: Array<{ value: number; color: string }>;
}) {
  const value = getLatestValue(result);
  const trend = getTrend(result);
  const label = result.length > 0 ? getSeriesLabel(result[0].metric) : '';
  const color = value !== null ? getThresholdColor(value, thresholds || []) : '#94A3B8';

  return (
    <div className="flex flex-col items-center justify-center min-h-[120px]">
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-3xl font-bold tabular-nums"
          style={{ color }}
        >
          {value !== null ? formatStatValue(value) : '--'}
        </span>
        {trend !== 'flat' && (
          <span
            className="text-lg"
            style={{ color: trend === 'up' ? '#DC2626' : '#16A34A' }}
          >
            {trend === 'up' ? '\u2191' : '\u2193'}
          </span>
        )}
      </div>
      {label && (
        <span className="text-[11px] text-muted-foreground mt-1 truncate max-w-full">
          {label}
        </span>
      )}
    </div>
  );
}
