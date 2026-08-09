'use client';

import { useState } from 'react';
import { Plus, FileSearch, Loader2, AlertTriangle, CircleDot } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { usePostMortems, useCreatePostMortem } from '@/lib/hooks/usePostMortems';
import { cn } from '@/lib/utils';

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'in-review': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function PostMortemsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSeverity, setNewSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [newSummary, setNewSummary] = useState('');

  const { data, isLoading } = usePostMortems({
    status: statusFilter || undefined,
    severity: severityFilter || undefined,
  });
  const createPostMortem = useCreatePostMortem();

  const postmortems = data?.data ?? [];

  async function handleCreate() {
    if (!newTitle.trim()) {
      toast.error('Title is required');
      return;
    }
    try {
      const pm = await createPostMortem.mutateAsync({
        title: newTitle.trim(),
        severity: newSeverity,
        summary: newSummary.trim(),
      });
      toast.success('Post-mortem created');
      setShowCreate(false);
      setNewTitle('');
      setNewSummary('');
      setNewSeverity('medium');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create post-mortem');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Post-Mortems</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Incident retrospectives and root cause analyses
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Post-Mortem
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="Status" icon={<CircleDot />} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="in-review">In Review</option>
          <option value="published">Published</option>
        </FilterSelect>
        <FilterSelect label="Severity" icon={<AlertTriangle />} value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">All</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </FilterSelect>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : postmortems.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No post-mortems found"
          description={
            statusFilter || severityFilter
              ? 'No post-mortems match your filters.'
              : 'Create your first post-mortem to document incident learnings.'
          }
          actionLabel="New Post-Mortem"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {postmortems.map((pm) => (
            <Link key={pm.id} href={`/postmortems/${pm.id}`}>
              <Card className="cursor-pointer transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <h3 className="font-semibold text-foreground truncate">{pm.title}</h3>
                      {pm.summary && (
                        <p className="text-sm text-muted-foreground line-clamp-1">{pm.summary}</p>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>by {pm.author?.name}</span>
                        <span>·</span>
                        <span>{new Date(pm.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
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
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowCreate(false)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              New Post-Mortem
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                placeholder="e.g., Database outage — 2026-02-20"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Severity</label>
              <Select
                value={newSeverity}
                onChange={(e) =>
                  setNewSeverity(e.target.value as 'critical' | 'high' | 'medium' | 'low')
                }
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Summary <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Brief description of what happened"
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createPostMortem.isPending}>
                {createPostMortem.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
