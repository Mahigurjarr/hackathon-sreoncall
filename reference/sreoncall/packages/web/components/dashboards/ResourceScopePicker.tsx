'use client';

import { useMemo, useState } from 'react';
import { Layers, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useServices } from '@/lib/hooks/useServices';
import { useResourceScopeStore, type ResourceScope } from '@/lib/stores/resource-scope';

/**
 * Platform-wide resource-scope picker. Values are sourced from the tenant's
 * Service inventory (service.cloud_metadata.*) so only clusters/namespaces/
 * regions that actually exist in the tenant appear in the dropdowns.
 *
 * Selection persists in localStorage via useResourceScopeStore and applies
 * to every dashboard panel query (via PanelRenderer → useQueryPanel →
 * injectScopeLabels).
 */
const DIMENSIONS: Array<{ key: keyof ResourceScope; label: string; field: 'cluster' | 'namespace' | 'region' | 'service_name' }> = [
  { key: 'service_name', label: 'Service', field: 'service_name' },
  { key: 'cluster',      label: 'Cluster', field: 'cluster' },
  { key: 'namespace',    label: 'Namespace', field: 'namespace' },
  { key: 'region',       label: 'Region', field: 'region' },
];

export default function ResourceScopePicker() {
  const { scope, setScope, clearScope } = useResourceScopeStore();
  const { data } = useServices();

  // Build the option set for each dimension from the services inventory —
  // deduplicated and alphabetized. A dimension with no values is hidden.
  const optionsByDim = useMemo(() => {
    const result: Record<string, string[]> = { cluster: [], namespace: [], region: [], service_name: [] };
    for (const svc of data?.data ?? []) {
      if (svc.name) result.service_name!.push(svc.name);
      const md = svc.cloud_metadata;
      if (!md) continue;
      if (md.cluster) result.cluster!.push(md.cluster);
      if (md.namespace) result.namespace!.push(md.namespace);
      if (md.region) result.region!.push(md.region);
    }
    for (const key of Object.keys(result)) {
      result[key] = Array.from(new Set(result[key]!)).sort();
    }
    return result;
  }, [data]);

  const activeCount = Object.values(scope).filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        <span className="font-medium">Scope</span>
      </div>
      {DIMENSIONS.map((dim) => {
        const options = optionsByDim[dim.field] ?? [];
        if (options.length === 0) return null;
        return (
          <ScopeDim
            key={dim.key}
            label={dim.label}
            value={scope[dim.key]}
            options={options}
            onChange={(val) => setScope({ [dim.key]: val })}
          />
        );
      })}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearScope}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}

function ScopeDim({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: string[];
  onChange: (val: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cn(
          'flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]',
          value ? 'border-primary/50 bg-primary/10 text-primary font-medium' : 'text-foreground',
        )}
      >
        <span className="text-muted-foreground">{label}:</span>
        <span className="max-w-[140px] truncate">{value ?? 'Any'}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 w-52 rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border/40 p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded border border-input bg-background px-2 py-1 text-[11px] outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(undefined);
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-accent/40"
            >
              Any
            </button>
            {filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-left text-[11px] hover:bg-accent/40',
                  value === opt && 'bg-primary/10 text-primary',
                )}
              >
                <span className="truncate">{opt}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
