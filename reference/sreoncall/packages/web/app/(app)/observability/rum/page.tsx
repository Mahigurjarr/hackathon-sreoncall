'use client';

import { useState } from 'react';
import { Loader2, Monitor } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { useRUMMetrics } from '@/lib/hooks/useRUM';
import { useRUMApplications } from '@/lib/hooks/useRUMApplications';

// ── Gauge helpers ─────────────────────────────────────────────────────

function vitalColor(value: number | null, yellow: number, red: number) {
  if (value === null) return 'text-muted-foreground';
  if (value >= red) return 'text-red-500';
  if (value >= yellow) return 'text-yellow-500';
  return 'text-green-500';
}

function vitalBg(value: number | null, yellow: number, red: number) {
  if (value === null) return 'bg-muted';
  if (value >= red) return 'bg-red-500/10 border-red-500/30';
  if (value >= yellow) return 'bg-yellow-500/10 border-yellow-500/30';
  return 'bg-green-500/10 border-green-500/30';
}

function vitalLabel(value: number | null, yellow: number, red: number) {
  if (value === null) return 'No data';
  if (value >= red) return 'Poor';
  if (value >= yellow) return 'Needs Improvement';
  return 'Good';
}

// ── Page ──────────────────────────────────────────────────────────────

export default function RUMPage() {
  const [selectedApp, setSelectedApp] = useState('__internal__');
  const { data: rumAppsData, isLoading: appsLoading } = useRUMApplications();
  const rumApps = rumAppsData?.data ?? [];
  const appSlug = selectedApp === '__internal__' ? undefined : selectedApp;
  const { data, isLoading } = useRUMMetrics(appSlug);
  const hasData = data?.hasData ?? false;
  const lcp = data?.lcp ?? null;
  const inp = data?.inp ?? null;
  const cls = data?.cls ?? null;
  const jsErrors = data?.jsErrors ?? [];
  const pageLoad = data?.pageLoad ?? [];
  const sessions = data?.sessions ?? [];
  const browsers = data?.browsers ?? [];

  if (isLoading || appsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">Real User Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Browser performance from real users via Grafana Faro
        </p>
        <div className="mt-3 max-w-sm">
          <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            App
          </label>
          <select
            value={selectedApp}
            onChange={(e) => setSelectedApp(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="__internal__">SREonCall Platform</option>
            {rumApps.map((app) => (
              <option key={app.id} value={app.slug}>
                {app.display_name}
              </option>
            ))}
          </select>
        </div>
        {data?.samples ? (
          <p className="text-xs text-muted-foreground mt-1">
            Based on {data.samples} browser telemetry event{data.samples === 1 ? '' : 's'} from the last hour.
          </p>
        ) : null}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Monitor className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">No RUM Data Yet</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {appSlug
              ? 'This application has not sent any browser telemetry yet. Add the generated Faro snippet to start collecting data.'
              : 'Add the Grafana Faro SDK to your frontend to start collecting Core Web Vitals, JavaScript errors, page load times, and user sessions.'}
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Go to <span className="font-medium text-foreground">Connect</span> to get the setup snippet.
          </p>
        </div>
      ) : (
        <>

      {/* Core Web Vitals gauges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* LCP */}
        <Card className={cn('border', vitalBg(lcp, 2500, 4000))}>
          <CardContent className="p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Largest Contentful Paint (LCP)
            </div>
            <div className={cn('text-3xl font-bold tabular-nums', vitalColor(lcp, 2500, 4000))}>
              {lcp !== null ? `${lcp.toFixed(0)} ms` : '--'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {vitalLabel(lcp, 2500, 4000)}
              <span className="ml-2 text-muted-foreground/60">
                Good &lt;2.5s / Poor &gt;4s
              </span>
            </div>
          </CardContent>
        </Card>

        {/* INP */}
        <Card className={cn('border', vitalBg(inp, 200, 500))}>
          <CardContent className="p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Interaction to Next Paint (INP)
            </div>
            <div className={cn('text-3xl font-bold tabular-nums', vitalColor(inp, 200, 500))}>
              {inp !== null ? `${inp.toFixed(0)} ms` : '--'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {vitalLabel(inp, 200, 500)}
              <span className="ml-2 text-muted-foreground/60">
                Good &lt;200ms / Poor &gt;500ms
              </span>
            </div>
          </CardContent>
        </Card>

        {/* CLS */}
        <Card className={cn('border', vitalBg(cls, 0.1, 0.25))}>
          <CardContent className="p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Cumulative Layout Shift (CLS)
            </div>
            <div className={cn('text-3xl font-bold tabular-nums', vitalColor(cls, 0.1, 0.25))}>
              {cls !== null ? cls.toFixed(3) : '--'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {vitalLabel(cls, 0.1, 0.25)}
              <span className="ml-2 text-muted-foreground/60">
                Good &lt;0.1 / Poor &gt;0.25
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* JS Error Rate + Page Load */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">JS Error Rate</h3>
            {jsErrors.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={jsErrors}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={1.5} dot={false} name="errors/s" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
                No error data
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Page Load Time by URL (ms)</h3>
            {pageLoad.length > 0 ? (
              <div className="overflow-auto max-h-[200px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">URL Path</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Avg (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageLoad.map((row) => (
                      <tr key={row.url_path} className="border-b border-border/50">
                        <td className="py-1.5 px-2 font-mono text-foreground">{row.url_path}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-foreground">{row.value.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
                No page load data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sessions + Browser breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Active Sessions Over Time</h3>
            {sessions.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={sessions}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} name="sessions/s" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
                No session data
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Sessions by Browser</h3>
            {browsers.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={browsers}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="sessions" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
                No browser data
              </div>
            )}
          </CardContent>
        </Card>
      </div>
        </>
      )}
    </div>
  );
}
