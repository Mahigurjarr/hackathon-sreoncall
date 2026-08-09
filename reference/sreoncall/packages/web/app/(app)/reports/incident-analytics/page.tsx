'use client';

import { useState } from 'react';
import { BarChart3, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useIncidentAnalytics,
  useExportIncidentAnalytics,
  type IncidentAnalyticsParams,
} from '@/lib/hooks/useIncidentAnalytics';

function fmtDuration(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(2)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getDefaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function IncidentAnalyticsPage() {
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getDefaultTo);
  const [activeParams, setActiveParams] = useState<IncidentAnalyticsParams | null>({
    from: getDefaultFrom(),
    to: getDefaultTo(),
  });

  const { data: report, isLoading } = useIncidentAnalytics(activeParams);
  const exportReport = useExportIncidentAnalytics();

  function handleApply() {
    setActiveParams({ from, to });
  }

  function applyPreset(days: number) {
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - days);
    const fromStr = f.toISOString().slice(0, 10);
    const toStr = t.toISOString().slice(0, 10);
    setFrom(fromStr);
    setTo(toStr);
    setActiveParams({ from: fromStr, to: toStr });
  }

  async function handleExport(format: 'csv' | 'pdf') {
    if (!activeParams) { toast.error('Run a report first'); return; }
    try {
      await exportReport.mutateAsync({ ...activeParams, format });
      toast.success(`${format.toUpperCase()} exported`);
    } catch {
      toast.error('Export failed');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Incident Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            MTTA / MTTR, by classification (app vs infrastructure), severity, and service over a custom date range.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={!activeParams || exportReport.isPending}>
            <Download className="mr-1 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('pdf')} disabled={!activeParams || exportReport.isPending}>
            <Download className="mr-1 h-4 w-4" />
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button onClick={handleApply}>Apply</Button>
            <div className="ml-auto flex gap-1">
              {PRESETS.map((p) => (
                <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset(p.days)}>
                  Last {p.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !report ? (
        <EmptyState
          icon={BarChart3}
          title="Run a report"
          description="Pick a date range and click Apply."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardContent>
                <p className="text-xs font-medium uppercase text-muted-foreground">Total Incidents</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{report.summary.total_incidents}</p>
                <p className="text-xs text-muted-foreground">
                  {report.summary.resolved_incidents} resolved · {report.summary.open_incidents} open
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-xs font-medium uppercase text-muted-foreground">MTTA (mean / p95)</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {fmtDuration(report.summary.mtta_seconds.mean)}
                </p>
                <p className="text-xs text-muted-foreground">
                  median {fmtDuration(report.summary.mtta_seconds.median)} · p95 {fmtDuration(report.summary.mtta_seconds.p95)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-xs font-medium uppercase text-muted-foreground">MTTR (mean / p95)</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {fmtDuration(report.summary.mttr_seconds.mean)}
                </p>
                <p className="text-xs text-muted-foreground">
                  median {fmtDuration(report.summary.mttr_seconds.median)} · p95 {fmtDuration(report.summary.mttr_seconds.p95)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-xs font-medium uppercase text-muted-foreground">Top Classification</p>
                <p className="mt-1 text-2xl font-bold text-foreground capitalize">
                  {report.by_classification[0]?.classification ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {report.by_classification[0]?.count ?? 0} incidents
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-input">
              <div className="bg-muted/50 px-4 py-2 text-sm font-semibold">By Classification (app / infrastructure)</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Class</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Incidents</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Resolved</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">MTTA</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">MTTR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-input">
                  {report.by_classification.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">No data</td></tr>
                  ) : report.by_classification.map((c) => (
                    <tr key={c.classification}>
                      <td className="px-4 py-2 capitalize text-foreground">{c.classification}</td>
                      <td className="px-4 py-2 text-right text-foreground">{c.count}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{c.resolved}</td>
                      <td className="px-4 py-2 text-right text-foreground">{fmtDuration(c.mtta_mean_seconds)}</td>
                      <td className="px-4 py-2 text-right text-foreground">{fmtDuration(c.mttr_mean_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-lg border border-input">
              <div className="bg-muted/50 px-4 py-2 text-sm font-semibold">By Severity</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Severity</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Incidents</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">MTTA</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">MTTR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-input">
                  {report.by_severity.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">No data</td></tr>
                  ) : report.by_severity.map((s) => (
                    <tr key={s.severity}>
                      <td className="px-4 py-2 text-foreground">SEV{s.severity}</td>
                      <td className="px-4 py-2 text-right text-foreground">{s.count}</td>
                      <td className="px-4 py-2 text-right text-foreground">{fmtDuration(s.mtta_mean_seconds)}</td>
                      <td className="px-4 py-2 text-right text-foreground">{fmtDuration(s.mttr_mean_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-input">
            <div className="bg-muted/50 px-4 py-2 text-sm font-semibold">Top Services (by incident count)</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Service</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Class</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Incidents</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">MTTA</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">MTTR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-input">
                {report.by_service.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">No data</td></tr>
                ) : report.by_service.map((s) => (
                  <tr key={s.service_id ?? '__none__'}>
                    <td className="px-4 py-2 text-foreground">{s.service_name}</td>
                    <td className="px-4 py-2 capitalize text-muted-foreground">{s.classification}</td>
                    <td className="px-4 py-2 text-right text-foreground">{s.count}</td>
                    <td className="px-4 py-2 text-right text-foreground">{fmtDuration(s.mtta_mean_seconds)}</td>
                    <td className="px-4 py-2 text-right text-foreground">{fmtDuration(s.mttr_mean_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
