'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  BellRing,
  TestTube,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  X,
  ChevronDown,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  useAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useToggleAlertRule,
  useTestAlertRule,
  useDryRunAlertRule,
  useCreateSilence,
  useDeleteSilence,
  useAlertTemplates,
  useActivateTemplate,
  type AlertRule,
  type AlertTemplate,
  type CreateAlertRuleInput,
  type AlertRuleDryRunResult,
  type SavedRuleTestResult,
} from '@/lib/hooks/useAlertRules';
import { useEscalationPolicies } from '@/lib/hooks/useEscalationPolicies';
import { useServices } from '@/lib/hooks/useServices';
import { useSyntheticChecks } from '@/lib/hooks/useSyntheticChecks';
import { toast } from 'sonner';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';

type AlertOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'expr' | 'absent';

// `expr` and `absent` are query-driven: the query result itself is the fire
// signal, so there is no threshold to enter or validate.
const isExprLike = (op: string): boolean => op === 'expr' || op === 'absent';

/** Validate a whole-number field. Returns an error string, or null if valid. */
function intFieldError(raw: string, min: number, max: number): string | null {
  const s = raw.trim();
  if (s === '') return 'Required';
  if (!/^-?\d+$/.test(s)) return 'Whole number only';
  const n = Number(s);
  if (n < min) return `Must be ≥ ${min}`;
  if (n > max) return `Must be ≤ ${max}`;
  return null;
}

/** Validate a numeric (decimal-allowed) field. Returns an error string, or null. */
function numFieldError(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return 'Required';
  if (Number.isNaN(Number(s))) return 'Must be a number';
  return null;
}

const SEVERITY_COLORS: Record<string, { stripe: string; text: string; bg: string }> = {
  critical: { stripe: 'border-l-[#DC2626]', text: 'text-[#DC2626]', bg: 'bg-red-500/10' },
  high:     { stripe: 'border-l-primary', text: 'text-primary', bg: 'bg-primary/10' },
  medium:   { stripe: 'border-l-[#A16207]', text: 'text-[#A16207]', bg: 'bg-yellow-500/10' },
  low:      { stripe: 'border-l-[#2563EB]', text: 'text-[#2563EB]', bg: 'bg-blue-500/10' },
};

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  firing:  { label: 'FIRING', cls: 'bg-red-500/10 text-[#DC2626] border-red-500/20' },
  ok:      { label: 'OK', cls: 'bg-emerald-500/10 text-[#16A34A] border-emerald-500/20' },
  no_data: { label: 'NO DATA', cls: 'bg-muted text-muted-foreground border-border' },
};

const OP_SYMBOL: Record<string, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==' };
const SYNTHETIC_STATUS_OPTIONS = [
  { label: 'Up', value: '0' },
  { label: 'Degraded Or Down', value: '1' },
  { label: 'Down', value: '2' },
] as const;

const SOURCE_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  managed_promql: { label: 'PromQL', cls: 'bg-purple-500/10 text-[#7C3AED] border-purple-500/20' },
  managed_logql:  { label: 'LogQL', cls: 'bg-blue-500/10 text-[#2563EB] border-blue-500/20' },
  byos_webhook:   { label: 'Webhook', cls: 'bg-amber-500/10 text-[#A16207] border-amber-500/20' },
  synthetic:      { label: 'Synthetic', cls: 'bg-teal-500/10 text-teal-400 border-teal-500/20' },
};

const QUERY_EXAMPLES = {
  managed_promql: [
    'up',
    'rate(http_requests_total[5m])',
    'sum(rate(http_requests_total{status=~"5.."}[5m]))',
  ],
  managed_logql: [
    '{service_name="api"} |= "error"',
    'sum(count_over_time({source="vercel"} |= "error"[5m]))',
    'count_over_time({level="warn"}[5m])',
  ],
} as const;

function formatTimestamp(ts: string | null) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isSyntheticStatusRule(rule: Pick<AlertRule, 'source_type' | 'condition'>) {
  return rule.source_type === 'synthetic' && rule.condition.metric === 'status';
}

function describeSyntheticStatusCondition(operator: string, threshold: number) {
  if (operator === 'gte' && threshold === 1) return 'status is degraded or down';
  if (operator === 'gte' && threshold === 2) return 'status is down';
  if (operator === 'eq' && threshold === 0) return 'status is up';
  if (operator === 'eq' && threshold === 1) return 'status is degraded';
  if (operator === 'eq' && threshold === 2) return 'status is down';
  if (operator === 'lt' && threshold === 1) return 'status is up';
  return `status ${OP_SYMBOL[operator] || operator} ${threshold}`;
}

function formatRuleCondition(rule: Pick<AlertRule, 'source_type' | 'condition'>) {
  if (isSyntheticStatusRule(rule)) {
    return describeSyntheticStatusCondition(rule.condition.operator, rule.condition.threshold);
  }
  return `${rule.condition.metric} ${OP_SYMBOL[rule.condition.operator] || rule.condition.operator} ${rule.condition.threshold}`;
}

function formatCurrentValue(rule: Pick<AlertRule, 'source_type' | 'condition' | 'last_value'>) {
  if (rule.last_value === null || rule.last_value === undefined) return null;
  if (isSyntheticStatusRule(rule)) {
    if (rule.last_value === 0) return 'up';
    if (rule.last_value === 1) return 'degraded';
    if (rule.last_value === 2) return 'down';
  }
  return rule.last_value.toFixed(4);
}

function formatRulePrimaryText(rule: Pick<AlertRule, 'source_type' | 'query' | 'condition'>) {
  if (rule.source_type === 'managed_promql' || rule.source_type === 'managed_logql') {
    return rule.query || formatRuleCondition(rule as Pick<AlertRule, 'source_type' | 'condition'>);
  }
  return formatRuleCondition(rule as Pick<AlertRule, 'source_type' | 'condition'>);
}

// ── Pre-defined Alert Templates Tab ────────────────────────────────

function PreDefinedAlertsTab() {
  const { data: templatesData, isLoading } = useAlertTemplates();
  const { data: rulesData } = useAlertRules();
  const activateTemplate = useActivateTemplate();
  const toggleRule = useToggleAlertRule();

  const templates = templatesData?.data ?? [];
  const activatedIds = new Set(templatesData?.activated_template_ids ?? []);
  const rules = rulesData?.data ?? [];

  // Group templates by category
  const grouped = useMemo(() => {
    const groups: Record<string, AlertTemplate[]> = {};
    for (const t of templates) {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    }
    return groups;
  }, [templates]);

  const categoryIcons: Record<string, string> = {
    'Infrastructure': 'bg-blue-500/10 text-[#2563EB]',
    'Application Performance': 'bg-emerald-500/10 text-[#16A34A]',
    'Kubernetes': 'bg-purple-500/10 text-[#7C3AED]',
    'Database': 'bg-cyan-500/10 text-cyan-400',
    'Container': 'bg-indigo-500/10 text-indigo-400',
    'SSL / Certificates': 'bg-rose-500/10 text-rose-400',
    'Log-Based': 'bg-amber-500/10 text-[#A16207]',
    'AWS CloudWatch': 'bg-orange-500/10 text-[#EA580C]',
    'Security': 'bg-red-500/10 text-[#DC2626]',
    'SNMP': 'bg-teal-500/10 text-teal-500',
    'Application Logs': 'bg-[#FF6B2B]/10 text-[#FF6B2B]',
  };

  // useState must be called before any early returns (Rules of Hooks)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => {
    return new Set(Object.keys(grouped));
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function handleToggle(template: AlertTemplate) {
    // Find existing predefined rule for this template
    const existingRule = rules.find((r) => r.template_id === template.template_id && r.is_predefined);

    if (existingRule) {
      // Toggle existing rule (active ↔ inactive)
      toggleRule.mutate(existingRule.id, {
        onSuccess: () => toast.success(`${template.name} ${existingRule.status === 'active' ? 'disabled' : 'enabled'}`),
        onError: (e) => toast.error(e.message),
      });
    } else {
      // First-time activation — create rule from template
      activateTemplate.mutate({ template }, {
        onSuccess: () => toast.success(`${template.name} enabled`),
        onError: (e) => toast.error(e.message),
      });
    }
  }

  function toggleCategory(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([category, items]) => {
        const isExpanded = expandedCategories.has(category);
        const activeCount = items.filter((t) => {
          const rule = rules.find((r) => r.template_id === t.template_id && r.is_predefined);
          return rule && rule.status === 'active';
        }).length;
        const firingCount = items.filter((t) => {
          const rule = rules.find((r) => r.template_id === t.template_id && r.is_predefined);
          return rule && rule.status === 'active' && rule.alert_state === 'firing';
        }).length;

        return (
        <Card key={category}>
          <CardContent className="p-0 sm:p-0">
            <button
              type="button"
              onClick={() => toggleCategory(category)}
              className="flex w-full items-center gap-2 px-5 py-3.5 text-left transition-colors hover:bg-muted/30"
            >
              <ChevronDown className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                !isExpanded && '-rotate-90',
              )} />
              <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase', categoryIcons[category] || 'bg-muted text-muted-foreground')}>
                {category}
              </span>
              <span className="text-[11px] text-muted-foreground">{items.length} templates</span>
              <span className="flex-1" />
              {activeCount > 0 && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-[#16A34A]">
                  {activeCount} active
                </span>
              )}
              {firingCount > 0 && (
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-[#DC2626]">
                  {firingCount} firing
                </span>
              )}
            </button>
            {isExpanded && (
            <div className="divide-y divide-border border-t border-border">
              {items.map((template) => {
                const existingRule = rules.find((r) => r.template_id === template.template_id && r.is_predefined);
                const isActive = existingRule ? existingRule.status === 'active' : false;
                const alertState = existingRule?.alert_state;
                const stBadge = alertState && isActive ? STATE_BADGE[alertState] : null;

                return (
                  <div key={template.template_id} className="flex items-start gap-4 px-5 py-4">
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(template)}
                      disabled={activateTemplate.isPending || toggleRule.isPending}
                      className={cn(
                        'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
                        isActive ? 'bg-primary' : 'bg-muted-foreground/20',
                      )}
                    >
                      <span className={cn(
                        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        isActive ? 'left-[22px]' : 'left-0.5',
                      )} />
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{template.name}</span>
                        <span className={cn(
                          'rounded px-2 py-0.5 text-[10px] font-bold uppercase',
                          SEVERITY_COLORS[template.severity]?.bg,
                          SEVERITY_COLORS[template.severity]?.text,
                        )}>
                          {template.severity}
                        </span>
                        {stBadge && (
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold border', stBadge.cls)}>
                            {stBadge.label}
                          </span>
                        )}
                        {existingRule && !isActive && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                            DISABLED
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                      {(existingRule?.service || existingRule?.last_firing_labels) ? (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Resource: <span className="font-medium text-foreground/70">
                            {existingRule.service?.name || existingRule.last_firing_labels?.instance || existingRule.last_firing_labels?.job || 'Unknown'}
                          </span>
                        </p>
                      ) : null}
                      <code className="text-[10px] font-mono text-muted-foreground/60 mt-1 block truncate">
                        {template.query}
                      </code>
                      {existingRule && (
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                          {existingRule.trigger_count > 0 && (
                            <span>triggered {existingRule.trigger_count}x</span>
                          )}
                          {existingRule.last_triggered_at && (
                            <span>last: {formatTimestamp(existingRule.last_triggered_at)}</span>
                          )}
                          {existingRule.last_value !== null && existingRule.last_value !== undefined && (
                            <span>current: <span className="font-mono">{formatCurrentValue(existingRule)}</span></span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}

// ── Main Alerts Page ────────────────────────────────────────────────

export default function AlertsPage() {
  const [activeTab, setActiveTab] = useState<'predefined' | 'custom' | 'silences'>('predefined');
  const [filter, setFilter] = useState<'all' | 'firing' | 'ok' | 'inactive'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  const { data, isLoading, error } = useAlertRules();
  const rules = data?.data ?? [];

  const firingCount = rules.filter((r) => r.alert_state === 'firing' && r.status === 'active').length;
  const activeCount = rules.filter((r) => r.status === 'active').length;
  const customRules = useMemo(() => rules.filter((r) => !r.is_predefined), [rules]);
  const activeSilences = useMemo(() => {
    const now = new Date();
    return rules.flatMap((r) =>
      (r.active_silences || [])
        .filter((s) => new Date(s.end) > now)
        .map((s) => ({ ...s, rule_name: r.name, rule_id: r.id })),
    );
  }, [rules]);

  const filtered = useMemo(() => {
    const base = customRules;
    if (filter === 'all') return base;
    if (filter === 'firing') return base.filter((r) => r.alert_state === 'firing' && r.status === 'active');
    if (filter === 'ok') return base.filter((r) => r.alert_state === 'ok' && r.status === 'active');
    if (filter === 'inactive') return base.filter((r) => r.status === 'inactive');
    return base;
  }, [customRules, filter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alert Rules</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rules.length} rules &middot; {activeCount} active &middot; {firingCount} firing
          </p>
        </div>
        {activeTab === 'custom' && (
          <Button size="sm" onClick={() => { setEditingRule(null); setShowCreate(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Rule
          </Button>
        )}
      </div>

      {/* Firing banner */}
      {firingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[13px] font-bold text-[#DC2626]">
            {firingCount} rule{firingCount > 1 ? 's' : ''} currently FIRING
          </span>
        </div>
      )}

      {/* Top-level tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {([
          { key: 'predefined', label: 'Pre-Defined Alerts' },
          { key: 'custom', label: 'Custom Rules' },
          { key: 'silences', label: `Silences${activeSilences.length ? ` (${activeSilences.length})` : ''}` },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2.5 text-[12px] font-semibold transition-colors border-b-2 -mb-[1px]',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'predefined' && <PreDefinedAlertsTab />}

      {activeTab === 'custom' && (
        <>
          {/* Filter tabs */}
          <div className="flex items-center gap-1.5">
            {([
              { key: 'all', label: `All (${customRules.length})` },
              { key: 'firing', label: `Firing (${customRules.filter((r) => r.alert_state === 'firing' && r.status === 'active').length})` },
              { key: 'ok', label: 'OK' },
              { key: 'inactive', label: 'Inactive' },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors',
                  filter === f.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
              <AlertCircle className="h-4 w-4 text-[#DC2626] shrink-0" />
              <span className="text-[12px] text-[#DC2626]">{(error as Error).message}</span>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Empty state */}
          {!isLoading && customRules.length === 0 && (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                <BellRing className="h-10 w-10 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">No custom alert rules yet</h3>
                <p className="text-[12px] text-muted-foreground mb-4 max-w-sm">
                  Create alert rules to monitor your metrics. Rules evaluate PromQL expressions every 60 seconds
                  and can send notifications to Slack or auto-create incidents.
                </p>
                <Button size="sm" onClick={() => { setEditingRule(null); setShowCreate(true); }}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Create First Rule
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Rule cards */}
          <div className="space-y-3">
            {filtered.map((rule) => (
              <AlertRuleCard
                key={rule.id}
                rule={rule}
                onEdit={() => { setEditingRule(rule); setShowCreate(true); }}
              />
            ))}
          </div>

          {/* Create/Edit modal */}
          {showCreate && (
            <AlertRuleForm
              rule={editingRule}
              onClose={() => { setShowCreate(false); setEditingRule(null); }}
            />
          )}
        </>
      )}

      {activeTab === 'silences' && (
        <div className="space-y-3">
          {activeSilences.length === 0 ? (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                <BellRing className="h-10 w-10 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">No active silences</h3>
                <p className="text-[12px] text-muted-foreground max-w-sm">
                  Silences can be created from individual alert rules to temporarily suppress notifications.
                </p>
              </CardContent>
            </Card>
          ) : (
            activeSilences.map((s) => (
              <Card key={s._id}>
                <CardContent className="p-4 flex items-center gap-4">
                  <BellRing className="h-4 w-4 text-[#A16207] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{(s as any).rule_name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {s.reason || 'No reason given'}
                      {' \u00B7 '}
                      Until {new Date(s.end).toLocaleString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Rule card ─── */

function AlertRuleCard({ rule, onEdit }: { rule: AlertRule; onEdit: () => void }) {
  const sev = SEVERITY_COLORS[rule.severity] || SEVERITY_COLORS.medium;
  const state = STATE_BADGE[rule.alert_state] || STATE_BADGE.ok;
  const isInactive = rule.status === 'inactive';
  const srcType = SOURCE_TYPE_LABEL[rule.source_type] || SOURCE_TYPE_LABEL.managed_promql;
  const activeSilenceCount = (rule.active_silences || []).filter((s) => new Date(s.end) > new Date()).length;

  const { data: escalationPolicies } = useEscalationPolicies({ status: 'active' });
  const escalationPolicyName = useMemo(() => {
    if (!rule.routing?.escalation_policy_id || !escalationPolicies) return null;
    const policy = escalationPolicies.find((p) => p._id === rule.routing!.escalation_policy_id);
    return policy?.name ?? null;
  }, [rule.routing?.escalation_policy_id, escalationPolicies]);

  const toggleRule = useToggleAlertRule();
  const deleteRule = useDeleteAlertRule();
  const testRule = useTestAlertRule();
  const createSilence = useCreateSilence();

  const [showSilenceForm, setShowSilenceForm] = useState(false);
  const [showTestResult, setShowTestResult] = useState(false);
  const [testResult, setTestResult] = useState<SavedRuleTestResult | null>(null);
  const [silenceHours, setSilenceHours] = useState('2');
  const [silenceReason, setSilenceReason] = useState('');

  return (
    <Card className={cn('border-l-[3px]', sev.stripe, isInactive && 'opacity-50')}>
      <CardContent className="p-4 pt-4 sm:p-6 sm:pt-6">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={cn('rounded px-2 py-0.5 text-[10px] font-bold uppercase', sev.bg, sev.text)}>
              {rule.severity}
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold border', srcType.cls)}>
              {srcType.label}
            </span>
            <span className="text-sm font-semibold text-foreground">{rule.name}</span>
            {!isInactive && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold border', state.cls)}>
                {state.label}
                {rule.alert_state === 'firing' && rule.last_triggered_at && (
                  <> &middot; {formatTimestamp(rule.last_triggered_at)}</>
                )}
              </span>
            )}
            {isInactive && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                DISABLED
              </span>
            )}
            {activeSilenceCount > 0 && (
              <span className="rounded-full bg-yellow-500/10 text-[#A16207] border border-yellow-500/20 px-2 py-0.5 text-[10px] font-bold">
                SILENCED ({activeSilenceCount})
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Test"
              onClick={() => testRule.mutate(rule.id, {
                onSuccess: (result) => {
                  setTestResult(result);
                  setShowTestResult(true);
                  toast.success(result.message);
                },
                onError: (e) => toast.error(e.message),
              })}
              disabled={testRule.isPending}
            >
              <TestTube className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={rule.status === 'active' ? 'Disable' : 'Enable'}
              onClick={() => toggleRule.mutate(rule.id, {
                onSuccess: (r) => toast.success(`Rule ${(r as any).status === 'active' ? 'enabled' : 'disabled'}`),
              })}
              disabled={toggleRule.isPending}
            >
              {rule.status === 'active' ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            </button>
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Edit"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Silence"
              onClick={() => setShowSilenceForm(!showSilenceForm)}
            >
              <BellRing className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Delete"
              onClick={() => {
                if (confirm('Delete this alert rule?')) {
                  deleteRule.mutate(rule.id, {
                    onSuccess: () => toast.success('Rule deleted'),
                  });
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Service/resource info */}
        {rule.service ? (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Resource:</span>
            <span className="text-[11px] font-semibold text-foreground/80">{rule.service.name}</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
              rule.service.current_status === 'operational' ? 'bg-emerald-500/10 text-[#16A34A]' :
              rule.service.current_status === 'degraded' ? 'bg-yellow-500/10 text-[#A16207]' :
              'bg-red-500/10 text-[#DC2626]',
            )}>
              {rule.service.current_status}
            </span>
          </div>
        ) : rule.last_firing_labels && (rule.last_firing_labels.instance || rule.last_firing_labels.job) ? (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Resource:</span>
            <span className="text-[11px] font-semibold text-foreground/80">
              {rule.last_firing_labels.instance || rule.last_firing_labels.job}
            </span>
          </div>
        ) : null}

        {/* Condition display */}
        <div className="rounded-lg bg-muted border border-border p-3 sm:p-4 mt-3 mb-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            {rule.source_type === 'managed_promql' ? 'PromQL Query' :
             rule.source_type === 'managed_logql' ? 'LogQL Query' :
             rule.source_type === 'synthetic' ? 'Synthetic Condition' :
             'Webhook Condition'}
          </div>
          <code className="text-[11px] font-mono text-primary break-all leading-relaxed">
            {formatRulePrimaryText(rule)}
          </code>
          <span className="text-[10px] text-muted-foreground ml-2">
            {rule.source_type === 'byos_webhook'
              ? 'event-driven'
              : rule.source_type === 'synthetic'
                ? `for ${rule.for_duration_seconds ? `${Math.round(rule.for_duration_seconds / 60)}m` : '0m'}`
                : `for ${rule.for_duration_seconds ? `${Math.round(rule.for_duration_seconds / 60)}m` : `${rule.condition.window_minutes}m`}`}
          </span>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          {rule.last_value !== null && rule.last_value !== undefined && (
            <span>
              current: <span className="font-mono font-medium text-foreground/70">{formatCurrentValue(rule)}</span>
            </span>
          )}
          {rule.routing?.escalation_policy_id && (
            <span>escalation: <span className="font-medium text-foreground/70">{escalationPolicyName || 'configured'}</span></span>
          )}
          {rule.routing?.oncall_schedule_id && (
            <span>on-call: <span className="font-medium text-foreground/70">configured</span></span>
          )}
          {rule.auto_create_incident && (
            <span>auto-incident: <span className="font-medium text-foreground/70">{rule.incident_severity}</span></span>
          )}
          {rule.webhook_url && (
            <span className="flex items-center gap-1">
              <BellRing className="h-3 w-3" />
              <span className="font-medium text-foreground/70">Slack</span>
            </span>
          )}
          {rule.source_type === 'byos_webhook' && rule.last_webhook_at && (
            <span>last event: <span className="font-medium text-foreground/70">{formatTimestamp(rule.last_webhook_at)}</span></span>
          )}
          {rule.source_type === 'synthetic' && (
            <span>synthetic: <span className="font-medium text-foreground/70">{rule.last_firing_labels?.check_name || 'configured'}</span></span>
          )}
          {rule.trigger_count > 0 && (
            <span>triggered: <span className="font-medium text-foreground/70">{rule.trigger_count}x</span></span>
          )}
          {rule.description && (
            <span className="text-muted-foreground/60">{rule.description}</span>
          )}
        </div>

        {showTestResult && testResult && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold text-foreground">Test Result</p>
              <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setShowTestResult(false)}>Close</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{testResult.message}</p>

            {testResult.kind === 'evaluation' && testResult.result && (
              <>
                <div className={cn(
                  'rounded-lg border px-3 py-2 text-[11px] font-medium',
                  testResult.result.triggered
                    ? 'border-red-500/20 bg-red-500/5 text-[#DC2626]'
                    : 'border-emerald-500/20 bg-emerald-500/5 text-[#16A34A]',
                )}>
                  {testResult.result.triggered ? 'Would fire right now' : 'Would stay OK right now'}
                </div>
                {testResult.result.query_executed && (
                  <code className="block break-all rounded bg-muted px-3 py-2 text-[11px] text-foreground">
                    {testResult.result.query_executed}
                  </code>
                )}
                <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                  <span>value: <span className="font-mono text-foreground/80">{testResult.result.value === null ? 'no data' : testResult.result.value}</span></span>
                  {Object.keys(testResult.result.labels).length > 0 && (
                    <span>labels: <span className="font-mono text-foreground/80">{Object.entries(testResult.result.labels).map(([k, v]) => `${k}=${v}`).join(', ')}</span></span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{testResult.result.explanation}</p>
              </>
            )}

            {testResult.kind === 'webhook' && (
              <>
                {testResult.ingress_path && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Ingress URL</div>
                    <code className="block break-all rounded bg-muted px-3 py-2 text-[11px] text-foreground">{testResult.ingress_path}</code>
                  </div>
                )}
                {testResult.connectivity_test_path && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Connectivity Test</div>
                    <code className="block break-all rounded bg-muted px-3 py-2 text-[11px] text-foreground">{testResult.connectivity_test_path}</code>
                  </div>
                )}
                {testResult.sample_payload && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Sample Payload</div>
                    <code className="block break-all rounded bg-muted px-3 py-2 text-[11px] text-foreground">{JSON.stringify(testResult.sample_payload, null, 2)}</code>
                  </div>
                )}
                {testResult.curl_command && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">cURL Example</div>
                    <code className="block break-all rounded bg-muted px-3 py-2 text-[11px] text-foreground">{testResult.curl_command}</code>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Silence form (inline) */}
        {showSilenceForm && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-muted-foreground">Duration (hours)</label>
              <input
                type="number" min="1" max="720" value={silenceHours}
                onChange={(e) => setSilenceHours(e.target.value)}
                className="w-20 rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] text-foreground"
              />
            </div>
            <input
              value={silenceReason} onChange={(e) => setSilenceReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] text-foreground"
            />
            <div className="flex gap-3">
              <Button size="sm" className="text-[11px]" onClick={() => {
                const now = new Date();
                const end = new Date(now.getTime() + parseInt(silenceHours) * 3600000);
                createSilence.mutate({ ruleId: rule.id, start: now.toISOString(), end: end.toISOString(), reason: silenceReason }, {
                  onSuccess: () => { toast.success('Silence created'); setShowSilenceForm(false); setSilenceReason(''); },
                  onError: (e) => toast.error(e.message),
                });
              }} disabled={createSilence.isPending}>
                {createSilence.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Silence
              </Button>
              <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setShowSilenceForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Create/Edit form modal ─── */

function AlertRuleForm({ rule, onClose }: { rule: AlertRule | null; onClose: () => void }) {
  const isEdit = !!rule;
  const createRule = useCreateAlertRule();
  const updateRule = useUpdateAlertRule();
  const dryRunRule = useDryRunAlertRule();
  const { data: escalationPolicies, isLoading: policiesLoading } = useEscalationPolicies({ status: 'active' });
  const { data: servicesData } = useServices();
  const {
    data: syntheticChecksData,
    isLoading: syntheticChecksLoading,
    error: syntheticChecksError,
  } = useSyntheticChecks();

  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [severity, setSeverity] = useState(rule?.severity ?? 'medium');
  const [sourceType, setSourceType] = useState(rule?.source_type ?? 'managed_promql');
  const [serviceId, setServiceId] = useState(rule?.service_id ?? '');
  const [syntheticCheckId, setSyntheticCheckId] = useState(rule?.synthetic_check_id ?? '');
  const [queryExpr, setQueryExpr] = useState(rule?.query ?? '');
  const [forDuration, setForDuration] = useState(String((rule?.for_duration_seconds ?? 300) / 60));
  const [metricPreset, setMetricPreset] = useState('');
  const [metric, setMetric] = useState(rule?.condition.metric ?? 'up');
  const [operator, setOperator] = useState<AlertOperator>(rule?.condition.operator ?? 'lt');
  const [threshold, setThreshold] = useState(String(rule?.condition.threshold ?? 1));
  const [windowMinutes, setWindowMinutes] = useState(String(rule?.condition.window_minutes ?? 5));
  // Compound conditions: extra conditions beyond the primary one, joined with AND/OR.
  const [conditionLogic, setConditionLogic] = useState<'and' | 'or'>(rule?.condition_logic ?? 'and');
  const [extraConditions, setExtraConditions] = useState<Array<{ metric: string; operator: AlertOperator; threshold: string; query: string }>>(
    (rule?.conditions && rule.conditions.length > 1)
      ? rule.conditions.slice(1).map((c) => ({
          metric: c.metric ?? '',
          operator: c.operator,
          threshold: String(c.threshold ?? 0),
          query: c.query ?? '',
        }))
      : [],
  );
  const [autoIncident, setAutoIncident] = useState(rule?.auto_create_incident ?? false);
  const [incidentSeverity, setIncidentSeverity] = useState<string>(rule?.incident_severity ?? 'sev3');
  const [webhookUrl, setWebhookUrl] = useState(rule?.webhook_url ?? '');
  const [escalationPolicyId, setEscalationPolicyId] = useState(rule?.routing?.escalation_policy_id ?? '');
  const [dryRunResult, setDryRunResult] = useState<AlertRuleDryRunResult | null>(null);

  const isPending = createRule.isPending || updateRule.isPending;
  const services = servicesData?.data ?? [];
  const syntheticChecks = syntheticChecksData?.data ?? [];
  const availableSyntheticChecks = syntheticChecks.filter((check) => !serviceId || check.service_id === serviceId);
  const webhookPath = rule?.source_type === 'byos_webhook' && rule.webhook_secret
    ? `/api/v1/public/alert-rules/webhooks/${rule.id}/${rule.webhook_secret}`
    : null;
  const isSyntheticStatusMetric = sourceType === 'synthetic' && metric === 'status';
  const showsQueryEditor = sourceType === 'managed_promql' || sourceType === 'managed_logql';
  const showsStructuredMetric = sourceType === 'synthetic' || sourceType === 'byos_webhook';
  const showsWindow = sourceType === 'managed_promql' || sourceType === 'managed_logql';
  const showsForDuration = sourceType !== 'byos_webhook';
  const supportsDryRun = sourceType !== 'byos_webhook';
  const metricOptions = [
    { label: 'Consecutive Failures', value: 'consecutive_failures' },
    { label: 'Last Response Time (ms)', value: 'last_response_time_ms' },
    { label: 'Uptime 1h (%)', value: 'uptime_1h' },
    { label: 'Uptime 24h (%)', value: 'uptime_24h' },
    { label: 'Uptime 7d (%)', value: 'uptime_7d' },
    { label: 'Status', value: 'status' },
  ];
  const isQueryDrivenSource = sourceType === 'managed_promql' || sourceType === 'managed_logql';
  const normalizedQueryExpr = queryExpr.trim();
  const normalizedMetric = metric.trim();
  const effectiveMetric = sourceType === 'synthetic'
    ? normalizedMetric
    : sourceType === 'byos_webhook'
      ? (normalizedMetric || 'incoming_value')
      : (normalizedQueryExpr || normalizedMetric);

  useEffect(() => {
    setDryRunResult(null);
  }, [sourceType, syntheticCheckId, queryExpr, metric, operator, threshold, windowMinutes, forDuration, serviceId, extraConditions, conditionLogic]);

  useEffect(() => {
    if (sourceType === 'synthetic' && syntheticCheckId && !availableSyntheticChecks.some((check) => check.id === syntheticCheckId)) {
      setSyntheticCheckId('');
    }
  }, [sourceType, syntheticCheckId, availableSyntheticChecks]);

  function addExtraCondition() {
    setExtraConditions((prev) => [...prev, { metric: '', operator: 'gt', threshold: '0', query: '' }]);
  }
  function removeExtraCondition(index: number) {
    setExtraConditions((prev) => prev.filter((_, i) => i !== index));
  }
  function updateExtraCondition(index: number, patch: Partial<{ metric: string; operator: AlertOperator; threshold: string; query: string }>) {
    setExtraConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  // ── Inline numeric validation (Bugs 1 & 2) ───────────────────────────────
  // Catch bad Window/For/Threshold values client-side with visible messages,
  // instead of sending them to the API and getting confusing per-condition
  // errors (e.g. conditions.0.window_minutes) that look like "ghost" rows.
  const windowError = showsWindow ? intFieldError(windowMinutes, 1, 1440) : null;
  const forError = showsForDuration ? intFieldError(forDuration, 0, 1440) : null;
  const thresholdError = (!isExprLike(operator) && !isSyntheticStatusMetric) ? numFieldError(threshold) : null;

  /** First blocking required/numeric error across the whole form, or null. */
  function firstFormError(): string | null {
    if (windowError) return `Window (min): ${windowError}`;
    if (forError) return `For (min): ${forError}`;
    if (thresholdError) return `Threshold: ${thresholdError}`;
    for (let i = 0; i < extraConditions.length; i++) {
      const c = extraConditions[i];
      if (isExprLike(c.operator)) {
        if (!c.query.trim()) return `Condition ${i + 2}: expression is required`;
      } else {
        if (!c.metric.trim()) return `Condition ${i + 2}: metric is required`;
        const te = numFieldError(c.threshold);
        if (te) return `Condition ${i + 2} threshold: ${te}`;
      }
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (isQueryDrivenSource && !normalizedQueryExpr) {
      toast.error(sourceType === 'managed_logql' ? 'LogQL query is required' : 'PromQL query is required');
      return;
    }
    if (sourceType === 'synthetic' && !normalizedMetric) {
      toast.error('Synthetic metric field is required');
      return;
    }
    if (!effectiveMetric) {
      toast.error('A metric or query is required');
      return;
    }
    const formErr = firstFormError();
    if (formErr) { toast.error(formErr); return; }
    const parsedThreshold = parseFloat(threshold);
    const parsedWindowMinutes = parseInt(windowMinutes, 10);
    const parsedForDurationMinutes = parseInt(forDuration, 10);
    // Assemble compound conditions when the user added extra conditions.
    let compoundConditions: NonNullable<CreateAlertRuleInput['conditions']> | undefined;
    if (isQueryDrivenSource && extraConditions.length > 0) {
      const win = showsWindow ? parsedWindowMinutes : 5;
      const primary = isExprLike(operator)
        ? { operator, query: normalizedQueryExpr, window_minutes: win }
        : { metric: effectiveMetric, operator, threshold: parsedThreshold, window_minutes: win };
      const extras: NonNullable<CreateAlertRuleInput['conditions']> = [];
      for (let i = 0; i < extraConditions.length; i++) {
        const c = extraConditions[i];
        if (isExprLike(c.operator)) {
          const q = c.query.trim();
          if (!q) { toast.error(`Condition ${i + 2}: expression is required`); return; }
          extras.push({ operator: c.operator, query: q, window_minutes: win });
        } else {
          const m = c.metric.trim();
          const t = parseFloat(c.threshold);
          if (!m) { toast.error(`Condition ${i + 2}: metric is required`); return; }
          if (Number.isNaN(t)) { toast.error(`Condition ${i + 2}: threshold must be a number`); return; }
          extras.push({ metric: m, operator: c.operator, threshold: t, window_minutes: win });
        }
      }
      compoundConditions = [primary, ...extras];
    }
    const input: CreateAlertRuleInput = {
      name: name.trim(),
      description: description || undefined,
      service_id: serviceId || null,
      severity: severity as any,
      source_type: sourceType as any,
      synthetic_check_id: sourceType === 'synthetic' ? (syntheticCheckId || null) : null,
      query: sourceType === 'byos_webhook' ? null : (normalizedQueryExpr || null),
      condition: {
        metric: effectiveMetric,
        operator: operator as any,
        threshold: isExprLike(operator) ? 0 : parsedThreshold,
        window_minutes: showsWindow ? parsedWindowMinutes : 5,
        ...(isExprLike(operator) ? { query: normalizedQueryExpr } : {}),
      },
      ...(compoundConditions ? { conditions: compoundConditions, condition_logic: conditionLogic } : {}),
      for_duration_seconds: showsForDuration ? (Number.isNaN(parsedForDurationMinutes) ? 0 : parsedForDurationMinutes) * 60 : 0,
      routing: escalationPolicyId
        ? { escalation_policy_id: escalationPolicyId }
        : undefined,
      auto_create_incident: autoIncident,
      incident_severity: incidentSeverity as any,
      webhook_url: webhookUrl || null,
    };

    if (isEdit) {
      updateRule.mutate({ id: rule!.id, input }, {
        onSuccess: () => { toast.success('Rule updated'); onClose(); },
        onError: (e) => toast.error(e.message),
      });
    } else {
      createRule.mutate(input, {
        onSuccess: () => { toast.success('Rule created'); onClose(); },
        onError: (e) => toast.error(e.message),
      });
    }
  }

  async function handleDryRun() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (isQueryDrivenSource && !normalizedQueryExpr) {
      toast.error(sourceType === 'managed_logql' ? 'LogQL query is required' : 'PromQL query is required');
      return;
    }
    if (sourceType === 'synthetic' && !syntheticCheckId) {
      toast.error('Select a synthetic check first');
      return;
    }
    if (!effectiveMetric) {
      toast.error('A metric or query is required');
      return;
    }
    const formErr = firstFormError();
    if (formErr) { toast.error(formErr); return; }
    const parsedThreshold = parseFloat(threshold);
    const parsedWindowMinutes = parseInt(windowMinutes, 10);
    const parsedForDurationMinutes = parseInt(forDuration, 10);
    const dryWin = showsWindow ? parsedWindowMinutes : 5;
    let dryConditions: NonNullable<CreateAlertRuleInput['conditions']> | undefined;
    if (isQueryDrivenSource && extraConditions.length > 0) {
      const primary = isExprLike(operator)
        ? { operator, query: normalizedQueryExpr, window_minutes: dryWin }
        : { metric: effectiveMetric, operator, threshold: Number.isNaN(parsedThreshold) ? 0 : parsedThreshold, window_minutes: dryWin };
      dryConditions = [
        primary,
        ...extraConditions.map((c) => isExprLike(c.operator)
          ? { operator: c.operator, query: c.query.trim(), window_minutes: dryWin }
          : { metric: c.metric.trim(), operator: c.operator, threshold: parseFloat(c.threshold) || 0, window_minutes: dryWin }),
      ];
    }

    try {
      const result = await dryRunRule.mutateAsync({
        name: name.trim(),
        description: description || undefined,
        service_id: serviceId || null,
        severity: severity as any,
        source_type: sourceType as any,
        synthetic_check_id: sourceType === 'synthetic' ? (syntheticCheckId || null) : null,
        query: sourceType === 'byos_webhook' ? null : (normalizedQueryExpr || null),
        condition: {
          metric: effectiveMetric,
          operator: operator as any,
          threshold: isExprLike(operator) ? 0 : parsedThreshold,
          window_minutes: dryWin,
          ...(isExprLike(operator) ? { query: normalizedQueryExpr } : {}),
        },
        ...(dryConditions ? { conditions: dryConditions, condition_logic: conditionLogic } : {}),
        for_duration_seconds: showsForDuration && !Number.isNaN(parsedForDurationMinutes) ? parsedForDurationMinutes * 60 : 0,
        routing: escalationPolicyId ? { escalation_policy_id: escalationPolicyId } : undefined,
        auto_create_incident: autoIncident,
        incident_severity: incidentSeverity as any,
        webhook_url: webhookUrl || null,
        sample_value: null,
      });
      setDryRunResult(result);
      toast.success('Dry run completed');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{isEdit ? 'Edit Alert Rule' : 'New Alert Rule'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
              placeholder="e.g. High CPU Usage"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
              placeholder="Brief description of what this rule monitors"
            />
          </div>

          {/* Severity */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Severity</label>
            <div className="flex gap-2">
              {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-[11px] font-medium capitalize transition-colors',
                    severity === s
                      ? `${SEVERITY_COLORS[s].bg} ${SEVERITY_COLORS[s].text} border-current`
                      : 'border-border text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Source type */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Source Type</label>
            <div className="flex gap-2 flex-wrap">
              {(['managed_promql', 'managed_logql', 'byos_webhook', 'synthetic'] as const).map((st) => {
                const stl = SOURCE_TYPE_LABEL[st];
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSourceType(st)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors',
                      sourceType === st
                        ? `${stl.cls} border-current`
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {stl.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {sourceType === 'byos_webhook'
                ? 'Webhook rules are event-driven. Send firing or resolved events to the generated endpoint after the rule is created.'
                : sourceType === 'synthetic'
                  ? 'Synthetic rules evaluate a real synthetic check instead of Prometheus data.'
                  : sourceType === 'managed_logql'
                    ? 'LogQL rules query Loki and compare the resulting count/value to the threshold.'
                    : 'PromQL rules query Mimir and compare the resulting value to the threshold.'}
            </p>
          </div>

          {/* Service */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Service (optional)</label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
            >
              <option value="">None</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </div>

          {/* Synthetic target */}
          {sourceType === 'synthetic' && (
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Synthetic Check</label>
              <select
                value={syntheticCheckId}
                onChange={(e) => setSyntheticCheckId(e.target.value)}
                disabled={syntheticChecksLoading}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
              >
                <option value="">
                  {syntheticChecksLoading
                    ? 'Loading synthetic checks...'
                    : syntheticChecksError
                      ? 'Failed to load synthetic checks'
                      : availableSyntheticChecks.length === 0
                        ? 'No synthetic checks available'
                        : 'Select a synthetic check'}
                </option>
                {availableSyntheticChecks.map((check) => (
                  <option key={check.id} value={check.id}>{check.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Thresholds are evaluated against fields like `consecutive_failures`, `last_response_time_ms`, uptime percentages, or a semantic check status.
              </p>
              {syntheticChecksLoading && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Loading synthetic checks for this tenant...
                </p>
              )}
              {syntheticChecksError && (
                <p className="text-[10px] text-[#DC2626] mt-1">
                  Failed to load synthetic checks. {syntheticChecksError.message}
                </p>
              )}
              {!syntheticChecksLoading && !syntheticChecksError && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {serviceId
                    ? `${availableSyntheticChecks.length} synthetic check${availableSyntheticChecks.length !== 1 ? 's' : ''} match the selected service.`
                    : `${syntheticChecks.length} synthetic check${syntheticChecks.length !== 1 ? 's' : ''} available in this tenant.`}
                </p>
              )}
              {!syntheticChecksLoading && !syntheticChecksError && availableSyntheticChecks.length === 0 && (
                <p className="text-[10px] text-[#A16207] mt-1">
                  {serviceId
                    ? 'No synthetic checks are linked to the selected service. Try Service = None or attach a check to this service.'
                    : 'No synthetic checks were returned for this tenant. Create one in Observability -> Synthetics.'}
                </p>
              )}
            </div>
          )}

          {/* Query expression */}
          {showsQueryEditor && (
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Query Expression ({sourceType === 'managed_logql' ? 'LogQL' : 'PromQL'})
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(sourceType === 'managed_logql'
                ? QUERY_EXAMPLES.managed_logql
                : QUERY_EXAMPLES.managed_promql).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQueryExpr(example)}
                  className="rounded border border-border bg-muted/50 px-2 py-1 text-[10px] font-mono text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
            <QueryEditor
              value={queryExpr}
              onChange={setQueryExpr}
              language={sourceType === 'managed_logql' ? 'logql' : 'promql'}
              height="96px"
              placeholder={sourceType === 'managed_logql' ? '{job="api"} |= "error"' : 'rate(http_requests_total[5m])'}
            />
            {isQueryDrivenSource && (
              <p className="text-[10px] text-muted-foreground mt-1 leading-5">
                Start with a metric, function, or log selector. Autocomplete narrows as you type, example chips above can prefill common queries, and the dry run action below is the fastest way to validate the expression before saving.
              </p>
            )}
          </div>
          )}

          {/* Metric preset */}
          {showsStructuredMetric && (
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                {sourceType === 'synthetic' ? 'Synthetic Signal' : 'Incoming Signal'}
              </label>
              {sourceType === 'synthetic' && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {metricOptions.map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => {
                        if (m.value) {
                          setMetric(m.value);
                          setMetricPreset(m.label);
                          if (m.value === 'status') {
                            setOperator('gte');
                            setThreshold('1');
                            setQueryExpr('status');
                          }
                        }
                      }}
                      className={cn(
                        'rounded border border-border px-2 py-0.5 text-[10px] font-medium transition-colors',
                        metricPreset === m.label ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={metric}
                onChange={(e) => {
                  setMetric(e.target.value);
                  setMetricPreset('');
                  if (sourceType === 'synthetic' && e.target.value === 'status') {
                    setOperator('gte');
                    setThreshold('1');
                    setQueryExpr('status');
                  }
                }}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary"
                placeholder={sourceType === 'synthetic' ? 'consecutive_failures' : 'incoming_value'}
                readOnly={isSyntheticStatusMetric}
              />
              {isSyntheticStatusMetric && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Status uses semantic values in the UI: `Up`, `Degraded Or Down`, and `Down`.
                </p>
              )}
              {sourceType === 'byos_webhook' && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  This labels the incoming numeric value in notifications and rule details. The sender still POSTs the actual `value` in the webhook payload.
                </p>
              )}
            </div>
          )}

          {sourceType === 'byos_webhook' && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[11px] font-medium text-foreground">Webhook Ingress</p>
              {webhookPath ? (
                <>
                  <code className="mt-2 block break-all rounded bg-background px-3 py-2 text-[11px] text-foreground">
                    {webhookPath}
                  </code>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {'POST JSON like {"status":"firing","value":1,"labels":{"source":"vendor"}} to fire, or {"status":"resolved","value":0} to resolve.'}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Save the rule first to generate a signed ingress URL.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-3">
                Dry run is unavailable for webhook rules because there is no live upstream event to evaluate. Save the rule, then send a real webhook event to the generated ingress URL or call the `/test` URL to verify connectivity.
              </p>
            </div>
          )}

          {/* Operator + threshold + window + for */}
          <div className={cn('grid gap-3', showsWindow && showsForDuration ? 'grid-cols-4' : showsWindow || showsForDuration ? 'grid-cols-3' : 'grid-cols-2')}>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Operator</label>
              {isSyntheticStatusMetric ? (
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as any)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
                >
                  <option value="eq">is exactly</option>
                  <option value="gte">is at least</option>
                </select>
              ) : (
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as any)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
                >
                  <option value="gt">&gt; greater than</option>
                  <option value="gte">&gt;= greater or equal</option>
                  <option value="lt">&lt; less than</option>
                  <option value="lte">&lt;= less or equal</option>
                  <option value="eq">== equals</option>
                  {isQueryDrivenSource && (
                    <>
                      <option value="expr">matches (expression fires)</option>
                      <option value="absent">does not match (no data)</option>
                    </>
                  )}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Threshold</label>
              {isExprLike(operator) ? (
                <div className="w-full rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {operator === 'absent'
                    ? 'n/a — fires when the query returns no data'
                    : 'n/a — the expression’s result is the trigger'}
                </div>
              ) : isSyntheticStatusMetric ? (
                <select
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
                >
                  {SYNTHETIC_STATUS_OPTIONS
                    .filter((option) => operator === 'eq' || option.value !== '0')
                    .map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
              ) : (
                <input
                  type="number"
                  step="any"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  required
                  aria-invalid={!!thresholdError}
                  className={cn(
                    'w-full rounded-lg border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary',
                    thresholdError ? 'border-red-500' : 'border-border',
                  )}
                />
              )}
              {thresholdError && !isExprLike(operator) && !isSyntheticStatusMetric && (
                <p className="mt-1 text-[10px] text-red-500">{thresholdError}</p>
              )}
            </div>
            {showsWindow && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Window (min)</label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={windowMinutes}
                  onChange={(e) => setWindowMinutes(e.target.value)}
                  required
                  aria-invalid={!!windowError}
                  className={cn(
                    'w-full rounded-lg border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary',
                    windowError ? 'border-red-500' : 'border-border',
                  )}
                />
                {windowError && <p className="mt-1 text-[10px] text-red-500">{windowError}</p>}
              </div>
            )}
            {showsForDuration && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">For (min)</label>
                <input
                  type="number"
                  min="0"
                  max="1440"
                  value={forDuration}
                  onChange={(e) => setForDuration(e.target.value)}
                  aria-invalid={!!forError}
                  className={cn(
                    'w-full rounded-lg border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary',
                    forError ? 'border-red-500' : 'border-border',
                  )}
                />
                {forError && <p className="mt-1 text-[10px] text-red-500">{forError}</p>}
              </div>
            )}
          </div>
          {sourceType === 'synthetic' && (
            <p className="text-[10px] text-muted-foreground -mt-2">
              Synthetic rules compare the latest state of the selected check. `For` still applies, but `Window` does not.
            </p>
          )}
          {sourceType === 'byos_webhook' && (
            <p className="text-[10px] text-muted-foreground -mt-2">
              Webhook rules are evaluated immediately from incoming events, so there is no polling window or pending duration.
            </p>
          )}

          {/* Compound conditions */}
          {isQueryDrivenSource && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-foreground">Additional conditions</label>
                {extraConditions.length > 0 && (
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">Fire when</span>
                    <select
                      value={conditionLogic}
                      onChange={(e) => setConditionLogic(e.target.value as any)}
                      className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground outline-none focus:border-primary"
                    >
                      <option value="and">ALL match (AND)</option>
                      <option value="or">ANY matches (OR)</option>
                    </select>
                  </div>
                )}
              </div>
              {extraConditions.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Combine this with more conditions to fire only when several signals breach together (AND) or when any of them breaches (OR).
                </p>
              )}
              {extraConditions.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-9 shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">{conditionLogic}</span>
                  <select
                    value={c.operator}
                    onChange={(e) => updateExtraCondition(i, { operator: e.target.value as any })}
                    className="shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary"
                  >
                    <option value="gt">&gt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&lt;=</option>
                    <option value="eq">==</option>
                    <option value="expr">expr</option>
                    <option value="absent">absent</option>
                  </select>
                  {isExprLike(c.operator) ? (
                    <input
                      value={c.query}
                      onChange={(e) => updateExtraCondition(i, { query: e.target.value })}
                      placeholder={sourceType === 'managed_logql' ? '{job="api"} |= "error"' : 'rate(errors[5m]) > 0'}
                      className="flex-1 rounded-lg border border-border bg-muted px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-primary"
                    />
                  ) : (
                    <>
                      <input
                        value={c.metric}
                        onChange={(e) => updateExtraCondition(i, { metric: e.target.value })}
                        placeholder="metric or expression"
                        className="flex-1 rounded-lg border border-border bg-muted px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-primary"
                      />
                      <input
                        type="number"
                        step="any"
                        value={c.threshold}
                        onChange={(e) => updateExtraCondition(i, { threshold: e.target.value })}
                        placeholder="0"
                        aria-invalid={!!numFieldError(c.threshold)}
                        className={cn(
                          'w-20 shrink-0 rounded-lg border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary',
                          numFieldError(c.threshold) ? 'border-red-500' : 'border-border',
                        )}
                      />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => removeExtraCondition(i)}
                    className="shrink-0 px-1 text-muted-foreground hover:text-red-500"
                    aria-label="Remove condition"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addExtraCondition}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                + Add condition
              </button>
            </div>
          )}

          {supportsDryRun && dryRunResult && (
            <div className={cn(
              'rounded-lg border p-3 space-y-2',
              dryRunResult.error
                ? 'border-amber-500/30 bg-amber-500/5'
                : dryRunResult.triggered ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5',
            )}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-foreground">Dry Run Result</p>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold border',
                  dryRunResult.error
                    ? 'bg-amber-500/10 text-[#B45309] border-amber-500/30'
                    : dryRunResult.triggered
                      ? 'bg-red-500/10 text-[#DC2626] border-red-500/20'
                      : 'bg-emerald-500/10 text-[#16A34A] border-emerald-500/20',
                )}>
                  {dryRunResult.error ? 'QUERY ERROR' : dryRunResult.triggered ? 'WOULD FIRE' : 'WOULD STAY OK'}
                </span>
              </div>
              {dryRunResult.error && (
                <p className="flex items-start gap-1.5 text-[11px] font-medium text-[#B45309]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>The query was rejected by the backend — fix the syntax before saving, or this rule will never evaluate.</span>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">{dryRunResult.explanation}</p>
              {dryRunResult.query_executed && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Executed</p>
                  <code className="block break-all rounded bg-background px-3 py-2 text-[11px] text-foreground">
                    {dryRunResult.query_executed}
                  </code>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                <span>
                  value: <span className="font-mono text-foreground/80">{dryRunResult.value === null ? 'no data' : dryRunResult.value}</span>
                </span>
                {Object.keys(dryRunResult.labels).length > 0 && (
                  <span>
                    labels: <span className="font-mono text-foreground/80">{Object.entries(dryRunResult.labels).map(([k, v]) => `${k}=${v}`).join(', ')}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Escalation Policy */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Escalation Policy (optional)
            </label>
            <select
              value={escalationPolicyId}
              onChange={(e) => setEscalationPolicyId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
            >
              <option value="">None</option>
              {policiesLoading && <option disabled>Loading...</option>}
              {(escalationPolicies ?? []).map((policy) => (
                <option key={policy._id} value={policy._id}>
                  {policy.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Route alerts through an escalation policy to notify on-call responders
            </p>
          </div>

          {/* Slack webhook */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Slack Webhook URL (optional)
            </label>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Receives FIRING and RESOLVED notifications when the alert state changes
            </p>
          </div>

          {/* Auto-create incident */}
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoIncident}
                onChange={(e) => setAutoIncident(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-[12px] font-medium text-foreground">Auto-create incident when firing</span>
            </label>
            {autoIncident && (
              <div className="mt-2 ml-6">
                <select
                  value={incidentSeverity}
                  onChange={(e) => setIncidentSeverity(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] text-foreground outline-none focus:border-primary"
                >
                  <option value="sev1">SEV-1 (Critical)</option>
                  <option value="sev2">SEV-2 (High)</option>
                  <option value="sev3">SEV-3 (Medium)</option>
                  <option value="sev4">SEV-4 (Low)</option>
                </select>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {supportsDryRun && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDryRun}
                disabled={
                  dryRunRule.isPending
                  || !name.trim()
                  || (isQueryDrivenSource && !normalizedQueryExpr)
                  || (sourceType === 'synthetic' && (!syntheticCheckId || !normalizedMetric))
                }
              >
                {dryRunRule.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
                Dry Run
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={
                isPending
                || !name.trim()
                || (isQueryDrivenSource && !normalizedQueryExpr)
                || (sourceType === 'synthetic' && (!syntheticCheckId || !normalizedMetric))
                || (sourceType === 'byos_webhook' && !effectiveMetric)
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              {isEdit ? 'Update Rule' : 'Create Rule'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
