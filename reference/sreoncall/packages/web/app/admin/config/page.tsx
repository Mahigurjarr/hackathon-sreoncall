'use client';

import { useState } from 'react';
import { useGlobalConfig, useUpdateGlobalConfig, type GlobalConfigItem } from '@/lib/hooks/useAdmin';
import { Save, Settings, Plus, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { toast } from 'sonner';

const CATEGORY_LABELS: Record<string, string> = {
  platform: 'Platform',
  auth: 'Authentication',
  email: 'Email',
  agents: 'AI Agents',
  limits: 'Limits & Retention',
  observability: 'Observability',
  general: 'General',
};

function getValueType(value: any): 'boolean' | 'number' | 'string' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

export default function ConfigPage() {
  const { data: configs, isLoading } = useGlobalConfig();
  const updateConfig = useUpdateGlobalConfig();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newConfig, setNewConfig] = useState({ key: '', value: '', description: '', category: 'general' });

  function handleEdit(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCategory(category: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function handleSave(config: GlobalConfigItem) {
    const newValue = edits[config.key];
    if (newValue === undefined) return;

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      parsedValue = newValue;
    }

    try {
      await updateConfig.mutateAsync({
        items: [{ key: config.key, value: parsedValue, description: config.description, category: config.category }],
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[config.key];
        return next;
      });
      toast.success(`Config '${config.key}' updated`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update config');
    }
  }

  async function handleCreate() {
    if (!newConfig.key) return;

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(newConfig.value);
    } catch {
      parsedValue = newConfig.value;
    }

    try {
      await updateConfig.mutateAsync({
        items: [{ key: newConfig.key, value: parsedValue, description: newConfig.description, category: newConfig.category }],
      });
      setShowCreate(false);
      setNewConfig({ key: '', value: '', description: '', category: 'general' });
      toast.success('Config entry created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create config');
    }
  }

  function handleToggleBoolean(config: GlobalConfigItem) {
    const currentValue = edits[config.key] !== undefined ? JSON.parse(edits[config.key]) : config.value;
    handleEdit(config.key, JSON.stringify(!currentValue));
  }

  const categories = [...new Set(configs?.map((c) => c.category) ?? [])].sort((a, b) => {
    const order = Object.keys(CATEGORY_LABELS);
    return (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b));
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Global Configuration</h1>
          <p className="text-sm text-muted-foreground">System-wide configuration key-value pairs</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Config
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowCreate(false)} />
          <DialogHeader>
            <DialogTitle>Add Configuration Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Key</label>
              <Input
                placeholder="e.g. platform.max_tenants"
                value={newConfig.key}
                onChange={(e) => setNewConfig({ ...newConfig, key: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Value</label>
              <Input
                placeholder="e.g. 1000, true, or a string"
                value={newConfig.value}
                onChange={(e) => setNewConfig({ ...newConfig, value: e.target.value })}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Numbers and booleans (true/false) are auto-detected. Wrap strings in quotes if they look like JSON.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Description</label>
              <Input
                placeholder="What does this config control?"
                value={newConfig.description}
                onChange={(e) => setNewConfig({ ...newConfig, description: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Category</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={newConfig.category}
                onChange={(e) => setNewConfig({ ...newConfig, category: e.target.value })}
              >
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={updateConfig.isPending || !newConfig.key}>
                {updateConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !configs?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Settings className="mb-3 h-10 w-10 opacity-50" />
          <p>No configuration entries</p>
        </div>
      ) : (
        categories.map((category) => {
          const isCollapsed = collapsedCategories.has(category);
          const categoryConfigs = configs.filter((c) => c.category === category);
          return (
            <div key={category} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggleCategory(category)}
                className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-muted/30 transition-colors"
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[category] || category}
                </h2>
                <span className="text-[10px] text-muted-foreground">({categoryConfigs.length})</span>
              </button>
              {!isCollapsed && (
                <div className="divide-y divide-border border-t border-border">
                  {categoryConfigs.map((config) => {
                    const valueType = getValueType(config.value);
                    const rawEdit = edits[config.key];
                    const isDirty = rawEdit !== undefined;
                    const currentBoolValue = rawEdit !== undefined ? rawEdit === 'true' : config.value === true;

                    return (
                      <div key={config._id} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm font-medium">{config.key.replace(`${category}.`, '')}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{config.description}</p>
                        </div>
                        {valueType === 'boolean' ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleBoolean(config)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                currentBoolValue ? 'bg-[#16A34A]' : 'bg-[#334155]'
                              }`}
                            >
                              <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${currentBoolValue ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                          </div>
                        ) : (
                          <input
                            value={rawEdit ?? (typeof config.value === 'string' ? config.value : JSON.stringify(config.value))}
                            onChange={(e) => handleEdit(config.key, e.target.value)}
                            className="w-60 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono"
                          />
                        )}
                        {isDirty && (
                          <button
                            onClick={() => handleSave(config)}
                            disabled={updateConfig.isPending}
                            className="rounded-lg bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
