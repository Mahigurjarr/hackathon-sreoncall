'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Loader2, AlertTriangle, UserCheck, RefreshCw,
  Shield, MoreHorizontal, ArrowUpRight, ExternalLink, Eye,
  ChevronDown, Clock, ArrowUpDown, ArrowUp, ArrowDown, Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Select';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { FilterCombobox } from '@/components/ui/FilterCombobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useIncidents, useCreateIncident, useUpdateIncident, useAcknowledgeIncident, useEscalateIncident,
  useBulkIncidentAction,
  type IncidentType, type Incident,
} from '@/lib/hooks/useIncidents';
import { useServices } from '@/lib/hooks/useServices';
import { useCurrentOnCallUsers } from '@/lib/hooks/useOnCallSchedules';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface LinkedConsumer {
  _id: string;
  consumer: { _id: string; name: string; slug: string } | null;
}
function useLinkedConsumers(enabled: boolean) {
  return useQuery<LinkedConsumer[]>({
    queryKey: ['provider-linked-consumers'],
    queryFn: async () => {
      const res = await api.get<{ data: LinkedConsumer[] }>('/api/v1/provider/consumers', { limit: 200 });
      return res.data;
    },
    enabled,
  });
}

/* ─── Severity config — semantic colors (same in light/dark) ─── */
const SEV_CONFIG: Record<number, { dot: string; badge: string; label: string; accent: string }> = {
  1: { dot: 'bg-[#DC2626] shadow-[0_0_6px_#DC2626] animate-pulse', badge: 'bg-[#FEF2F2] text-[#DC2626] dark:text-red-400 border-[#FECACA]', label: 'SEV-1', accent: '#DC2626' },
  2: { dot: 'bg-[#EA580C] shadow-[0_0_5px_#EA580C]', badge: 'bg-[#FFF7ED] text-[#EA580C] dark:text-orange-400 border-[#FED7AA]', label: 'SEV-2', accent: '#EA580C' },
  3: { dot: 'bg-[#EAB308]', badge: 'bg-[#FEFCE8] text-[#A16207] dark:text-yellow-400 border-[#FDE68A]', label: 'SEV-3', accent: '#EAB308' },
  4: { dot: 'bg-[#2563EB]', badge: 'bg-[#EFF6FF] text-[#2563EB] dark:text-blue-400 border-[#BFDBFE]', label: 'SEV-4', accent: '#2563EB' },
  5: { dot: 'bg-[#64748B]', badge: 'bg-[#F8FAFC] text-[#64748B] dark:text-slate-400 border-[#E2E8F0]', label: 'SEV-5', accent: '#64748B' },
};

const STATUS_CONFIG: Record<string, { dot: string; pill: string; label: string }> = {
  open:          { dot: 'bg-[#DC2626] animate-pulse', pill: 'bg-[#FEF2F2] text-[#DC2626] dark:text-red-400 border-[#FECACA]', label: 'Open' },
  acknowledged:  { dot: 'bg-primary animate-[pulse_2s_infinite]', pill: 'bg-primary/10 text-primary border-primary/20', label: 'Acknowledged' },
  investigating: { dot: 'bg-[#7C3AED]', pill: 'bg-[#F5F3FF] text-[#7C3AED] dark:text-purple-400 border-[#DDD6FE]', label: 'Investigating' },
  monitoring:    { dot: 'bg-[#2563EB]', pill: 'bg-[#EFF6FF] text-[#2563EB] dark:text-blue-400 border-[#BFDBFE]', label: 'Monitoring' },
  resolved:      { dot: 'bg-[#16A34A]', pill: 'bg-[#F0FDF4] text-[#16A34A] dark:text-green-400 border-[#BBF7D0]', label: 'Resolved' },
  closed:        { dot: 'bg-[#64748B]', pill: 'bg-[#F8FAFC] text-[#64748B] dark:text-slate-400 border-[#E2E8F0]', label: 'Closed' },
};

const AVATAR_COLORS = [
  'bg-gradient-to-br from-[#FF6B2B] to-[#C84F14]',
  'bg-gradient-to-br from-[#3B82F6] to-[#1d4ed8]',
  'bg-gradient-to-br from-[#8B5CF6] to-[#6d28d9]',
  'bg-gradient-to-br from-[#06B6D4] to-[#0891b2]',
  'bg-gradient-to-br from-[#22C55E] to-[#16a34a]',
];

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatarColor(name: string | null): string {
  if (!name) return AVATAR_COLORS[0];
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Check if incident has been unacknowledged for more than 10 minutes */
function isUnackedTooLong(inc: Incident): boolean {
  if (inc.status !== 'open') return false;
  if (inc.metrics?.ack_at) return false;
  return differenceInMinutes(new Date(), new Date(inc.created_at)) >= 10;
}

export default function IncidentsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [consumerFilter, setConsumerFilter] = useState('');
  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType || 'standalone';
  const isProvider = tenantType === 'provider';
  const { data: linkedConsumers = [] } = useLinkedConsumers(isProvider);
  const [sevSort, setSevSort] = useState<'asc' | 'desc' | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const [reassignOpenId, setReassignOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', description: '', severity: 2, type: 'other' as IncidentType, service_id: '' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];

  const { data: incidents = [], isLoading, isFetching, refetch } = useIncidents({
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    severity: severityFilter ? Number(severityFilter) : undefined,
    source_consumer_tenant_id: consumerFilter || undefined,
  });

  // Unfiltered query for stats — so stats stay consistent regardless of active filters
  const { data: allIncidents = [] } = useIncidents({});

  const createMutation = useCreateIncident();
  const updateMutation = useUpdateIncident();
  const ackMutation = useAcknowledgeIncident();
  const escalateMutation = useEscalateIncident();
  const bulkAction = useBulkIncidentAction();
  const { data: onCallUsers = [] } = useCurrentOnCallUsers();

  /* ─── Computed stats — based on unfiltered incidents so stats stay constant ─── */
  const stats = useMemo(() => {
    const source = allIncidents.length > 0 ? allIncidents : incidents;
    const active = source.filter(i => !['resolved', 'closed'].includes(i.status));
    const sev1 = active.filter(i => i.severity === 1);
    const open = source.filter(i => i.status === 'open');
    const acked = source.filter(i => i.status === 'acknowledged');

    // Last 7 days window for MTTA / MTTR averages
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentWithMttr = source.filter(i => i.metrics?.mttr_seconds && new Date(i.created_at) >= sevenDaysAgo);
    const avgMttr = recentWithMttr.length > 0
      ? Math.round(recentWithMttr.reduce((a, i) => a + (i.metrics.mttr_seconds || 0), 0) / recentWithMttr.length / 60)
      : null;

    const recentWithMtta = source.filter(i => i.metrics?.mtta_seconds && new Date(i.created_at) >= sevenDaysAgo);
    const avgMtta = recentWithMtta.length > 0
      ? Math.round(recentWithMtta.reduce((a, i) => a + (i.metrics.mtta_seconds || 0), 0) / recentWithMtta.length / 60)
      : null;

    return { active: active.length, sev1: sev1.length, open: open.length, acked: acked.length, avgMtta, avgMttr };
  }, [allIncidents, incidents]);

  /* ─── Sorted incidents ─── */
  const sortedIncidents = useMemo(() => {
    if (!sevSort) return incidents;
    return [...incidents].sort((a, b) =>
      sevSort === 'asc' ? a.severity - b.severity : b.severity - a.severity,
    );
  }, [incidents, sevSort]);

  /* ─── Live SEV1 banner ─── */
  const liveSev1 = useMemo(() => {
    return incidents.find(i => i.severity === 1 && i.status === 'open');
  }, [incidents]);

  /* ─── Handlers ─── */
  async function handleAssignUser(incidentId: string, userId: string, userName: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await updateMutation.mutateAsync({ id: incidentId, input: { commander_id: userId } });
      toast.success(`Assigned to ${userName}`);
      setReassignOpenId(null);
    } catch {
      toast.error('Failed to assign commander');
    }
  }

  async function handleAcknowledge(incidentId: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await ackMutation.mutateAsync(incidentId);
      toast.success('Incident acknowledged');
    } catch {
      toast.error('Failed to acknowledge');
    }
  }

  async function handleEscalate(incidentId: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await escalateMutation.mutateAsync({ id: incidentId });
      toast.success('Incident escalated');
    } catch {
      toast.error('Failed to escalate');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.service_id) return;
    try {
      const inc = await createMutation.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim(),
        severity: form.severity,
        type: form.type,
        affected_service_ids: form.service_id ? [form.service_id] : undefined,
      });
      toast.success(`INC-${String(inc.number).padStart(4, '0')} declared`);
      setShowCreate(false);
      setForm({ title: '', description: '', severity: 2, type: 'other', service_id: '' });
      router.push(`/incidents/${inc.id}`);
    } catch {
      toast.error('Failed to declare incident');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!incidents?.length) return;
    const activeIds = incidents.filter(i => ['open', 'investigating', 'monitoring', 'acknowledged'].includes(i.status)).map(i => i.id);
    if (selectedIds.size === activeIds.length && activeIds.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeIds));
    }
  }

  async function handleBulkAction(action: 'acknowledge' | 'resolve' | 'close') {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const result = await bulkAction.mutateAsync({ incident_ids: ids, action });
      if (result.failed > 0) {
        toast.warning(`${result.success} ${action}d, ${result.failed} failed`);
      } else {
        toast.success(`${result.success} incident${result.success !== 1 ? 's' : ''} ${action}d`);
      }
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error(err?.message || `Bulk ${action} failed`);
    }
  }

  function handleStatFilter(filter: string) {
    setSelectedIds(new Set());
    if (filter === 'sev1') {
      setSeverityFilter(severityFilter === '1' ? '' : '1');
      setStatusFilter('');
    } else if (filter === 'open') {
      setStatusFilter(statusFilter === 'open' ? '' : 'open');
      setSeverityFilter('');
    } else if (filter === 'acked') {
      setStatusFilter(statusFilter === 'acknowledged' ? '' : 'acknowledged');
      setSeverityFilter('');
    } else {
      setStatusFilter('');
      setSeverityFilter('');
    }
  }

  function toggleActionsMenu(incId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setActionsOpenId(actionsOpenId === incId ? null : incId);
  }

  function toggleReassignMenu(incId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setReassignOpenId(reassignOpenId === incId ? null : incId);
  }

  return (
    <div data-testid="incidents-page" className="space-y-5">

      {/* ─── Page Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[1.5px] text-primary">
            <span className="h-[5px] w-[5px] rounded-full bg-green-500 shadow-[0_0_5px_theme(colors.green.500)] animate-pulse" />
            Live
          </div>
          <h1 className="text-2xl font-bold text-foreground">Incidents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track and respond to active incidents</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="icon"
            onClick={() => { refetch(); toast.success('Refreshing incidents…'); }}
            disabled={isFetching}
            className="h-9 w-9"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
          <Button onClick={() => setShowCreate(true)} variant="destructive" className="gap-2">
            <Plus className="h-4 w-4" />
            Declare Incident
          </Button>
        </div>
      </div>

      {/* ─── Stats Row ─── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { key: 'all', label: 'Total Active', value: stats.active, accent: 'text-primary', border: 'border-primary' },
          { key: 'sev1', label: 'SEV-1 Critical', value: stats.sev1, accent: 'text-red-500', border: 'border-red-500', pulse: stats.sev1 > 0 },
          { key: 'open', label: 'Open', value: stats.open, accent: 'text-orange-500', border: 'border-orange-500' },
          { key: 'acked', label: 'Acknowledged', value: stats.acked, accent: 'text-primary', border: 'border-primary' },
          { key: 'mtta', label: 'Avg MTTA (7d)', value: stats.avgMtta !== null ? `${stats.avgMtta}m` : '--', accent: 'text-blue-500', border: 'border-blue-500', noFilter: true },
          { key: 'mttr', label: 'Avg MTTR (7d)', value: stats.avgMttr !== null ? `${stats.avgMttr}m` : '--', accent: 'text-green-500', border: 'border-green-500', noFilter: true },
        ].map(s => {
          const isActive =
            (s.key === 'sev1' && severityFilter === '1') ||
            (s.key === 'open' && statusFilter === 'open') ||
            (s.key === 'acked' && statusFilter === 'acknowledged') ||
            (s.key === 'all' && !statusFilter && !severityFilter);
          return (
            <Card
              key={s.key}
              role={s.noFilter ? undefined : 'button'}
              onClick={() => !s.noFilter && handleStatFilter(s.key)}
              className={cn(
                'relative overflow-hidden transition-all hover:-translate-y-0.5',
                isActive && `${s.border} shadow-sm`,
                !s.noFilter && 'cursor-pointer',
              )}
            >
              <CardContent className="px-5 py-4 text-center">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</div>
                <div className={cn('text-3xl font-black leading-none', s.accent)}>
                  {s.pulse && typeof s.value === 'number' && s.value > 0 ? (
                    <span className="flex items-center justify-center gap-2">
                      {s.value}
                      <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_6px_theme(colors.red.500)] animate-pulse" />
                    </span>
                  ) : s.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ─── Live Banner (SEV-1 Open) ─── */}
      {liveSev1 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2.5">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500 shadow-[0_0_6px_theme(colors.red.500)] animate-pulse" />
          <span className="flex-1 text-sm text-foreground">
            <strong className="text-red-500">New SEV-1 incident</strong> — {liveSev1.title}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(liveSev1.created_at), { addSuffix: true })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => handleAcknowledge(liveSev1.id, e)}
            className="h-7 border-primary/30 text-primary hover:bg-primary/10"
          >
            Acknowledge
          </Button>
        </div>
      )}

      {/* ─── Toolbar ─── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          containerClassName="min-w-[200px] flex-1"
          placeholder="Search incidents, services, IDs..."
          value={search}
          onChange={(v) => { setSearch(v); setSelectedIds(new Set()); }}
        />
        <div className="flex gap-1.5">
          {[
            { value: '', label: 'All' },
            { value: 'open', label: 'Open', dotColor: 'bg-red-500' },
            { value: 'acknowledged', label: 'Acked', dotColor: 'bg-primary' },
            { value: 'resolved', label: 'Resolved', dotColor: 'bg-green-500' },
            { value: 'closed', label: 'Closed', dotColor: 'bg-slate-500' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setSelectedIds(new Set()); }}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold transition-all',
                statusFilter === f.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {f.dotColor && <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', f.dotColor)} />}
              {f.label}
            </button>
          ))}
        </div>
        <FilterSelect
          label="Severity"
          icon={<AlertTriangle />}
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setSelectedIds(new Set()); }}
        >
          <option value="">All</option>
          <option value="1">SEV-1 — Critical</option>
          <option value="2">SEV-2 — High</option>
          <option value="3">SEV-3 — Medium</option>
          <option value="4">SEV-4 — Low</option>
          <option value="5">SEV-5 — Informational</option>
        </FilterSelect>
        {isProvider && (
          <FilterCombobox
            label="Consumer"
            icon={<Building2 />}
            value={consumerFilter}
            onChange={(v) => { setConsumerFilter(v); setSelectedIds(new Set()); }}
            options={linkedConsumers
              .filter((l) => l.consumer)
              .map((l) => ({
                value: l.consumer!._id,
                label: l.consumer!.name,
                sublabel: l.consumer!.slug,
              }))}
            placeholder="Search consumers…"
          />
        )}
      </div>

      {/* ─── Bulk Action Bar ─── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} incident{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkAction('acknowledge')}
            disabled={bulkAction.isPending}
          >
            Acknowledge
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkAction('resolve')}
            disabled={bulkAction.isPending}
          >
            Resolve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkAction('close')}
            disabled={bulkAction.isPending}
          >
            Close
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* ─── Incidents Table ───
          The list has its own inner scroll capped at 70vh so long lists
          stay browsable without losing the filters above, AND the page
          itself remains naturally scrollable so the user can also scroll
          past the table on smaller viewports. */}
      <Card>
        <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : incidents.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="All clear"
              description="No incidents match your current filters"
              actionLabel="Declare Incident"
              onAction={() => setShowCreate(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={incidents?.length > 0 && incidents.filter(i => ['open', 'investigating', 'monitoring', 'acknowledged'].includes(i.status)).every(i => selectedIds.has(i.id)) && selectedIds.size > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => setSevSort(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
                    >
                      <span className="inline-flex items-center gap-1">
                        Severity
                        {sevSort === 'asc' ? <ArrowUp className="h-3 w-3" /> : sevSort === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                      </span>
                    </th>
                    {['Incident', 'Resource', 'Status', 'Tier', 'Commander', 'Created', 'Actions'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedIncidents.map((inc) => {
                    const sev = SEV_CONFIG[inc.severity] || SEV_CONFIG[5];
                    const st = STATUS_CONFIG[inc.status] || STATUS_CONFIG.open;
                    const mttrSec = inc.metrics?.mttr_seconds;
                    const isMenuOpen = actionsOpenId === inc.id;
                    const isReassignOpen = reassignOpenId === inc.id;
                    const unackedLong = isUnackedTooLong(inc);
                    const isActive = !['resolved', 'closed'].includes(inc.status);

                    return (
                      <tr
                        key={inc.id}
                        className="group relative cursor-pointer transition-colors hover:bg-muted/50"
                        onClick={() => router.push(`/incidents/${inc.id}`)}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3">
                          {['open', 'investigating', 'monitoring', 'acknowledged'].includes(inc.status) ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border"
                              checked={selectedIds.has(inc.id)}
                              onChange={(e) => { e.stopPropagation(); toggleSelect(inc.id); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div className="h-4 w-4" />
                          )}
                        </td>

                        {/* Hover accent bar */}
                        <td className="relative px-4 py-3">
                          <div
                            className="absolute left-0 top-0 bottom-0 w-0 rounded-r-sm transition-all group-hover:w-[3px]"
                            style={{ background: sev.accent }}
                          />
                          <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide', sev.badge)}>
                            <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', sev.dot)} />
                            {sev.label}
                          </span>
                        </td>

                        {/* Incident */}
                        <td className="px-4 py-3">
                          <div className="mb-0.5 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            INC-{String(inc.number).padStart(4, '0')}
                            <span className="rounded border border-border bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                              {inc.source}
                            </span>
                          </div>
                          <div className="max-w-[340px] truncate text-sm font-semibold text-foreground">
                            {inc.title}
                          </div>
                          {inc.labels.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {inc.labels.slice(0, 3).map(l => (
                                <span key={l} className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[9px] text-muted-foreground">
                                  {l}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Resource */}
                        <td className="px-4 py-3">
                          {inc.affected_services?.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="max-w-[160px] truncate font-mono text-xs text-foreground">
                                {inc.affected_services[0].name}
                              </span>
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <span className="inline-block h-1 w-1 rounded-full bg-red-500" />
                                {inc.affected_services[0].current_status || 'production'}
                              </span>
                            </div>
                          ) : inc.source_alert ? (
                            <span className="font-mono text-xs text-foreground">
                              {inc.source_alert.last_firing_labels?.instance || inc.source_alert.last_firing_labels?.job || inc.source_alert.name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold', st.pill)}>
                            <span className={cn('h-[5px] w-[5px] flex-shrink-0 rounded-full', st.dot)} />
                            {st.label}
                          </span>
                        </td>

                        {/* Tier — managed support tier indicator */}
                        <td className="px-4 py-3">
                          {inc.custom_fields?.managed_tier ? (
                            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/8 px-2.5 py-0.5 text-xs font-semibold text-primary">
                              {inc.custom_fields.managed_tier}
                            </span>
                          ) : inc.custom_fields?.provider_escalated === 'true' ? (
                            <span className="text-xs text-muted-foreground">L1</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                        </td>

                        {/* Commander — clickable to reassign */}
                        <td className="px-4 py-3">
                          <div className="relative">
                            {inc.commander?.name ? (
                              <button
                                onClick={(e) => isActive ? toggleReassignMenu(inc.id, e) : e.stopPropagation()}
                                className={cn(
                                  'flex items-center gap-2',
                                  isActive && 'group/cmd rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-colors hover:bg-muted',
                                )}
                              >
                                <div className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-black text-white', avatarColor(inc.commander.name))}>
                                  {getInitials(inc.commander.name)}
                                </div>
                                <span className="text-sm font-medium text-foreground">{inc.commander.name}</span>
                                {isActive && <ChevronDown className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/cmd:opacity-100" />}
                              </button>
                            ) : inc.custom_fields?.provider_escalated === 'true' ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                                {inc.custom_fields?.provider_support_label || 'Provider Support'}
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  if (onCallUsers.length > 0) {
                                    handleAssignUser(inc.id, onCallUsers[0].id, onCallUsers[0].name, e);
                                  } else {
                                    e.stopPropagation();
                                    toggleReassignMenu(inc.id, e);
                                  }
                                }}
                                disabled={updateMutation.isPending}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-50"
                                title={onCallUsers.length > 0 ? `Assign to ${onCallUsers[0].name} (on-call)` : 'No on-call user available'}
                              >
                                <UserCheck className="h-3 w-3" />
                                {onCallUsers.length > 0 ? `Assign ${onCallUsers[0].name}` : 'Assign'}
                              </button>
                            )}

                            {/* Reassign dropdown */}
                            {isReassignOpen && onCallUsers.length > 0 && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setReassignOpenId(null); }} />
                                <div className="absolute left-0 top-full z-40 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-lg">
                                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    On-Call Users
                                  </div>
                                  {onCallUsers.map(u => (
                                    <button
                                      key={u.id}
                                      onClick={(e) => handleAssignUser(inc.id, u.id, u.name, e)}
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                    >
                                      <div className={cn('flex h-5 w-5 items-center justify-center rounded text-[8px] font-black text-white', avatarColor(u.name))}>
                                        {getInitials(u.name)}
                                      </div>
                                      {u.name}
                                      {inc.commander?.id === u.id && (
                                        <span className="ml-auto text-[9px] text-primary">current</span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Created — highlight if unacked >10 min */}
                        <td className="px-4 py-3">
                          <div className={cn(
                            'flex flex-col gap-0.5 rounded-md px-2 py-1 -mx-2 -my-1',
                            unackedLong && 'bg-red-500/10 border border-red-500/20',
                          )}>
                            <span className={cn(
                              'font-mono text-xs',
                              unackedLong ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground',
                            )}>
                              {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {format(new Date(inc.created_at), 'HH:mm:ss zzz')}
                            </span>
                            {unackedLong ? (
                              <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded border border-red-500/25 bg-red-500/10 px-1.5 py-px font-mono text-[9px] text-red-600 dark:text-red-400 font-semibold">
                                <Clock className="h-2.5 w-2.5" />
                                Unacked {differenceInMinutes(new Date(), new Date(inc.created_at))}m
                              </span>
                            ) : mttrSec ? (
                              <span className="mt-0.5 inline-block w-fit rounded border border-green-500/25 bg-green-500/10 px-1.5 py-px font-mono text-[9px] text-green-600 dark:text-green-400">
                                MTTR: {Math.round(mttrSec / 60)}m
                              </span>
                            ) : null}
                          </div>
                        </td>

                        {/* Actions — always show Ack + Escalate for active incidents */}
                        <td className="px-4 py-3">
                          {!isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); router.push(`/incidents/${inc.id}`); }}
                              className="h-7 gap-1 text-xs"
                            >
                              <Eye className="h-3 w-3" /> View
                            </Button>
                          ) : (
                            <div className="flex gap-1.5">
                              {/* Acknowledge — show for open / investigating / monitoring */}
                              {inc.status !== 'acknowledged' && (
                                <button
                                  onClick={(e) => handleAcknowledge(inc.id, e)}
                                  disabled={ackMutation.isPending}
                                  className={cn(
                                    'flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-all disabled:opacity-50',
                                    unackedLong
                                      ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 animate-pulse'
                                      : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                                  )}
                                >
                                  <Shield className="h-3 w-3" />
                                  Ack
                                </button>
                              )}
                              {/* Escalate */}
                              <button
                                onClick={(e) => handleEscalate(inc.id, e)}
                                disabled={escalateMutation.isPending}
                                className="flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-500 dark:text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-50"
                              >
                                <ArrowUpRight className="h-3 w-3" />
                                Escalate
                              </button>
                              {/* More menu */}
                              <div className="relative">
                                <button
                                  onClick={(e) => toggleActionsMenu(inc.id, e)}
                                  className={cn(
                                    'flex items-center rounded-md border px-2 py-1 transition-all',
                                    isMenuOpen
                                      ? 'border-primary/30 bg-primary/10 text-primary'
                                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                                  )}
                                >
                                  <MoreHorizontal className="h-3 w-3" />
                                </button>
                                {isMenuOpen && (
                                  <>
                                    <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setActionsOpenId(null); }} />
                                    <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-border bg-card p-1 shadow-lg">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          router.push(`/incidents/${inc.id}`);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" /> View Details
                                      </button>
                                      {!inc.commander && onCallUsers.length > 0 && (
                                        <button
                                          onClick={(e) => {
                                            handleAssignUser(inc.id, onCallUsers[0].id, onCallUsers[0].name, e);
                                            setActionsOpenId(null);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                        >
                                          <UserCheck className="h-3.5 w-3.5" /> Assign On-Call
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Declare Incident Dialog ─── */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowCreate(false)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Declare Incident
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Title *</label>
              <Input
                placeholder="Brief description of the incident"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What happened? What is the impact?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Severity</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {([1, 2, 3, 4, 5] as const).map(s => {
                    const cfg = SEV_CONFIG[s];
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, severity: s }))}
                        className={cn(
                          'rounded-lg border px-1.5 py-2 text-center transition-all',
                          form.severity === s
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-muted-foreground/30',
                        )}
                      >
                        <div className="font-mono text-[11px] font-bold" style={{ color: cfg.accent }}>{cfg.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Type</label>
                <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as IncidentType }))}>
                  <option value="reliability">Reliability</option>
                  <option value="performance">Performance</option>
                  <option value="security">Security</option>
                  <option value="availability">Availability</option>
                  <option value="other">Other</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Affected Service *</label>
              <Select value={form.service_id} onChange={(e) => setForm((f) => ({ ...f, service_id: e.target.value }))}>
                <option value="">Select a service...</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={createMutation.isPending || !form.title.trim() || !form.service_id}>
                {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Declaring...</> : 'Declare Incident'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
