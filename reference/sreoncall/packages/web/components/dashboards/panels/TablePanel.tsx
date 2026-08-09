'use client';

import type { MetricSample } from '@/lib/hooks/useObservabilityProxy';

function formatValue(v: string | number): string {
  const num = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(num)) return String(v);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num % 1 === 0 ? num.toString() : num.toFixed(4);
}

export default function TablePanel({
  result,
  maxHeight = 240,
}: {
  result: MetricSample[];
  maxHeight?: number;
}) {
  if (!result || result.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[120px] text-[11px] text-muted-foreground">
        No data
      </div>
    );
  }

  // Collect all unique label keys across all series
  const labelKeys = new Set<string>();
  for (const sample of result) {
    for (const key of Object.keys(sample.metric)) {
      if (key !== '__name__') labelKeys.add(key);
    }
  }
  const columns = Array.from(labelKeys);

  return (
    <div className="overflow-auto" style={{ maxHeight: maxHeight }}>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col} className="text-left px-2 py-1.5 font-medium text-muted-foreground">
                {col}
              </th>
            ))}
            <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {result.map((sample, i) => {
            const value = sample.value
              ? sample.value[1]
              : sample.values && sample.values.length > 0
                ? sample.values[sample.values.length - 1][1]
                : '--';

            return (
              <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1 text-foreground truncate max-w-[150px]">
                    {sample.metric[col] || '--'}
                  </td>
                ))}
                <td className="px-2 py-1 text-right font-mono text-foreground">
                  {formatValue(value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
