'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Play, RotateCcw, Ban, FileText, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { cn } from '@/lib/utils';
import { useUsers } from '@/lib/hooks/useUsers';
import {
  useChange,
  useSubmitChange,
  useApproveChange,
  useScheduleChange,
  useImplementChange,
  useCompleteChange,
  useRollbackChange,
  useCancelChange,
  useSubmitPir,
  useAddChangeNote,
  type ApprovalDecision,
  type PirOutcome,
  type RiskScore,
} from '@/lib/hooks/useChanges';

// ─── Constants ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskScore, string> = {
  low:      'bg-green-100 text-green-700 border-green-200',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_COLORS: Record<string, string> = {
  draft:            'bg-gray-100 text-gray-600 border-gray-200',
  submitted:        'bg-blue-50 text-blue-700 border-blue-200',
  pending_approval: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  approved:         'bg-green-50 text-green-700 border-green-200',
  rejected:         'bg-red-50 text-red-700 border-red-200',
  scheduled:        'bg-purple-50 text-purple-700 border-purple-200',
  in_progress:      'bg-orange-50 text-orange-700 border-orange-200',
  completed:        'bg-green-50 text-green-700 border-green-200',
  rolled_back:      'bg-red-50 text-red-700 border-red-200',
  cancelled:        'bg-gray-50 text-gray-500 border-gray-200',
  not_approved_by_cab: 'bg-red-50 text-red-700 border-red-200',
  implemented:         'bg-green-50 text-green-700 border-green-200',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChangeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const { data: cr, isLoading, error } = useChange(id);

  const submit     = useSubmitChange();
  const approve    = useApproveChange();
  const schedule   = useScheduleChange();
  const implement  = useImplementChange();
  const complete   = useCompleteChange();
  const rollback   = useRollbackChange();
  const cancel     = useCancelChange();
  const submitPir  = useSubmitPir();
  const { data: orgUsers = [] } = useUsers();
  const addNote = useAddChangeNote();
  const [noteText, setNoteText] = useState('');

  // Dialog state
  const [showApprove, setShowApprove]   = useState(false);
  const [approveDecision, setApproveDecision] = useState<ApprovalDecision>('approved');
  const [approveComment, setApproveComment]   = useState('');

  const [showSchedule, setShowSchedule] = useState(false);
  const [schedStart, setSchedStart]     = useState('');
  const [schedEnd, setSchedEnd]         = useState('');

  const [showRollback, setShowRollback] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');

  const [showPir, setShowPir]           = useState(false);
  const [pirOutcome, setPirOutcome]     = useState<PirOutcome>('successful');
  const [pirNotes, setPirNotes]         = useState('');

  const [conflictsExpanded, setConflictsExpanded] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSubmit() {
    try {
      await submit.mutateAsync(id);
      toast.success('Change request submitted');
    } catch { toast.error('Failed to submit'); }
  }

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    try {
      await approve.mutateAsync({ id, decision: approveDecision, comment: approveComment });
      toast.success(`Decision recorded: ${approveDecision}`);
      setShowApprove(false);
      setApproveComment('');
    } catch { toast.error('Failed to record decision'); }
  }

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    try {
      await schedule.mutateAsync({ id, start: schedStart, end: schedEnd });
      toast.success('Change scheduled');
      setShowSchedule(false);
    } catch { toast.error('Failed to schedule change'); }
  }

  async function handleImplement() {
    try {
      await implement.mutateAsync(id);
      toast.success('Implementation started');
    } catch { toast.error('Failed to start implementation'); }
  }

  async function handleComplete() {
    try {
      await complete.mutateAsync(id);
      toast.success('Change marked completed');
    } catch { toast.error('Failed to complete change'); }
  }

  async function handleRollback(e: React.FormEvent) {
    e.preventDefault();
    try {
      await rollback.mutateAsync({ id, reason: rollbackReason });
      toast.success('Change rolled back');
      setShowRollback(false);
    } catch { toast.error('Failed to rollback'); }
  }

  async function handleCancel() {
    try {
      await cancel.mutateAsync(id);
      toast.success('Change cancelled');
    } catch { toast.error('Failed to cancel'); }
  }

  async function handlePir(e: React.FormEvent) {
    e.preventDefault();
    try {
      await submitPir.mutateAsync({ id, outcome: pirOutcome, notes: pirNotes });
      toast.success('PIR submitted');
      setShowPir(false);
    } catch { toast.error('Failed to submit PIR'); }
  }

  // ── Loading / Error ────────────────────────────────────────────────────────

  if (isLoading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (error || !cr) return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-muted-foreground">Change request not found.</p>
      <Button variant="outline" onClick={() => router.push('/changes')}>Back to Changes</Button>
    </div>
  );

  const isDone      = ['completed', 'rolled_back', 'cancelled'].includes(cr.status);
  const canSubmit   = cr.status === 'draft';
  const canApprove  = cr.status === 'pending_approval';
  const canSchedule = ['approved', 'submitted'].includes(cr.status);
  const canImpl     = ['approved', 'scheduled'].includes(cr.status);
  const canComplete = cr.status === 'in_progress';
  const canRollback = ['in_progress', 'completed'].includes(cr.status);
  const canCancel   = !isDone && cr.status !== 'in_progress';
  const needsPir    = ['completed', 'rolled_back'].includes(cr.status) && cr.pir?.status === 'pending';

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/changes')}>
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Changes
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">CR-{String(cr.number).padStart(4, '0')}</span>
            <span className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium capitalize', STATUS_COLORS[cr.status])}>
              {cr.status.replace(/_/g, ' ')}
            </span>
            <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', RISK_COLORS[cr.risk.score])}>
              {cr.risk.score} risk
            </span>
            <span className="inline-flex rounded bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{cr.type}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{cr.title}</h1>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {canSubmit   && <Button size="sm" onClick={handleSubmit} disabled={submit.isPending}>{submit.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Submit for Approval</Button>}
          {canApprove  && <Button size="sm" onClick={() => setShowApprove(true)}><CheckCircle2 className="mr-1 h-4 w-4" />Decide</Button>}
          {canSchedule && <Button size="sm" variant="outline" onClick={() => setShowSchedule(true)}><Clock className="mr-1 h-4 w-4" />Schedule</Button>}
          {canImpl     && <Button size="sm" onClick={handleImplement} disabled={implement.isPending}><Play className="mr-1 h-4 w-4" />Implement</Button>}
          {canComplete && <Button size="sm" onClick={handleComplete} disabled={complete.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Complete</Button>}
          {canRollback && <Button size="sm" variant="outline" onClick={() => setShowRollback(true)}><RotateCcw className="mr-1 h-4 w-4" />Rollback</Button>}
          {needsPir    && <Button size="sm" onClick={() => setShowPir(true)}><FileText className="mr-1 h-4 w-4" />Submit PIR</Button>}
          {canCancel   && <Button size="sm" variant="outline" onClick={handleCancel} disabled={cancel.isPending}><Ban className="mr-1 h-4 w-4" />Cancel</Button>}
        </div>
      </div>

      {/* Conflict warnings */}
      {cr.ai_conflict_warnings.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <button
            className="flex w-full items-center justify-between text-sm font-medium text-orange-700"
            onClick={() => setConflictsExpanded(v => !v)}
          >
            <span>⚠ {cr.ai_conflict_warnings.length} scheduling conflict{cr.ai_conflict_warnings.length > 1 ? 's' : ''} detected</span>
            {conflictsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {conflictsExpanded && (
            <ul className="mt-2 space-y-1">
              {cr.ai_conflict_warnings.map((w, i) => (
                <li key={i} className="text-xs text-orange-600">• {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* PIR pending banner */}
      {needsPir && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          📋 Post-Implementation Review is pending. Please submit a PIR to close out this change.
        </div>
      )}

      {/* Body */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: main content */}
        <div className="space-y-6 lg:col-span-2">

          {/* Description */}
          <Card>
            <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-foreground">{cr.description || 'No description provided.'}</p>
            </CardContent>
          </Card>

          {/* Justification + Rollback Plan */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Justification</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-foreground">{cr.justification || 'Not provided.'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Rollback Plan</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-foreground">{cr.rollback_plan || 'Not provided.'}</p>
              </CardContent>
            </Card>
          </div>

          {/* Approval Chain */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Approval Chain
                {cr.approval_chain.length > 0 && (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Step {cr.current_step}/{cr.approval_chain.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cr.approval_chain.length === 0 ? (
                <p className="text-sm text-muted-foreground">No approval chain configured — change will auto-approve on submit.</p>
              ) : (
                <div className="space-y-4">
                  {cr.approval_chain.map((step) => {
                    const isActive    = step.step === cr.current_step;
                    const isCompleted = !!step.completed_at;
                    return (
                      <div
                        key={step.id}
                        className={cn('rounded-lg border p-4', isActive ? 'border-primary bg-primary/5' : isCompleted ? 'border-green-200 bg-green-50/50' : 'border-border')}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                              isCompleted ? 'bg-green-500 text-white' : isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            )}>
                              {isCompleted ? '✓' : step.step}
                            </span>
                            <span className="text-sm font-medium text-foreground">Step {step.step}</span>
                            <span className="text-xs text-muted-foreground capitalize">({step.type} · {step.required_approvals} required)</span>
                          </div>
                          {isActive && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Active</span>}
                        </div>

                        <div className="mt-3 space-y-2">
                          {step.approvers.map((a, i) => {
                            const decision = step.decisions.find((d) => d.user?.id === a.user?.id);
                            return (
                              <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <UserAvatar name={a.user?.name ?? '?'} size="sm" />
                                  <span className="text-sm text-foreground">{a.user?.name ?? a.user?.email ?? 'Unknown'}</span>
                                  {a.role && <span className="text-xs text-muted-foreground">({a.role})</span>}
                                </div>
                                {decision ? (
                                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                    decision.decision === 'approved' ? 'bg-green-100 text-green-700' :
                                    decision.decision === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                                  )}>
                                    {decision.decision}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Pending</span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {step.decisions.some(d => d.comment) && (
                          <div className="mt-2 border-t border-border pt-2 space-y-1">
                            {step.decisions.filter(d => d.comment).map((d, i) => (
                              <p key={i} className="text-xs text-muted-foreground">
                                <span className="font-medium">{d.user?.name}:</span> {d.comment}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* PIR */}
          {cr.pir && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Post-Implementation Review
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex gap-4">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase">Status</span>
                    <p className="mt-0.5 capitalize text-foreground">{cr.pir.status}</p>
                  </div>
                  {cr.pir.outcome && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase">Outcome</span>
                      <p className="mt-0.5 capitalize text-foreground">{cr.pir.outcome.replace(/_/g, ' ')}</p>
                    </div>
                  )}
                  {cr.pir.reviewed_by && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase">Reviewed by</span>
                      <p className="mt-0.5 text-foreground">{cr.pir.reviewed_by.name}</p>
                    </div>
                  )}
                </div>
                {cr.pir.notes && <p className="whitespace-pre-wrap text-muted-foreground">{cr.pir.notes}</p>}
              </CardContent>
            </Card>
          )}

          {/* Notes & Discussion */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Notes &amp; Discussion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(cr.notes ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(cr.notes ?? []).map((note, idx) => (
                    <div key={idx} className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={note.user?.name ?? '?'} size="sm" />
                        <span className="text-sm font-medium text-foreground">{note.user?.name ?? 'Unknown'}</span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                          note.type === 'comment' ? 'bg-blue-50 text-blue-700' :
                          note.type === 'state_change' ? 'bg-yellow-50 text-yellow-700' :
                          'bg-purple-50 text-purple-700'
                        )}>
                          {note.type.replace(/_/g, ' ')}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
              <div className="space-y-2">
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Add a note or comment..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!noteText.trim() || addNote.isPending}
                    onClick={async () => {
                      try {
                        await addNote.mutateAsync({ id, body: noteText.trim() });
                        setNoteText('');
                        toast.success('Note added');
                      } catch {
                        toast.error('Failed to add note');
                      }
                    }}
                  >
                    {addNote.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Add Note
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: details sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-xs font-medium uppercase text-muted-foreground">Created by</span>
                <div className="mt-1 flex items-center gap-2">
                  <UserAvatar name={cr.created_by?.name ?? '?'} size="sm" />
                  <span className="text-foreground">{cr.created_by?.name ?? 'Unknown'}</span>
                </div>
              </div>
              {cr.requester && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Requester</span>
                  <div className="mt-1 flex items-center gap-2">
                    <UserAvatar name={cr.requester.name ?? '?'} size="sm" />
                    <span className="text-foreground">{cr.requester.name ?? 'Unknown'}</span>
                  </div>
                </div>
              )}
              {cr.change_owner && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Change Owner</span>
                  <div className="mt-1 flex items-center gap-2">
                    <UserAvatar name={cr.change_owner.name ?? '?'} size="sm" />
                    <span className="text-foreground">{cr.change_owner.name ?? 'Unknown'}</span>
                  </div>
                </div>
              )}
              {cr.roll_out_date && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Roll Out Date</span>
                  <p className="mt-1 text-foreground">{format(new Date(cr.roll_out_date), 'MMM d, yyyy')}</p>
                </div>
              )}
              <div>
                <span className="text-xs font-medium uppercase text-muted-foreground">Created</span>
                <p className="mt-1 text-foreground">{formatDistanceToNow(new Date(cr.created_at), { addSuffix: true })}</p>
              </div>
              {cr.implementation_window && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Implementation Window</span>
                  <p className="mt-1 text-foreground text-xs">
                    {format(new Date(cr.implementation_window.start), 'MMM d, HH:mm')} →{' '}
                    {format(new Date(cr.implementation_window.end), 'MMM d, HH:mm')}
                  </p>
                  <p className="text-xs text-muted-foreground">{cr.implementation_window.timezone}</p>
                </div>
              )}
              {cr.scheduled_at && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Scheduled</span>
                  <p className="mt-1 text-foreground">{formatDistanceToNow(new Date(cr.scheduled_at), { addSuffix: true })}</p>
                </div>
              )}
              {cr.implemented_at && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Implementation Started</span>
                  <p className="mt-1 text-foreground">{formatDistanceToNow(new Date(cr.implemented_at), { addSuffix: true })}</p>
                </div>
              )}
              {cr.completed_at && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Completed</span>
                  <p className="mt-1 text-foreground">{formatDistanceToNow(new Date(cr.completed_at), { addSuffix: true })}</p>
                </div>
              )}
              {cr.labels.length > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Labels</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cr.labels.map((l) => (
                      <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{l}</span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Risk details */}
          <Card>
            <CardHeader><CardTitle className="text-base">Risk Assessment</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Score</span>
                <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', RISK_COLORS[cr.risk.score])}>
                  {cr.risk.score}
                </span>
              </div>
              {cr.risk.ai_score && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">AI Score</span>
                  <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', RISK_COLORS[cr.risk.ai_score])}>
                    {cr.risk.ai_score}
                  </span>
                </div>
              )}
              {cr.risk.blast_radius_description && (
                <p className="text-xs text-muted-foreground">{cr.risk.blast_radius_description}</p>
              )}
              {cr.risk.factors.length > 0 && (
                <ul className="space-y-0.5">
                  {cr.risk.factors.map((f, i) => <li key={i} className="text-xs text-muted-foreground">• {f}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}

      {/* Approve/Reject */}
      <Dialog open={showApprove} onClose={() => setShowApprove(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowApprove(false)} />
          <DialogHeader><DialogTitle>Submit Decision</DialogTitle></DialogHeader>
          <form onSubmit={handleApprove} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Decision</label>
              <Select value={approveDecision} onChange={(e) => setApproveDecision(e.target.value as ApprovalDecision)}>
                <option value="approved">Approve</option>
                <option value="rejected">Reject</option>
                <option value="abstained">Abstain</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Comment (optional)</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Reason for your decision..."
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowApprove(false)}>Cancel</Button>
              <Button type="submit" variant={approveDecision === 'rejected' ? 'destructive' : 'default'} disabled={approve.isPending}>
                {approve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit Decision
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Schedule */}
      <Dialog open={showSchedule} onClose={() => setShowSchedule(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowSchedule(false)} />
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Clock className="h-4 w-4" />Schedule Implementation</DialogTitle></DialogHeader>
          <form onSubmit={handleSchedule} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Start time *</label>
              <Input type="datetime-local" value={schedStart} onChange={(e) => setSchedStart(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">End time *</label>
              <Input type="datetime-local" value={schedEnd} onChange={(e) => setSchedEnd(e.target.value)} required />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowSchedule(false)}>Cancel</Button>
              <Button type="submit" disabled={schedule.isPending || !schedStart || !schedEnd}>
                {schedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Schedule
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rollback */}
      <Dialog open={showRollback} onClose={() => setShowRollback(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowRollback(false)} />
          <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="h-4 w-4 text-destructive" />Rollback Change</DialogTitle></DialogHeader>
          <form onSubmit={handleRollback} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Reason *</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Why is this change being rolled back?"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowRollback(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={rollback.isPending || !rollbackReason.trim()}>
                {rollback.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Rollback
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* PIR */}
      <Dialog open={showPir} onClose={() => setShowPir(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowPir(false)} />
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" />Post-Implementation Review</DialogTitle></DialogHeader>
          <form onSubmit={handlePir} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Outcome *</label>
              <Select value={pirOutcome} onChange={(e) => setPirOutcome(e.target.value as PirOutcome)}>
                <option value="successful">Successful</option>
                <option value="partial_success">Partial Success</option>
                <option value="failed">Failed</option>
                <option value="rolled_back">Rolled Back</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Notes / Lessons Learned</label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What went well? What could be improved? Lessons learned..."
                value={pirNotes}
                onChange={(e) => setPirNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowPir(false)}>Cancel</Button>
              <Button type="submit" disabled={submitPir.isPending}>
                {submitPir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit PIR
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
