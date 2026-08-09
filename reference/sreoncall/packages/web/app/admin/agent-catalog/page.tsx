'use client';

import { useState } from 'react';
import {
  Bot,
  Crown,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { useAgentCatalog, type AgentDefinition } from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

export default function AgentCatalogPage() {
  const { data: catalog, isLoading } = useAgentCatalog();
  const [search, setSearch] = useState('');

  const filtered = catalog?.filter(
    (a) =>
      !search ||
      a.display_name.toLowerCase().includes(search.toLowerCase()) ||
      a.slug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Crown className="h-6 w-6 text-amber-500" /> Agent Catalog Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform admin: manage agent definitions, pricing, and availability
        </p>
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

      {/* Catalog Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-muted/50" />
          ))}
        </div>
      ) : !filtered?.length ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No agents found.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Agent</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((agent) => (
                <AgentRow key={agent.slug} agent={agent} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {catalog && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-bold text-foreground">{catalog.length}</p>
            <p className="text-xs text-muted-foreground">Total Agents</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-bold text-foreground">
              {catalog.filter((a) => a.is_active).length}
            </p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-bold text-foreground">
              {catalog.filter((a) => a.is_beta).length}
            </p>
            <p className="text-xs text-muted-foreground">Beta</p>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentDefinition }) {
  const price =
    agent.pricing.monthly_cents > 0
      ? `$${(agent.pricing.monthly_cents / 100).toFixed(0)}/mo`
      : 'Free';

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="font-medium text-foreground">{agent.display_name}</p>
            <p className="text-[10px] text-muted-foreground">{agent.slug}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{agent.category}</td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {agent.required_plan || 'any'}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1 text-foreground">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {price}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn(
            'h-2 w-2 rounded-full',
            agent.is_active ? 'bg-green-500' : 'bg-slate-400',
          )} />
          <span className="text-xs text-muted-foreground">
            {agent.is_active ? 'Active' : 'Inactive'}
          </span>
          {agent.is_beta && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Beta
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{agent.version}</td>
    </tr>
  );
}
