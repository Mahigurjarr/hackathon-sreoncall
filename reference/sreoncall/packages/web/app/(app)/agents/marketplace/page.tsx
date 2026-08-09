'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Bot, Store, Check, Tag, Search, X } from 'lucide-react';
import {
  useAgentCatalog,
  useInstalledAgents,
  useInstallAgent,
  type AgentDefinition,
} from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  'All',
  'Incident Response',
  'Observability',
  'Change Management',
  'Security',
  'Communication',
  'Analytics',
] as const;

type Category = (typeof CATEGORIES)[number];

export default function AgentMarketplacePage() {
  const { data: catalog, isLoading: catalogLoading } = useAgentCatalog();
  const { data: installed } = useInstalledAgents();
  const installAgent = useInstallAgent();

  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [search, setSearch] = useState('');

  const installedSlugs = useMemo(
    () => new Set(installed?.map((a) => a.agent_slug) ?? []),
    [installed],
  );

  const filteredAgents = useMemo(() => {
    if (!catalog) return [];
    return catalog.filter((agent) => {
      const matchesCategory =
        activeCategory === 'All' ||
        agent.category.toLowerCase() === activeCategory.toLowerCase();
      const matchesSearch =
        !search ||
        agent.display_name.toLowerCase().includes(search.toLowerCase()) ||
        agent.description.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [catalog, activeCategory, search]);

  function handleInstall(slug: string) {
    installAgent.mutate({ agent_slug: slug });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Store className="h-6 w-6" />
            Agent Marketplace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and install AI agents to automate your SRE workflows
          </p>
        </div>
        <Link
          href="/agents"
          className="text-sm text-primary hover:underline"
        >
          Back to Command Center
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Agent Grid */}
      {catalogLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-lg border border-border bg-muted/50"
            />
          ))}
        </div>
      ) : !filteredAgents.length ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {search || activeCategory !== 'All'
              ? 'No agents match your filters.'
              : 'No agents available yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.slug}
              agent={agent}
              isInstalled={installedSlugs.has(agent.slug)}
              isInstalling={
                installAgent.isPending &&
                (installAgent.variables as { agent_slug: string } | undefined)
                  ?.agent_slug === agent.slug
              }
              onInstall={() => handleInstall(agent.slug)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  isInstalled,
  isInstalling,
  onInstall,
}: {
  agent: AgentDefinition;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
}) {
  const price =
    agent.pricing.monthly_cents > 0
      ? `$${(agent.pricing.monthly_cents / 100).toFixed(2)}/mo`
      : 'Free';

  return (
    <div className="group relative flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/30">
      <Link
        href={`/agents/marketplace/${agent.slug}`}
        className="absolute inset-0 z-0 rounded-lg"
        aria-label={`View ${agent.display_name} details`}
      />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {agent.display_name}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {agent.category}
            </span>
          </div>
        </div>
        {agent.is_beta && (
          <span className="rounded-full bg-[#FEFCE8] px-2 py-0.5 text-[10px] font-medium text-[#A16207] dark:bg-amber-900/30 dark:text-amber-400">
            Beta
          </span>
        )}
      </div>

      <p className="mt-3 flex-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">
        {agent.description}
      </p>

      <div className="mt-4 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-medium text-foreground">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {price}
        </span>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isInstalled && !isInstalling) onInstall();
          }}
          disabled={isInstalled || isInstalling}
          className={cn(
            'relative z-10 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            isInstalled
              ? 'bg-[#F0FDF4] text-[#16A34A] dark:bg-green-900/30 dark:text-green-400'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
          )}
        >
          {isInstalled ? (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              Installed
            </span>
          ) : isInstalling ? (
            'Installing...'
          ) : (
            'Install'
          )}
        </button>
      </div>
    </div>
  );
}
