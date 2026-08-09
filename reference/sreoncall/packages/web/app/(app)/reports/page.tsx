'use client';

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { BarChart3, Download, Loader2, ChevronDown, ChevronRight, Printer, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useWorkLogReport,
  useExportWorkLogReport,
  useGenerateAISummaryPDF,
  type WorkLogReportParams,
  type WorkLogReportGroup,
} from '@/lib/hooks/useReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useMilestones } from '@/lib/hooks/useMilestones';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';
import { cn } from '@/lib/utils';

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1) + 'h';
}

function getDefaultFrom(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function getDefaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function ExpandableGroup({ group }: { group: WorkLogReportGroup }) {
  const [expanded, setExpanded] = useState(false);
  const entries = group.entries ?? [];

  return (
    <>
      <tr
        className="bg-background hover:bg-muted/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-foreground">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="font-medium">{group.label || group._id || 'Ungrouped'}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-foreground text-center">{group.entry_count}</td>
        <td className="px-4 py-3 text-foreground font-medium text-right">{formatHours(group.total_minutes)}</td>
        <td className="px-4 py-3 text-muted-foreground text-right">
          {group.entry_count > 0 ? formatHours(group.total_minutes / group.entry_count) : '-'}
        </td>
      </tr>
      {expanded && entries.map((entry) => (
        <tr key={entry.id} className="bg-muted/20 text-xs">
          <td className="px-4 py-2 pl-10 text-foreground">
            <div>
              <span className="text-muted-foreground mr-2">
                {new Date(entry.logged_at).toLocaleDateString()}
              </span>
              <span className="font-medium">{entry.user_name}</span>
              {entry.entity_number != null && (
                <span className="ml-2 font-mono text-muted-foreground">
                  {entry.entity_type === 'incident' ? 'INC' : 'TK'}-{String(entry.entity_number).padStart(4, '0')}
                </span>
              )}
              <span className="ml-1 text-foreground">{entry.entity_title}</span>
            </div>
            {entry.description && (
              <p className="text-muted-foreground mt-0.5 truncate max-w-md">{entry.description}</p>
            )}
          </td>
          <td className="px-4 py-2 text-center">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                entry.source === 'provider'
                  ? 'bg-[#FFF7ED] text-[#EA580C]'
                  : 'bg-[#EFF6FF] text-[#2563EB]',
              )}
            >
              {entry.source === 'provider' ? 'Provider' : 'Internal'}
            </span>
            {entry.billable && (
              <span className="ml-1 inline-flex items-center rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[10px] font-semibold text-[#16A34A]">
                Billable
              </span>
            )}
          </td>
          <td className="px-4 py-2 text-right font-medium text-foreground">{formatHours(entry.duration_minutes)}</td>
          <td className="px-4 py-2 text-right text-muted-foreground">
            {entry.project_name || '-'}
          </td>
        </tr>
      ))}
      {expanded && entries.length === 0 && (
        <tr className="bg-muted/20">
          <td colSpan={4} className="px-4 py-2 pl-10 text-xs text-muted-foreground">
            No detailed entries available.
          </td>
        </tr>
      )}
    </>
  );
}

export default function ReportsPage() {
  const { data: session } = useSession();
  const isProvider = (session?.user as any)?.tenantType === 'provider';

  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getDefaultTo);
  const [entityType, setEntityType] = useState<string>('all');
  const [source, setSource] = useState<string>('all');
  const [projectId, setProjectId] = useState<string>('');
  const [milestoneId, setMilestoneId] = useState<string>('');
  const [consumerName, setConsumerName] = useState<string>('');
  const [groupBy, setGroupBy] = useState<string>('project');
  const [billableOnly, setBillableOnly] = useState(false);
  const [approvedOnly, setApprovedOnly] = useState(false);

  // Active params (applied on click)
  const [activeParams, setActiveParams] = useState<WorkLogReportParams | null>(null);

  const { data: projectsData } = useProjects();
  const projects = projectsData?.data ?? [];

  const milestoneFilters = projectId ? { project_id: projectId } : {};
  const { data: milestonesData } = useMilestones(milestoneFilters);
  const milestones = milestonesData?.data ?? [];

  const { data: linkedConsumers = [] } = useLinkedConsumers();

  const { data: report, isLoading } = useWorkLogReport(activeParams);
  const exportReport = useExportWorkLogReport();
  const generateAISummary = useGenerateAISummaryPDF();

  function handleApply() {
    const params: WorkLogReportParams = { from, to };
    if (entityType !== 'all') params.entity_type = entityType as any;
    if (source !== 'all') params.source = source as any;
    if (projectId) params.project_id = projectId;
    if (milestoneId) params.milestone_id = milestoneId;
    if (groupBy) params.group_by = groupBy as any;
    if (billableOnly) params.billable_only = true;
    if (approvedOnly) params.approved_only = true;
    if (consumerName) params.consumer_name = consumerName;
    setActiveParams(params);
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

  async function handleAISummary() {
    if (!activeParams) { toast.error('Run a report first, then generate an AI summary'); return; }
    try {
      toast.info('Generating AI summary — this may take a few seconds…');
      await generateAISummary.mutateAsync(activeParams);
      toast.success('AI summary PDF downloaded');
    } catch {
      toast.error('AI summary generation failed');
    }
  }

  function handlePrint() {
    window.print();
  }

  const grandTotal = report?.grand_total_minutes ?? 0;
  const groups = report?.groups ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Work Log Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyze work log data across projects, milestones, teams, and users.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            disabled={!activeParams || exportReport.isPending}
          >
            <Download className="mr-1 h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('pdf')}
            disabled={!activeParams || exportReport.isPending}
          >
            <Download className="mr-1 h-4 w-4" />
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-1 h-4 w-4" />
            Print
          </Button>
          <Button
            size="sm"
            onClick={handleAISummary}
            disabled={!activeParams || generateAISummary.isPending}
            className="bg-gradient-to-r from-[#0E5AA6] to-[#1282BF] text-white hover:from-[#0A3D6E] hover:to-[#0E5AA6] border-0 shadow-sm"
            title="Generate an AI-powered executive summary PDF for the selected date range"
          >
            {generateAISummary.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {generateAISummary.isPending ? 'Generating…' : 'AI Summary PDF'}
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Entity Type</label>
              <Select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                <option value="all">All</option>
                <option value="ticket">Tickets</option>
                <option value="incident">Incidents</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="all">All</option>
                <option value="internal">Internal</option>
                <option value="provider">Provider</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Project</label>
              <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setMilestoneId(''); }}>
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Milestone</label>
              <Select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
                <option value="">All Milestones</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </div>
            {isProvider && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Consumer</label>
                <Select value={consumerName} onChange={(e) => setConsumerName(e.target.value)}>
                  <option value="">All Consumers</option>
                  {linkedConsumers
                    .filter((lc) => lc.consumer)
                    .map((lc) => (
                      <option key={lc._id} value={lc.consumer!.name}>{lc.consumer!.name}</option>
                    ))}
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Group By</label>
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="project">Project</option>
                <option value="user">User</option>
                <option value="ticket">Ticket</option>
                <option value="team">Team</option>
                <option value="source">Source</option>
                <option value="entity_type">Entity Type</option>
              </Select>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 h-[40px] text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={billableOnly}
                  onChange={(e) => setBillableOnly(e.target.checked)}
                  className="rounded border-border"
                />
                Billable only
              </label>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 h-[40px] text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={approvedOnly}
                  onChange={(e) => setApprovedOnly(e.target.checked)}
                  className="rounded border-border"
                />
                Approved only
              </label>
            </div>
            <div className="flex flex-col justify-end">
              <Button onClick={handleApply} className="w-full h-[40px]">
                Apply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {report && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase text-muted-foreground">Total Hours</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{formatHours(grandTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase text-muted-foreground">Internal / Provider</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                <span className="text-[#2563EB]">{formatHours(report.internal_minutes)}</span>
                {' / '}
                <span className="text-[#EA580C]">{formatHours(report.provider_minutes)}</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase text-muted-foreground">Billable Hours</p>
              <p className="mt-1 text-2xl font-bold text-[#16A34A]">{formatHours(report.billable_minutes)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase text-muted-foreground">Tickets / Incidents</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {formatHours(report.ticket_minutes)} / {formatHours(report.incident_minutes)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Grouped Table */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !activeParams ? (
        <EmptyState
          icon={BarChart3}
          title="Run a report"
          description="Set your filters above and click Apply to generate a work log report."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No data"
          description="No work log entries match the selected filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-input">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Group</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Entries</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total Hours</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Avg / Entry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-input">
              {groups.map((group) => (
                <ExpandableGroup key={group._id} group={group} />
              ))}
            </tbody>
            <tfoot className="bg-muted/30 font-semibold">
              <tr>
                <td className="px-4 py-3 text-foreground">Total</td>
                <td className="px-4 py-3 text-center text-foreground">
                  {groups.reduce((sum, g) => sum + g.entry_count, 0)}
                </td>
                <td className="px-4 py-3 text-right text-foreground">{formatHours(grandTotal)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">-</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
