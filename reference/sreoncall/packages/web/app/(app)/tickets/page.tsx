'use client';

import { useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Kanban, List, Plus, Filter, Upload, Download, Loader2, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, CircleDot, Flag, FolderKanban, UserCircle2, UserRound, Building2, X, CheckSquare, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { FilterCombobox } from '@/components/ui/FilterCombobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { KanbanBoard } from '@/components/tickets/KanbanBoard';
import { BacklogPanel } from '@/components/tickets/BacklogPanel';
import { SprintsPanel } from '@/components/tickets/SprintsPanel';
import { TicketForm } from '@/components/tickets/TicketForm';
import { UserAssignDropdown } from '@/components/tickets/UserAssignDropdown';
import { useTicketBoard, useTicketBoardProjects, useBulkUpdateTickets, useCycleTime, useWorkloadStats, useStatusDistribution, useThroughput, type TicketPriority, type TicketFilters, type TicketSla, type BulkUpdateInput } from '@/lib/hooks/useTickets';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTeams } from '@/lib/hooks/useTeams';
import { useProjects } from '@/lib/hooks/useProjects';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn, formatMinutes, formatTicketNumber } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';

type ViewMode = 'kanban' | 'list';
type TabMode  = 'board' | 'backlog' | 'sprints' | 'analytics';

interface ImportJob {
  job_id: string;
  status: string;
  created_count: number;
  errors: unknown[];
}

export default function TicketsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType || 'standalone';
  const isProvider = tenantType === 'provider';
  const [tabMode, setTabMode] = useState<TabMode>('board');
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [showConsumerTicketModal, setShowConsumerTicketModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [prioSort, setPrioSort] = useState<'asc' | 'desc' | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const bulkUpdate = useBulkUpdateTickets();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleBulkUpdate() {
    if (selectedIds.size === 0) return;
    const update: BulkUpdateInput = {};
    if (bulkStatus)   update.status   = bulkStatus;
    if (bulkPriority) update.priority = bulkPriority as TicketPriority;
    if (!update.status && !update.priority) return;
    try {
      const result = await bulkUpdate.mutateAsync({ ticket_ids: Array.from(selectedIds), update });
      toast.success(`${result.updated_count} ticket${result.updated_count !== 1 ? 's' : ''} updated`);
      setSelectedIds(new Set());
      setBulkStatus('');
      setBulkPriority('');
    } catch {
      toast.error('Failed to bulk update tickets');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setImportLoading(true);
    setImportJob(null);
    try {
      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await fetch('/api/v1/import/tickets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.accessToken ?? ''}`,
          'X-Tenant-Slug': session?.tenantSlug ?? 'platform',
        },
        body: formData,
      });
      if (!res.ok) throw new Error('Import failed');
      const job: ImportJob = await res.json();
      setImportJob(job);
      // Poll for status
      const poll = setInterval(async () => {
        const statusRes = await fetch(`/api/v1/import/${job.job_id}`, {
          headers: {
            Authorization: `Bearer ${session?.accessToken ?? ''}`,
            'X-Tenant-Slug': session?.tenantSlug ?? 'platform',
          },
        });
        if (statusRes.ok) {
          const updated: ImportJob = await statusRes.json();
          setImportJob(updated);
          if (updated.status === 'completed' || updated.status === 'failed') {
            clearInterval(poll);
            setImportLoading(false);
            if (updated.status === 'completed') {
              queryClient.invalidateQueries({ queryKey: ['tickets'] });
              queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
            }
          }
        }
      }, 1500);
    } catch {
      setImportLoading(false);
    }
  }

  const currentUserId = (session?.user as any)?.id || (session?.user as any)?.sub || '';

  const FILTER_KEY = 'ticket_filters_v1';
  function loadSavedFilters(): TicketFilters {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (raw) return { ...JSON.parse(raw), search: searchParams.get('search') || undefined };
    } catch { /* ignore */ }
    return {
      search: searchParams.get('search') || undefined,
      status: undefined, priority: undefined,
      assignee_id: undefined, reporter_id: undefined, consumer_name: undefined,
    };
  }

  const [filters, setFilters] = useState<TicketFilters>(loadSavedFilters);

  function handleFilterChange(key: keyof TicketFilters, value: string) {
    setFilters((prev) => {
      const next = { ...prev, [key]: value || undefined };
      try { localStorage.setItem(FILTER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function handleClearFilters() {
    const next: TicketFilters = { search: filters.search, status: undefined, priority: undefined, project_id: undefined, assignee_id: undefined, reporter_id: undefined, team_id: undefined, consumer_name: undefined };
    setFilters(next);
    try { localStorage.removeItem(FILTER_KEY); } catch { /* ignore */ }
  }

  function handleExportCsv() {
    const tickets = listTickets;
    if (!tickets.length) { toast.error('No tickets to export'); return; }
    const headers = ['Number', 'Title', 'Type', 'Status', 'Priority', 'Assignee', 'Created'];
    const rows = tickets.map((t) => [
      formatTicketNumber(t.number, t.project_key),
      `"${(t.title || '').replace(/"/g, '""')}"`,
      t.type,
      t.status,
      t.priority,
      t.assignee?.name || '',
      new Date(t.created_at).toLocaleDateString(),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const assignedToMe = filters.assignee_id === currentUserId;
  const { data: orgUsers = [] } = useUsers();
  const { data: teams = [] } = useTeams();
  const { data: projectsData } = useProjects();
  const { data: linkedConsumers = [] } = useLinkedConsumers();

  const { data: board, isLoading, error } = useTicketBoard(filters);
  const projectOptionFilters = useMemo(
    () => (assignedToMe ? { assignee_id: currentUserId } : {}),
    [assignedToMe, currentUserId],
  );
  const { data: projectIdsWithTickets = [] } = useTicketBoardProjects(projectOptionFilters);
  const projectOptions = useMemo(() => {
    const projectIds = new Set(projectIdsWithTickets);

    return (projectsData?.data || [])
      .filter((project) => projectIds.has(project.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectIdsWithTickets, projectsData]);
  const selectedProject = useMemo(
    () => (projectsData?.data || []).find((project) => project.id === filters.project_id),
    [filters.project_id, projectsData],
  );
  const sortedColumns = useMemo(() => {
    const cols = board?.columns || [
      { status: 'discover', label: 'Discover', tickets: [] },
      { status: 'open', label: 'Open', tickets: [] },
      { status: 'in_progress', label: 'In Progress', tickets: [] },
      { status: 'in_review', label: 'In Review', tickets: [] },
      { status: 'on_hold', label: 'On Hold', tickets: [] },
      { status: 'resolved', label: 'Resolved', tickets: [] },
    ];

    if (!prioSort) return cols;

    const PRIO_ORDER: Record<string, number> = { high: 1, medium: 2, low: 3 };
    return cols.map((col) => ({
      ...col,
      tickets: [...col.tickets].sort((a, b) =>
        prioSort === 'asc'
          ? (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9)
          : (PRIO_ORDER[b.priority] ?? 9) - (PRIO_ORDER[a.priority] ?? 9),
      ),
    }));
  }, [board, prioSort]);
  const listTickets = useMemo(() => {
    const all = board?.columns.flatMap((col) => col.tickets) ?? [];
    if (!prioSort) return all;

    const PRIO_ORDER: Record<string, number> = { high: 1, medium: 2, low: 3 };
    return [...all].sort((a, b) =>
      prioSort === 'asc'
        ? (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9)
        : (PRIO_ORDER[b.priority] ?? 9) - (PRIO_ORDER[a.priority] ?? 9),
    );
  }, [board, prioSort]);

  const totalConsumerMinutes = useMemo(() => {
    if (!filters.consumer_name) return 0;
    return (board?.columns.flatMap((col) => col.tickets) ?? [])
      .reduce((sum, t) => sum + (t.time_spent_minutes || 0), 0);
  }, [board, filters.consumer_name]);

  return (
    <div data-testid="ticket-list" className="flex h-full min-h-0 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Work Tickets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan and track non-emergency work
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={!listTickets.length}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button data-testid="import-csv-btn" variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
          {isProvider && (
            <Button variant="outline" onClick={() => setShowConsumerTicketModal(true)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Create for Consumer
            </Button>
          )}
          <Button onClick={() => setShowNewTicketModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Work Ticket
          </Button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex w-fit gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {(['board', 'backlog', 'sprints', 'analytics'] as TabMode[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTabMode(tab)}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-semibold capitalize transition-colors',
              tabMode === tab
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'board' ? 'Board' : tab === 'backlog' ? 'Backlog' : tab === 'sprints' ? 'Sprints' : 'Analytics'}
          </button>
        ))}
      </div>

      {/* Board selector — private projects only shown if current user is a member (filtered server-side) */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => handleFilterChange('project_id', '')}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            !filters.project_id
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:border-foreground hover:text-foreground'
          )}
        >
          <FolderKanban className="h-3.5 w-3.5" />
          All Boards
        </button>
        {(projectsData?.data ?? []).filter((p) => p.visibility === 'private').map((project) => (
          <button
            key={project.id}
            onClick={() => handleFilterChange('project_id', project.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filters.project_id === project.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:border-foreground hover:text-foreground'
            )}
          >
            {project.color && (
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
            )}
            {project.name}
          </button>
        ))}
      </div>

      {tabMode === 'backlog'   && <BacklogPanel projectId={filters.project_id} />}
      {tabMode === 'sprints'   && <SprintsPanel projectId={filters.project_id} />}
      {tabMode === 'analytics' && <AnalyticsPanel projectId={filters.project_id} />}

      {tabMode === 'board' && <>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border">
            <button
              onClick={() => setViewMode('kanban')}
              className={cn(
                'flex items-center gap-1.5 rounded-l-lg px-3 py-1.5 text-sm font-medium transition-colors',
                viewMode === 'kanban'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Kanban className="h-4 w-4" />
              Board
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-r-lg px-3 py-1.5 text-sm font-medium transition-colors',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <List className="h-4 w-4" />
              List
            </button>
          </div>

          {/* Filter toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-1.5 h-4 w-4" />
            Filters
          </Button>

          {/* Assigned to me quick filter */}
          <Button
            variant={assignedToMe ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleFilterChange('assignee_id', assignedToMe ? '' : currentUserId)}
            title="Show only tickets assigned to me"
          >
            My Tickets
          </Button>

          {/* Sort by priority */}
          <Button
            variant={prioSort ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPrioSort(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
            title="Sort by priority"
          >
            {prioSort === 'asc' ? <ArrowUp className="mr-1.5 h-4 w-4" /> : prioSort === 'desc' ? <ArrowDown className="mr-1.5 h-4 w-4" /> : <ArrowUpDown className="mr-1.5 h-4 w-4" />}
            Priority
          </Button>

          <FilterSelect
            label="Status"
            icon={<CircleDot />}
            value={filters.status || ''}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            containerClassName="max-w-[210px]"
          >
            <option value="">All Statuses</option>
            <option value="discover">Discover</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="on_hold">On Hold</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </FilterSelect>

          <FilterSelect
            label="Priority"
            icon={<Flag />}
            value={filters.priority || ''}
            onChange={(e) => handleFilterChange('priority', e.target.value as TicketPriority)}
            containerClassName="max-w-[190px]"
          >
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </FilterSelect>

          <FilterSelect
            label="Project"
            icon={<FolderKanban />}
            value={filters.project_id || ''}
            onChange={(e) => handleFilterChange('project_id', e.target.value)}
            containerClassName="max-w-[240px]"
          >
            <option value="">All Projects</option>
            {selectedProject && !projectOptions.some((project) => project.id === selectedProject.id) && (
              <option value={selectedProject.id} hidden>
                {selectedProject.name}
              </option>
            )}
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </FilterSelect>
        </div>

        {/* Search */}
        <SearchInput
          containerClassName="w-full lg:w-72"
          placeholder="Search tickets..."
          value={filters.search || ''}
          onChange={(v) => handleFilterChange('search', v)}
        />
      </div>

      {/* Filters bar */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterCombobox
            label="Assignee"
            icon={<UserCircle2 />}
            value={filters.assignee_id || ''}
            onChange={(v) => handleFilterChange('assignee_id', v)}
            options={orgUsers.map((u) => ({
              value: u.id,
              label: u.name || u.email,
              sublabel: u.name ? u.email : undefined,
            }))}
            placeholder="Search people…"
          />

          <FilterCombobox
            label="Reporter"
            icon={<UserRound />}
            value={filters.reporter_id || ''}
            onChange={(v) => handleFilterChange('reporter_id', v)}
            options={orgUsers.map((u) => ({
              value: u.id,
              label: u.name || u.email,
              sublabel: u.name ? u.email : undefined,
            }))}
            placeholder="Search people…"
          />

          <FilterCombobox
            label="Team"
            icon={<Users />}
            value={filters.team_id || ''}
            onChange={(v) => handleFilterChange('team_id', v)}
            options={teams.map((t) => ({
              value: t.id ?? t._id,
              label: t.name,
              sublabel: t.description || undefined,
            }))}
            placeholder="Search teams…"
          />

          {isProvider && (
            <FilterCombobox
              label="Consumer"
              icon={<Building2 />}
              value={filters.consumer_name || ''}
              onChange={(v) => handleFilterChange('consumer_name', v)}
              options={linkedConsumers
                .filter((lc) => lc.consumer)
                .map((lc) => ({
                  value: lc.consumer!.name,
                  label: lc.consumer!.name,
                }))}
              placeholder="Search consumers…"
            />
          )}

          {(filters.status || filters.priority || filters.project_id || filters.assignee_id || filters.reporter_id || filters.team_id || filters.consumer_name) && (
            <button
              onClick={handleClearFilters}
              className="inline-flex h-[34px] items-center gap-1 rounded-full px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Consumer time summary */}
      {filters.consumer_name && !isLoading && totalConsumerMinutes > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-4 py-2.5">
          <Building2 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="text-sm text-blue-800 dark:text-blue-200">
            <span className="font-semibold">{filters.consumer_name}</span>
            {' — '}
            <span className="font-semibold">
              {totalConsumerMinutes >= 60
                ? `${(totalConsumerMinutes / 60).toFixed(1)}h`
                : `${totalConsumerMinutes}m`}
            </span>
            {' total logged across '}
            <span className="font-semibold">
              {(board?.columns.flatMap((col) => col.tickets) ?? []).filter(t => t.time_spent_minutes > 0).length}
            </span>
            {' tickets'}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading && (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <p className="text-sm text-destructive">
              Failed to load tickets. Please try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !error && viewMode === 'kanban' && (
          <div className="h-full min-h-0">
            <KanbanBoard
              columns={sortedColumns}
              onQuickCreate={() => setShowNewTicketModal(true)}
            />
          </div>
        )}

        {!isLoading && !error && viewMode === 'list' && (
          <div className="h-full overflow-auto rounded-lg border border-border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      className="accent-brand h-3.5 w-3.5"
                      checked={selectedIds.size > 0 && selectedIds.size === listTickets.length}
                      onChange={(e) => setSelectedIds(e.target.checked ? new Set(listTickets.map((t) => t.id)) : new Set())}
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Ticket
                  </th>
                  {isProvider && (
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                      Consumer
                    </th>
                  )}
                  <th
                    className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => setPrioSort(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Priority
                      {prioSort === 'asc' ? <ArrowUp className="h-3 w-3" /> : prioSort === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Assignee
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    SLA
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Estimate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Logged
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {listTickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={cn('border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer', selectedIds.has(ticket.id) && 'bg-brand/5')}
                      onClick={() => (window.location.href = `/tickets/${ticket.id}`)}
                    >
                      <td className="px-3 py-3" onClick={(e) => { e.stopPropagation(); toggleSelect(ticket.id); }}>
                        <input
                          type="checkbox"
                          className="accent-brand h-3.5 w-3.5"
                          checked={selectedIds.has(ticket.id)}
                          onChange={() => toggleSelect(ticket.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-xs font-mono text-muted-foreground">
                            {formatTicketNumber(ticket.number, ticket.project_key)}
                          </span>
                          <p className="text-sm font-medium text-foreground">
                            {ticket.title}
                          </p>
                        </div>
                      </td>
                      {isProvider && (
                        <td className="px-4 py-3">
                          {(ticket.tenant_name || ticket.custom_fields?.escalated_from) ? (
                            <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                              {ticket.tenant_name || ticket.custom_fields.escalated_from}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">&mdash;</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                            ticket.priority === 'high' &&
                              'bg-[#FEF2F2] text-[#DC2626]',
                            ticket.priority === 'medium' &&
                              'bg-[#FEFCE8] text-[#A16207]',
                            ticket.priority === 'low' &&
                              'bg-[#EFF6FF] text-[#2563EB]',
                          )}
                        >
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground capitalize">
                          {ticket.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        <UserAssignDropdown ticket={ticket} />
                      </td>
                      <td className="px-4 py-3">
                        <SlaStatusDot sla={ticket.sla} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {ticket.time_estimate_minutes
                          ? formatMinutes(ticket.time_estimate_minutes)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {ticket.time_spent_minutes
                          ? formatMinutes(ticket.time_spent_minutes)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(ticket.updated_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                {(!board ||
                  board.columns.every((c) => c.tickets.length === 0)) && (
                  <tr>
                    <td
                      colSpan={isProvider ? 10 : 9}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      No tickets found. Create your first ticket to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk action floating bar — list view only */}
      {viewMode === 'list' && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3 shadow-xl">
          <CheckSquare className="h-4 w-4 text-brand flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
          <div className="mx-2 h-4 w-px bg-border" />
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none"
          >
            <option value="">Set status…</option>
            <option value="discover">Discover</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="on_hold">On Hold</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={bulkPriority}
            onChange={(e) => setBulkPriority(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none"
          >
            <option value="">Set priority…</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <Button
            size="sm"
            onClick={handleBulkUpdate}
            disabled={bulkUpdate.isPending || (!bulkStatus && !bulkPriority)}
          >
            {bulkUpdate.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Apply
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setSelectedIds(new Set()); setBulkStatus(''); setBulkPriority(''); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      </>}

      {/* New Ticket Modal */}
      <Dialog
        open={showNewTicketModal}
        onClose={() => setShowNewTicketModal(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Work Ticket</DialogTitle>
          </DialogHeader>
          <TicketForm onSuccess={() => setShowNewTicketModal(false)} />
        </DialogContent>
      </Dialog>

      {/* Create for Consumer Modal (provider only) */}
      {isProvider && (
        <Dialog
          open={showConsumerTicketModal}
          onClose={() => setShowConsumerTicketModal(false)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Ticket for Consumer</DialogTitle>
            </DialogHeader>
            <TicketForm
              forConsumer
              onSuccess={() => setShowConsumerTicketModal(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Import CSV Modal */}
      <Dialog open={showImport} onClose={() => { setShowImport(false); setImportFile(null); setImportJob(null); setImportLoading(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Tickets from CSV</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleImport} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">CSV File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Expected columns: <code className="font-mono">title, description, type, priority</code>
              </p>
            </div>

            {importJob && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">Status:</span>
                  <span className={cn(
                    'capitalize',
                    importJob.status === 'completed' && 'text-[#16A34A]',
                    importJob.status === 'failed' && 'text-destructive',
                    importJob.status === 'processing' && 'text-[#A16207]',
                  )}>
                    {importJob.status}
                  </span>
                  {importLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <p className="text-muted-foreground">Created: {importJob.created_count} tickets</p>
                {importJob.errors?.length > 0 && (
                  <p className="text-destructive">{importJob.errors.length} errors</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => { setShowImport(false); setImportFile(null); setImportJob(null); setImportLoading(false); }}>
                {importJob?.status === 'completed' ? 'Close' : 'Cancel'}
              </Button>
              {!importJob && (
                <Button type="submit" disabled={importLoading || !importFile}>
                  {importLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Import
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}

const STATUS_COLORS_CHART: Record<string, string> = {
  discover: '#0EA5E9',
  open: '#3B82F6', in_progress: '#6366F1', in_review: '#8B5CF6',
  on_hold: '#64748B', resolved: '#10B981', closed: '#6B7280', done: '#10B981',
};

function AnalyticsPanel({ projectId }: { projectId?: string }) {
  const [cycleTimeDays, setCycleTimeDays] = useState(30);
  const { data: cycleTime,  isLoading: loadingCT } = useCycleTime({ days: cycleTimeDays, project_id: projectId });
  const { data: workload,   isLoading: loadingWL } = useWorkloadStats();
  const { data: statusDist, isLoading: loadingSD } = useStatusDistribution();
  const { data: throughput, isLoading: loadingTP } = useThroughput(12);

  const PRIORITY_COLORS: Record<string, string> = { bug: '#DC2626', task: '#6366F1', user_story: '#0EA5E9', epic: '#D97706' };

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Analytics</h2>
        <a href="/tickets/timesheet" className="text-xs font-medium text-brand hover:underline">
          View Timesheet →
        </a>
      </div>

      {/* Throughput + Status distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Throughput */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tickets Resolved / Week</p>
            {throughput && <span className="text-xs text-muted-foreground">{throughput.total} total</span>}
          </div>
          {loadingTP ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (throughput?.data.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No resolved tickets yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={throughput!.data.map((d) => ({ week: d.week.slice(5), count: d.count }))} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status distribution */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ticket Status Distribution</p>
          {loadingSD ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (statusDist?.data.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tickets</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={statusDist!.data} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={60} label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false} style={{ fontSize: 9 }}>
                  {statusDist!.data.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS_CHART[entry.status] ?? '#94A3B8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Cycle time */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cycle Time</p>
          <select value={cycleTimeDays} onChange={(e) => setCycleTimeDays(Number(e.target.value))} className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none">
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        {loadingCT ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : !cycleTime || cycleTime.sample_size === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No resolved tickets in this period</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ label: 'Avg', value: `${cycleTime.avg_days}d` }, { label: 'Median', value: `${cycleTime.median_days}d` }, { label: 'P75', value: `${cycleTime.p75_days}d` }, { label: 'P95', value: `${cycleTime.p95_days}d` }].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-xl font-bold text-foreground">{value}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {cycleTime.trend.length > 1 && (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={cycleTime.trend.map((t) => ({ week: t.week.slice(5), days: t.avg_days }))} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v}d`, 'Avg']} />
                  <Bar dataKey="days" radius={[4, 4, 0, 0]}>
                    {cycleTime.trend.map((_, i) => <Cell key={i} fill="#6366F1" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* Workload */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open Tickets by Assignee</p>
        {loadingWL ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : (workload?.data.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No assigned open tickets</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(120, (workload!.data.length * 32))}>
            <BarChart data={workload!.data} layout="vertical" margin={{ top: 0, right: 40, left: 80, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={75} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" fill="#6366F1" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 10, fill: '#94A3B8' }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Cycle time based on {cycleTime?.sample_size ?? 0} resolved ticket{(cycleTime?.sample_size ?? 0) !== 1 ? 's' : ''} in the selected period.
      </p>
    </div>
  );
}

function SlaStatusDot({ sla }: { sla: TicketSla | null | undefined }) {
  if (!sla) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" title="No SLA" />;
  }

  // Already resolved — check met/breached
  if (sla.resolution_met === true) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#16A34A]" title="SLA Met" />;
  }
  if (sla.resolution_met === false || sla.response_met === false) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#DC2626]" title="SLA Breached" />;
  }

  // Still open — check deadline proximity
  if (sla.resolution_deadline) {
    const remaining = new Date(sla.resolution_deadline).getTime() - Date.now();
    if (remaining < 0) {
      return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#DC2626] animate-pulse" title="SLA Overdue" />;
    }
    // At risk: less than 25% of time remaining (heuristic: < 1 hour)
    if (remaining < 3600000) {
      return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#A16207]" title="SLA At Risk" />;
    }
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#16A34A]" title="SLA On Track" />;
  }

  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" title="No SLA deadline" />;
}
