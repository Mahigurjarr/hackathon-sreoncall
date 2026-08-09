'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Bot, CheckCircle, Zap, DollarSign, ArrowRight, Activity } from 'lucide-react';
import { useInstalledAgents, useAgentExecutions, useAgentApprovals, useAgentUsage } from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

const AUTONOMY_COLORS: Record<string, string> = {
  observe: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  recommend: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  auto_low: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  auto_full: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function AgentCommandCenter() {
  const { data: session } = useSession();
  const { data: installed } = useInstalledAgents();
  const { data: executions } = useAgentExecutions();
  const { data: approvals } = useAgentApprovals('pending');
  const { data: usage } = useAgentUsage();

  const activeCount = installed?.filter((a) => a.enabled).length ?? 0;
  const todayActions = executions?.items?.length ?? 0;
  const pendingApprovals = approvals?.length ?? 0;
  const monthlyCost = usage?.total?.cost_cents ? (usage.total.cost_cents / 100).toFixed(2) : '0.00';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agent Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">Monitor and manage your AI agents</p>
        </div>
        <Link
          href="/agents/marketplace"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Bot className="h-4 w-4" />
          Marketplace
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Bot} label="Active Agents" value={String(activeCount)} />
        <StatCard icon={Zap} label="Actions Today" value={String(todayActions)} />
        <StatCard
          icon={CheckCircle}
          label="Pending Approvals"
          value={String(pendingApprovals)}
          href="/agents/approvals"
          highlight={pendingApprovals > 0}
        />
        <StatCard icon={DollarSign} label="Monthly Cost" value={`$${monthlyCost}`} />
      </div>

      {/* Installed Agents */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Installed Agents</h2>
        {!installed?.length ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No agents installed yet.</p>
            <Link href="/agents/marketplace" className="mt-2 inline-block text-sm text-primary hover:underline">
              Browse the marketplace
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {installed.map((agent) => (
              <Link
                key={agent.agent_slug}
                href={`/agents/settings/${agent.agent_slug}`}
                className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{agent.agent_slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</p>
                      <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium', AUTONOMY_COLORS[agent.autonomy_level])}>
                        {agent.autonomy_level.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                  <div className={cn('h-2 w-2 rounded-full', agent.enabled ? 'bg-green-500' : 'bg-gray-400')} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Recent Activity</h2>
          <Link href="/agents/executions" className="text-sm text-primary hover:underline flex items-center gap-1">
            View All <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {!executions?.items?.length ? (
          <p className="text-sm text-muted-foreground">No recent agent activity.</p>
        ) : (
          <div className="space-y-2">
            {executions.items.slice(0, 5).map((exec) => (
              <div key={exec._id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <Activity className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{exec.agent_slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    {' — '}
                    {exec.outcome?.summary || exec.context_summary || 'Processing...'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(exec.started_at).toLocaleString()} · {exec.status}
                    {exec.cost_cents > 0 && ` · $${(exec.cost_cents / 100).toFixed(2)}`}
                  </p>
                </div>
                <span className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  exec.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  exec.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                  exec.status === 'awaiting_approval' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                )}>
                  {exec.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, href, highlight }: {
  icon: any;
  label: string;
  value: string;
  href?: string;
  highlight?: boolean;
}) {
  const content = (
    <div className={cn(
      'rounded-lg border border-border bg-card p-4',
      href && 'hover:border-primary/30 transition-colors cursor-pointer',
      highlight && 'border-amber-500/50',
    )}>
      <div className="flex items-center gap-3">
        <Icon className={cn('h-5 w-5', highlight ? 'text-amber-500' : 'text-muted-foreground')} />
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
