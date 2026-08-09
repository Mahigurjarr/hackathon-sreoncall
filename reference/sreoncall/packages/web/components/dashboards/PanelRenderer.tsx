'use client';

import { Loader2, AlertTriangle } from 'lucide-react';
import { useQueryPanel } from '@/lib/hooks/useQueryPanel';
import { matrixToChartData } from '@/lib/panel-data-transform';
import type { DashboardPanel } from '@/lib/hooks/useDashboards';
import type { VariableValues } from '@/lib/query-substitution';
import LineChartPanel from './panels/LineChartPanel';
import BarChartPanel from './panels/BarChartPanel';
import StatPanel from './panels/StatPanel';
import GaugePanel from './panels/GaugePanel';
import TablePanel from './panels/TablePanel';

export default function PanelRenderer({
  panel,
  timeRange,
  refreshIntervalSeconds,
  variables = {},
  scope = {},
  height,
  staggerIndex = 0,
}: {
  panel: DashboardPanel;
  timeRange: { from: string; to: string };
  refreshIntervalSeconds: number;
  variables?: VariableValues;
  scope?: Record<string, string | undefined>;
  height?: number;
  staggerIndex?: number;
}) {
  const { data, isLoading, error } = useQueryPanel(
    panel.query,
    timeRange,
    refreshIntervalSeconds,
    !!panel.query,
    variables,
    scope,
    staggerIndex,
  );

  if (!panel.query) {
    return (
      <div className="flex items-center justify-center min-h-[120px] text-[11px] text-muted-foreground">
        No query configured
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[120px]">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[120px] gap-1.5 text-[11px] text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        {error.message || 'Query failed'}
      </div>
    );
  }

  const result = data?.data?.result || [];

  if (result.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[120px] text-[11px] text-muted-foreground">
        No data returned
      </div>
    );
  }

  switch (panel.type) {
    case 'log_viewer':
      // Log viewer renders raw log lines from Loki streams
      return (
        <div className="font-mono text-[10px] leading-tight overflow-y-auto max-h-[280px] p-2 space-y-0.5">
          {(result as any[]).slice(0, 200).map((stream, i) => {
            const labels = stream.stream || stream.metric || {};
            const values = stream.values || [];
            return (
              <div key={i}>
                {values.slice(0, 50).map(([ts, line]: [string, string], j: number) => (
                  <div key={j} className="text-foreground/80 break-all">
                    <span className="text-muted-foreground/60 mr-2">
                      {new Date(parseInt(ts) / 1_000_000).toLocaleTimeString()}
                    </span>
                    {line}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      );

    case 'stat':
      return <StatPanel result={result} thresholds={panel.thresholds} />;

    case 'gauge':
      return (
        <GaugePanel
          result={result}
          thresholds={panel.thresholds}
          max={(panel.options?.max as number) || 100}
        />
      );

    case 'table':
      return <TablePanel result={result} maxHeight={height ?? 240} />;

    case 'bar_chart': {
      const { data: chartData, seriesKeys } = matrixToChartData(result);
      return <BarChartPanel data={chartData} seriesKeys={seriesKeys} height={height} />;
    }

    case 'line_chart':
    default: {
      const { data: chartData, seriesKeys } = matrixToChartData(result);
      return (
        <LineChartPanel
          data={chartData}
          seriesKeys={seriesKeys}
          thresholds={panel.thresholds}
          height={height}
        />
      );
    }
  }
}
