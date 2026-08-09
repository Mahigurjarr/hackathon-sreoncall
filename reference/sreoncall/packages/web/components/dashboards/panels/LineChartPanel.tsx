'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { ChartDataPoint } from '@/lib/panel-data-transform';

const COLORS = ['#FF6B2B', '#3B82F6', '#16A34A', '#EAB308', '#7C3AED', '#DC2626', '#06B6D4'];

function formatTime(tick: number): string {
  const d = new Date(tick * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
}

export default function LineChartPanel({
  data,
  seriesKeys,
  thresholds,
  height = 200,
}: {
  data: ChartDataPoint[];
  seriesKeys: string[];
  thresholds?: Array<{ value: number; color: string }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatValue}
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 11,
          }}
          labelFormatter={(v) => formatTime(v as number)}
          formatter={(v: number, name: string) => [formatValue(v), name]}
        />
        {seriesKeys.length > 1 && (
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 4, maxHeight: 48, overflowY: 'auto' }}
            iconSize={8}
          />
        )}
        {thresholds?.map((t, i) => (
          <Line
            key={`threshold-${i}`}
            type="monotone"
            dataKey={() => t.value}
            stroke={t.color}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
            name={`Threshold ${t.value}`}
          />
        ))}
        {seriesKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
