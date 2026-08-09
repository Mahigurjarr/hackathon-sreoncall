'use client';

import { useState, useRef, useEffect } from 'react';
import { User, X, Check, Search, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TenantUser } from '@/lib/hooks/useUsers';

export function UserMultiSelect({
  users,
  selectedIds,
  onChange,
  label = 'Users in rotation',
}: {
  users: TenantUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const selectedUsers = users.filter((u) => selectedIds.includes(u.id));

  return (
    <div className="space-y-1.5" ref={ref}>
      <label className="text-sm font-medium text-foreground">{label}</label>

      {/* Selected pills */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {selectedUsers.map((u) => (
            <span
              key={u.id}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              <User className="h-3 w-3" />
              {u.name}
              <button
                type="button"
                onClick={() => toggle(u.id)}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/50"
      >
        <span className="text-muted-foreground">
          {selectedUsers.length === 0
            ? 'Select org members\u2026'
            : `${selectedUsers.length} member${selectedUsers.length !== 1 ? 's' : ''} selected`}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                className="w-full rounded border border-input bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Search by name or email\u2026"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No users found</p>
            ) : (
              filtered.map((u) => {
                const selected = selectedIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors',
                      selected && 'bg-primary/5',
                    )}
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      selected ? 'border-primary bg-primary' : 'border-muted-foreground',
                    )}>
                      {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {selectedUsers.length > 0 && (
            <div className="border-t border-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
