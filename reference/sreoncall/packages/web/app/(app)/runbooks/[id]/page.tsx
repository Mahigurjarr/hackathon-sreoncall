'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Play, CheckCircle2, XCircle, Clock, Loader2,
  Terminal, Globe, BookOpen, User, ChevronDown, ChevronRight,
  ShieldAlert, AlertCircle, FileText, History, BarChart2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { MarkdownRenderer } from '@/components/ai/MarkdownRenderer';
import { cn } from '@/lib/utils';
import {
  useRunbook,
  useRunbookVersions,
  useRunbookExecutions,
  useExecution,
  useStartExecution,
  useCompleteManualStep,
  useApproveStep,
  useCancelExecution,
  useUpdateRunbook,
  type RunbookExecution,
  type ExecutionStepState,
  type StepExecutionStatus,
} from '@/lib/hooks/useRunbooks';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_TYPE_ICONS: Record<string, React.ReactNode> = {
  manual:           <User className="h-3.5 w-3.5" />,
  bash_script:      <Terminal className="h-3.5 w-3.5" />,
  api_call:         <Globe className="h-3.5 w-3.5" />,
  ansible_playbook: <BookOpen className="h-3.5 w-3.5" />,
};

const STEP_STATUS_COLORS: Record<StepExecutionStatus, string> = {
  pending:           'text-muted-foreground bg-muted',
  awaiting_approval: 'text-[#A16207] bg-[#FEFCE8] dark:text-amber-300 dark:bg-amber-900/30',
  running:           'text-[#2563EB] bg-[#EFF6FF] dark:text-blue-300 dark:bg-blue-900/30',
  completed:         'text-[#16A34A] bg-[#F0FDF4] dark:text-green-300 dark:bg-green-900/30',
  failed:            'text-[#DC2626] bg-[#FEF2F2] dark:text-red-300 dark:bg-red-900/30',
  skipped:           'text-muted-foreground bg-muted/60',
};

const EXEC_STATUS_COLORS: Record<string, string> = {
  running:          'text-[#2563EB] bg-[#EFF6FF] dark:text-blue-300 dark:bg-blue-900/30',
  paused_approval:  'text-[#A16207] bg-[#FEFCE8] dark:text-amber-300 dark:bg-amber-900/30',
  completed:        'text-[#16A34A] bg-[#F0FDF4] dark:text-green-300 dark:bg-green-900/30',
  failed:           'text-[#DC2626] bg-[#FEF2F2] dark:text-red-300 dark:bg-red-900/30',
  cancelled:        'text-muted-foreground bg-muted',
};

// ─── Active execution panel ────────────────────────────────────────────────────

function ActiveExecutionPanel({ executionId }: { executionId: string }) {
  const isActive = (status: string) => ['running', 'paused_approval'].includes(status);
  const { data: exec, isLoading } = useExecution(executionId, true);
  const completeMutation  = useCompleteManualStep();
  const approveMutation   = useApproveStep();
  const cancelMutation    = useCancelExecution();
  const [showLog, setShowLog]           = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [completingStep, setCompletingStep] = useState<number | null>(null);

  if (isLoading || !exec) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  async function handleComplete(stepIdx: number) {
    setCompletingStep(stepIdx);
    try {
      await completeMutation.mutateAsync({ executionId, stepIdx });
      toast.success('Step completed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setCompletingStep(null); }
  }

  async function handleApprove(stepIdx: number, decision: 'approved' | 'rejected') {
    try {
      await approveMutation.mutateAsync({ executionId, stepIdx, decision, comment: approveComment || undefined });
      toast.success(decision === 'approved' ? 'Step approved' : 'Step rejected');
      setApproveComment('');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  }

  async function handleCancel() {
    if (!confirm('Cancel this execution?')) return;
    try {
      await cancelMutation.mutateAsync(executionId);
      toast.success('Execution cancelled');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', EXEC_STATUS_COLORS[exec.status] || 'bg-muted text-muted-foreground')}>
            {exec.status.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-muted-foreground">
            v{exec.runbook_version} · started {formatDistanceToNow(new Date(exec.started_at), { addSuffix: true })}
          </span>
          {exec.duration_ms && (
            <span className="text-xs text-muted-foreground">
              · {(exec.duration_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {isActive(exec.status) && (
          <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={handleCancel} disabled={cancelMutation.isPending}>
            Cancel
          </Button>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: '50vh' }}>
        {exec.steps_state.map((step, idx) => (
          <StepRow
            key={step.id || idx}
            step={step}
            idx={idx}
            isCurrent={exec.current_step === idx && isActive(exec.status)}
            onComplete={() => handleComplete(idx)}
            onApprove={(d) => handleApprove(idx, d)}
            completing={completingStep === idx}
            approveComment={approveComment}
            setApproveComment={setApproveComment}
            approving={approveMutation.isPending}
          />
        ))}
      </div>

      {/* Output log toggle */}
      <div>
        <button
          onClick={() => setShowLog(!showLog)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {showLog ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Execution log ({exec.output_log.length} entries)
        </button>
        {showLog && (
          <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
            {exec.output_log.map((e, i) => (
              `[${format(new Date(e.timestamp), 'HH:mm:ss')}] [${e.level.toUpperCase()}] ${e.message}`
            )).join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}

function StepRow({
  step, idx, isCurrent, onComplete, onApprove,
  completing, approveComment, setApproveComment, approving,
}: {
  step: ExecutionStepState; idx: number; isCurrent: boolean;
  onComplete: () => void; onApprove: (d: 'approved' | 'rejected') => void;
  completing: boolean; approveComment: string;
  setApproveComment: (v: string) => void; approving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isManualRunning = step.type === 'manual' && step.status === 'running' && isCurrent;
  const isAwaitingApproval = step.status === 'awaiting_approval' && isCurrent;

  return (
    <div className={cn(
      'rounded-lg border p-3',
      isCurrent && ['running', 'paused_approval', 'awaiting_approval'].includes(step.status)
        ? 'border-primary/50 bg-primary/5'
        : 'border-border',
    )}>
      <div className="flex items-center gap-2">
        {/* Status icon */}
        {step.status === 'completed' && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />}
        {step.status === 'failed'    && <XCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />}
        {step.status === 'running'   && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2563EB]" />}
        {step.status === 'pending'   && <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />}
        {step.status === 'skipped'   && <Clock className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
        {step.status === 'awaiting_approval' && <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />}

        <span className="text-xs text-muted-foreground">{idx + 1}.</span>
        <span className="flex-1 text-sm font-medium text-foreground">{step.title}</span>

        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-muted-foreground">
            {STEP_TYPE_ICONS[step.type]}
          </span>
          {step.requires_approval && (
            <span className="text-xs text-[#A16207] dark:text-amber-400">approval gate</span>
          )}
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STEP_STATUS_COLORS[step.status])}>
            {step.status.replace(/_/g, ' ')}
          </span>
          {(step.output || step.error) && (
            <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Output */}
      {expanded && (step.output || step.error) && (
        <pre className={cn('mt-2 rounded bg-muted p-2 font-mono text-xs overflow-y-auto', step.error ? 'text-[#DC2626] dark:text-red-400' : 'text-foreground')} style={{ maxHeight: '200px' }}>
          {step.error || step.output}
        </pre>
      )}

      {/* Duration */}
      {step.duration_ms != null && (
        <p className="mt-1 text-xs text-muted-foreground">{(step.duration_ms / 1000).toFixed(2)}s</p>
      )}

      {/* Manual step — waiting for operator to complete */}
      {isManualRunning && (
        <div className="mt-3 rounded-lg border border-info/30 bg-info/5 p-3 space-y-2">
          <p className="text-xs font-medium text-info">
            Waiting for you to complete this manual step. Perform the action described above, then click the button below.
          </p>
          <Button size="sm" onClick={onComplete} disabled={completing}>
            {completing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
            Mark as Complete
          </Button>
        </div>
      )}

      {/* Approval gate */}
      {isAwaitingApproval && (
        <div className="mt-3 space-y-2 rounded-lg border border-[#FDE68A] dark:border-amber-800 bg-[#FEFCE8] dark:bg-amber-900/20 p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">This step requires approval before it can run.</p>
          <input
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Optional comment..."
            value={approveComment}
            onChange={(e) => setApproveComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onApprove('approved')} disabled={approving}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => onApprove('rejected')} disabled={approving}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Execution history row ─────────────────────────────────────────────────────

function ExecutionHistoryRow({
  exec,
  onSelect,
}: { exec: RunbookExecution; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-muted/60"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium capitalize', EXEC_STATUS_COLORS[exec.status] || 'bg-muted text-muted-foreground')}>
            {exec.status.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-muted-foreground">v{exec.runbook_version}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(exec.started_at), { addSuffix: true })}
          {exec.duration_ms ? ` · ${(exec.duration_ms / 1000).toFixed(1)}s` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {exec.steps_state.filter((s) => s.status === 'completed').length}/{exec.steps_state.length} steps
        <ChevronRight className="h-3.5 w-3.5" />
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunbookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [showExecute, setShowExecute]             = useState(false);
  const [execVariables, setExecVariables]         = useState<Record<string, string>>({});
  const [showVersions, setShowVersions]           = useState(false);

  const { data: runbook, isLoading, error } = useRunbook(id);
  const { data: versionsData }               = useRunbookVersions(id);
  const { data: executionsData, refetch: refetchExecutions } = useRunbookExecutions(id);
  const startMutation   = useStartExecution();
  const updateMutation  = useUpdateRunbook();

  const executions = executionsData?.data ?? [];
  const hasActiveExec = activeExecutionId !== null;

  async function handleExecute() {
    if (!runbook) return;
    try {
      const exec = await startMutation.mutateAsync({
        runbookId: id,
        variables: execVariables,
      });
      setActiveExecutionId(exec.id);
      setShowExecute(false);
      toast.success('Execution started');
      refetchExecutions();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start execution');
    }
  }

  async function handlePublish() {
    try {
      await updateMutation.mutateAsync({ id, input: { status: runbook?.status === 'published' ? 'draft' : 'published' } });
      toast.success(runbook?.status === 'published' ? 'Moved to draft' : 'Published');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status');
    }
  }

  if (isLoading) {
    return <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error || !runbook) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-foreground">Runbook not found</p>
        <Button variant="outline" onClick={() => router.push('/runbooks')}>Back to Runbooks</Button>
      </div>
    );
  }

  const successRate = runbook.stats.executions > 0
    ? Math.round((runbook.stats.successful / runbook.stats.executions) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/runbooks')} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{runbook.title}</h1>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', runbook.status === 'published' ? 'bg-[#F0FDF4] text-[#16A34A] dark:bg-green-900/30 dark:text-green-300' : 'bg-muted text-muted-foreground')}>
                {runbook.status}
              </span>
              <span className="text-xs text-muted-foreground">v{runbook.version}</span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{runbook.description || 'No description'}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={handlePublish} disabled={updateMutation.isPending}>
            {runbook.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
          <Button
            size="sm"
            onClick={() => setShowExecute(true)}
            disabled={runbook.steps.length === 0}
            title={runbook.steps.length === 0 ? 'Add steps before executing' : undefined}
          >
            <Play className="mr-1.5 h-4 w-4" />
            Execute
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: steps + active execution */}
        <div className="space-y-6 lg:col-span-2">
          {/* Active execution */}
          {activeExecutionId && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play className="h-4 w-4 text-primary" />
                  Active Execution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActiveExecutionPanel executionId={activeExecutionId} />
              </CardContent>
            </Card>
          )}

          {/* Detailed runbook body (markdown — shown when AI-generated) */}
          {runbook.content && runbook.content.trim().length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4" />
                  Detailed Report
                  {runbook.ai_generated && (
                    <Badge variant="secondary" className="ml-1 text-[10px]">AI-generated</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-y-auto pr-1" style={{ maxHeight: '65vh' }}>
                  <MarkdownRenderer content={runbook.content} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Steps */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Steps ({runbook.steps.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {runbook.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No steps defined yet. Edit the runbook to add steps.</p>
              ) : (
                <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: '60vh' }}>
                  {runbook.steps
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((step, i) => (
                      <div key={step.id || i} className="rounded-lg border border-border p-3" style={{ maxHeight: '280px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div className="flex items-start gap-3 shrink-0">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {i + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{step.title}</p>
                              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground capitalize">
                                {STEP_TYPE_ICONS[step.type]}
                                {step.type.replace(/_/g, ' ')}
                              </span>
                              {step.requires_approval && (
                                <span className="flex items-center gap-1 text-xs text-[#A16207] dark:text-amber-400">
                                  <ShieldAlert className="h-3 w-3" /> approval gate
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {step.instructions && (
                          <pre className="mt-2 ml-9 rounded bg-muted px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap overflow-y-auto flex-1" style={{ minHeight: 0 }}>
                            {step.instructions}
                          </pre>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Past executions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Execution History ({executions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {executions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No executions yet.</p>
              ) : (
                <div className="space-y-1">
                  {executions.map((exec) => (
                    <ExecutionHistoryRow
                      key={exec.id}
                      exec={exec}
                      onSelect={() => setActiveExecutionId(exec.id)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart2 className="h-4 w-4" />
                Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Executions</span>
                <span className="font-medium">{runbook.stats.executions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Success rate</span>
                <span className="font-medium">{successRate !== null ? `${successRate}%` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg duration</span>
                <span className="font-medium">
                  {runbook.stats.avg_duration_seconds != null
                    ? `${runbook.stats.avg_duration_seconds}s`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last run</span>
                <span className="font-medium">
                  {runbook.stats.last_executed_at
                    ? formatDistanceToNow(new Date(runbook.stats.last_executed_at), { addSuffix: true })
                    : 'Never'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category</span>
                <span className="font-medium capitalize">{runbook.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Author</span>
                <span className="font-medium">{runbook.author.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AI generated</span>
                <span className="font-medium">{runbook.ai_generated ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="font-medium">
                  {formatDistanceToNow(new Date(runbook.updated_at), { addSuffix: true })}
                </span>
              </div>
              {runbook.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {runbook.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Version history */}
          <Card>
            <CardHeader className="pb-3">
              <button
                onClick={() => setShowVersions(!showVersions)}
                className="flex w-full items-center justify-between"
              >
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4" />
                  Version History ({runbook.version_history_count})
                </CardTitle>
                {showVersions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </CardHeader>
            {showVersions && (
              <CardContent>
                {!versionsData?.history.length ? (
                  <p className="text-xs text-muted-foreground">No previous versions.</p>
                ) : (
                  <div className="space-y-2">
                    {versionsData.history.map((v) => (
                      <div key={v.version} className="rounded border border-border px-2.5 py-2">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium">v{v.version}</span>
                          <span className="text-muted-foreground">
                            {v.changed_at ? format(new Date(v.changed_at), 'MMM d, HH:mm') : '—'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{v.step_count} steps{v.change_note ? ` · ${v.change_note}` : ''}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      {/* Execute dialog */}
      {showExecute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-card-foreground">Execute Runbook</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Running <span className="font-medium text-foreground">{runbook.title}</span> (v{runbook.version}) with {runbook.steps.length} steps.
            </p>
            {runbook.variables.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium text-foreground">Variables</p>
                {runbook.variables.map((v) => (
                  <div key={v.name} className="space-y-1">
                    <label className="text-xs text-muted-foreground">{v.name}{v.required && ' *'}</label>
                    <input
                      className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder={v.default_value || v.description || v.name}
                      value={execVariables[v.name] ?? v.default_value}
                      onChange={(e) => setExecVariables((prev) => ({ ...prev, [v.name]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowExecute(false)}>Cancel</Button>
              <Button onClick={handleExecute} disabled={startMutation.isPending}>
                {startMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</> : <><Play className="mr-2 h-4 w-4" />Start Execution</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
