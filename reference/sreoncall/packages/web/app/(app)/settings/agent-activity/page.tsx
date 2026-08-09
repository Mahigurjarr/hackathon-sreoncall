'use client';

import { Bot, Activity, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useConsumerAgentActivity, type AgentExecution } from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  awaiting_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  queued: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

export default function ConsumerAgentActivityPage() {
  const { data: activity, isLoading } = useConsumerAgentActivity();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Activity className="h-5 w-5" /> Agent Activity
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          View AI agent actions performed on your environment by your provider
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-muted/50" />
          ))}
        </div>
      ) : !activity?.items?.length ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No agent activity yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            When your provider runs AI agents on your behalf, activity will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activity.items.map((exec) => (
            <ExecutionRow key={exec._id} exec={exec} />
          ))}
          {activity.total > activity.items.length && (
            <p className="text-center text-xs text-muted-foreground">
              Showing {activity.items.length} of {activity.total} executions
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ExecutionRow({ exec }: { exec: AgentExecution }) {
  const agentName = exec.agent_slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const StatusIcon =
    exec.status === 'completed' ? CheckCircle :
    exec.status === 'failed' ? XCircle :
    exec.status === 'running' ? Loader2 :
    Clock;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{agentName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {exec.outcome?.summary || exec.context_summary || 'Processing...'}
            </p>
          </div>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_STYLES[exec.status] || STATUS_STYLES.queued)}>
          {exec.status}
        </span>
      </div>

      {/* Actions taken */}
      {exec.actions_taken.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Actions</p>
          <div className="space-y-1">
            {exec.actions_taken.map((action, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  action.status === 'executed' ? 'bg-green-500' :
                  action.status === 'failed' ? 'bg-red-500' :
                  'bg-gray-400',
                )} />
                <span>{action.action_type}: {action.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {exec.recommendations.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Recommendations</p>
          <div className="space-y-1">
            {exec.recommendations.map((rec, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {rec.description}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{new Date(exec.started_at).toLocaleString()}</span>
        {exec.duration_ms > 0 && <span>{(exec.duration_ms / 1000).toFixed(1)}s</span>}
        {exec.cost_cents > 0 && <span>${(exec.cost_cents / 100).toFixed(2)}</span>}
      </div>
    </div>
  );
}
