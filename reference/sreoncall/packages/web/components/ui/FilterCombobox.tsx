'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
}

export interface FilterComboboxProps {
  label: string;
  icon?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyText?: string;
  allLabel?: string;
  className?: string;
}

export function FilterCombobox({
  label,
  icon,
  value,
  onChange,
  options,
  placeholder = 'Search…',
  emptyText = 'No matches',
  allLabel = 'All',
  className,
}: FilterComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 240 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  const isActive = !!value;
  const selected = options.find((o) => o.value === value);
  const displayText = selected ? selected.label : allLabel;

  // Options with an implicit "All" at the top (maps to empty value)
  const allOptions = useMemo<ComboboxOption[]>(
    () => [{ value: '', label: allLabel }, ...options],
    [options, allLabel],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(q)),
    );
  }, [allOptions, query]);

  // Reposition popover when opening or on scroll/resize
  useEffect(() => {
    if (!open) return;
    function reposition() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 240) });
    }
    reposition();
    const onScroll = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Focus the search box when opening; clear query on close
  useEffect(() => {
    if (open) {
      setActiveIdx(0);
      setQuery('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  // Click-outside close
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keyboard nav inside the popover
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = filtered[activeIdx];
      if (picked) {
        onChange(picked.value);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'group relative inline-flex h-[34px] items-center gap-1.5 rounded-full border-[1.5px] pl-3 pr-6 text-[12.5px] transition-colors',
          isActive
            ? 'border-[#FF6B2B] bg-[#FFF3ED] text-[#C84F14] dark:bg-[#FF6B2B]/10 dark:text-[#FF8F4F]'
            : 'border-border bg-card text-foreground hover:border-[#FF6B2B]/50 hover:bg-muted/60',
          className,
        )}
      >
        {icon && (
          <span
            className={cn(
              '[&>svg]:h-3.5 [&>svg]:w-3.5 flex-shrink-0',
              isActive ? 'text-[#FF6B2B]' : 'text-muted-foreground',
            )}
          >
            {icon}
          </span>
        )}
        <span
          className={cn(
            'flex-shrink-0 font-medium',
            isActive ? 'text-[#C84F14] dark:text-[#FF8F4F]/80' : 'text-muted-foreground',
          )}
        >
          {label}:
        </span>
        <span className="max-w-[180px] truncate font-semibold">{displayText}</span>
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-2 h-3.5 w-3.5 transition-transform',
            open && 'rotate-180',
            isActive ? 'text-[#FF6B2B]' : 'text-muted-foreground',
          )}
        />
      </button>

      {mounted && open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-[60] rounded-[12px] border border-border bg-card shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                placeholder={placeholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={onKeyDown}
                className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="max-h-[260px] overflow-y-auto py-1" role="listbox">
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                  {emptyText}
                </div>
              )}
              {filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isHover = i === activeIdx;
                return (
                  <button
                    key={`${opt.value}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
                      isHover ? 'bg-muted' : 'bg-transparent',
                      isSelected ? 'font-semibold text-[#C84F14] dark:text-[#FF8F4F]' : 'text-foreground',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {opt.sublabel}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#FF6B2B]" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
