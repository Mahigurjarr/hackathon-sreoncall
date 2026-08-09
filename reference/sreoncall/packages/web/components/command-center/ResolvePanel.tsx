'use client';

import { useState } from 'react';
import {
  Bot,
  Loader2,
  Wrench,
  CheckCircle2,
  Circle,
  Copy,
  Check,
  SkipForward,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  BookOpen,
  Sparkles,
  ArrowRight,
  Activity,
  BarChart3,
  Globe,
  FlaskConical,
  Network,
  MinusCircle,
  StickyNote,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { ValidationEntry, ValidationCheckType } from '@/lib/hooks/useResolution';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface ResolutionStep {
  id: string;
  title: string;
  description?: string | null;
  source: 'runbook' | 'ai' | 'similar_incident' | 'engineer_added';
  suggested_command?: string;
  status: 'pending' | 'completed' | 'skipped';
  completed_by?: string;
  skip_reason?: string;
  notes?: string | null;
}

interface ValidationCheck {
  name: string;
  passed: boolean;
}

interface ResolutionPlan {
  root_cause: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  alternative_causes?: string[];
  steps: ResolutionStep[];
  validation_checks?: ValidationCheck[];
  validation_note?: string;
}

interface ResolvePanelPending {
  creating: boolean;
  updatingStepId: string | null;
  savingNoteStepId: string | null;
  deletingStepId: string | null;
  validating: boolean;
  rediagnosing: boolean;
  confirming: boolean;
  addingStep: boolean;
}

interface ResolvePanelProps {
  plan: ResolutionPlan | null;
  readOnly: boolean;
  onCreatePlan: () => void;
  onCompleteStep: (stepId: string) => void;
  onSkipStep: (stepId: string, reason: string) => void;
  onTriggerValidation: () => void;
  onRediagnose: () => void;
  onConfirmResolution: () => void;
  onAddStep?: (title: string) => void;
  onDeleteStep?: (stepId: string) => void;
  onSaveNote?: (stepId: string, notes: string, onSuccess: () => void) => void;
  pending?: Partial<ResolvePanelPending>;
  validationEntries?: ValidationEntry[];
}

// ─── Check type config ────────────────────────────────────────────────────────

const checkTypeConfig: Record<ValidationCheckType, { label: string; icon: React.ElementType }> = {
  health_endpoint:   { label: 'Health',     icon: Activity },
  metric_threshold:  { label: 'Metric',     icon: BarChart3 },
  synthetic_monitor: { label: 'Synthetic',  icon: Globe },
  tenant_e2e:        { label: 'E2E',        icon: FlaskConical },
  dependency_health: { label: 'Dependency', icon: Network },
};

const entryStatusConfig = {
  passed:  { label: 'All Passed',   variant: 'success'     as const, color: '#16A34A' },
  partial: { label: 'Partial Pass', variant: 'warning'     as const, color: '#D97706' },
  failed:  { label: 'All Failed',   variant: 'destructive' as const, color: '#DC2626' },
  running: { label: 'Running…',     variant: 'secondary'   as const, color: '#2563EB' },
};

// ─── Validation detail section ────────────────────────────────────────────────

function ValidationSection({
  entries,
  readOnly,
  onTriggerValidation,
  isValidating,
}: {
  entries: ValidationEntry[];
  readOnly: boolean;
  onTriggerValidation: () => void;
  isValidating: boolean;
}) {
  const latest = entries.length > 0
    ? [...entries].sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime())[0]
    : null;

  const statusCfg = latest ? entryStatusConfig[latest.status] : null;

  return (
    <Card>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#16A34A]" />
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              Validation
            </span>
            {statusCfg && (
              <Badge variant={statusCfg.variant} className="text-[9px]">
                {statusCfg.label}
              </Badge>
            )}
            {entries.length > 1 && (
              <span className="text-[10px] text-[#94A3B8]">
                attempt {latest?.iteration ?? entries.length}/{entries.length}
              </span>
            )}
          </div>
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onTriggerValidation}
              disabled={isValidating}
              className="h-[28px] text-[11px]"
            >
              {isValidating
                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                : <RefreshCw className="w-3 h-3 mr-1" />}
              {isValidating ? 'Checking…' : 'Re-check'}
            </Button>
          )}
        </div>

        {/* No validation run yet */}
        {!latest ? (
          <p className="text-[12px] text-[#94A3B8]">No validation run yet.</p>
        ) : (
          <>
            {/* Per-check rows */}
            <div className="space-y-1.5">
              {latest.checks.map((check, i) => {
                const typeCfg = checkTypeConfig[check.type] ?? { label: check.type, icon: ShieldCheck };
                const TypeIcon = typeCfg.icon;

                const statusDot: Record<string, string> = {
                  passed:  '#16A34A',
                  failed:  '#DC2626',
                  skipped: '#94A3B8',
                  running: '#2563EB',
                };
                const bgClass: Record<string, string> = {
                  passed:  'bg-[#F0FDF4] dark:bg-green-950/20',
                  failed:  'bg-[#FEF2F2] dark:bg-red-950/20',
                  skipped: 'bg-[#F8FAFC] dark:bg-navy-elevated/40',
                  running: 'bg-[#EFF6FF] dark:bg-blue-950/20',
                };

                return (
                  <div
                    key={i}
                    className={cn(
                      'rounded-[6px] px-2.5 py-2',
                      bgClass[check.status] ?? bgClass.skipped,
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {/* Status dot */}
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: statusDot[check.status] ?? '#94A3B8' }}
                      />
                      <div className="flex-1 min-w-0">
                        {/* Name + type badge */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-medium text-foreground leading-tight">
                            {check.name}
                          </span>
                          <span className="inline-flex items-center gap-0.5 rounded-[3px] bg-white/60 dark:bg-navy-elevated/60 px-1 py-0.5 text-[9px] font-medium text-[#64748B]">
                            <TypeIcon className="h-2.5 w-2.5" />
                            {typeCfg.label}
                          </span>
                          {check.status === 'skipped' && (
                            <MinusCircle className="h-3 w-3 text-[#94A3B8]" />
                          )}
                          {check.status === 'running' && (
                            <Loader2 className="h-3 w-3 text-[#2563EB] animate-spin" />
                          )}
                        </div>
                        {/* Details */}
                        {check.details && (
                          <p className="mt-0.5 text-[11px] text-[#64748B] leading-snug font-mono">
                            {check.details}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* AI failure analysis */}
            {latest.ai_analysis_of_failure && (
              <div className="mt-3 flex items-start gap-1.5 rounded-[6px] bg-[#F5F3FF] dark:bg-purple-950/20 p-2.5">
                <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#7C3AED]" />
                <p className="text-[11px] text-[#7C3AED] leading-relaxed">
                  {latest.ai_analysis_of_failure}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

const sourceConfig: Record<
  ResolutionStep['source'],
  { label: string; color: 'info' | 'ai' | 'warning' | 'secondary'; icon: React.ElementType }
> = {
  runbook:          { label: 'Runbook', color: 'info',      icon: BookOpen },
  ai:               { label: 'AI',      color: 'ai',        icon: Sparkles },
  similar_incident: { label: 'Similar', color: 'warning',   icon: ArrowRight },
  engineer_added:   { label: 'Manual',  color: 'secondary', icon: Pencil },
};

const confidenceConfig = {
  high: { label: 'High Confidence', variant: 'success' as const },
  medium: { label: 'Medium Confidence', variant: 'warning' as const },
  low: { label: 'Low Confidence', variant: 'destructive' as const },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1 rounded-[4px] text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors"
      title="Copy command"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function SkipDialog({
  onSkip,
  onCancel,
  isPending,
}: {
  onSkip: (reason: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for skipping..."
        disabled={isPending}
        className="flex-1 h-[30px] px-2.5 text-[12px] rounded-[6px] border border-border bg-background text-foreground placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B] disabled:opacity-50"
        autoFocus
      />
      <Button size="sm" variant="ghost" onClick={() => onSkip(reason || 'No reason given')} disabled={isPending} className="h-[30px] text-[11px]">
        {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending} className="h-[30px] text-[11px]">
        Cancel
      </Button>
    </div>
  );
}

export function ResolvePanel({
  plan,
  readOnly,
  onCreatePlan,
  onCompleteStep,
  onSkipStep,
  onTriggerValidation,
  onRediagnose,
  onConfirmResolution,
  onAddStep,
  onDeleteStep,
  onSaveNote,
  pending = {},
  validationEntries = [],
}: ResolvePanelProps) {
  const [skippingStepId, setSkippingStepId] = useState<string | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [editingNoteStepId, setEditingNoteStepId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-14 h-14 rounded-full bg-[#FF6B2B]/10 flex items-center justify-center mb-4">
          <Wrench className="w-7 h-7 text-[#FF6B2B]" />
        </div>
        <h3 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Need help fixing this?
        </h3>
        <p className="text-[12px] text-[#64748B] dark:text-[#94A3B8] mb-5 text-center max-w-[300px]">
          Let AI analyze the incident, identify root cause, and generate a step-by-step resolution plan.
        </p>
        <Button onClick={onCreatePlan} disabled={pending.creating}>
          {pending.creating
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : <Bot className="w-4 h-4 mr-2" />}
          {pending.creating ? 'Analyzing…' : 'Generate Resolution Plan'}
        </Button>
      </div>
    );
  }

  const completedSteps = plan.steps.filter((s) => s.status === 'completed').length;
  const allStepsDone = plan.steps.every((s) => s.status !== 'pending');
  const conf = confidenceConfig[plan.confidence];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* LEFT COLUMN — Diagnosis + Validation */}
      <div className="lg:col-span-2 space-y-4">
        {/* AI Diagnosis */}
        <Card className="border-l-4 border-l-[#7C3AED] bg-[#F5F3FF] dark:bg-[#7C3AED]/5">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-[#7C3AED]" />
              </div>
              <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                AI Diagnosis
              </span>
              <Badge variant={conf.variant}>{conf.label}</Badge>
            </div>

            <div className="bg-white dark:bg-navy-surface rounded-[8px] p-3 border border-[#E2E8F0] dark:border-[#1E293B]">
              <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1">
                Root Cause
              </p>
              <p className="text-[13px] text-gray-900 dark:text-gray-100 leading-relaxed">
                {plan.root_cause}
              </p>
            </div>

            {/* Evidence tags */}
            {plan.evidence.length > 0 && (
              <div className="mt-3">
                <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1.5">
                  Evidence
                </p>
                <div className="flex flex-wrap gap-1">
                  {plan.evidence.map((ev, i) => (
                    <Badge key={i} variant="secondary" className="text-[9px] font-normal">
                      {ev}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Low confidence — alternative causes */}
            {plan.confidence === 'low' && plan.alternative_causes && plan.alternative_causes.length > 0 && (
              <div className="mt-3 rounded-[8px] bg-[#FEF2F2] dark:bg-red-950/20 p-3 border border-[#FECACA]/50">
                <p className="text-[9px] uppercase tracking-wide font-medium text-[#DC2626] mb-1.5">
                  Alternative Causes
                </p>
                <ul className="space-y-1">
                  {plan.alternative_causes.map((cause, i) => (
                    <li key={i} className="text-[12px] text-[#DC2626] flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      {cause}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>

        {/* Validation Results — always rendered once a plan exists */}
        <ValidationSection
          entries={validationEntries}
          readOnly={readOnly}
          onTriggerValidation={onTriggerValidation}
          isValidating={!!pending.validating}
        />

        {/* Action buttons */}
        {!readOnly && allStepsDone && (
          <div className="flex flex-col gap-2">
            <Button onClick={onConfirmResolution} disabled={pending.confirming || pending.validating} className="w-full">
              {pending.confirming
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {pending.confirming ? 'Confirming…' : 'Confirm Resolution'}
            </Button>
            <Button variant="outline" onClick={onRediagnose} disabled={pending.rediagnosing || pending.confirming} className="w-full">
              {pending.rediagnosing
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-2" />}
              {pending.rediagnosing ? 'Re-diagnosing…' : 'Re-diagnose'}
            </Button>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN — Steps */}
      <div className="lg:col-span-3">
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                  Resolution Steps
                </span>
                <span className="text-[11px] text-[#64748B] font-mono">
                  {completedSteps}/{plan.steps.length}
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-24 h-1.5 rounded-full bg-[#E2E8F0] dark:bg-navy-elevated overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#16A34A] transition-all duration-300"
                  style={{ width: `${(completedSteps / plan.steps.length) * 100}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              {plan.steps.map((step, index) => {
                const src = sourceConfig[step.source];
                const SrcIcon = src.icon;
                const isDone = step.status === 'completed';
                const isSkipped = step.status === 'skipped';

                return (
                  <div
                    key={step.id}
                    className={cn(
                      'rounded-[8px] border p-3 transition-colors',
                      isDone
                        ? 'border-[#BBF7D0] bg-[#F0FDF4] dark:bg-green-950/10 dark:border-green-900/30'
                        : isSkipped
                          ? 'border-[#E2E8F0] bg-[#F8FAFC] dark:bg-navy-elevated/50 dark:border-[#1E293B] opacity-60'
                          : 'border-border bg-card dark:bg-navy-surface',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Step number / status circle */}
                      <div className="flex-shrink-0 mt-0.5">
                        {isDone ? (
                          <div className="w-6 h-6 rounded-full bg-[#16A34A] flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white" />
                          </div>
                        ) : isSkipped ? (
                          <div className="w-6 h-6 rounded-full bg-[#94A3B8] flex items-center justify-center">
                            <SkipForward className="w-3 h-3 text-white" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full border-2 border-[#94A3B8] flex items-center justify-center">
                            <span className="text-[10px] font-bold text-[#94A3B8]">{index + 1}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Title + source badge */}
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              'text-[13px] font-medium',
                              isDone
                                ? 'text-[#16A34A] line-through'
                                : isSkipped
                                  ? 'text-[#94A3B8] line-through'
                                  : 'text-gray-900 dark:text-gray-100',
                            )}
                          >
                            {step.title}
                          </span>
                          <Badge variant={src.color} className="text-[8px] gap-0.5">
                            <SrcIcon className="w-2.5 h-2.5" />
                            {src.label}
                          </Badge>
                        </div>

                        {/* Description — the "why" behind the step */}
                        {step.description && (
                          <p className={cn(
                            'mt-1 text-[12px] leading-relaxed',
                            isDone || isSkipped ? 'text-[#94A3B8]' : 'text-[#64748B]',
                          )}>
                            {step.description}
                          </p>
                        )}

                        {/* Suggested command */}
                        {step.suggested_command && (
                          <div className="relative mt-2 rounded-[6px] bg-[#0D1117] p-2.5 pr-8 font-mono text-[11px] text-[#E2E8F0] leading-relaxed overflow-x-auto">
                            <code>{step.suggested_command}</code>
                            <CopyButton text={step.suggested_command} />
                          </div>
                        )}

                        {/* Completed by */}
                        {isDone && step.completed_by && (
                          <p className="mt-1.5 text-[10px] text-[#16A34A]">
                            Completed by {step.completed_by}
                          </p>
                        )}

                        {/* Skipped reason */}
                        {isSkipped && step.skip_reason && (
                          <p className="mt-1.5 text-[10px] text-[#94A3B8]">
                            Skipped: {step.skip_reason}
                          </p>
                        )}

                        {/* Step notes — editable on any status when !readOnly */}
                        {!readOnly && onSaveNote && (
                          editingNoteStepId === step.id ? (
                            <div className="mt-2 space-y-1.5">
                              <textarea
                                value={editingNoteText}
                                onChange={(e) => setEditingNoteText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    setEditingNoteStepId(null);
                                    setEditingNoteText('');
                                  }
                                }}
                                placeholder="Add a note for this step…"
                                rows={3}
                                autoFocus
                                className="w-full rounded-[6px] border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B] resize-none"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-[26px] px-2.5 text-[11px]"
                                  disabled={pending.savingNoteStepId === step.id}
                                  onClick={() => {
                                    onSaveNote(step.id, editingNoteText.trim(), () => {
                                      setEditingNoteStepId(null);
                                      setEditingNoteText('');
                                    });
                                  }}
                                >
                                  {pending.savingNoteStepId === step.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : 'Save note'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-[26px] px-2.5 text-[11px] text-[#64748B]"
                                  onClick={() => {
                                    setEditingNoteStepId(null);
                                    setEditingNoteText('');
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-1.5">
                              {step.notes ? (
                                <div className="flex items-start gap-1.5 group">
                                  <StickyNote className="w-3 h-3 mt-0.5 shrink-0 text-[#94A3B8]" />
                                  <p className="text-[11px] text-[#64748B] leading-snug flex-1 italic">
                                    {step.notes}
                                  </p>
                                  <button
                                    onClick={() => {
                                      setEditingNoteStepId(step.id);
                                      setEditingNoteText(step.notes ?? '');
                                    }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Edit note"
                                  >
                                    <Pencil className="w-3 h-3 text-[#94A3B8] hover:text-[#FF6B2B]" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingNoteStepId(step.id);
                                    setEditingNoteText('');
                                  }}
                                  className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#FF6B2B] transition-colors"
                                >
                                  <StickyNote className="w-3 h-3" />
                                  Add note
                                </button>
                              )}
                            </div>
                          )
                        )}
                        {/* Read-only: show notes if they exist */}
                        {readOnly && step.notes && (
                          <div className="mt-1.5 flex items-start gap-1.5">
                            <StickyNote className="w-3 h-3 mt-0.5 shrink-0 text-[#94A3B8]" />
                            <p className="text-[11px] text-[#64748B] leading-snug italic">{step.notes}</p>
                          </div>
                        )}

                        {/* Action buttons */}
                        {!readOnly && step.status === 'pending' && (
                          <>
                            {skippingStepId === step.id ? (
                              <SkipDialog
                                onSkip={(reason) => {
                                  onSkipStep(step.id, reason);
                                  setSkippingStepId(null);
                                }}
                                onCancel={() => setSkippingStepId(null)}
                                isPending={pending.updatingStepId === step.id}
                              />
                            ) : (
                              <div className="flex items-center gap-2 mt-2">
                                <Button
                                  size="sm"
                                  onClick={() => onCompleteStep(step.id)}
                                  disabled={pending.updatingStepId === step.id}
                                  className="h-[28px] text-[11px]"
                                >
                                  {pending.updatingStepId === step.id
                                    ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    : <Play className="w-3 h-3 mr-1" />}
                                  Complete
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSkippingStepId(step.id)}
                                  disabled={pending.updatingStepId === step.id}
                                  className="h-[28px] text-[11px] text-[#64748B]"
                                >
                                  <SkipForward className="w-3 h-3 mr-1" />
                                  Skip
                                </Button>
                                {step.source === 'engineer_added' && onDeleteStep && (
                                  <button
                                    onClick={() => onDeleteStep(step.id)}
                                    disabled={pending.deletingStepId === step.id}
                                    title="Delete this step"
                                    className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-md text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors disabled:opacity-50"
                                  >
                                    {pending.deletingStepId === step.id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <Trash2 className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add custom step — only shown when !readOnly and onAddStep is wired */}
              {!readOnly && onAddStep && (
                addingStep ? (
                  <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-[#FF6B2B]/50 bg-[#FFF7ED] dark:bg-orange-950/10 px-3 py-2">
                    <input
                      type="text"
                      value={newStepTitle}
                      onChange={(e) => setNewStepTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newStepTitle.trim()) {
                          onAddStep(newStepTitle.trim());
                          setNewStepTitle('');
                          setAddingStep(false);
                        }
                        if (e.key === 'Escape') {
                          setNewStepTitle('');
                          setAddingStep(false);
                        }
                      }}
                      placeholder="Step title..."
                      autoFocus
                      className="flex-1 h-[28px] bg-transparent text-[12px] text-foreground placeholder:text-[#94A3B8] focus:outline-none"
                    />
                    <Button
                      size="sm"
                      className="h-[26px] px-2.5 text-[11px]"
                      disabled={!newStepTitle.trim() || pending.addingStep}
                      onClick={() => {
                        if (newStepTitle.trim()) {
                          onAddStep(newStepTitle.trim());
                          setNewStepTitle('');
                          setAddingStep(false);
                        }
                      }}
                    >
                      {pending.addingStep ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-[26px] px-2.5 text-[11px] text-[#64748B]"
                      onClick={() => { setNewStepTitle(''); setAddingStep(false); }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingStep(true)}
                    className="flex items-center gap-1.5 w-full rounded-[8px] border border-dashed border-[#E2E8F0] dark:border-[#1E293B] px-3 py-2 text-[12px] text-[#94A3B8] hover:border-[#FF6B2B]/50 hover:text-[#FF6B2B] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add custom step
                  </button>
                )
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
