'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Radar, ArrowLeft, Loader2, ChevronDown, ChevronRight, RefreshCw,
  Clock, User, Hash, Activity, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoveryJob {
  id: string;
  type: 'otel_trace_scan' | 'document_upload' | 'network_scan';
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: {
    edges_discovered: number;
    edges_new: number;
    edges_updated: number;
    edges_stale: number;
    services_discovered: number;
    processing_time_ms: number;
  } | null;
  error_message: string | null;
  triggered_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface DiscoveryJobsResponse {
  data: DiscoveryJob[];
  pagination: { total: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_TYPE_LABELS: Record<string, string> = {
  otel_trace_scan: 'OTel Trace Scan',
  document_upload: 'Document Upload',
  network_scan: 'Network Scan',
};

const STATUS_CONFIG: Record<string, { label: string; variant: 'outline' | 'info' | 'success' | 'destructive'; pulse?: boolean }> = {
  pending:   { label: 'Pending',   variant: 'outline' },
  running:   { label: 'Running',   variant: 'info',        pulse: true },
  completed: { label: 'Completed', variant: 'success' },
  failed:    { label: 'Failed',    variant: 'destructive' },
};

// ─── Discovery Progress ──────────────────────────────────────────────────────

const STAGES = [
  { label: 'Queued', duration: 5 },
  { label: 'Connecting to telemetry', duration: 10 },
  { label: 'Scanning traces', duration: 30 },
  { label: 'Extracting dependencies', duration: 15 },
  { label: 'Finalizing results', duration: 5 },
];
const TOTAL_ESTIMATED_SECONDS = STAGES.reduce((s, st) => s + st.duration, 0); // 65s

function DiscoveryProgress({ job }: { job: DiscoveryJob }) {
  const [now, setNow] = useState(Date.now());

  // Tick every second for live elapsed time
  useState(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  });

  const elapsedSec = Math.round((now - new Date(job.created_at).getTime()) / 1000);
  const percent = job.status === 'pending'
    ? Math.min(Math.round((elapsedSec / 10) * 15), 15)
    : Math.min(Math.round((elapsedSec / TOTAL_ESTIMATED_SECONDS) * 100), 95);
  const remainingSec = Math.max(TOTAL_ESTIMATED_SECONDS - elapsedSec, 0);

  // Determine current stage
  let currentStage = STAGES[0].label;
  if (job.status === 'running') {
    let cumulative = 0;
    for (const stage of STAGES) {
      cumulative += stage.duration;
      if (elapsedSec < cumulative) { currentStage = stage.label; break; }
      currentStage = stage.label;
    }
  }

  const formatDuration = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  };

  const formatRemaining = (sec: number) => `~${formatDuration(sec)} remaining`;

  return (
    <div className="px-4 pb-2 pl-12">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-3 mb-2">
          <Loader2 className="h-4 w-4 animate-spin text-brand shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">
              {job.status === 'pending' ? 'Preparing to scan...' : currentStage}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {job.status === 'pending'
                ? 'Your discovery job is queued and will begin processing shortly.'
                : `Step ${STAGES.findIndex(s => s.label === currentStage) + 1} of ${STAGES.length}`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-sm font-bold font-mono text-foreground">{percent}%</span>
            <p className="text-[10px] text-muted-foreground">
              {job.status === 'pending' ? `Queued ${formatDuration(elapsedSec)} ago` : formatRemaining(remainingSec)}
            </p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-brand transition-all duration-1000 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        {/* Stage dots */}
        {job.status === 'running' && (
          <div className="flex items-center justify-between mt-2">
            {STAGES.map((stage, i) => {
              const stageIdx = STAGES.findIndex(s => s.label === currentStage);
              const isDone = i < stageIdx;
              const isCurrent = i === stageIdx;
              return (
                <div key={stage.label} className="flex items-center gap-1">
                  <div className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isDone ? 'bg-success' : isCurrent ? 'bg-brand animate-pulse' : 'bg-muted-foreground/20'
                  )} />
                  <span className={cn(
                    'text-[8px]',
                    isDone ? 'text-success' : isCurrent ? 'text-brand font-semibold' : 'text-muted-foreground/40'
                  )}>
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Job Row ──────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: DiscoveryJob }) {
  const [expanded, setExpanded] = useState(false);

  const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;

  function formatDuration(ms: number | null): string {
    if (ms === null) return '--';
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        {/* Expand icon */}
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>

        {/* Type */}
        <span className="w-36 shrink-0 text-sm font-medium text-foreground">
          {JOB_TYPE_LABELS[job.type] ?? job.type}
        </span>

        {/* Status badge */}
        <span className="w-28 shrink-0">
          <Badge
            variant={statusCfg.variant}
            className={cn(statusCfg.pulse && 'animate-pulse')}
          >
            {statusCfg.label}
          </Badge>
        </span>

        {/* Edges discovered */}
        <span className="w-24 shrink-0 text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{job.results?.edges_discovered ?? 0}</span> edges
        </span>

        {/* Processing time */}
        <span className="w-20 shrink-0 text-sm text-muted-foreground">
          {formatDuration(job.results?.processing_time_ms ?? null)}
        </span>

        {/* Triggered by */}
        <span className="flex-1 min-w-0 text-sm text-muted-foreground truncate">
          {job.triggered_by ?? 'Scheduled'}
        </span>

        {/* Date */}
        <span className="w-40 shrink-0 text-xs text-muted-foreground text-right">
          {new Date(job.created_at).toLocaleString()}
        </span>
      </button>

      {/* Progress bar for pending/running */}
      {(job.status === 'pending' || job.status === 'running') && (
        <DiscoveryProgress job={job} />
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pl-12">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" /> Job ID
                </p>
                <p className="text-sm font-mono text-foreground mt-0.5 truncate">{job.id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Triggered By
                </p>
                <p className="text-sm text-foreground mt-0.5">{job.triggered_by ?? 'Scheduled'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Started
                </p>
                <p className="text-sm text-foreground mt-0.5">
                  {new Date(job.created_at).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Completed
                </p>
                <p className="text-sm text-foreground mt-0.5">
                  {job.completed_at ? new Date(job.completed_at).toLocaleString() : '--'}
                </p>
              </div>
            </div>

            {/* Results section */}
            {job.results && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-2 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">Services Discovered</p>
                  <p className="text-sm font-bold text-foreground">{job.results.services_discovered}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">New Edges</p>
                  <p className="text-sm font-bold text-success">{job.results.edges_new}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Updated Edges</p>
                  <p className="text-sm font-bold text-info">{job.results.edges_updated}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stale Edges</p>
                  <p className="text-sm font-bold text-muted-foreground">{job.results.edges_stale}</p>
                </div>
              </div>
            )}

            {/* Error message */}
            {job.error_message && (
              <div className="rounded-lg border border-error/20 bg-error/5 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-error" />
                  <span className="text-sm font-medium text-error">Error</span>
                </div>
                <p className="text-sm text-error/80">{job.error_message}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DiscoveryDashboardPage() {
  const queryClient = useQueryClient();

  const { data: jobsResponse, isLoading } = useQuery<DiscoveryJobsResponse>({
    queryKey: ['discovery-jobs'],
    queryFn: () => api.get<DiscoveryJobsResponse>('/api/v1/service-dependencies/discovery/jobs'),
    refetchInterval: 10000, // Poll every 10s for running jobs
  });

  const triggerScan = useMutation({
    mutationFn: () =>
      api.post<{ job_id: string }>('/api/v1/service-dependencies/discovery/trigger', { type: 'otel_trace_scan' }),
    onSuccess: () => {
      toast.success('OTel trace scan triggered. Check back for results.');
      queryClient.invalidateQueries({ queryKey: ['discovery-jobs'] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to trigger scan');
    },
  });

  const jobs = jobsResponse?.data ?? [];
  const total = jobsResponse?.pagination?.total ?? 0;

  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const runningCount = jobs.filter((j) => j.status === 'running').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/services/topology" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-foreground">Dependency Discovery</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground ml-8">
            Monitor auto-discovery jobs and trigger new scans
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['discovery-jobs'] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => triggerScan.mutate()} disabled={triggerScan.isPending}>
            {triggerScan.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Radar className="mr-2 h-4 w-4" />
            )}
            Trigger OTel Scan
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Jobs',    value: total,          color: 'text-foreground' },
          { label: 'Pending',       value: pendingCount,   color: 'text-[#EAB308]' },
          { label: 'Completed',     value: completedCount, color: 'text-success' },
          { label: 'Failed',        value: failedCount,    color: 'text-error' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{isLoading ? '...' : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Jobs table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5 text-muted-foreground" />
            Discovery Jobs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Radar}
                title="No discovery jobs"
                description="Trigger an OTel trace scan or upload an architecture diagram to start discovering dependencies."
                actionLabel="Trigger OTel Scan"
                onAction={() => triggerScan.mutate()}
              />
            </div>
          ) : (
            <>
              {/* Table header */}
              <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                <span className="w-4 shrink-0" />
                <span className="w-36 shrink-0">Type</span>
                <span className="w-28 shrink-0">Status</span>
                <span className="w-24 shrink-0">Edges</span>
                <span className="w-20 shrink-0">Duration</span>
                <span className="flex-1 min-w-0">Triggered By</span>
                <span className="w-40 shrink-0 text-right">Date</span>
              </div>

              {/* Rows */}
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
