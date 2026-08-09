'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Shield,
  Bot,
} from 'lucide-react';
import {
  useAgentApprovals,
  useDecideApproval,
  type AgentApproval,
} from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

const STATUS_TABS = ['pending', 'approved', 'rejected'] as const;

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-amber-500',
  high: 'text-orange-500',
  critical: 'text-red-500',
};

export default function AgentApprovalsPage() {
  const [activeTab, setActiveTab] = useState<(typeof STATUS_TABS)[number]>('pending');
  const { data: approvals, isLoading } = useAgentApprovals(activeTab);
  const decide = useDecideApproval();

  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({});

  function handleDecide(id: string, decision: 'approved' | 'rejected') {
    decide.mutate({
      id,
      decision,
      reason: decisionReason[id] || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to Agents
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6" /> Agent Approvals
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and approve or reject agent actions
          </p>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors',
              activeTab === tab
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Approval List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-muted/50" />
          ))}
        </div>
      ) : !approvals?.length ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <CheckCircle className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No {activeTab} approvals.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval._id}
              approval={approval}
              isPending={activeTab === 'pending'}
              isDeciding={decide.isPending}
              reason={decisionReason[approval._id] || ''}
              onReasonChange={(val) =>
                setDecisionReason((prev) => ({ ...prev, [approval._id]: val }))
              }
              onApprove={() => handleDecide(approval._id, 'approved')}
              onReject={() => handleDecide(approval._id, 'rejected')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  isPending,
  isDeciding,
  reason,
  onReasonChange,
  onApprove,
  onReject,
}: {
  approval: AgentApproval;
  isPending: boolean;
  isDeciding: boolean;
  reason: string;
  onReasonChange: (val: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const agentName = approval.agent_slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const expiresAt = new Date(approval.expires_at);
  const isExpired = expiresAt < new Date();
  const timeLeft = isExpired
    ? 'Expired'
    : `Expires ${expiresAt.toLocaleString()}`;

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
              {approval.action.action_type}: {approval.action.description}
            </p>
            {approval.action.reasoning && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Reasoning: {approval.action.reasoning}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', RISK_COLORS[approval.action.risk_level])}>
            {approval.action.risk_level} risk
          </span>
          <span className={cn('text-xs font-medium', PRIORITY_COLORS[approval.priority])}>
            {approval.priority}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>{timeLeft}</span>
        <span className="mx-1">&middot;</span>
        <span>Requested {new Date(approval.requested_at).toLocaleString()}</span>
      </div>

      {isPending && !isExpired && (
        <div className="mt-3 border-t border-border pt-3">
          <input
            type="text"
            placeholder="Optional reason..."
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex gap-2">
            <button
              onClick={onApprove}
              disabled={isDeciding}
              className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              <CheckCircle className="h-3 w-3" /> Approve
            </button>
            <button
              onClick={onReject}
              disabled={isDeciding}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <XCircle className="h-3 w-3" /> Reject
            </button>
          </div>
        </div>
      )}

      {approval.decided_by && (
        <div className="mt-2 text-xs text-muted-foreground">
          {approval.status === 'approved' ? 'Approved' : 'Rejected'} by {approval.decided_by}
          {approval.decision_reason && ` — ${approval.decision_reason}`}
        </div>
      )}
    </div>
  );
}
