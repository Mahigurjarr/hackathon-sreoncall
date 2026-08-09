'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Loader2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { DashboardVariable } from '@/lib/hooks/useDashboards';

export type VariableSelections = Record<string, string[]>;

/** Substitute $varName tokens in a match_template with current selection values. */
function resolveMatchTemplate(template: string, selections: VariableSelections): string {
  return template.replace(/\$(\w+)/g, (_, varName) => {
    const vals = (selections[varName] ?? []).filter(Boolean);
    if (vals.length === 0) return '.*';
    return vals.length === 1 ? vals[0]! : vals.join('|');
  });
}

export default function DashboardVariablesBar({
  variables,
  selections,
  onChange,
}: {
  variables: DashboardVariable[];
  selections: VariableSelections;
  onChange: (next: VariableSelections) => void;
}) {
  if (variables.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {variables.map((v, idx) => {
        const matchQuery = v.source.match_template
          ? resolveMatchTemplate(v.source.match_template, selections)
          : undefined;
        return (
          <VariableControl
            key={v.name}
            variable={v}
            value={selections[v.name] ?? []}
            matchQuery={matchQuery}
            onChange={(next) => {
              // Clear selections for all downstream variables (those that depend on this one)
              const downstream: Record<string, string[]> = {};
              for (let i = idx + 1; i < variables.length; i++) {
                const dep = variables[i]!;
                if (dep.source.match_template?.includes(`$${v.name}`)) {
                  downstream[dep.name] = [];
                }
              }
              onChange({ ...selections, [v.name]: next, ...downstream });
            }}
          />
        );
      })}
    </div>
  );
}

function VariableControl({
  variable,
  value,
  matchQuery,
  onChange,
}: {
  variable: DashboardVariable;
  value: string[];
  matchQuery?: string;
  onChange: (next: string[]) => void;
}) {
  // Declare open first so we can gate the fetch on it (lazy load — avoids N
  // concurrent requests on page load that can trigger rate limits).
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');

  const { data: fetched, isLoading, isError, error, refetch } = useLabelValues(
    variable.type === 'query' && open ? variable.source.label_name ?? null : null,
    matchQuery,
  );

  const options: string[] = useMemo(() => {
    if (variable.type === 'query') return fetched ?? [];
    return variable.source.values ?? [];
  }, [variable, fetched]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      return;
    }
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  function toggle(val: string) {
    if (variable.multi) {
      if (value.includes(val)) onChange(value.filter((v) => v !== val));
      else onChange([...value, val]);
    } else {
      onChange([val]);
      setOpen(false);
    }
  }

  function clearAll() {
    onChange([]);
  }

  const displayText = value.length === 0
    ? 'All'
    : value.length === 1
      ? value[0]
      : `${value.length} selected`;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">{variable.label}:</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 font-medium text-foreground',
            'hover:bg-accent/50',
            value.length > 0 && 'border-primary/50 bg-primary/10 text-primary',
          )}
        >
          <span className="max-w-[180px] truncate">{displayText}</span>
          {value.length > 0 && (
            <X
              className="h-3 w-3 opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
            />
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 w-56 rounded-md border border-border bg-popover shadow-lg">
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
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            )}
            {isError && (
              <div className="px-3 py-2 text-[11px] text-destructive space-y-1">
                <p>{(error as Error)?.message || 'Failed to load values'}</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="text-primary hover:underline text-[11px]"
                >
                  Retry
                </button>
              </div>
            )}
            {!isLoading && !isError && (
              <>
                {/* "All" row — always shown so the user can reset from inside the dropdown */}
                <button
                  type="button"
                  onClick={() => { onChange([]); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-accent/40"
                >
                  <div
                    className={cn(
                      'flex h-3.5 w-3.5 flex-none items-center justify-center rounded border',
                      value.length === 0
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background',
                    )}
                  >
                    {value.length === 0 && <Check className="h-2.5 w-2.5" />}
                  </div>
                  <span className="truncate italic text-muted-foreground">All</span>
                </button>
                {filtered.length === 0 && options.length > 0 && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">No matches</div>
                )}
                {filtered.map((opt) => {
                  const checked = value.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-accent/40"
                    >
                      <div
                        className={cn(
                          'flex h-3.5 w-3.5 flex-none items-center justify-center rounded border',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-background',
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </div>
                      <span className="truncate">{opt}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fetch the set of values for a Prometheus/Mimir label.
 * Optionally filtered by a PromQL match selector (for cascading variables).
 */
function useLabelValues(labelName: string | null, matchQuery?: string) {
  return useQuery<string[]>({
    queryKey: ['label-values', labelName, matchQuery ?? ''],
    enabled: !!labelName,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (matchQuery) params.set('match[]', matchQuery);
      const qs = params.toString() ? `?${params}` : '';
      const res = await api.get<{ status: string; data?: string[] }>(
        `/api/v1/observability/metrics/label/${encodeURIComponent(labelName!)}/values${qs}`,
      );
      if (res.status !== 'success') return [];
      return (res.data ?? []).filter((v): v is string => typeof v === 'string');
    },
    // Parent-selection changes produce a new queryKey (matchQuery is part of the key),
    // so fresh data is always fetched when the cascade changes — no need for staleTime:0.
    // 30s keeps data fresh enough without hammering the API on every re-open.
    staleTime: 30_000,
  });
}
