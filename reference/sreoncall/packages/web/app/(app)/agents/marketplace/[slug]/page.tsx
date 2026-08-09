'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Bot, ArrowLeft, Check, Tag, Zap, Radio } from 'lucide-react';
import {
  useAgentDetail,
  useInstalledAgents,
  useInstallAgent,
  useUninstallAgent,
} from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

export default function AgentDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: agent, isLoading } = useAgentDetail(slug);
  const { data: installed } = useInstalledAgents();
  const installAgent = useInstallAgent();
  const uninstallAgent = useUninstallAgent();

  const isInstalled = useMemo(
    () => installed?.some((a) => a.agent_slug === slug) ?? false,
    [installed, slug],
  );

  const isMutating = installAgent.isPending || uninstallAgent.isPending;

  function handleInstall() {
    installAgent.mutate({ agent_slug: slug });
  }

  function handleUninstall() {
    uninstallAgent.mutate(slug);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted/50" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <Link
          href="/agents/marketplace"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Marketplace
        </Link>
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Agent not found.</p>
        </div>
      </div>
    );
  }

  const price =
    agent.pricing.monthly_cents > 0
      ? `$${(agent.pricing.monthly_cents / 100).toFixed(2)}/mo`
      : 'Free';

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        href="/agents/marketplace"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Marketplace
      </Link>

      {/* Agent Header */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">
                  {agent.display_name}
                </h1>
                {agent.is_beta && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Beta
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {agent.category} &middot; v{agent.version}
              </p>
              <div className="mt-2 flex items-center gap-1 text-sm font-medium text-foreground">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                {price}
              </div>
            </div>
          </div>

          <button
            onClick={isInstalled ? handleUninstall : handleInstall}
            disabled={isMutating}
            className={cn(
              'shrink-0 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-60',
              isInstalled
                ? 'border border-red-300 bg-transparent text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {isMutating ? (
              'Processing...'
            ) : isInstalled ? (
              'Uninstall'
            ) : (
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4" />
                Install Agent
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">About</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
          {agent.long_description || agent.description}
        </p>
      </div>

      {/* Capabilities & Triggers */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Capabilities */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Zap className="h-4 w-4 text-primary" />
            Capabilities
          </h2>
          {agent.capabilities.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {agent.capabilities.map((cap) => (
                <li
                  key={cap}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                  {cap}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No capabilities listed.
            </p>
          )}
        </div>

        {/* Triggers */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Radio className="h-4 w-4 text-primary" />
            Triggers
          </h2>
          {agent.triggers.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {agent.triggers.map((trigger) => (
                <li
                  key={trigger}
                  className="inline-flex mr-2 mb-2 items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {trigger}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No triggers listed.
            </p>
          )}
        </div>
      </div>

      {/* Requirements */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Requirements</h2>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span>
            Required plan:{' '}
            <span className="font-medium text-foreground">
              {agent.required_plan || 'Any'}
            </span>
          </span>
          {agent.tenant_type_restriction && (
            <span>
              Tenant type:{' '}
              <span className="font-medium text-foreground">
                {agent.tenant_type_restriction}
              </span>
            </span>
          )}
          <span>
            Model:{' '}
            <span className="font-medium text-foreground">
              {agent.llm_config.primary_model}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
