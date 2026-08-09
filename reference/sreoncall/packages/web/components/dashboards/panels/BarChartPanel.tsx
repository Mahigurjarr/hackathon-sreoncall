'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
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

export default function BarChartPanel({
  data,
  seriesKeys,
  height = 200,
}: {
  data: ChartDataPoint[];
  seriesKeys: string[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
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
          formatter={(v: number) => [formatValue(v), undefined]}
        />
        {seriesKeys.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4, maxHeight: 48, overflowY: 'auto' }} iconSize={8} />
        )}
        {seriesKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            fill={COLORS[i % COLORS.length]}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
