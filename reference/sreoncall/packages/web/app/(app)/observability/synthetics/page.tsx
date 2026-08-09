'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Plus,
  Globe,
  Wifi,
  Server,
  Loader2,
  ChevronDown,
  AlertCircle,
  Trash2,
  Play,
  Pause,
  Pencil,
  X,
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ListOrdered,
  Search,
  Download,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TimeRangeSelector, type TimeRangeValue } from '@/components/ui/TimeRangeSelector';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useSyntheticChecks,
  useCreateCheck,
  useUpdateCheck,
  useDeleteCheck,
  useTriggerCheck,
  usePauseCheck,
  useResumeCheck,
  useCheckResults,
  fetchCheckResults,
  type SyntheticCheck,
  type CreateCheckInput,
  type CheckResult,
} from '@/lib/hooks/useSyntheticChecks';

const ChecksWorldMap = dynamic(() => import('@/components/shared/ChecksWorldMap'), { ssr: false });

const TYPE_ICONS: Record<string, typeof Globe> = {
  http: Globe,
  tcp: Server,
  dns: Wifi,
};

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  up: { label: 'UP', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  down: { label: 'DOWN', cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  degraded: { label: 'DEGRADED', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
};

const RESULT_ICON: Record<string, { icon: typeof CheckCircle2; cls: string }> = {
  up: { icon: CheckCircle2, cls: 'text-[#16A34A]' },
  down: { icon: XCircle, cls: 'text-[#DC2626]' },
  degraded: { icon: AlertTriangle, cls: 'text-[#A16207]' },
};

// ── Multi-step check type ────────────────────────────────────────────
interface CheckStep {
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
}

export default function SyntheticMonitors() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingCheck, setEditingCheck] = useState<SyntheticCheck | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<SyntheticCheck | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useSyntheticChecks();
  const checks = data?.data ?? [];

  const filtered = useMemo(() => {
    let result = filter === 'all' ? checks : checks.filter(c => c.status === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) =>
        c.name?.toLowerCase().includes(q) ||
        c.url?.toLowerCase().includes(q) ||
        c.type?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [checks, filter, search]);

  const upCount = checks.filter(c => c.last_status === 'up' && c.status === 'active').length;
  const downCount = checks.filter(c => c.last_status === 'down' && c.status === 'active').length;
  const activeCount = checks.filter(c => c.status === 'active').length;

  // Detail view
  if (selectedCheck) {
    return <CheckDetail check={selectedCheck} onBack={() => setSelectedCheck(null)} onEdit={(c) => { setSelectedCheck(null); setEditingCheck(c); }} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Synthetic Monitors</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {checks.length} check{checks.length !== 1 ? 's' : ''} &middot; {activeCount} active
            {downCount > 0 && ` \u00B7 ${downCount} failing`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Check
        </Button>
      </div>

      {/* Failing banner */}
      {downCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[13px] font-bold text-red-400">
            {downCount} check{downCount > 1 ? 's' : ''} currently FAILING
          </span>
        </div>
      )}

      {/* KPI strip */}
      {checks.length > 0 && (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-emerald-500">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">PASSING</div>
            <div className="text-2xl font-bold text-emerald-500 font-mono mt-1">{upCount}/{activeCount}</div>
            <div className="text-xs text-muted-foreground">{activeCount > 0 ? ((upCount / activeCount) * 100).toFixed(1) : 0}% success rate</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-red-500">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">FAILING</div>
            <div className="text-2xl font-bold text-red-500 font-mono mt-1">{downCount}</div>
            <div className="text-xs text-muted-foreground">active checks down</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-blue-500">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AVG RESPONSE</div>
            <div className="text-2xl font-bold text-blue-400 font-mono mt-1">
              {checks.filter(c => c.last_response_time_ms !== null).length > 0
                ? `${Math.round(checks.reduce((s, c) => s + (c.last_response_time_ms || 0), 0) / checks.filter(c => c.last_response_time_ms !== null).length)}ms`
                : '-'}
            </div>
            <div className="text-xs text-muted-foreground">across active checks</div>
          </div>
        </div>
      )}

      {/* World Map */}
      {checks.length > 0 && <ChecksWorldMap checks={checks} />}

      {/* Filter tabs + search */}
      {checks.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
          {([
            { key: 'all', label: `All (${checks.length})` },
            { key: 'active', label: `Active (${activeCount})` },
            { key: 'paused', label: `Paused (${checks.filter(c => c.status === 'paused').length})` },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors',
                filter === f.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {f.label}
            </button>
          ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, URL, or type..."
              className="w-full rounded-lg border border-border bg-card pl-9 pr-8 py-1.5 text-[12px] text-foreground outline-none focus:border-primary"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {filtered.length !== checks.length && (
            <span className="text-[11px] text-muted-foreground">
              {filtered.length} of {checks.length} shown
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span className="text-[12px] text-red-400">{(error as Error).message}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && checks.length === 0 && !error && (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Globe className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No synthetic checks yet</h3>
            <p className="text-[12px] text-muted-foreground mb-4 max-w-sm">
              Create HTTP, TCP, or DNS checks to monitor your endpoints. Checks run at configurable
              intervals and auto-create incidents on consecutive failures.
            </p>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create First Check
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Check cards */}
      {filtered.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-[32px_1fr_70px_80px_100px_80px_90px_100px] gap-3 px-5 py-3 border-b border-border">
              <span />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Check</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Interval</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">Response</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">Uptime 1h</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">Uptime 24h</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-center">Actions</span>
            </div>
            <div className="divide-y divide-border">
              {filtered.map((check) => (
                <CheckRow key={check.id} check={check} onSelect={setSelectedCheck} onEdit={setEditingCheck} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create modal */}
      {showCreate && <CheckFormModal onClose={() => setShowCreate(false)} />}

      {/* Edit modal */}
      {editingCheck && <CheckFormModal check={editingCheck} onClose={() => setEditingCheck(null)} />}
    </div>
  );
}

function CheckRow({ check, onSelect, onEdit }: { check: SyntheticCheck; onSelect: (c: SyntheticCheck) => void; onEdit: (c: SyntheticCheck) => void }) {
  const Icon = TYPE_ICONS[check.type] || Globe;
  const isDown = check.last_status === 'down';
  const isPaused = check.status === 'paused';
  const statusStyle = check.last_status ? STATUS_STYLES[check.last_status] || STATUS_STYLES.up : null;

  const deleteCheck = useDeleteCheck();
  const triggerCheck = useTriggerCheck();
  const pauseCheck = usePauseCheck();
  const resumeCheck = useResumeCheck();

  return (
    <div
      className={cn(
        'grid grid-cols-[32px_1fr_70px_80px_100px_80px_90px_100px] gap-3 px-5 py-3.5 items-center hover:bg-muted/20 transition-colors cursor-pointer',
        isDown && 'border-l-[3px] border-l-red-500',
        isPaused && 'opacity-50',
      )}
      onClick={() => onSelect(check)}
    >
      <span className="flex justify-center">
        <span className={cn(
          'h-2.5 w-2.5 rounded-full',
          isPaused ? 'bg-muted-foreground' : isDown
            ? 'bg-red-500 shadow-[0_0_6px_rgba(220,38,38,0.5)]'
            : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,163,74,0.5)]',
        )} />
      </span>

      <div>
        <div className="text-sm font-semibold text-foreground">{check.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {statusStyle && (
            <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold border', statusStyle.cls)}>
              {statusStyle.label}
            </span>
          )}
          {isPaused && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">PAUSED</span>
          )}
          {check.consecutive_failures > 0 && (
            <span className="text-[9px] text-red-400 font-bold">{check.consecutive_failures} consecutive failures</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {check.type.toUpperCase()}
      </div>

      <span className="text-[12px] font-mono text-muted-foreground">{check.interval_seconds}s</span>

      <div className={cn(
        'text-right text-[13px] font-bold font-mono',
        (check.last_response_time_ms || 0) > 2000 ? 'text-red-400' : 'text-foreground',
      )}>
        {check.last_response_time_ms !== null ? `${check.last_response_time_ms}ms` : '-'}
      </div>

      <div className="text-right text-[12px] font-mono text-muted-foreground">
        {check.uptime_1h.toFixed(1)}%
      </div>

      <div className="text-right text-[12px] font-mono text-muted-foreground">
        {check.uptime_24h.toFixed(1)}%
      </div>

      <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Edit"
          onClick={() => onEdit(check)}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Trigger now"
          onClick={() => triggerCheck.mutate(check.id, { onSuccess: () => toast.success('Check triggered') })}
        >
          <Play className="h-3 w-3" />
        </button>
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={check.status === 'active' ? 'Pause' : 'Resume'}
          onClick={() => {
            if (check.status === 'active') {
              pauseCheck.mutate(check.id, { onSuccess: () => toast.success('Check paused') });
            } else {
              resumeCheck.mutate(check.id, { onSuccess: () => toast.success('Check resumed') });
            }
          }}
        >
          {check.status === 'active' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>
        <button
          className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          title="Delete"
          onClick={() => {
            if (confirm('Delete this check?')) {
              deleteCheck.mutate(check.id, { onSuccess: () => toast.success('Check deleted') });
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Shared presets (matches Logs Explorer) ─────────────────────────────────────

const SYNTH_PRESETS = [
  { label: '5m',  ms: 5   * 60_000 },
  { label: '15m', ms: 15  * 60_000 },
  { label: '1h',  ms: 3_600_000 },
  { label: '6h',  ms: 6   * 3_600_000 },
  { label: '24h', ms: 24  * 3_600_000 },
  { label: '3d',  ms: 3   * 86_400_000 },
  { label: '7d',  ms: 7   * 86_400_000 },
];

// ─── CSV export helper ───────────────────────────────────────────────────────────

function exportCheckHistoryCSV(
  results: import('@/lib/hooks/useSyntheticChecks').CheckResult[],
  checkName: string,
  timeRange: TimeRangeValue,
  statusFilter: 'all' | 'up' | 'down',
) {
  const from = new Date(timeRange.start).toISOString();
  const to   = new Date(timeRange.end).toISOString();
  const rows = [
    ['Time', 'Status', 'Response (ms)', 'HTTP Status', 'Error'],
    ...results.map((r) => [
      new Date(r.checked_at).toISOString(),
      r.status,
      r.response_time_ms ?? '',
      r.http_status_code ?? '',
      r.error ?? '',
    ]),
  ];
  const csv = rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const safeName = checkName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filterSuffix = statusFilter !== 'all' ? `_${statusFilter}` : '';
  a.href     = url;
  a.download = `${safeName}${filterSuffix}_${from.slice(0, 10)}_to_${to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Check Detail View ──────────────────────────────────────────────────────────

function CheckDetail({ check, onBack, onEdit }: { check: SyntheticCheck; onBack: () => void; onEdit: (c: SyntheticCheck) => void }) {
  const now = Date.now();
  const [timeRange, setTimeRange] = useState<TimeRangeValue>({ start: now - 24 * 3_600_000, end: now, preset: '24h' });
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down'>('all');

  const [olderResults, setOlderResults] = useState<CheckResult[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);

  // Compute limit dynamically: range ÷ check interval + 20% buffer, capped at 5 000
  const dynamicLimit = Math.min(
    Math.ceil((timeRange.end - timeRange.start) / (check.interval_seconds * 1_000)) + 20,
    5_000,
  );

  const { data: resultsData, isLoading } = useCheckResults(check.id, { from: timeRange.start, until: timeRange.end, limit: dynamicLimit });
  const freshResults: CheckResult[] = (resultsData as any)?.data ?? [];

  // Reset pagination when time range changes
  useEffect(() => {
    setOlderResults([]);
    setHasMoreOlder(true);
  }, [timeRange]);

  const allResults = useMemo(() => {
    const seen = new Set<string>();
    return [...freshResults, ...olderResults].filter(r => {
      if (seen.has(r._id)) return false;
      seen.add(r._id);
      return true;
    });
  }, [freshResults, olderResults]);

  const loadOlderResults = useCallback(async () => {
    if (loadingOlder || !allResults.length) return;
    setLoadingOlder(true);
    try {
      const oldest = allResults[allResults.length - 1];
      const until = new Date(oldest.checked_at).getTime() - 1;
      const res = await fetchCheckResults(check.id, { from: timeRange.start, until });
      const entries: CheckResult[] = (res as any)?.data ?? [];
      if (entries.length === 0) {
        setHasMoreOlder(false);
      } else {
        setOlderResults(prev => [...prev, ...entries]);
      }
    } catch {
      // keep hasMoreOlder true so user can retry
    } finally {
      setLoadingOlder(false);
    }
  }, [check.id, allResults, timeRange.start, loadingOlder]);

  const results = statusFilter === 'all' ? allResults : allResults.filter(r => r.status === statusFilter);
  const Icon = TYPE_ICONS[check.type] || Globe;
  const statusStyle = check.last_status ? STATUS_STYLES[check.last_status] : null;

  const targetLabel = check.type === 'http' ? check.url : check.type === 'tcp' ? `${check.host}:${check.port}` : check.hostname;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{check.name}</h1>
            {statusStyle && (
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border', statusStyle.cls)}>
                {statusStyle.label}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">{targetLabel}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => onEdit(check)}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Type</div>
          <div className="flex items-center gap-1.5 mt-1 text-sm font-semibold text-foreground">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {check.type.toUpperCase()}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Interval</div>
          <div className="text-sm font-bold font-mono text-foreground mt-1">{check.interval_seconds}s</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Uptime (24h)</div>
          <div className={cn('text-sm font-bold font-mono mt-1', check.uptime_24h >= 99 ? 'text-emerald-400' : check.uptime_24h >= 95 ? 'text-yellow-400' : 'text-red-400')}>
            {check.uptime_24h.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Uptime (7d)</div>
          <div className={cn('text-sm font-bold font-mono mt-1', check.uptime_7d >= 99 ? 'text-emerald-400' : check.uptime_7d >= 95 ? 'text-yellow-400' : 'text-red-400')}>
            {check.uptime_7d.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* SSL Certificate info (HTTP checks only) — uses real cert data from latest check result */}
      {check.type === 'http' && check.url && (() => {
        const sslResult = allResults.find(r => r.ssl_days_remaining !== null);

        if (!sslResult) {
          return (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">SSL Certificate</h3>
                  <span className="text-[11px] text-muted-foreground ml-1">
                    {isLoading ? 'Loading...' : 'Not yet captured — run a check to populate'}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        }

        const days = sslResult.ssl_days_remaining!;
        const expiryColor = days > 30 ? 'text-emerald-400' : days > 7 ? 'text-yellow-400' : 'text-red-400';
        const expiryBg = days > 30
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : days > 7
          ? 'border-yellow-500/20 bg-yellow-500/5'
          : 'border-red-500/20 bg-red-500/5';
        const validFrom = sslResult.ssl_valid_from ? new Date(sslResult.ssl_valid_from).toISOString().split('T')[0] : '-';
        const validUntil = sslResult.ssl_valid_to ? new Date(sslResult.ssl_valid_to).toISOString().split('T')[0] : '-';

        return (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className={cn('h-4 w-4', expiryColor)} />
                <h3 className="text-sm font-semibold text-foreground">SSL Certificate</h3>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Issuer</div>
                  <div className="text-[12px] font-medium text-foreground mt-1">{sslResult.ssl_issuer ?? 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valid From</div>
                  <div className="text-[12px] font-mono text-foreground mt-1">{validFrom}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valid Until</div>
                  <div className="text-[12px] font-mono text-foreground mt-1">{validUntil}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Days Until Expiry</div>
                  <div className={cn('mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold font-mono', expiryBg, expiryColor)}>
                    {days} days
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Check history */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-border px-5 py-3">
            {/* Left: title + result count */}
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-foreground">Check History</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                {results.length}{statusFilter !== 'all' ? ` / ${allResults.length}` : ''}
              </span>
            </div>

            {/* Right: status filter + time range */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status pill group */}
              <div className="flex items-center rounded-lg border border-border bg-muted/20 p-0.5 gap-0.5">
                {/* All */}
                <button
                  onClick={() => setStatusFilter('all')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all',
                    statusFilter === 'all'
                      ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                  )}
                >
                  All
                </button>

                {/* Up — always green */}
                <button
                  onClick={() => setStatusFilter('up')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all flex items-center gap-1',
                    statusFilter === 'up'
                      ? 'bg-emerald-500/20 text-emerald-400 shadow-sm ring-1 ring-emerald-500/30'
                      : 'text-emerald-500/70 hover:text-emerald-400 hover:bg-emerald-500/10',
                  )}
                >
                  <span className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full transition-all',
                    statusFilter === 'up' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-emerald-500/60',
                  )} />
                  Up
                </button>

                {/* Down — always red */}
                <button
                  onClick={() => setStatusFilter('down')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all flex items-center gap-1',
                    statusFilter === 'down'
                      ? 'bg-red-500/20 text-red-400 shadow-sm ring-1 ring-red-500/30'
                      : 'text-red-500/70 hover:text-red-400 hover:bg-red-500/10',
                  )}
                >
                  <span className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full transition-all',
                    statusFilter === 'down' ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]' : 'bg-red-500/60',
                  )} />
                  Down
                </button>
              </div>

              {/* Divider */}
              <span className="h-5 w-px bg-border" />

              {/* Time range — same component as Logs Explorer */}
              <TimeRangeSelector
                presets={SYNTH_PRESETS}
                value={timeRange}
                onChange={setTimeRange}
                compact
              />

              {/* Download CSV */}
              <button
                onClick={() => exportCheckHistoryCSV(results, check.name, timeRange, statusFilter)}
                disabled={results.length === 0}
                title="Download as CSV"
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all',
                  results.length > 0
                    ? 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'
                    : 'border-border/40 text-muted-foreground/30 cursor-not-allowed',
                )}
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-[12px] text-muted-foreground">No results yet. Waiting for first check...</p>
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
              {/* Table header */}
              <div className="grid grid-cols-[32px_80px_120px_1fr_140px] gap-3 px-5 py-2.5 bg-muted/30 sticky top-0">
                <span />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Response</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Error</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Time</span>
              </div>
              {results.map((r) => {
                const ri = RESULT_ICON[r.status] || RESULT_ICON.down;
                const RIcon = ri.icon;
                return (
                  <div key={r._id} className="grid grid-cols-[32px_80px_120px_1fr_140px] gap-3 px-5 py-2.5 items-center hover:bg-muted/10">
                    <span className="flex justify-center">
                      <RIcon className={cn('h-3.5 w-3.5', ri.cls)} />
                    </span>
                    <span className={cn('text-[11px] font-bold uppercase', ri.cls)}>
                      {r.status}
                      {r.http_status_code !== null && (
                        <span className="text-muted-foreground font-normal ml-1">({r.http_status_code})</span>
                      )}
                    </span>
                    <span className="text-[12px] font-mono text-foreground">
                      {r.response_time_ms !== null ? `${r.response_time_ms}ms` : '-'}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate" title={r.error || undefined}>
                      {r.error || '-'}
                    </span>
                    <span className="text-[11px] text-muted-foreground text-right">
                      {new Date(r.checked_at).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!isLoading && hasMoreOlder && results.length > 0 && (
            <div className="flex items-center justify-center border-t border-border px-5 py-2">
              <button
                onClick={loadOlderResults}
                disabled={loadingOlder}
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                {loadingOlder ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
                {loadingOlder ? 'Loading older results...' : 'Load older results'}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Create / Edit Form Modal ───────────────────────────────────────────────────

function CheckFormModal({ check, onClose }: { check?: SyntheticCheck; onClose: () => void }) {
  const isEdit = !!check;
  const createCheck = useCreateCheck();
  const updateCheck = useUpdateCheck();

  const [name, setName] = useState(check?.name ?? '');
  const [type, setType] = useState<'http' | 'tcp' | 'dns'>(check?.type ?? 'http');
  const [url, setUrl] = useState(check?.url ?? '');
  const [method, setMethod] = useState<'GET' | 'POST' | 'HEAD'>(check?.method as any ?? 'GET');
  const allCodes = [check?.expected_status_code ?? 200, ...(check?.allowed_status_codes ?? [])];
  const [expectedStatus, setExpectedStatus] = useState([...new Set(allCodes)].join(', '));
  const [keywordCheck, setKeywordCheck] = useState(check?.keyword_check ?? '');
  const [host, setHost] = useState(check?.host ?? '');
  const [port, setPort] = useState(check?.port != null ? String(check.port) : '');
  const [hostname, setHostname] = useState(check?.hostname ?? '');
  const [recordType, setRecordType] = useState<'A' | 'CNAME' | 'MX' | 'TXT'>(check?.record_type as any ?? 'A');
  const [expectedValue, setExpectedValue] = useState(check?.expected_value ?? '');
  const [interval, setInterval] = useState(String(check?.interval_seconds ?? 30));
  const [timeout, setTimeout] = useState(String(check?.timeout_seconds ?? 10));
  const [steps, setSteps] = useState<CheckStep[]>([]);

  const isPending = createCheck.isPending || updateCheck.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: CreateCheckInput = {
      name,
      type,
      interval_seconds: parseInt(interval),
      timeout_seconds: parseInt(timeout),
      ...(type === 'http' && (() => {
        const codes = expectedStatus.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        const [primary, ...extra] = codes.length ? codes : [200];
        return {
          url,
          method,
          expected_status_code: primary,
          allowed_status_codes: extra,
          keyword_check: keywordCheck || undefined,
        };
      })()),
      ...(type === 'tcp' && { host, port: parseInt(port) }),
      ...(type === 'dns' && {
        hostname,
        record_type: recordType,
        expected_value: expectedValue || undefined,
      }),
    };

    if (isEdit) {
      updateCheck.mutate(
        { id: check!.id, input },
        {
          onSuccess: () => { toast.success('Check updated'); onClose(); },
          onError: (e) => toast.error(e.message),
        },
      );
    } else {
      createCheck.mutate(input, {
        onSuccess: () => { toast.success('Check created'); onClose(); },
        onError: (e) => toast.error(e.message),
      });
    }
  }

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{isEdit ? 'Edit Synthetic Check' : 'New Synthetic Check'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} placeholder="e.g. API Health Check" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Type</label>
            <div className="flex gap-2">
              {(['http', 'tcp', 'dns'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setType(t)} className={cn('rounded-lg border px-3 py-1.5 text-[11px] font-medium uppercase transition-colors', type === t ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:bg-muted/50')}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* HTTP fields */}
          {type === 'http' && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">URL</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)} required className={cn(inputCls, 'font-mono')} placeholder="https://api.example.com/health" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Method</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value as any)} className={inputCls}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="HEAD">HEAD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Accepted Status Codes</label>
                  <input value={expectedStatus} onChange={(e) => setExpectedStatus(e.target.value)} type="text" placeholder="200, 403" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Keyword Check <span className="font-normal text-muted-foreground/60">(optional)</span></label>
                <input value={keywordCheck} onChange={(e) => setKeywordCheck(e.target.value)} className={inputCls} placeholder="e.g. healthy" />
              </div>

              {/* Additional Steps */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-[11px] font-medium text-muted-foreground">Additional Steps <span className="font-normal text-muted-foreground/60">(sequential requests, up to 3)</span></label>
                  </div>
                  {steps.length < 3 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-6 px-2"
                      onClick={() => setSteps([...steps, { name: '', url: '', method: 'GET', expectedStatus: 200 }])}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Step
                    </Button>
                  )}
                </div>
                {steps.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/60 italic">No additional steps. Add steps to chain sequential HTTP requests.</p>
                )}
                {steps.map((step, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Step {idx + 1}</span>
                      <button
                        type="button"
                        className="p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        onClick={() => setSteps(steps.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      <input
                        value={step.name}
                        onChange={(e) => { const s = [...steps]; s[idx] = { ...s[idx], name: e.target.value }; setSteps(s); }}
                        className={inputCls}
                        placeholder="Step name"
                      />
                      <input
                        value={step.url}
                        onChange={(e) => { const s = [...steps]; s[idx] = { ...s[idx], url: e.target.value }; setSteps(s); }}
                        className={cn(inputCls, 'font-mono')}
                        placeholder="https://api.example.com/endpoint"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={step.method}
                          onChange={(e) => { const s = [...steps]; s[idx] = { ...s[idx], method: e.target.value as any }; setSteps(s); }}
                          className={inputCls}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="HEAD">HEAD</option>
                        </select>
                        <input
                          value={step.expectedStatus}
                          onChange={(e) => { const s = [...steps]; s[idx] = { ...s[idx], expectedStatus: parseInt(e.target.value) || 200 }; setSteps(s); }}
                          type="number"
                          className={inputCls}
                          placeholder="Expected status"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TCP fields */}
          {type === 'tcp' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Host</label>
                <input value={host} onChange={(e) => setHost(e.target.value)} required className={inputCls} placeholder="10.0.0.1" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Port</label>
                <input value={port} onChange={(e) => setPort(e.target.value)} required type="number" className={inputCls} placeholder="443" />
              </div>
            </div>
          )}

          {/* DNS fields */}
          {type === 'dns' && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Hostname</label>
                <input value={hostname} onChange={(e) => setHostname(e.target.value)} required className={inputCls} placeholder="api.example.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Record Type</label>
                  <select value={recordType} onChange={(e) => setRecordType(e.target.value as any)} className={inputCls}>
                    <option value="A">A</option>
                    <option value="CNAME">CNAME</option>
                    <option value="MX">MX</option>
                    <option value="TXT">TXT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Expected Value <span className="font-normal text-muted-foreground/60">(opt)</span></label>
                  <input value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} className={inputCls} placeholder="1.2.3.4" />
                </div>
              </div>
            </>
          )}

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Interval (seconds)</label>
              <input value={interval} onChange={(e) => setInterval(e.target.value)} type="number" min="10" max="3600" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Timeout (seconds)</label>
              <input value={timeout} onChange={(e) => setTimeout(e.target.value)} type="number" min="1" max="60" className={inputCls} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending || !name}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              {isEdit ? 'Save Changes' : 'Create Check'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
