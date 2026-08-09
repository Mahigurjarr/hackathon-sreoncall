'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import type { DashboardVariable } from '@/lib/hooks/useDashboards';

/**
 * Add/remove/reorder the variables on a dashboard. Variable names must be
 * valid identifiers (matches the regex in the API zod schema).
 *
 * The dialog owns its own draft copy while open; the parent is only notified
 * when the user clicks Save.
 */
export default function ManageVariablesDialog({
  open,
  onClose,
  variables,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  variables: DashboardVariable[];
  onSave: (next: DashboardVariable[]) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<DashboardVariable[]>(variables);

  // Reset the draft each time the dialog is opened so edits from prior
  // sessions don't leak between opens.
  useEffect(() => {
    if (open) setDraft(variables);
  }, [open, variables]);

  function addVariable() {
    setDraft((d) => [
      ...d,
      {
        name: `var${d.length + 1}`,
        label: 'New Variable',
        type: 'query',
        source: { label_name: '' },
        default: [],
        multi: false,
      },
    ]);
  }

  function updateVariable(index: number, patch: Partial<DashboardVariable>) {
    setDraft((d) => d.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function updateSource(index: number, patch: Partial<DashboardVariable['source']>) {
    setDraft((d) => d.map((v, i) => (i === index ? { ...v, source: { ...v.source, ...patch } } : v)));
  }

  function removeVariable(index: number) {
    setDraft((d) => {
      const removed = d[index];
      if (!removed) return d;
      // Also remove any variables whose match_template references the deleted
      // variable — they become orphaned and would silently match everything.
      return d.filter((v, i) => {
        if (i === index) return false;
        if (v.source.match_template?.includes(`$${removed.name}`)) return false;
        return true;
      });
    });
  }

  function move(index: number, dir: -1 | 1) {
    setDraft((d) => {
      const next = [...d];
      const target = index + dir;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  const nameRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const hasInvalid = draft.some((v) => !nameRegex.test(v.name) || !v.label.trim());

  // Build a set of variable names that are referenced by at least one other variable.
  // Used to warn the user that deleting a variable will also remove its dependents.
  function dependentCount(varName: string): number {
    return draft.filter((v) => v.source.match_template?.includes(`$${varName}`)).length;
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Variables</DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto px-6 pb-6 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Variables let you parameterize panel queries. Reference them as{' '}
            <code className="rounded bg-muted px-1">$name</code> in PromQL/LogQL —
            e.g. <code className="rounded bg-muted px-1">cluster=~&quot;$cluster&quot;</code>.
          </p>

          {draft.length === 0 && (
            <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-[12px] text-muted-foreground">
              No variables yet
            </div>
          )}

          {draft.map((v, i) => (
            <div key={i} className="rounded-md border border-border/60 p-3 space-y-2.5">
              <div className="flex items-center gap-1.5">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <GripVertical className="h-3 w-3 rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === draft.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <GripVertical className="h-3 w-3" />
                  </button>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground">#{i + 1}</span>
                <div className="flex-1" />
                {dependentCount(v.name) > 0 && (
                  <span
                    className="text-[9px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5"
                    title={`Deleting this will also remove ${dependentCount(v.name)} dependent variable(s)`}
                  >
                    +{dependentCount(v.name)} dependent{dependentCount(v.name) > 1 ? 's' : ''}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeVariable(i)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  title={
                    dependentCount(v.name) > 0
                      ? `Delete ${v.name} and its ${dependentCount(v.name)} dependent variable(s)`
                      : `Delete ${v.name}`
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground">Name (identifier)</label>
                  <input
                    value={v.name}
                    onChange={(e) => updateVariable(i, { name: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[12px] font-mono"
                    placeholder="cluster"
                  />
                  {!nameRegex.test(v.name) && (
                    <p className="mt-0.5 text-[10px] text-destructive">Must start with a letter or _ (no spaces)</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground">Display Label</label>
                  <input
                    value={v.label}
                    onChange={(e) => updateVariable(i, { label: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[12px]"
                    placeholder="Cluster"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground">Type</label>
                  <select
                    value={v.type}
                    onChange={(e) => updateVariable(i, { type: e.target.value as 'query' | 'custom' })}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[12px]"
                  >
                    <option value="query">Query (from label)</option>
                    <option value="custom">Custom (static list)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      checked={v.multi}
                      onChange={(e) => updateVariable(i, { multi: e.target.checked })}
                      className="h-3 w-3"
                    />
                    Allow multiple
                  </label>
                </div>
              </div>

              {v.type === 'query' ? (
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground">Label name (from metrics)</label>
                  <input
                    value={v.source.label_name ?? ''}
                    onChange={(e) => updateSource(i, { label_name: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[12px] font-mono"
                    placeholder="cluster"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground">Values (comma-separated)</label>
                  <input
                    value={(v.source.values ?? []).join(', ')}
                    onChange={(e) =>
                      updateSource(i, {
                        values: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[12px]"
                    placeholder="prod, staging, dev"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-medium text-muted-foreground">
                  Default (pipe-separated for multi)
                </label>
                <input
                  value={v.default.join('|')}
                  onChange={(e) =>
                    updateVariable(i, {
                      default: e.target.value
                        .split('|')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[12px]"
                  placeholder="(empty = All)"
                />
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addVariable} className="w-full">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Variable
          </Button>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || hasInvalid}
              onClick={() => onSave(draft)}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
