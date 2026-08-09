'use client';

import { useProviderSLA, type SLAMetrics } from '@/lib/hooks/useProviderSLA';
import { BarChart3 } from 'lucide-react';

function formatSeconds(seconds: number | null): string {
  if (seconds == null) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export default function SLAPage() {
  const { data: metrics, isLoading } = useProviderSLA();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">SLA Metrics</h1>
        <p className="text-sm text-muted-foreground">Incident response and resolution metrics per consumer</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !metrics?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BarChart3 className="mb-3 h-10 w-10 opacity-50" />
          <p>No SLA data available</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Consumer</th>
                <th className="px-4 py-3 font-medium">Total Incidents</th>
                <th className="px-4 py-3 font-medium">Avg Response</th>
                <th className="px-4 py-3 font-medium">Avg Resolution</th>
                <th className="px-4 py-3 font-medium">P50 Response</th>
                <th className="px-4 py-3 font-medium">P90 Response</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m: SLAMetrics) => (
                <tr key={m.consumer_tenant_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{m.consumer_name || m.consumer_tenant_id}</td>
                  <td className="px-4 py-3">{m.total_incidents}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatSeconds(m.avg_response_seconds)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatSeconds(m.avg_resolution_seconds)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatSeconds(m.p50_response_seconds)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatSeconds(m.p90_response_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
