'use client';

import { useState, useCallback } from 'react';
import {
  Plus,
  Loader2,
  GripVertical,
  Pencil,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useLogPipeline,
  useAddRule,
  useUpdateRule,
  useDeleteRule,
  useReorderRules,
  useGenerateConfig,
  usePreviewPipeline,
  type LogPipelineRule,
  type RuleType,
  type CreateRuleInput,
} from '@/lib/hooks/useLogPipelines';

// ── Rule type display config ─────────────────────────────────────────
const RULE_TYPE_META: Record<RuleType, { label: string; badgeClass: string; description: string }> = {
  json_parse: {
    label: 'JSON Parse',
    badgeClass: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]',
    description: 'Parse JSON log lines into structured fields',
  },
  regex_extract: {
    label: 'Regex Extract',
    badgeClass: 'border-purple-200 bg-purple-50 text-purple-700',
    description: 'Extract fields from log lines using regex',
  },
  label_set: {
    label: 'Label Set',
    badgeClass: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]',
    description: 'Set labels on log entries from extracted fields',
  },
  line_filter: {
    label: 'Line Filter',
    badgeClass: 'border-[#FDE68A] bg-[#FEFCE8] text-[#A16207]',
    description: 'Keep or drop log lines matching a pattern',
  },
  drop: {
    label: 'Drop',
    badgeClass: 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]',
    description: 'Drop log entries matching a pattern',
  },
  redact: {
    label: 'Redact',
    badgeClass: 'border-[#FED7AA] bg-[#FFF7ED] text-[#EA580C]',
    description: 'Replace sensitive patterns with redacted text',
  },
};

const RULE_TYPES = Object.keys(RULE_TYPE_META) as RuleType[];

// ── Label key-value pair editor ──────────────────────────────────────
function LabelEditor({
  labels,
  onChange,
}: {
  labels: Record<string, string>;
  onChange: (labels: Record<string, string>) => void;
}) {
  const entries = Object.entries(labels);

  const addEntry = () => onChange({ ...labels, '': '' });
  const removeEntry = (key: string) => {
    const next = { ...labels };
    delete next[key];
    onChange(next);
  };
  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };
  const updateValue = (key: string, value: string) => {
    onChange({ ...labels, [key]: value });
  };

  return (
    <div className="space-y-2">
      {entries.map(([key, value], idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            placeholder="Label key"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            className="flex-1"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            placeholder="Value"
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeEntry(key)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addEntry} className="text-muted-foreground">
        <Plus className="mr-1 h-3 w-3" /> Add label
      </Button>
    </div>
  );
}

// ── Rule config form based on type ───────────────────────────────────
function RuleConfigFields({
  type,
  config,
  onChange,
}: {
  type: RuleType;
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
}) {
  switch (type) {
    case 'json_parse':
      return (
        <p className="text-sm text-muted-foreground">
          No additional configuration needed. JSON log lines will be parsed automatically.
        </p>
      );
    case 'regex_extract':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Expression</label>
          <Input
            placeholder="(?P<timestamp>\S+) (?P<level>\S+) (?P<msg>.*)"
            value={config.expression || ''}
            onChange={(e) => onChange({ ...config, expression: e.target.value })}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Use named capture groups to extract fields.
          </p>
        </div>
      );
    case 'label_set':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Labels</label>
          <LabelEditor
            labels={(config.labels as Record<string, string>) || {}}
            onChange={(labels) => onChange({ ...config, labels })}
          />
        </div>
      );
    case 'line_filter':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Match Pattern</label>
            <Input
              placeholder="error|warn|fatal"
              value={config.match || ''}
              onChange={(e) => onChange({ ...config, match: e.target.value })}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Action</label>
            <Select
              value={config.action || 'keep'}
              onChange={(e) => onChange({ ...config, action: e.target.value })}
            >
              <option value="keep">Keep matching lines</option>
              <option value="drop">Drop matching lines</option>
            </Select>
          </div>
        </div>
      );
    case 'drop':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Match Pattern</label>
            <Input
              placeholder="healthcheck|readiness"
              value={config.match || ''}
              onChange={(e) => onChange({ ...config, match: e.target.value })}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Match Type</label>
            <Select
              value={config.match_type || 'regex'}
              onChange={(e) => onChange({ ...config, match_type: e.target.value })}
            >
              <option value="regex">Regex</option>
              <option value="contains">Contains</option>
            </Select>
          </div>
        </div>
      );
    case 'redact':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Pattern</label>
            <Input
              placeholder="\b\d{3}-\d{2}-\d{4}\b"
              value={config.pattern || ''}
              onChange={(e) => onChange({ ...config, pattern: e.target.value })}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Regex pattern to match sensitive data.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Replacement</label>
            <Input
              placeholder="[REDACTED]"
              value={config.replacement || ''}
              onChange={(e) => onChange({ ...config, replacement: e.target.value })}
            />
          </div>
        </div>
      );
    default:
      return null;
  }
}

// ── Add/Edit Rule Dialog ─────────────────────────────────────────────
function RuleDialog({
  open,
  onClose,
  editingRule,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  editingRule: LogPipelineRule | null;
  onSubmit: (data: { name: string; type: RuleType; config: Record<string, any> }) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState(editingRule?.name || '');
  const [type, setType] = useState<RuleType>(editingRule?.type || 'json_parse');
  const [config, setConfig] = useState<Record<string, any>>(editingRule?.config || {});

  // Reset form when dialog opens with different rule
  const resetForm = useCallback(() => {
    setName(editingRule?.name || '');
    setType(editingRule?.type || 'json_parse');
    setConfig(editingRule?.config || {});
  }, [editingRule]);

  // Reset when editingRule changes
  useState(() => {
    resetForm();
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Rule'}</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Rule Name</label>
            <Input
              placeholder="e.g., Parse JSON logs"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Rule Type</label>
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as RuleType);
                setConfig({});
              }}
              disabled={!!editingRule}
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RULE_TYPE_META[t].label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{RULE_TYPE_META[type].description}</p>
          </div>
          <div className="border-t border-border pt-4">
            <RuleConfigFields type={type} config={config} onChange={setConfig} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => onSubmit({ name, type, config })}
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editingRule ? 'Update' : 'Add'} Rule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Rule Card ────────────────────────────────────────────────────────
function RuleCard({
  rule,
  index,
  totalRules,
  onEdit,
  onDelete,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  rule: LogPipelineRule;
  index: number;
  totalRules: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const meta = RULE_TYPE_META[rule.type];

  return (
    <Card className={cn('transition-opacity', !rule.enabled && 'opacity-50')}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {/* Drag handle / reorder controls */}
          <div className="flex flex-col items-center gap-0.5">
            <button
              onClick={onMoveUp}
              disabled={index === 0}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            <button
              onClick={onMoveDown}
              disabled={index === totalRules - 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Order number */}
          <span className="text-sm font-mono text-muted-foreground w-6 text-center">
            {rule.order + 1}
          </span>

          {/* Name and type */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
              <Badge className={cn('text-[10px] shrink-0', meta.badgeClass)}>{meta.label}</Badge>
            </div>
            {rule.type === 'regex_extract' && rule.config.expression && (
              <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                {rule.config.expression}
              </p>
            )}
            {rule.type === 'redact' && rule.config.pattern && (
              <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                {rule.config.pattern}
              </p>
            )}
          </div>

          {/* Toggle enabled */}
          <button
            onClick={onToggle}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
              rule.enabled ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                rule.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]',
              )}
            />
          </button>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onEdit} className="h-8 w-8 p-0">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────
export default function LogPipelinesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LogPipelineRule | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sampleLines, setSampleLines] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: pipelineData, isLoading } = useLogPipeline();
  const { data: configData, isLoading: configLoading } = useGenerateConfig();
  const addRule = useAddRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const reorderRules = useReorderRules();
  const previewPipeline = usePreviewPipeline();

  const rules = (pipelineData?.data ?? []).sort((a, b) => a.order - b.order);
  const alloyConfig = configData?.data ?? '';

  const handleAddRule = () => {
    setEditingRule(null);
    setDialogOpen(true);
  };

  const handleEditRule = (rule: LogPipelineRule) => {
    setEditingRule(rule);
    setDialogOpen(true);
  };

  const handleSubmitRule = (data: { name: string; type: RuleType; config: Record<string, any> }) => {
    if (editingRule) {
      updateRule.mutate(
        { ruleId: editingRule.id, ...data },
        {
          onSuccess: () => {
            toast.success('Rule updated');
            setDialogOpen(false);
          },
          onError: () => toast.error('Failed to update rule'),
        },
      );
    } else {
      addRule.mutate(data as CreateRuleInput, {
        onSuccess: () => {
          toast.success('Rule added');
          setDialogOpen(false);
        },
        onError: () => toast.error('Failed to add rule'),
      });
    }
  };

  const handleDeleteRule = (ruleId: string) => {
    deleteRule.mutate(ruleId, {
      onSuccess: () => toast.success('Rule deleted'),
      onError: () => toast.error('Failed to delete rule'),
    });
  };

  const handleToggleRule = (rule: LogPipelineRule) => {
    updateRule.mutate(
      { ruleId: rule.id, enabled: !rule.enabled },
      {
        onError: () => toast.error('Failed to toggle rule'),
      },
    );
  };

  const handleMoveRule = (ruleIndex: number, direction: 'up' | 'down') => {
    const sorted = [...rules];
    const targetIndex = direction === 'up' ? ruleIndex - 1 : ruleIndex + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    [sorted[ruleIndex], sorted[targetIndex]] = [sorted[targetIndex], sorted[ruleIndex]];
    reorderRules.mutate(sorted.map((r) => r.id));
  };

  const handleCopyConfig = async () => {
    await navigator.clipboard.writeText(alloyConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Config copied to clipboard');
  };

  const handlePreview = () => {
    const lines = sampleLines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error('Enter at least one sample log line');
      return;
    }
    previewPipeline.mutate(lines);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Log Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure transform rules applied to logs before storage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfig(!showConfig)}
          >
            Generate Config
          </Button>
          <Button size="sm" onClick={handleAddRule}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground text-sm">
              No pipeline rules configured. Add a rule to start transforming your logs.
            </p>
            <Button size="sm" className="mt-4" onClick={handleAddRule}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add First Rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, idx) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={idx}
              totalRules={rules.length}
              onEdit={() => handleEditRule(rule)}
              onDelete={() => handleDeleteRule(rule.id)}
              onToggle={() => handleToggleRule(rule)}
              onMoveUp={() => handleMoveRule(idx, 'up')}
              onMoveDown={() => handleMoveRule(idx, 'down')}
            />
          ))}
        </div>
      )}

      {/* Preview Panel */}
      {showPreview && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Pipeline Preview</h3>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Sample Log Lines (one per line)
              </label>
              <textarea
                value={sampleLines}
                onChange={(e) => setSampleLines(e.target.value)}
                rows={4}
                placeholder={'{"level":"error","msg":"connection refused","ts":"2026-04-01T10:00:00Z"}\n192.168.1.1 - - [01/Apr/2026:10:00:00] "GET /health" 200'}
                className="w-full rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated px-4 py-3 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/12 transition-[border-color,box-shadow] duration-150 resize-y"
              />
            </div>
            <Button
              size="sm"
              onClick={handlePreview}
              disabled={previewPipeline.isPending}
            >
              {previewPipeline.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Run Preview
            </Button>
            {previewPipeline.data && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Transformed Output
                </label>
                <pre className="rounded-[8px] border border-border bg-muted/50 p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
                  {previewPipeline.data.data.output.join('\n')}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Config Panel */}
      {showConfig && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Generated Alloy Config
              </h3>
              <Button variant="ghost" size="sm" onClick={handleCopyConfig}>
                {copied ? (
                  <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {configLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <pre className="rounded-[8px] border border-border bg-muted/50 p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
                {alloyConfig}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <RuleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editingRule={editingRule}
        onSubmit={handleSubmitRule}
        isSubmitting={addRule.isPending || updateRule.isPending}
      />
    </div>
  );
}
