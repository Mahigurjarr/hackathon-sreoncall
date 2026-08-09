'use client';

import { useState } from 'react';
import {
  BellRing, Plus, Search, Loader2, Pencil, Trash2, X,
  Play, Power, PowerOff, CheckCircle2, AlertCircle, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
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
  useAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useToggleAlertRule,
  useTestAlertRule,
  type AlertRule,
  type AlertSeverity,
  type AlertOperator,
  type CreateAlertRuleInput,
} from '@/lib/hooks/useAlertRules';
import { useServices } from '@/lib/hooks/useServices';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]' },
  high:     { label: 'High',     color: 'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]' },
  medium:   { label: 'Medium',   color: 'bg-[#FEFCE8] text-[#A16207] border-[#FDE68A]' },
  low:      { label: 'Low',      color: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]' },
};

const COMMON_METRICS = [
  'error_rate', 'latency_p50', 'latency_p95', 'latency_p99',
  'cpu_usage', 'memory_usage', 'disk_usage',
  'http_5xx', 'http_4xx', 'request_rate',
  'queue_depth', 'db_connections', 'cache_miss_rate',
];

const OPERATORS: { value: AlertOperator; label: string }[] = [
  { value: 'gt',  label: '> (greater than)' },
  { value: 'gte', label: '≥ (greater or equal)' },
  { value: 'lt',  label: '< (less than)' },
  { value: 'lte', label: '≤ (less or equal)' },
  { value: 'eq',  label: '= (equal)' },
];

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ─── Alert Rule Dialog ────────────────────────────────────────────────────────

type ConditionMode = 'simple' | 'query';
type SourceType = 'managed_promql' | 'managed_logql';

interface FormData {
  name: string;
  description: string;
  service_id: string;
  severity: AlertSeverity;
  status: 'active' | 'inactive';
  source_type: SourceType;
  condition_mode: ConditionMode;
  query: string;
  metric: string;
  customMetric: string;
  operator: AlertOperator;
  threshold: string;
  window_minutes: string;
  for_duration_seconds: string;
  auto_create_incident: boolean;
  incident_severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  notification_channels: string;
}

function defaultForm(rule?: AlertRule | null): FormData {
  const hasQuery = !!rule?.query;
  return {
    name:                 rule?.name ?? '',
    description:          rule?.description ?? '',
    service_id:           rule?.service?.id ?? rule?.service_id ?? '',
    severity:             rule?.severity ?? 'medium',
    status:               rule?.status ?? 'active',
    source_type:          rule?.source_type === 'managed_logql' ? 'managed_logql' : 'managed_promql',
    condition_mode:       hasQuery ? 'query' : 'simple',
    query:                rule?.query ?? '',
    metric:               COMMON_METRICS.includes(rule?.condition.metric ?? '') ? (rule?.condition.metric ?? 'error_rate') : '__custom__',
    customMetric:         COMMON_METRICS.includes(rule?.condition.metric ?? '') ? '' : (rule?.condition.metric ?? ''),
    operator:             rule?.condition.operator ?? 'gt',
    threshold:            rule?.condition.threshold?.toString() ?? '5',
    window_minutes:       rule?.condition.window_minutes?.toString() ?? '5',
    for_duration_seconds: rule?.for_duration_seconds?.toString() ?? '0',
    auto_create_incident: rule?.auto_create_incident ?? false,
    incident_severity:    rule?.incident_severity ?? 'sev3',
    notification_channels: rule?.notification_channels?.join(', ') ?? '',
  };
}

function AlertRuleDialog({
  open,
  onClose,
  rule,
}: {
  open: boolean;
  onClose: () => void;
  rule?: AlertRule | null;
}) {
  const isEdit = !!rule;
  const createRule = useCreateAlertRule();
  const updateRule = useUpdateAlertRule();
  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];

  const [form, setForm] = useState<FormData>(() => defaultForm(rule));
  const [lastRule, setLastRule] = useState(rule);
  if (rule !== lastRule) {
    setLastRule(rule);
    setForm(defaultForm(rule));
  }

  function set<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }

    const isQueryMode = form.condition_mode === 'query';

    if (isQueryMode && !form.query.trim()) { toast.error('Query is required'); return; }

    const metric = isQueryMode
      ? form.query.trim()
      : form.metric === '__custom__' ? form.customMetric.trim() : form.metric;
    if (!metric) { toast.error('Metric is required'); return; }

    const threshold = parseFloat(form.threshold);
    if (isNaN(threshold)) { toast.error('Threshold must be a number'); return; }
    const window_minutes = parseInt(form.window_minutes, 10);
    const for_duration_seconds = parseInt(form.for_duration_seconds, 10) || 0;

    const input: CreateAlertRuleInput = {
      name:                 form.name.trim(),
      description:          form.description.trim(),
      service_id:           form.service_id || null,
      severity:             form.severity,
      status:               form.status,
      source_type:          form.source_type,
      query:                isQueryMode ? form.query.trim() : null,
      condition: { metric, operator: form.operator, threshold, window_minutes },
      for_duration_seconds,
      auto_create_incident: form.auto_create_incident,
      incident_severity:    form.incident_severity,
      notification_channels: form.notification_channels.split(',').map((c) => c.trim()).filter(Boolean),
    };

    try {
      if (isEdit && rule) {
        await updateRule.mutateAsync({ id: rule.id, input });
        toast.success('Alert rule updated');
      } else {
        await createRule.mutateAsync(input);
        toast.success('Alert rule created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save alert rule');
    }
  }

  const isPending = createRule.isPending || updateRule.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            {isEdit ? 'Edit Alert Rule' : 'Create Alert Rule'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto flex-1 pr-1">

          {/* Name + Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input placeholder="e.g. High Error Rate on Payment API" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <Input placeholder="What does this rule detect?" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>

          {/* Service + Severity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Service</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={form.service_id} onChange={(e) => set('service_id', e.target.value)}>
                <option value="">Any service</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Severity</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={form.severity} onChange={(e) => set('severity', e.target.value as AlertSeverity)}>
                {(Object.keys(SEVERITY_CONFIG) as AlertSeverity[]).map((s) => (
                  <option key={s} value={s}>{SEVERITY_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Source Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Source Type</label>
            <div className="flex gap-2">
              {([
                { value: 'managed_promql' as SourceType, label: 'PromQL (Metrics)' },
                { value: 'managed_logql' as SourceType, label: 'LogQL (Logs)' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('source_type', opt.value)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    form.source_type === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Condition */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Condition</p>
              <div className="flex rounded-md border border-border overflow-hidden">
                {([
                  { value: 'simple' as ConditionMode, label: 'Simple' },
                  { value: 'query' as ConditionMode, label: 'Query' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('condition_mode', opt.value)}
                    className={cn(
                      'px-2.5 py-1 text-[10px] font-medium transition-colors',
                      form.condition_mode === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {form.condition_mode === 'query' ? (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">
                  {form.source_type === 'managed_logql' ? 'LogQL Expression' : 'PromQL Expression'}
                </label>
                <QueryEditor
                  value={form.query}
                  onChange={(val) => set('query', val)}
                  language={form.source_type === 'managed_logql' ? 'logql' : 'promql'}
                  height="80px"
                  placeholder={form.source_type === 'managed_logql'
                    ? 'sum(count_over_time({job="app"} |= "error" [5m]))'
                    : 'avg(rate(http_requests_total{status=~"5.."}[5m])) / avg(rate(http_requests_total[5m])) * 100'}
                />
                <p className="text-[10px] text-muted-foreground">
                  {form.source_type === 'managed_logql'
                    ? 'Enter a full LogQL expression. Must return a scalar or vector for threshold comparison.'
                    : 'Enter a full PromQL expression. The result is compared against the threshold below.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Metric</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={form.metric} onChange={(e) => set('metric', e.target.value)}>
                  {COMMON_METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                  <option value="__custom__">Custom metric…</option>
                </select>
                {form.metric === '__custom__' && (
                  <Input placeholder="my.custom.metric" value={form.customMetric} onChange={(e) => set('customMetric', e.target.value)} className="mt-1.5" />
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Operator</label>
                <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground" value={form.operator} onChange={(e) => set('operator', e.target.value as AlertOperator)}>
                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Threshold</label>
                <Input type="number" placeholder="5" value={form.threshold} onChange={(e) => set('threshold', e.target.value)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Window (min)</label>
                <Input type="number" placeholder="5" min="1" value={form.window_minutes} onChange={(e) => set('window_minutes', e.target.value)} className="text-xs" />
              </div>
            </div>

            {/* Pending period (for duration) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Pending period (seconds)</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  value={form.for_duration_seconds}
                  onChange={(e) => set('for_duration_seconds', e.target.value)}
                  className="text-xs max-w-[120px]"
                />
                <span className="text-[10px] text-muted-foreground">
                  Hold in pending state before firing. 0 = fire immediately.
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {form.condition_mode === 'query' ? (
                <>
                  Fire when query result{' '}
                  {OPERATORS.find((o) => o.value === form.operator)?.label.split(' ')[0]}{' '}
                  <strong>{form.threshold || '?'}</strong>
                  {parseInt(form.for_duration_seconds) > 0 && (
                    <> for <strong>{form.for_duration_seconds}s</strong></>
                  )}
                </>
              ) : (
                <>
                  Fire when <strong>{form.metric === '__custom__' ? (form.customMetric || 'metric') : form.metric}</strong>
                  {' '}{OPERATORS.find((o) => o.value === form.operator)?.label.split(' ')[0]}{' '}
                  <strong>{form.threshold || '?'}</strong> over{' '}
                  <strong>{form.window_minutes || '5'} min</strong> window
                  {parseInt(form.for_duration_seconds) > 0 && (
                    <> for <strong>{form.for_duration_seconds}s</strong></>
                  )}
                </>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <p className="text-sm font-semibold text-foreground">Actions when triggered</p>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.auto_create_incident}
                onChange={(e) => set('auto_create_incident', e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-sm text-foreground">Auto-create incident</span>
            </label>

            {form.auto_create_incident && (
              <div className="space-y-2 pl-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Incident severity</label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={form.incident_severity} onChange={(e) => set('incident_severity', e.target.value as any)}>
                    <option value="sev1">SEV1 — Critical</option>
                    <option value="sev2">SEV2 — High</option>
                    <option value="sev3">SEV3 — Medium</option>
                    <option value="sev4">SEV4 — Low</option>
                  </select>
                </div>
                {!form.service_id && (
                  <p className="text-xs text-amber-600">
                    No service selected — auto-created incidents will have no affected service. Select a service above to link incidents automatically.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Notification channels</label>
              <Input placeholder="email, slack, pagerduty (comma-separated)" value={form.notification_channels} onChange={(e) => set('notification_channels', e.target.value)} />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Initial Status</label>
            <div className="flex gap-3">
              {(['active', 'inactive'] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="status" value={s} checked={form.status === s} onChange={() => set('status', s)} className="accent-primary" />
                  <span className="text-sm text-foreground capitalize">{s}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-1 pb-1 border-t border-border mt-auto sticky bottom-0 bg-background">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Rule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertRulesPage() {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<AlertRule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useAlertRules({
    search:   search || undefined,
    severity: severityFilter || undefined,
    status:   statusFilter || undefined,
  });
  const deleteRule = useDeleteAlertRule();
  const toggleRule = useToggleAlertRule();
  const testRule = useTestAlertRule();

  const rules = data?.data ?? [];
  const activeCount = rules.filter((r) => r.status === 'active').length;

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteRule.mutateAsync(deleteId);
      toast.success('Alert rule deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete rule');
    }
  }

  async function handleToggle(rule: AlertRule) {
    try {
      await toggleRule.mutateAsync(rule.id);
      toast.success(`Rule ${rule.status === 'active' ? 'disabled' : 'enabled'}`);
    } catch {
      toast.error('Failed to toggle rule');
    }
  }

  async function handleTest(rule: AlertRule) {
    try {
      const result = await testRule.mutateAsync(rule.id);
      toast.success(result.message);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to test rule');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alert Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define conditions that trigger alerts and auto-create incidents
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Rule
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Rules',  value: data?.pagination.total ?? 0, color: 'text-foreground' },
          { label: 'Active',       value: activeCount,                  color: 'text-[#16A34A]' },
          { label: 'Inactive',     value: (data?.pagination.total ?? 0) - activeCount, color: 'text-muted-foreground' },
          { label: 'Triggered (all time)', value: rules.reduce((a, r) => a + r.trigger_count, 0), color: 'text-[#EA580C]' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{isLoading ? '…' : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput containerClassName="flex-1 sm:max-w-xs" placeholder="Search rules…" value={search} onChange={setSearch} />
        <select className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">All severities</option>
          {(Object.entries(SEVERITY_CONFIG) as [AlertSeverity, any][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {(severityFilter || statusFilter) && (
          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => { setSeverityFilter(''); setStatusFilter(''); }}>
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Rules list */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No alert rules found"
          description={search || severityFilter || statusFilter ? 'No rules match your filters.' : 'Create your first alert rule to start monitoring services.'}
          actionLabel="Create Rule"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id} className={rule.status === 'inactive' ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Status indicator */}
                  <div className="mt-0.5 shrink-0" title={rule.status === 'active' ? `State: ${rule.alert_state}` : 'Inactive'}>
                    {rule.status !== 'active'
                      ? <AlertCircle className="h-5 w-5 text-muted-foreground" />
                      : rule.alert_state === 'firing'
                        ? <AlertCircle className="h-5 w-5 text-red-500" />
                        : rule.alert_state === 'no_data'
                          ? <Info className="h-5 w-5 text-yellow-500" />
                          : <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    }
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">{rule.name}</p>
                        {rule.description && (
                          <p className="text-sm text-muted-foreground">{rule.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <SeverityBadge severity={rule.severity} />
                      </div>
                    </div>

                    {/* Condition pill */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {rule.status === 'active' && rule.alert_state === 'firing' && (
                        <span className="rounded-full bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 font-medium animate-pulse">
                          FIRING{rule.last_value != null ? ` (${rule.last_value})` : ''}
                        </span>
                      )}
                      {rule.status === 'active' && rule.alert_state === 'no_data' && (
                        <span className="rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200 px-2 py-0.5 font-medium">
                          NO DATA
                        </span>
                      )}
                      <span className="rounded-full bg-muted border border-border px-2 py-0.5 font-mono text-foreground">
                        {rule.query
                          ? `${rule.query.length > 60 ? rule.query.slice(0, 60) + '…' : rule.query} ${rule.condition.operator} ${rule.condition.threshold}`
                          : `${rule.condition.metric} ${rule.condition.operator} ${rule.condition.threshold} over ${rule.condition.window_minutes}m`}
                      </span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5',
                        rule.source_type === 'managed_logql'
                          ? 'bg-purple-100 text-purple-700 border border-purple-200'
                          : 'bg-blue-100 text-blue-700 border border-blue-200',
                      )}>
                        {rule.source_type === 'managed_logql' ? 'LogQL' : rule.source_type === 'managed_promql' ? 'PromQL' : rule.source_type}
                      </span>
                      {rule.service && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
                          {rule.service.name}
                        </span>
                      )}
                      {rule.auto_create_incident && (
                        <span className="rounded-full bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] px-2 py-0.5">
                          auto-incident {rule.incident_severity.toUpperCase()}
                        </span>
                      )}
                      {rule.for_duration_seconds > 0 && (
                        <span className="rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground">
                          for {rule.for_duration_seconds}s
                        </span>
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Triggered <strong className="text-foreground">{rule.trigger_count}</strong>×</span>
                      {rule.last_triggered_at && (
                        <span>
                          Last: {formatDistanceToNow(new Date(rule.last_triggered_at), { addSuffix: true })}
                        </span>
                      )}
                      {rule.notification_channels.length > 0 && (
                        <span>Channels: {rule.notification_channels.join(', ')}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => handleTest(rule)}
                      title="Test trigger"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => handleToggle(rule)}
                      title={rule.status === 'active' ? 'Disable' : 'Enable'}
                    >
                      {rule.status === 'active'
                        ? <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                        : <Power className="h-3.5 w-3.5 text-emerald-500" />
                      }
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => setEditRule(rule)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(rule.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertRuleDialog
        open={showCreate || !!editRule}
        onClose={() => { setShowCreate(false); setEditRule(null); }}
        rule={editRule}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Alert Rule"
        description="Are you sure you want to delete this alert rule? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
