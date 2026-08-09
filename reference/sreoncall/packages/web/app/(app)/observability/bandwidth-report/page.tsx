'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpDown,
  Download,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Gauge,
  Activity,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

/* ─── Types ────────────────────────────────────────────────────── */

interface InterfaceReport {
  device: string;
  interface_name: string;
  speed_bps: number;
  p95_in_bps: number;
  p95_out_bps: number;
  p95_burstable_bps: number;
  avg_in_bps: number;
  avg_out_bps: number;
  max_in_bps: number;
  max_out_bps: number;
  utilization_pct: number;
}

interface BandwidthReport {
  period_days: number;
  start: string;
  end: string;
  total_interfaces: number;
  total_p95_burstable_bps: number;
  total_p95_burstable_mbps: number;
  interfaces: InterfaceReport[];
}

/* ─── Helpers ──────────────────────────────────────────────────── */

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${bps} bps`;
}

function utilizationColor(pct: number): string {
  if (pct >= 80) return 'text-red-400';
  if (pct >= 60) return 'text-yellow-400';
  return 'text-emerald-400';
}

function utilizationBadge(pct: number) {
  if (pct >= 80) return 'destructive' as const;
  if (pct >= 60) return 'outline' as const;
  return 'default' as const;
}

/* ─── Sort logic ───────────────────────────────────────────────── */

type SortField = 'device' | 'interface_name' | 'p95_burstable_bps' | 'utilization_pct' | 'avg_in_bps' | 'max_in_bps';

/* ─── Main Page ────────────────────────────────────────────────── */

export default function BandwidthReportPage() {
  const [periodDays, setPeriodDays] = useState(30);
  const [sortField, setSortField] = useState<SortField>('p95_burstable_bps');
  const [sortDesc, setSortDesc] = useState(true);

  const { data, isLoading, error, refetch, isFetching } = useQuery<BandwidthReport>({
    queryKey: ['bandwidth-report', periodDays],
    queryFn: () => api.get(`/api/v1/observability/bandwidth-report?period_days=${periodDays}`),
    staleTime: 300_000,
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  }

  const sortedInterfaces = [...(data?.interfaces ?? [])].sort((a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  function SortHeader({ label, field }: { label: string; field: SortField }) {
    const isActive = sortField === field;
    return (
      <button
        className={cn(
          'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider',
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => toggleSort(field)}
      >
        {label}
        {isActive && (sortDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
        {!isActive && <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    );
  }

  function exportCSV() {
    if (!data) return;
    const headers = ['Device', 'Interface', 'Speed', 'P95 In', 'P95 Out', 'P95 Burstable', 'Avg In', 'Avg Out', 'Max In', 'Max Out', 'Utilization %'];
    const rows = sortedInterfaces.map((i) => [
      i.device, i.interface_name,
      formatBps(i.speed_bps), formatBps(i.p95_in_bps), formatBps(i.p95_out_bps),
      formatBps(i.p95_burstable_bps), formatBps(i.avg_in_bps), formatBps(i.avg_out_bps),
      formatBps(i.max_in_bps), formatBps(i.max_out_bps),
      `${i.utilization_pct}%`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bandwidth-report-p95-${periodDays}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <p className="text-muted-foreground text-sm">Failed to load bandwidth report</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!data || data.interfaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Gauge className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm">No interface bandwidth data available</p>
        <p className="text-muted-foreground/60 text-xs max-w-md text-center">
          Enable HC counter polling on your SNMP trapper to collect 64-bit interface traffic data.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">95th Percentile Bandwidth Report</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.total_interfaces} interfaces | {data.start.slice(0, 10)} to {data.end.slice(0, 10)} ({data.period_days} days)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {[7, 14, 30, 60, 90].map((d) => (
              <button
                key={d}
                className={cn(
                  'px-2.5 py-1.5 transition-colors',
                  periodDays === d
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'bg-card hover:bg-muted text-muted-foreground',
                )}
                onClick={() => setPeriodDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total P95 Burstable</div>
            <div className="text-2xl font-bold font-mono">{formatBps(data.total_p95_burstable_bps)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Billing rate (higher of in/out)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Interfaces Monitored</div>
            <div className="text-2xl font-bold font-mono">{data.total_interfaces}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Report Period</div>
            <div className="text-2xl font-bold font-mono">{data.period_days}d</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">High Utilization</div>
            <div className="text-2xl font-bold font-mono text-red-400">
              {data.interfaces.filter((i) => i.utilization_pct >= 80).length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Interfaces &ge; 80%</div>
          </CardContent>
        </Card>
      </div>

      {/* Interface Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3"><SortHeader label="Device" field="device" /></th>
                  <th className="text-left px-4 py-3"><SortHeader label="Interface" field="interface_name" /></th>
                  <th className="text-right px-4 py-3 whitespace-nowrap"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Speed</span></th>
                  <th className="text-right px-4 py-3"><SortHeader label="P95 In" field="avg_in_bps" /></th>
                  <th className="text-right px-4 py-3"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">P95 Out</span></th>
                  <th className="text-right px-4 py-3"><SortHeader label="P95 Burstable" field="p95_burstable_bps" /></th>
                  <th className="text-right px-4 py-3"><SortHeader label="Peak" field="max_in_bps" /></th>
                  <th className="text-right px-4 py-3"><SortHeader label="Util %" field="utilization_pct" /></th>
                </tr>
              </thead>
              <tbody>
                {sortedInterfaces.map((iface, idx) => (
                  <tr
                    key={`${iface.device}-${iface.interface_name}-${idx}`}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">{iface.device}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{iface.interface_name}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {iface.speed_bps > 0 ? formatBps(iface.speed_bps) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {formatBps(iface.p95_in_bps)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {formatBps(iface.p95_out_bps)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">
                      {formatBps(iface.p95_burstable_bps)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {formatBps(Math.max(iface.max_in_bps, iface.max_out_bps))}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge variant={utilizationBadge(iface.utilization_pct)} className="text-[10px] font-mono">
                        <span className={utilizationColor(iface.utilization_pct)}>
                          {iface.utilization_pct}%
                        </span>
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
