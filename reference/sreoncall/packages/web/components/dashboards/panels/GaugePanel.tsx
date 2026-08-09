'use client';

import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { MetricSample } from '@/lib/hooks/useObservabilityProxy';
import { getLatestValue } from '@/lib/panel-data-transform';

function getThresholdColor(
  value: number,
  thresholds: Array<{ value: number; color: string }>,
): string {
  if (!thresholds || thresholds.length === 0) return '#FF6B2B';
  const sorted = [...thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) {
    if (value >= t.value) return t.color;
  }
  return '#16A34A';
}

export default function GaugePanel({
  result,
  thresholds,
  max = 100,
}: {
  result: MetricSample[];
  thresholds?: Array<{ value: number; color: string }>;
  max?: number;
}) {
  const value = getLatestValue(result);
  const displayValue = value !== null ? Math.min(value, max) : 0;
  const pct = (displayValue / max) * 100;
  const color = value !== null ? getThresholdColor(value, thresholds || []) : '#94A3B8';

  const gaugeData = [
    { value: displayValue },
    { value: max - displayValue },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[120px]">
      <div className="relative w-[160px] h-[90px]">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie
              data={gaugeData}
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={55}
              outerRadius={75}
              paddingAngle={0}
              dataKey="value"
              isAnimationActive={false}
            >
              <Cell fill={color} />
              <Cell fill="var(--muted)" opacity={0.3} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>
            {value !== null ? (value % 1 === 0 ? value : value.toFixed(1)) : '--'}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground mt-1">
        {pct.toFixed(0)}% of {max}
      </span>
    </div>
  );
}
