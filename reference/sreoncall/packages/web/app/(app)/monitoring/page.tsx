'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  Plus,
  Trash2,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Search,
  FileText,
  Activity,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  useMonitoringIntegrations,
  useCreateIntegration,
  useDeleteIntegration,
  useTestIntegration,
  useMetricsQuery,
  useLogsQuery,
  type MonitoringIntegration,
  type CreateIntegrationInput,
  type IntegrationType,
} from '@/lib/hooks/useMonitoringIntegrations';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

/* ── Integration type config ── */
const TYPE_CONFIG: Record<IntegrationType, { label: string; color: string; desc: string }> = {
  prometheus: { label: 'Prometheus', color: 'bg-orange-500/10 text-orange-500', desc: 'PromQL metrics' },
  datadog:    { label: 'Datadog',    color: 'bg-purple-500/10 text-purple-500', desc: 'Metrics & APM' },
  newrelic:   { label: 'New Relic',  color: 'bg-teal-500/10 text-teal-500',    desc: 'Full observability' },
  grafana:    { label: 'Grafana',    color: 'bg-orange-400/10 text-orange-400', desc: 'Dashboard platform' },
  mimir:      { label: 'Mimir',      color: 'bg-blue-500/10 text-blue-500',    desc: 'Long-term metrics' },
  loki:       { label: 'Loki',       color: 'bg-yellow-500/10 text-yellow-500', desc: 'Log aggregation' },
};

function statusBadge(status: MonitoringIntegration['status']) {
  if (status === 'connected')
    return <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge>;
  if (status === 'error')
    return <Badge className="bg-red-500/10 text-red-500 border-red-500/20"><XCircle className="mr-1 h-3 w-3" />Error</Badge>;
  return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Pending</Badge>;
}

/* ── Create Integration Dialog ── */
const DEFAULT_FORM: CreateIntegrationInput = {
  name: '',
  type: 'prometheus',
  endpoint_url: '',
  api_key: '',
  extra_headers: {},
};

function IntegrationDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CreateIntegrationInput>(DEFAULT_FORM);
  const [headersJson, setHeadersJson] = useState('{}');
  const create = useCreateIntegration();

  useEffect(() => {
    if (open) {
      setForm(DEFAULT_FORM);
      setHeadersJson('{}');
    }
  }, [open]);

  async function handleSubmit() {
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form.endpoint_url.trim()) return toast.error('Endpoint URL is required');
    let extra_headers: Record<string, string> = {};
    try {
      extra_headers = JSON.parse(headersJson);
    } catch {
      return toast.error('Extra headers must be valid JSON');
    }
    try {
      await create.mutateAsync({ ...form, extra_headers });
      toast.success('Integration added');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add integration');
    }
  }

  const cfg = TYPE_CONFIG[form.type];

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Add Monitoring Integration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input
              placeholder="e.g., Production Prometheus"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Type</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as IntegrationType }))}
            >
              {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label} — {v.desc}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Endpoint URL *</label>
            <Input
              placeholder={
                form.type === 'prometheus' ? 'http://prometheus:9090' :
                form.type === 'datadog' ? 'https://api.datadoghq.com' :
                form.type === 'loki' ? 'http://loki:3100' :
                'https://...'
              }
              value={form.endpoint_url}
              onChange={(e) => setForm((p) => ({ ...p, endpoint_url: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">API Key / Token</label>
            <Input
              type="password"
              placeholder="Optional — leave blank for unauthenticated"
              value={form.api_key ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value }))}
            />
            {form.type === 'datadog' && (
              <p className="text-xs text-muted-foreground">Datadog: paste your API key here</p>
            )}
            {form.type === 'newrelic' && (
              <p className="text-xs text-muted-foreground">New Relic: paste your Insights Query key</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Extra Headers (JSON)</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm h-20 resize-none"
              placeholder='{"X-Custom-Header": "value"}'
              value={headersJson}
              onChange={(e) => setHeadersJson(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={create.isPending}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Integration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Metrics Explorer ── */
function MetricsExplorer() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const { data, isLoading, error } = useMetricsQuery(activeQuery, !!activeQuery);

  const EXAMPLES = [
    'up',
    'rate(http_requests_total[5m])',
    'process_cpu_seconds_total',
    'node_memory_MemAvailable_bytes',
  ];

  // Transform Prometheus response to recharts data
  const chartData: any[] = [];
  if (data?.data?.result) {
    const results: any[] = data.data.result;
    if (results.length > 0 && results[0].values) {
      const timeSet = new Set<number>();
      results.forEach((r: any) => r.values?.forEach(([t]: [number]) => timeSet.add(t)));
      const times = Array.from(timeSet).sort((a, b) => a - b);

      times.forEach((t) => {
        const point: any = {
          time: new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        results.forEach((r: any, i: number) => {
          const val = r.values?.find(([ts]: [number]) => ts === t);
          point[r.metric?.__name__ || `series_${i}`] = val ? parseFloat(val[1]) : null;
        });
        chartData.push(point);
      });
    }
  }

  const seriesKeys = chartData.length > 0
    ? Object.keys(chartData[0]).filter((k) => k !== 'time')
    : [];

  const COLORS = ['#FF6B2B', '#3B82F6', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899'];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
        <QueryEditor
          placeholder="Enter PromQL query, e.g. rate(http_requests_total[5m])"
          value={query}
          onChange={setQuery}
          language="promql"
          height="42px"
        />
        </div>
        <Button onClick={() => setActiveQuery(query)} disabled={isLoading || !query}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => { setQuery(ex); setActiveQuery(ex); }}
            className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
          Failed to query metrics. Is Mimir/Prometheus configured?
        </div>
      )}

      {activeQuery && !isLoading && chartData.length === 0 && !error && (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          No data returned for this query
        </div>
      )}

      {chartData.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-5">
          <p className="mb-4 font-mono text-xs text-muted-foreground">{activeQuery}</p>
          <div className="mt-3">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 20, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#475569" />
              <YAxis tick={{ fontSize: 10 }} stroke="#475569" width={60} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #1E293B', borderRadius: 6 }}
                labelStyle={{ color: '#94A3B8', fontSize: 12 }}
                itemStyle={{ color: '#E2E8F0', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {seriesKeys.slice(0, 6).map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={COLORS[i % COLORS.length]}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Logs Explorer ── */
function LogsExplorer() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const { data, isLoading, error } = useLogsQuery(activeQuery, !!activeQuery);

  const EXAMPLES = [
    '{job="sreoncall-api"}',
    '{level="error"}',
    '{job="sreoncall-web"} |= "error"',
  ];

  const logLines: Array<{ ts: string; level: string; line: string }> = [];
  if (data?.data?.result) {
    const results: any[] = data.data.result;
    results.forEach((stream: any) => {
      const level = stream.stream?.level || 'info';
      stream.values?.forEach(([ts, line]: [string, string]) => {
        logLines.push({
          ts: new Date(parseInt(ts) / 1_000_000).toLocaleTimeString(),
          level,
          line,
        });
      });
    });
    logLines.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  function levelColor(l: string) {
    if (l === 'error' || l === 'fatal') return 'text-red-400';
    if (l === 'warn') return 'text-yellow-400';
    if (l === 'debug') return 'text-blue-400';
    return 'text-green-400';
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
        <QueryEditor
          placeholder='Enter LogQL query, e.g. {job="sreoncall-api"} |= "error"'
          value={query}
          onChange={setQuery}
          language="logql"
          height="42px"
        />
        </div>
        <Button onClick={() => setActiveQuery(query)} disabled={isLoading || !query}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => { setQuery(ex); setActiveQuery(ex); }}
            className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
          Failed to query logs. Is Loki configured?
        </div>
      )}

      {activeQuery && !isLoading && logLines.length === 0 && !error && (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          No log lines returned
        </div>
      )}

      {logLines.length > 0 && (
        <div className="rounded-lg border border-border bg-black/40 p-3 font-mono text-xs overflow-auto max-h-96">
          {logLines.slice(0, 200).map((l, i) => (
            <div key={i} className="flex gap-2 py-0.5 border-b border-white/5 last:border-0">
              <span className="shrink-0 text-[#475569]">{l.ts}</span>
              <span className={`shrink-0 w-12 text-right ${levelColor(l.level)}`}>{l.level}</span>
              <span className="text-[#94A3B8] break-all">{l.line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function MonitoringPage() {
  const [activeTab, setActiveTab] = useState<'integrations' | 'metrics' | 'logs'>('integrations');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useMonitoringIntegrations();
  const deleteIntegration = useDeleteIntegration();
  const testIntegration = useTestIntegration();

  const integrations = data?.data ?? [];

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteIntegration.mutateAsync(deleteId);
      toast.success('Integration removed');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove');
    }
  }

  async function handleTest(id: string) {
    try {
      const result = await testIntegration.mutateAsync(id);
      if (result.success) {
        toast.success(`Connected — ${result.latency_ms}ms`);
      } else {
        toast.error(`Test failed: ${result.message}`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Test failed');
    }
  }

  const tabs = [
    { id: 'integrations', label: 'Integrations', icon: BarChart3 },
    { id: 'metrics', label: 'Metrics Explorer', icon: Activity },
    { id: 'logs', label: 'Logs Explorer', icon: FileText },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monitoring & Observability</h1>
          <p className="text-sm text-muted-foreground">
            Connect data sources and explore metrics &amp; logs
          </p>
        </div>
        {activeTab === 'integrations' && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Integration
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : integrations.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border">
              <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No monitoring integrations yet</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add Integration
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {integrations.map((integration) => {
                const cfg = TYPE_CONFIG[integration.type];
                return (
                  <Card key={integration.id} className="relative overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={`${cfg.color} border-transparent text-xs`}>
                              {cfg.label}
                            </Badge>
                            {statusBadge(integration.status)}
                          </div>
                          <h3 className="font-semibold text-sm text-foreground">{integration.name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {integration.endpoint_url}
                          </p>
                        </div>
                      </div>

                      {integration.error_message && (
                        <div className="mb-3 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                          {integration.error_message}
                        </div>
                      )}

                      {integration.last_tested_at && (
                        <p className="text-xs text-muted-foreground mb-3">
                          Last tested: {new Date(integration.last_tested_at).toLocaleString()}
                        </p>
                      )}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => handleTest(integration.id)}
                          disabled={testIntegration.isPending}
                        >
                          {testIntegration.isPending ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Zap className="mr-1 h-3 w-3" />
                          )}
                          Test
                        </Button>
                        <button
                          onClick={() => setDeleteId(integration.id)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Remove integration"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Supported types info */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Supported Sources</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                  <div key={key} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                    <Badge className={`${cfg.color} border-transparent text-xs shrink-0`}>
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{cfg.desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Metrics Explorer Tab */}
      {activeTab === 'metrics' && (
        <Card>
          <CardContent className="p-4">
            <MetricsExplorer />
          </CardContent>
        </Card>
      )}

      {/* Logs Explorer Tab */}
      {activeTab === 'logs' && (
        <Card>
          <CardContent className="p-4">
            <LogsExplorer />
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <IntegrationDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Remove Integration"
        description="This will permanently remove the monitoring integration. Are you sure?"
        confirmLabel="Remove"
        variant="destructive"
      />
    </div>
  );
}
