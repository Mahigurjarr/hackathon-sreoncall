'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Activity,
  Plus,
  Trash2,
  Play,
  Pause,
  RotateCw,
  ChevronDown,
  ChevronUp,
  Globe,
  Network,
  Loader2,
  Clock,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
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
  useSyntheticChecks,
  useCheckResults,
  useCreateCheck,
  useUpdateCheck,
  useDeleteCheck,
  useTriggerCheck,
  usePauseCheck,
  useResumeCheck,
  type SyntheticCheck,
  type CreateCheckInput,
  type CheckType,
} from '@/lib/hooks/useSyntheticChecks';
import { useServices } from '@/lib/hooks/useServices';

const ChecksWorldMap = dynamic(() => import('@/components/shared/ChecksWorldMap'), { ssr: false });

/* ── helpers ── */
function statusColor(s: string | null) {
  if (s === 'up') return 'text-[#16A34A]';
  if (s === 'down') return 'text-[#DC2626]';
  if (s === 'degraded') return 'text-[#A16207]';
  return 'text-muted-foreground';
}

function statusBadge(s: string | null) {
  if (s === 'up')
    return (
      <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
        <CheckCircle2 className="mr-1 h-3 w-3" /> UP
      </Badge>
    );
  if (s === 'down')
    return (
      <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
        <XCircle className="mr-1 h-3 w-3" /> DOWN
      </Badge>
    );
  if (s === 'degraded')
    return (
      <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
        <AlertTriangle className="mr-1 h-3 w-3" /> DEGRADED
      </Badge>
    );
  return <Badge variant="secondary">PENDING</Badge>;
}

function uptimeBar(pct: number) {
  const color = pct >= 99 ? 'bg-[#16A34A]' : pct >= 95 ? 'bg-[#A16207]' : 'bg-[#DC2626]';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}

function typeIcon(t: CheckType) {
  if (t === 'http') return <Globe className="h-4 w-4" />;
  if (t === 'tcp') return <Network className="h-4 w-4" />;
  return <Activity className="h-4 w-4" />;
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function relativeTime(ts: string | null) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ── Results Panel ── */
function ResultsPanel({ checkId }: { checkId: string }) {
  const { data, isLoading } = useCheckResults(checkId, {}, true);
  const results = data?.data ?? [];

  if (isLoading)
    return (
      <div className="flex h-16 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );

  if (results.length === 0)
    return <p className="px-4 py-3 text-sm text-muted-foreground">No results yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-t border-border">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Response</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">HTTP</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Error</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Checked At</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {results.slice(0, 20).map((r) => (
            <tr key={r._id} className="hover:bg-muted/30">
              <td className={`px-4 py-2 font-semibold ${statusColor(r.status)}`}>
                {r.status.toUpperCase()}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{fmtMs(r.response_time_ms)}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.http_status_code ?? '—'}</td>
              <td className="px-4 py-2 text-muted-foreground max-w-xs truncate">{r.error ?? '—'}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(r.checked_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Create / Edit Dialog ── */
const DEFAULT_FORM: CreateCheckInput & { service_id?: string | null } = {
  name: '',
  type: 'http',
  service_id: null,
  interval_seconds: 60,
  timeout_seconds: 10,
  url: '',
  method: 'GET',
  http_headers: {},
  expected_status_code: 200,
  keyword_check: '',
  host: '',
  port: undefined,
  hostname: '',
  record_type: 'A',
  expected_value: '',
};

function CheckDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: SyntheticCheck;
}) {
  const [form, setForm] = useState<CreateCheckInput & { service_id?: string | null }>(DEFAULT_FORM);
  const create = useCreateCheck();
  const update = useUpdateCheck();
  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];

  useEffect(() => {
    if (open) {
      if (existing) {
        setForm({
          name: existing.name,
          type: existing.type,
          service_id: existing.service_id ?? null,
          interval_seconds: existing.interval_seconds,
          timeout_seconds: existing.timeout_seconds,
          url: existing.url ?? '',
          method: (existing.method as any) ?? 'GET',
          http_headers: existing.http_headers ?? {},
          expected_status_code: existing.expected_status_code ?? 200,
          keyword_check: existing.keyword_check ?? '',
          host: existing.host ?? '',
          port: existing.port ?? undefined,
          hostname: existing.hostname ?? '',
          record_type: (existing.record_type as any) ?? 'A',
          expected_value: existing.expected_value ?? '',
        });
      } else {
        setForm(DEFAULT_FORM);
      }
    }
  }, [open, existing]);

  function set<K extends keyof CreateCheckInput>(k: K, v: CreateCheckInput[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) return toast.error('Name is required');
    try {
      const payload = { ...form };
      if (form.type === 'http') {
        delete payload.host;
        delete payload.port;
        delete payload.hostname;
        delete payload.record_type;
        delete payload.expected_value;
      } else if (form.type === 'tcp') {
        delete payload.url;
        delete payload.http_headers;
        delete payload.expected_status_code;
        delete payload.keyword_check;
        delete payload.hostname;
        delete payload.record_type;
        delete payload.expected_value;
      } else {
        delete payload.url;
        delete payload.http_headers;
        delete payload.expected_status_code;
        delete payload.keyword_check;
        delete payload.host;
        delete payload.port;
      }
      if (existing) {
        await update.mutateAsync({ id: existing.id, input: payload });
        toast.success('Check updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Check created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save check');
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {existing ? 'Edit Check' : 'New Synthetic Check'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Name *</label>
            <Input placeholder="e.g., API Health Check" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>

          {/* Type */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Type</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => set('type', e.target.value as CheckType)}
            >
              <option value="http">HTTP / HTTPS</option>
              <option value="tcp">TCP Port</option>
              <option value="dns">DNS Lookup</option>
            </select>
          </div>

          {/* Linked Service */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Linked Service</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.service_id ?? ''}
              onChange={(e) => set('service_id' as any, e.target.value || null)}
            >
              <option value="">None (no auto-incident)</option>
              {services.map((svc: any) => (
                <option key={svc.id || svc._id} value={svc.id || svc._id}>{svc.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Links this check to a service. Incidents are auto-created after 5 consecutive failures.
            </p>
          </div>

          {/* Interval + Timeout */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Interval (seconds)</label>
              <Input
                type="number"
                min={10}
                value={form.interval_seconds}
                onChange={(e) => set('interval_seconds', parseInt(e.target.value) || 60)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Timeout (seconds)</label>
              <Input
                type="number"
                min={1}
                value={form.timeout_seconds}
                onChange={(e) => set('timeout_seconds', parseInt(e.target.value) || 10)}
              />
            </div>
          </div>

          {/* HTTP fields */}
          {form.type === 'http' && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">URL *</label>
                <Input
                  placeholder="https://api.example.com/health"
                  value={form.url ?? ''}
                  onChange={(e) => set('url', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Method</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.method ?? 'GET'}
                    onChange={(e) => set('method', e.target.value as any)}
                  >
                    <option>GET</option>
                    <option>POST</option>
                    <option>HEAD</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Expected Status</label>
                  <Input
                    type="number"
                    value={form.expected_status_code ?? 200}
                    onChange={(e) => set('expected_status_code', parseInt(e.target.value) || 200)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Keyword Check (optional)</label>
                <Input
                  placeholder="Text that must appear in response body"
                  value={form.keyword_check ?? ''}
                  onChange={(e) => set('keyword_check', e.target.value)}
                />
              </div>
            </>
          )}

          {/* TCP fields */}
          {form.type === 'tcp' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Host *</label>
                <Input
                  placeholder="db.example.com"
                  value={form.host ?? ''}
                  onChange={(e) => set('host', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Port *</label>
                <Input
                  type="number"
                  placeholder="5432"
                  value={form.port ?? ''}
                  onChange={(e) => set('port', parseInt(e.target.value) || undefined)}
                />
              </div>
            </div>
          )}

          {/* DNS fields */}
          {form.type === 'dns' && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">Hostname *</label>
                <Input
                  placeholder="api.example.com"
                  value={form.hostname ?? ''}
                  onChange={(e) => set('hostname', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Record Type</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.record_type ?? 'A'}
                    onChange={(e) => set('record_type', e.target.value as any)}
                  >
                    <option>A</option>
                    <option>CNAME</option>
                    <option>MX</option>
                    <option>TXT</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Expected Value</label>
                  <Input
                    placeholder="1.2.3.4"
                    value={form.expected_value ?? ''}
                    onChange={(e) => set('expected_value', e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existing ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ── */
export default function SyntheticChecksPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editCheck, setEditCheck] = useState<SyntheticCheck | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useSyntheticChecks({
    type: typeFilter || undefined,
    status: statusFilter || undefined,
    search: search || undefined,
  });
  const deleteCheck = useDeleteCheck();
  const triggerCheck = useTriggerCheck();
  const pauseCheck = usePauseCheck();
  const resumeCheck = useResumeCheck();

  const checks = data?.data ?? [];
  const total = data?.pagination?.total ?? checks.length;

  const upCount = checks.filter((c) => c.last_status === 'up').length;
  const downCount = checks.filter((c) => c.last_status === 'down').length;
  const pausedCount = checks.filter((c) => c.status === 'paused').length;

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteCheck.mutateAsync(deleteId);
      toast.success('Check deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  }

  async function handleTrigger(id: string) {
    try {
      await triggerCheck.mutateAsync(id);
      toast.success('Check triggered');
    } catch (err: any) {
      toast.error(err?.message || 'Trigger failed');
    }
  }

  async function handleToggle(check: SyntheticCheck) {
    try {
      if (check.status === 'active') {
        await pauseCheck.mutateAsync(check.id);
        toast.success('Check paused');
      } else {
        await resumeCheck.mutateAsync(check.id);
        toast.success('Check resumed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Synthetic Checks</h1>
          <p className="text-sm text-muted-foreground">
            Monitor endpoints with HTTP, TCP, and DNS probes
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Check
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total', value: total, icon: Activity, color: 'text-foreground' },
          { label: 'Up', value: upCount, icon: CheckCircle2, color: 'text-[#16A34A]' },
          { label: 'Down', value: downCount, icon: XCircle, color: 'text-[#DC2626]' },
          { label: 'Paused', value: pausedCount, icon: Pause, color: 'text-muted-foreground' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className={`h-8 w-8 ${color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* World Map */}
      {checks.length > 0 && <ChecksWorldMap checks={checks} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <SearchInput
          containerClassName="flex-1 min-w-48"
          placeholder="Search checks..."
          value={search}
          onChange={setSearch}
        />
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="http">HTTP</option>
          <option value="tcp">TCP</option>
          <option value="dns">DNS</option>
        </select>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {/* Checks Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : checks.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3">
              <Activity className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No synthetic checks yet</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Create your first check
              </Button>
            </div>
          ) : (
            <div>
              {checks.map((check) => (
                <div key={check.id} className="border-b border-border last:border-b-0">
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                    {/* Type icon */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      {typeIcon(check.type)}
                    </div>

                    {/* Name + target */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground">{check.name}</span>
                        <Badge variant="secondary" className="text-xs uppercase">
                          {check.type}
                        </Badge>
                        {check.status === 'paused' && (
                          <Badge variant="secondary" className="text-xs">Paused</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {check.url || (check.host ? `${check.host}:${check.port}` : check.hostname)}
                        {' · '}Every {check.interval_seconds}s
                      </p>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0">{statusBadge(check.last_status)}</div>

                    {/* Uptime 24h */}
                    <div className="hidden lg:block shrink-0 w-36">
                      <p className="text-xs text-muted-foreground mb-1">24h uptime</p>
                      {uptimeBar(check.uptime_24h)}
                    </div>

                    {/* Response time */}
                    <div className="hidden md:block shrink-0 w-20 text-right">
                      <p className="text-xs text-muted-foreground">Response</p>
                      <p className="text-sm font-mono">{fmtMs(check.last_response_time_ms)}</p>
                    </div>

                    {/* Last checked */}
                    <div className="hidden sm:block shrink-0 w-20 text-right">
                      <p className="text-xs text-muted-foreground">Last check</p>
                      <p className="text-xs">{relativeTime(check.last_check_at)}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleTrigger(check.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Trigger now"
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleToggle(check)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={check.status === 'active' ? 'Pause' : 'Resume'}
                      >
                        {check.status === 'active' ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditCheck(check)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Edit"
                      >
                        <Filter className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(check.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === check.id ? null : check.id)
                        }
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="View results"
                      >
                        {expandedId === check.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded results */}
                  {expandedId === check.id && (
                    <div className="border-t border-border bg-muted/20">
                      <div className="flex items-center gap-6 px-4 py-2 text-xs text-muted-foreground">
                        <span>1h: <strong>{check.uptime_1h.toFixed(1)}%</strong></span>
                        <span>24h: <strong>{check.uptime_24h.toFixed(1)}%</strong></span>
                        <span>7d: <strong>{check.uptime_7d.toFixed(1)}%</strong></span>
                        <span>Failures: <strong>{check.consecutive_failures}</strong></span>
                      </div>
                      <ResultsPanel checkId={check.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CheckDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <CheckDialog
        open={!!editCheck}
        onClose={() => setEditCheck(null)}
        existing={editCheck ?? undefined}
      />
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Check"
        description="This will permanently delete the check and all its results. Are you sure?"
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
