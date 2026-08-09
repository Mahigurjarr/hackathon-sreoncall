'use client';

import { useState } from 'react';
import { ArrowUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
  render: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  keyExtractor: (item: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  emptyMessage = 'No data found',
  onRowClick,
  keyExtractor,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-border border-t-brand animate-spin" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-[0.9375rem] text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.05em] text-muted-foreground whitespace-nowrap',
                  col.sortable && 'cursor-pointer select-none hover:text-foreground',
                  col.className,
                )}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && (
                    <ArrowUpDown className="h-3 w-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={keyExtractor(item)}
              className={cn(
                'border-b border-border transition-colors hover:bg-muted/50',
                onRowClick && 'cursor-pointer',
              )}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={cn('px-4 py-3 text-[0.9375rem] text-foreground/80', col.className)}>
                  {col.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
