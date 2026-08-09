'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  ArrowLeft,
  Save,
  Trash2,
  Shield,
  Clock,
  DollarSign,
  Zap,
} from 'lucide-react';
import {
  useInstalledAgents,
  useUpdateAgentConfig,
  useUninstallAgent,
  type AgentInstallation,
} from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

const AUTONOMY_LEVELS = [
  { value: 'observe', label: 'Observe', desc: 'Monitors only, no recommendations' },
  { value: 'recommend', label: 'Recommend', desc: 'Suggests actions, requires approval for all' },
  { value: 'auto_low', label: 'Auto (Low Risk)', desc: 'Executes low-risk actions, approves rest' },
  { value: 'auto_full', label: 'Auto (Full)', desc: 'Executes all actions within budget' },
] as const;

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

export default function AgentSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { data: installed } = useInstalledAgents();
  const updateConfig = useUpdateAgentConfig(slug);
  const uninstallAgent = useUninstallAgent();

  const agent = installed?.find((a) => a.agent_slug === slug);

  const [autonomy, setAutonomy] = useState(agent?.autonomy_level ?? 'recommend');
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [maxActions, setMaxActions] = useState(agent?.configuration?.max_actions_per_execution ?? 10);
  const [maxExecPerHour, setMaxExecPerHour] = useState(agent?.configuration?.max_executions_per_hour ?? 20);
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState(agent?.configuration?.monthly_token_budget ?? 500000);
  const [monthlyCostBudget, setMonthlyCostBudget] = useState(agent?.configuration?.monthly_cost_budget_cents ?? 5000);
  const [approvalThreshold, setApprovalThreshold] = useState(agent?.configuration?.require_approval_above_risk ?? 'medium');
  const [quietEnabled, setQuietEnabled] = useState(agent?.configuration?.quiet_hours?.enabled ?? false);
  const [quietStart, setQuietStart] = useState(agent?.configuration?.quiet_hours?.start_hour ?? 22);
  const [quietEnd, setQuietEnd] = useState(agent?.configuration?.quiet_hours?.end_hour ?? 6);
  const [dirty, setDirty] = useState(false);

  function markDirty() {
    setDirty(true);
  }

  function handleSave() {
    updateConfig.mutate(
      {
        enabled,
        autonomy_level: autonomy as AgentInstallation['autonomy_level'],
        configuration: {
          max_actions_per_execution: maxActions,
          max_executions_per_hour: maxExecPerHour,
          monthly_token_budget: monthlyTokenBudget,
          monthly_cost_budget_cents: monthlyCostBudget,
          require_approval_above_risk: approvalThreshold,
          blocked_actions: agent?.configuration?.blocked_actions ?? [],
          quiet_hours: {
            enabled: quietEnabled,
            start_hour: quietStart,
            end_hour: quietEnd,
            days: agent?.configuration?.quiet_hours?.days ?? [0, 1, 2, 3, 4, 5, 6],
          },
        },
      } as Partial<AgentInstallation>,
      { onSuccess: () => setDirty(false) },
    );
  }

  function handleUninstall() {
    if (!confirm('Are you sure you want to uninstall this agent?')) return;
    uninstallAgent.mutate(slug, {
      onSuccess: () => router.push('/agents'),
    });
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Agents
        </Link>
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Agent not installed.</p>
        </div>
      </div>
    );
  }

  const displayName = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to Agents
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-6 w-6" /> {displayName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure agent behavior and limits</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleUninstall}
            disabled={uninstallAgent.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" /> Uninstall
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || updateConfig.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {updateConfig.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Enable/Disable */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Agent Status</h2>
            <p className="text-xs text-muted-foreground mt-1">Enable or disable this agent</p>
          </div>
          <button
            onClick={() => { setEnabled(!enabled); markDirty(); }}
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span className={cn(
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform',
              enabled && 'translate-x-5',
            )} />
          </button>
        </div>
      </div>

      {/* Autonomy Level */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
          <Shield className="h-4 w-4 text-primary" /> Autonomy Level
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {AUTONOMY_LEVELS.map((level) => (
            <button
              key={level.value}
              onClick={() => { setAutonomy(level.value); markDirty(); }}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                autonomy === level.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30',
              )}
            >
              <p className="text-sm font-medium text-foreground">{level.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{level.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Execution Limits */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
          <Zap className="h-4 w-4 text-primary" /> Execution Limits
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Max actions per execution</span>
            <input
              type="number" min={1} max={50} value={maxActions}
              onChange={(e) => { setMaxActions(Number(e.target.value)); markDirty(); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Max executions per hour</span>
            <input
              type="number" min={1} max={100} value={maxExecPerHour}
              onChange={(e) => { setMaxExecPerHour(Number(e.target.value)); markDirty(); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Approval required above risk</span>
            <select
              value={approvalThreshold}
              onChange={(e) => { setApprovalThreshold(e.target.value); markDirty(); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {RISK_LEVELS.map((r) => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Budget */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
          <DollarSign className="h-4 w-4 text-primary" /> Budget
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Monthly token budget</span>
            <input
              type="number" min={10000} value={monthlyTokenBudget}
              onChange={(e) => { setMonthlyTokenBudget(Number(e.target.value)); markDirty(); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Monthly cost budget (cents)</span>
            <input
              type="number" min={0} value={monthlyCostBudget}
              onChange={(e) => { setMonthlyCostBudget(Number(e.target.value)); markDirty(); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <p className="text-[10px] text-muted-foreground">${(monthlyCostBudget / 100).toFixed(2)}/month</p>
          </label>
        </div>
      </div>

      {/* Quiet Hours */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 text-primary" /> Quiet Hours
          </h2>
          <button
            onClick={() => { setQuietEnabled(!quietEnabled); markDirty(); }}
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              quietEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span className={cn(
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform',
              quietEnabled && 'translate-x-5',
            )} />
          </button>
        </div>
        {quietEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Start hour (0-23)</span>
              <input
                type="number" min={0} max={23} value={quietStart}
                onChange={(e) => { setQuietStart(Number(e.target.value)); markDirty(); }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">End hour (0-23)</span>
              <input
                type="number" min={0} max={23} value={quietEnd}
                onChange={(e) => { setQuietEnd(Number(e.target.value)); markDirty(); }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
