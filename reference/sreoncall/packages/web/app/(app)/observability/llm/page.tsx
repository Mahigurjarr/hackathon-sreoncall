'use client';

import { useMemo } from 'react';
import {
  RefreshCw,
  Brain,
  Clock,
  AlertTriangle,
  DollarSign,
  Activity,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useLLMMetrics, LLM_PRICING } from '@/lib/hooks/useLLMMetrics';

// ── Helpers ──────────────────────────────────────────────────────────

const COLORS = ['#FF6B2B', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Convert Prometheus range result into recharts-friendly data */
function toChartData(result: any[]): { data: any[]; seriesKeys: string[] } {
  if (!result?.length) return { data: [], seriesKeys: [] };

  const timeMap = new Map<number, Record<string, number>>();
  const seriesKeys: string[] = [];

  for (const series of result) {
    const label =
      series.metric?.gen_ai_request_model ||
      series.metric?.gen_ai_system ||
      series.metric?.service_name ||
      'unknown';
    if (!seriesKeys.includes(label)) seriesKeys.push(label);

    for (const [ts, val] of series.values || []) {
      if (!timeMap.has(ts)) timeMap.set(ts, { timestamp: ts });
      timeMap.get(ts)![label] = parseFloat(val) || 0;
    }
  }

  const data = Array.from(timeMap.values()).sort(
    (a, b) => (a.timestamp as number) - (b.timestamp as number)
  );
  return { data, seriesKeys };
}

// ── Stat Card ────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function LLMObservabilityPage() {
  const { data, isLoading, refetch, isRefetching } = useLLMMetrics({});

  const stats = useMemo(() => {
    if (!data) return { totalRequests: 0, avgLatency: 0, errorRate: 0, estCost: 0 };

    // Total requests: sum latest value from each series
    let totalRequests = 0;
    for (const series of data.requestRate || []) {
      const values = series.values || [];
      if (values.length) totalRequests += parseFloat(values[values.length - 1][1]) || 0;
    }

    // Average latency from P99
    let avgLatency = 0;
    let latCount = 0;
    for (const series of data.latencyP99 || []) {
      const values = series.values || [];
      if (values.length) {
        avgLatency += parseFloat(values[values.length - 1][1]) || 0;
        latCount++;
      }
    }
    if (latCount > 0) avgLatency /= latCount;

    // Error rate
    let errorRate = 0;
    for (const series of data.errorRate || []) {
      const values = series.values || [];
      if (values.length) errorRate += parseFloat(values[values.length - 1][1]) || 0;
    }

    // Estimated cost (rough: based on request rate * avg pricing)
    let estCost = 0;
    for (const series of data.requestRate || []) {
      const model = series.metric?.gen_ai_request_model || '';
      const pricing = LLM_PRICING[model];
      if (pricing) {
        const values = series.values || [];
        if (values.length) {
          const rate = parseFloat(values[values.length - 1][1]) || 0;
          // Rough estimate: rate * 60 * avg tokens * price per 1M tokens
          estCost += rate * 60 * ((pricing.input + pricing.output) / 2) * 0.001;
        }
      }
    }

    return { totalRequests, avgLatency, errorRate, estCost };
  }, [data]);

  const requestRateChart = useMemo(() => toChartData(data?.requestRate || []), [data]);
  const latencyChart = useMemo(() => toChartData(data?.latencyP99 || []), [data]);
  const errorChart = useMemo(() => toChartData(data?.errorRate || []), [data]);

  const topConsumers = useMemo(() => {
    if (!data?.topConsumers?.length) return [];
    return data.topConsumers.map((s: any) => ({
      service: s.metric?.service_name || 'unknown',
      rate: parseFloat(s.values?.[s.values.length - 1]?.[1] || '0'),
    })).sort((a: any, b: any) => b.rate - a.rate);
  }, [data]);

  const hasData = (data?.requestRate?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">LLM Observability</h1>
          <p className="text-sm text-muted-foreground">
            Monitor AI/LLM API calls — token usage, cost, latency, errors
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading LLM metrics...</span>
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Brain className="h-12 w-12 text-muted-foreground/40" />
            <h3 className="mt-4 text-sm font-medium text-foreground">No LLM metrics found</h3>
            <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
              LLM metrics will appear once your services emit OpenTelemetry traces with{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">gen_ai.*</code>{' '}
              semantic convention attributes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Requests (rate/s)"
              value={formatNumber(stats.totalRequests)}
              subtitle="Current request rate"
              icon={Activity}
            />
            <StatCard
              title="Avg Latency (P99)"
              value={`${stats.avgLatency.toFixed(2)}s`}
              subtitle="Across all models"
              icon={Clock}
            />
            <StatCard
              title="Error Rate"
              value={formatNumber(stats.errorRate)}
              subtitle="Errors per second"
              icon={AlertTriangle}
            />
            <StatCard
              title="Est. Cost ($/hr)"
              value={`$${stats.estCost.toFixed(2)}`}
              subtitle="Based on list pricing"
              icon={DollarSign}
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Request Rate by Model */}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">
                  Request Rate by Model
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={requestRateChart.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={formatTimestamp}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        labelFormatter={formatTimestamp}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px',
                          fontSize: 12,
                        }}
                      />
                      <Legend />
                      {requestRateChart.seriesKeys.map((key, i) => (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stroke={COLORS[i % COLORS.length]}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Latency P99 by Model */}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">
                  LLM Latency P99 by Model (s)
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={latencyChart.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={formatTimestamp}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        labelFormatter={formatTimestamp}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px',
                          fontSize: 12,
                        }}
                      />
                      <Legend />
                      {latencyChart.seriesKeys.map((key, i) => (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stroke={COLORS[i % COLORS.length]}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Error Rate by Provider */}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">
                  Error Rate by Provider
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={errorChart.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={formatTimestamp}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        labelFormatter={formatTimestamp}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px',
                          fontSize: 12,
                        }}
                      />
                      <Legend />
                      {errorChart.seriesKeys.map((key, i) => (
                        <Bar
                          key={key}
                          dataKey={key}
                          fill={COLORS[i % COLORS.length]}
                          radius={[2, 2, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Top Consumers Table */}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">
                  Top LLM Consumers by Service
                </h3>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">#</th>
                        <th className="pb-2 pr-4 font-medium">Service</th>
                        <th className="pb-2 text-right font-medium">Request Rate (req/s)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topConsumers.map((item: any, idx: number) => (
                        <tr key={item.service} className="border-b border-border/50">
                          <td className="py-2 pr-4 text-muted-foreground">{idx + 1}</td>
                          <td className="py-2 pr-4 font-medium text-foreground">{item.service}</td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {formatNumber(item.rate)}
                          </td>
                        </tr>
                      ))}
                      {topConsumers.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-4 text-center text-muted-foreground">
                            No consumer data available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
