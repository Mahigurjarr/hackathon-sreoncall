'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Loader2,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { usePostMortem, useUpdatePostMortem, usePublishPostMortem, useDeletePostMortem } from '@/lib/hooks/usePostMortems';
import { cn } from '@/lib/utils';

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  'in-review': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function PostMortemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: pm, isLoading } = usePostMortem(id);
  const updatePM = useUpdatePostMortem();
  const publishPM = usePublishPostMortem();
  const deletePM = useDeletePostMortem();

  const [showDelete, setShowDelete] = useState(false);

  // Editable fields
  const [summary, setSummary] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);

  // Timeline
  const [newTimelineTime, setNewTimelineTime] = useState('');
  const [newTimelineDesc, setNewTimelineDesc] = useState('');

  // Contributing factors
  const [newFactor, setNewFactor] = useState('');

  // Action items
  const [newActionDesc, setNewActionDesc] = useState('');

  // Initialize edit state when PM loads (only once)
  const [initialized, setInitialized] = useState(false);
  if (pm && !initialized) {
    setSummary(pm.summary || '');
    setRootCause(pm.root_cause || '');
    setInitialized(true);
  }

  async function saveField(field: string, value: any) {
    setSavingField(field);
    try {
      await updatePM.mutateAsync({ id, input: { [field]: value } });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    } finally {
      setSavingField(null);
    }
  }

  async function addTimelineEntry() {
    if (!newTimelineTime || !newTimelineDesc) return;
    const entry = { time: newTimelineTime, description: newTimelineDesc };
    const current = pm?.timeline ?? [];
    const updated = [...current, entry].sort((a, b) => a.time.localeCompare(b.time));
    await saveField('timeline', updated);
    setNewTimelineTime('');
    setNewTimelineDesc('');
  }

  async function removeTimelineEntry(index: number) {
    const updated = (pm?.timeline ?? []).filter((_, i) => i !== index);
    await saveField('timeline', updated);
  }

  async function addFactor() {
    if (!newFactor.trim()) return;
    const updated = [...(pm?.contributing_factors ?? []), newFactor.trim()];
    await saveField('contributing_factors', updated);
    setNewFactor('');
  }

  async function removeFactor(index: number) {
    const updated = (pm?.contributing_factors ?? []).filter((_, i) => i !== index);
    await saveField('contributing_factors', updated);
  }

  async function addActionItem() {
    if (!newActionDesc.trim()) return;
    const item = { description: newActionDesc.trim(), status: 'open' as const };
    const updated = [...(pm?.action_items ?? []), item];
    await saveField('action_items', updated);
    setNewActionDesc('');
  }

  async function toggleActionStatus(index: number) {
    const items = [...(pm?.action_items ?? [])];
    const item = items[index];
    items[index] = {
      ...item,
      status: item.status === 'done' ? 'open' : 'done',
    };
    await saveField('action_items', items);
  }

  async function removeActionItem(index: number) {
    const updated = (pm?.action_items ?? []).filter((_, i) => i !== index);
    await saveField('action_items', updated);
  }

  async function handlePublish() {
    try {
      await publishPM.mutateAsync(id);
      toast.success('Post-mortem published');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to publish');
    }
  }

  async function handleDelete() {
    try {
      await deletePM.mutateAsync(id);
      toast.success('Post-mortem deleted');
      router.push('/postmortems');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete');
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!pm) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Post-mortem not found</p>
        <Button variant="outline" onClick={() => router.push('/postmortems')}>
          Back to Post-Mortems
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            className="mb-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => router.push('/postmortems')}
          >
            <ArrowLeft className="h-4 w-4" />
            Post-Mortems
          </button>
          <h1 className="text-2xl font-bold text-foreground">{pm.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                severityColors[pm.severity],
              )}
            >
              {pm.severity}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                statusColors[pm.status],
              )}
            >
              {pm.status}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {pm.author?.name}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(pm.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {pm.status !== 'published' && (
            <Button onClick={handlePublish} disabled={publishPM.isPending}>
              {publishPM.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Publish
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowDelete(true)} className="text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Describe what happened and its impact..."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => summary !== pm.summary && saveField('summary', summary)}
          />
          {savingField === 'summary' && (
            <p className="text-xs text-muted-foreground">Saving...</p>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pm.timeline && pm.timeline.length > 0 ? (
            <div className="space-y-3 border-l-2 border-border pl-4">
              {pm.timeline.map((entry, i) => (
                <div key={i} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {new Date(entry.time).toLocaleString()}
                    </p>
                    <p className="text-sm text-foreground">{entry.description}</p>
                  </div>
                  <button
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeTimelineEntry(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No timeline entries yet.</p>
          )}
          <div className="flex gap-2">
            <Input
              type="datetime-local"
              value={newTimelineTime}
              onChange={(e) => setNewTimelineTime(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="What happened?"
              value={newTimelineDesc}
              onChange={(e) => setNewTimelineDesc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTimelineEntry()}
              className="flex-[2]"
            />
            <Button size="sm" onClick={addTimelineEntry}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Root Cause */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Root Cause
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="What was the underlying root cause?"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            onBlur={() => rootCause !== pm.root_cause && saveField('root_cause', rootCause)}
          />
          {savingField === 'root_cause' && (
            <p className="text-xs text-muted-foreground">Saving...</p>
          )}
        </CardContent>
      </Card>

      {/* Contributing Factors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contributing Factors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pm.contributing_factors && pm.contributing_factors.length > 0 ? (
            <ul className="space-y-2">
              {pm.contributing_factors.map((factor, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground">{factor}</span>
                  <button
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeFactor(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic">No contributing factors added.</p>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Add a contributing factor..."
              value={newFactor}
              onChange={(e) => setNewFactor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFactor()}
              className="flex-1"
            />
            <Button size="sm" onClick={addFactor}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4" />
            Action Items
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pm.action_items && pm.action_items.length > 0 ? (
            <ul className="space-y-2">
              {pm.action_items.map((item, i) => (
                <li key={i} className="flex items-center gap-3">
                  <button
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                      item.status === 'done'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-input bg-background hover:border-emerald-400',
                    )}
                    onClick={() => toggleActionStatus(i)}
                    title={item.status === 'done' ? 'Mark open' : 'Mark done'}
                  >
                    {item.status === 'done' && <CheckCircle2 className="h-3 w-3" />}
                  </button>
                  <span
                    className={cn(
                      'flex-1 text-sm',
                      item.status === 'done'
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground',
                    )}
                  >
                    {item.description}
                  </span>
                  <button
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeActionItem(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic">No action items yet.</p>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Add an action item..."
              value={newActionDesc}
              onChange={(e) => setNewActionDesc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addActionItem()}
              className="flex-1"
            />
            <Button size="sm" onClick={addActionItem}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Post-Mortem"
        description="Are you sure you want to delete this post-mortem? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
