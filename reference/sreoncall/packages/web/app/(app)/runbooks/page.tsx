'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, BookOpen, Plus, Clock, Tag, FileText, Pencil, Trash2,
  Loader2, Play, ChevronDown, ChevronUp, GripVertical, Paperclip, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useRunbooks,
  useCreateRunbook,
  useUpdateRunbook,
  useDeleteRunbook,
  type Runbook as RunbookItem,
  type RunbookStep,
  type StepType,
} from '@/lib/hooks/useRunbooks';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_TYPES: { value: StepType; label: string; description: string }[] = [
  { value: 'manual',            label: 'Manual',            description: 'Human operator performs the step' },
  { value: 'bash_script',       label: 'Bash Script',       description: 'Execute a shell command or script' },
  { value: 'api_call',          label: 'API Call',          description: 'Make an HTTP request to an endpoint' },
  { value: 'ansible_playbook',  label: 'Ansible Playbook',  description: 'Run an Ansible playbook' },
];

const CATEGORIES = ['general', 'incident_response', 'deployment', 'database', 'networking', 'security', 'monitoring'];

// ─── Step editor ──────────────────────────────────────────────────────────────

interface StepAttachment {
  file_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

interface StepFormData {
  title: string;
  type: StepType;
  instructions: string;
  requires_approval: boolean;
  attachments: StepAttachment[];
  pendingFiles?: File[];
}

function StepEditor({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: StepFormData;
  index: number;
  total: number;
  onChange: (updated: StepFormData) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <div className="rounded-lg border border-border bg-muted/30">
      {/* Step header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground w-5">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <Input
            placeholder="Step title…"
            value={step.title}
            onChange={(e) => onChange({ ...step, title: e.target.value })}
            className="h-7 text-sm border-0 bg-transparent p-0 focus-visible:ring-0 font-medium"
          />
        </div>
        <Badge variant="secondary" className="text-xs shrink-0">{step.type.replace('_', ' ')}</Badge>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Step body */}
      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          {/* Type selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Step Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {STEP_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onChange({ ...step, type: t.value })}
                  className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                    step.type === t.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/40'
                  }`}
                >
                  <div className="text-xs font-medium">{t.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5 leading-tight">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              {step.type === 'bash_script'
                ? 'Shell Commands'
                : step.type === 'api_call'
                ? 'API Details / curl command'
                : step.type === 'ansible_playbook'
                ? 'Playbook / Task Name'
                : 'Instructions'}
            </label>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={
                step.type === 'bash_script'
                  ? '#!/bin/bash\n# Your commands here\necho "Running step..."'
                  : step.type === 'api_call'
                  ? 'curl -X POST https://api.example.com/endpoint \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -d \'{"key":"value"}\''
                  : step.type === 'ansible_playbook'
                  ? 'playbook: site.yml\ntags: [deploy, migrate]'
                  : 'Describe the manual actions the operator should perform...'
              }
              value={step.instructions}
              onChange={(e) => onChange({ ...step, instructions: e.target.value })}
            />
          </div>

          {/* Approval gate */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={step.requires_approval}
              onChange={(e) => onChange({ ...step, requires_approval: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            <span className="text-xs text-foreground">Require approval before executing this step</span>
          </label>

          {/* Attachments */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Attachments</label>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.md,.log"
              className="hidden"
              id={`step-file-${index}`}
              onChange={(e) => {
                if (e.target.files) {
                  const files = Array.from(e.target.files);
                  onChange({ ...step, pendingFiles: [...(step.pendingFiles || []), ...files] });
                  e.target.value = '';
                }
              }}
            />
            <button
              type="button"
              onClick={() => document.getElementById(`step-file-${index}`)?.click()}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-input bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            >
              <Paperclip className="h-3 w-3" />
              Attach image or file
            </button>
            {/* Existing attachments */}
            {step.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {step.attachments.map((att) => (
                  <span key={att.file_id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                    {att.mime_type.startsWith('image/') ? '🖼' : '📎'} {att.original_name}
                    <button type="button" onClick={() => onChange({ ...step, attachments: step.attachments.filter((a) => a.file_id !== att.file_id) })} className="text-muted-foreground hover:text-destructive ml-1">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Pending files */}
            {step.pendingFiles && step.pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {step.pendingFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs text-primary">
                    {f.name} ({(f.size / 1024).toFixed(0)}KB)
                    <button type="button" onClick={() => onChange({ ...step, pendingFiles: step.pendingFiles?.filter((_, j) => j !== i) })} className="hover:text-destructive ml-1">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RunbookDialog ─────────────────────────────────────────────────────────────

interface RunbookFormData {
  title: string;
  description: string;
  category: string;
  tags: string;
  steps: StepFormData[];
}

function defaultStep(): StepFormData {
  return { title: '', type: 'manual', instructions: '', requires_approval: false, attachments: [] };
}

function stepsFromRunbook(runbook: RunbookItem | null | undefined): StepFormData[] {
  if (!runbook?.steps?.length) return [];
  return runbook.steps.map((s) => ({
    title: s.title,
    type: s.type,
    instructions: s.instructions,
    requires_approval: s.requires_approval,
    attachments: s.attachments || [],
  }));
}

function RunbookDialog({
  open,
  onClose,
  runbook,
}: {
  open: boolean;
  onClose: () => void;
  runbook?: RunbookItem | null;
}) {
  const isEdit = !!runbook;
  const createRunbook = useCreateRunbook();
  const updateRunbook = useUpdateRunbook();

  const [form, setForm] = useState<RunbookFormData>(() => ({
    title: runbook?.title ?? '',
    description: runbook?.description ?? '',
    category: runbook?.category ?? 'general',
    tags: runbook?.tags?.join(', ') ?? '',
    steps: stepsFromRunbook(runbook),
  }));

  // Reset form when runbook prop changes
  const [lastRunbook, setLastRunbook] = useState(runbook);
  if (runbook !== lastRunbook) {
    setLastRunbook(runbook);
    setForm({
      title: runbook?.title ?? '',
      description: runbook?.description ?? '',
      category: runbook?.category ?? 'general',
      tags: runbook?.tags?.join(', ') ?? '',
      steps: stepsFromRunbook(runbook),
    });
  }

  function addStep() {
    setForm((f) => ({ ...f, steps: [...f.steps, defaultStep()] }));
  }

  function updateStep(idx: number, updated: StepFormData) {
    setForm((f) => {
      const steps = [...f.steps];
      steps[idx] = updated;
      return { ...f, steps };
    });
  }

  function removeStep(idx: number) {
    setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setForm((f) => {
      const steps = [...f.steps];
      const target = idx + dir;
      if (target < 0 || target >= steps.length) return f;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...f, steps };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const steps = form.steps
      .filter((s) => s.title.trim())
      .map((s, i) => ({ ...s, order: i + 1 }));

    try {
      if (isEdit && runbook) {
        await updateRunbook.mutateAsync({
          id: runbook.id,
          input: {
            title: form.title.trim(),
            description: form.description.trim(),
            category: form.category,
            tags,
            steps,
          },
        });
        toast.success('Runbook updated');
      } else {
        await createRunbook.mutateAsync({
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          tags,
          steps,
        });
        toast.success('Runbook created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save runbook');
    }
  }

  const isPending = createRunbook.isPending || updateRunbook.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {isEdit ? 'Edit Runbook' : 'Create Runbook'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col space-y-4 overflow-y-auto flex-1 px-6 pb-6">
          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Title *</label>
            <Input
              placeholder="e.g., Database Failover Procedure"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <Input
              placeholder="Brief description of what this runbook covers"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Category + Tags row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Category</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Tags</label>
              <Input
                placeholder="database, failover, critical"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                Steps
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({form.steps.length} step{form.steps.length !== 1 ? 's' : ''})
                </span>
              </label>
              <Button type="button" variant="outline" size="sm" onClick={addStep}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Step
              </Button>
            </div>

            {form.steps.length === 0 ? (
              <div
                className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={addStep}
              >
                <Plus className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to add your first step</p>
                <p className="text-xs text-muted-foreground mt-1 opacity-70">
                  Steps define the sequence of actions in this runbook
                </p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto pr-1 -mr-1" style={{ maxHeight: '50vh' }}>
                {form.steps.map((step, idx) => (
                  <StepEditor
                    key={idx}
                    step={step}
                    index={idx}
                    total={form.steps.length}
                    onChange={(updated) => updateStep(idx, updated)}
                    onRemove={() => removeStep(idx)}
                    onMoveUp={() => moveStep(idx, -1)}
                    onMoveDown={() => moveStep(idx, 1)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-border mt-auto sticky bottom-0 bg-background">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Runbook'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function RunbooksPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editRunbook, setEditRunbook] = useState<RunbookItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useRunbooks({ search: search || undefined, tags: selectedTag || undefined });
  const deleteRunbook = useDeleteRunbook();

  const runbooks = data?.data ?? [];
  const allTags = [...new Set(runbooks.flatMap((r) => r.tags ?? []))].sort();

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteRunbook.mutateAsync(deleteId);
      toast.success('Runbook deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete runbook');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Runbooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational playbooks and procedures
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Runbook
        </Button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          containerClassName="flex-1 sm:max-w-xs"
          placeholder="Search runbooks..."
          value={search}
          onChange={setSearch}
        />
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <button
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !selectedTag
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              onClick={() => setSelectedTag('')}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedTag === tag
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                onClick={() => setSelectedTag(tag === selectedTag ? '' : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Runbook Grid */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : runbooks.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No runbooks found"
          description={
            search || selectedTag
              ? 'No runbooks match your search. Try different keywords or clear your filters.'
              : 'Create your first runbook to document operational procedures.'
          }
          actionLabel="Create Runbook"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {runbooks.map((runbook) => (
            <Card
              key={runbook.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => router.push(`/runbooks/${runbook.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <CardTitle className="text-base truncate">{runbook.title}</CardTitle>
                  </div>
                  <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setEditRunbook(runbook)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteId(runbook.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {runbook.description || 'No description'}
                </p>
                {runbook.category && runbook.category !== 'general' && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {runbook.category.replace(/_/g, ' ')}
                  </Badge>
                )}
                {runbook.tags && runbook.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {runbook.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(runbook.updated_at).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Play className="h-3 w-3" />
                      {runbook.stats?.executions ?? 0} runs
                    </span>
                    {runbook.steps?.length > 0 && (
                      <span className="text-muted-foreground">
                        {runbook.steps.length} step{runbook.steps.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <RunbookDialog
        open={showCreate || !!editRunbook}
        onClose={() => {
          setShowCreate(false);
          setEditRunbook(null);
        }}
        runbook={editRunbook}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Runbook"
        description="Are you sure you want to delete this runbook? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
