'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TimeRangePreset {
  label: string;
  ms: number;
}

export interface TimeRangeValue {
  start: number;
  end: number;
  preset: string;
}

interface TimeRangeSelectorProps {
  presets: TimeRangePreset[];
  value: TimeRangeValue;
  onChange: (value: TimeRangeValue) => void;
  className?: string;
  compact?: boolean;
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_ABBR    = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function pad(n: number) { return String(n).padStart(2, '0'); }

function msToDateParts(ms: number) {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hours: d.getHours(), minutes: d.getMinutes() };
}

function datePartsToMs(year: number, month: number, day: number, hours: number, minutes: number) {
  return new Date(year, month, day, hours, minutes, 0, 0).getTime();
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = ms / 3_600_000;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((ms / 86_400_000) * 10) / 10}d`;
}

function formatCustomLabel(start: number, end: number): string {
  const fmt = (ms: number) => {
    const p = msToDateParts(ms);
    return `${MONTH_SHORT[p.month]} ${p.day}, ${pad(p.hours)}:${pad(p.minutes)}`;
  };
  return `${fmt(start)} \u2013 ${fmt(end)}`;
}

const QUICK_CUSTOM = [
  { label: 'Last 12h', ms: 12 * 3_600_000 },
  { label: 'Last 2d',  ms: 2  * 86_400_000 },
  { label: 'Last 7d',  ms: 7  * 86_400_000 },
  { label: 'Last 30d', ms: 30 * 86_400_000 },
];

export function TimeRangeSelector({ presets, value, onChange, className, compact }: TimeRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Draft state (committed only on Apply)
  const [startMs, setStartMs] = useState(value.start);
  const [endMs,   setEndMs]   = useState(value.end);
  const [startH,  setStartH]  = useState(() => pad(new Date(value.start).getHours()));
  const [startM,  setStartM]  = useState(() => pad(new Date(value.start).getMinutes()));
  const [endH,    setEndH]    = useState(() => pad(new Date(value.end).getHours()));
  const [endM,    setEndM]    = useState(() => pad(new Date(value.end).getMinutes()));

  // Which endpoint the calendar is editing
  const [editing, setEditing] = useState<'start' | 'end'>('start');

  // Calendar view (which month is shown)
  const [calView, setCalView] = useState<{ year: number; month: number }>(() => {
    const d = new Date(value.start);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Re-sync draft when popover opens
  useEffect(() => {
    if (!open) return;
    setStartMs(value.start);
    setEndMs(value.end);
    const sd = new Date(value.start);
    const ed = new Date(value.end);
    setCalView({ year: sd.getFullYear(), month: sd.getMonth() });
    setStartH(pad(sd.getHours()));
    setStartM(pad(sd.getMinutes()));
    setEndH(pad(ed.getHours()));
    setEndM(pad(ed.getMinutes()));
    setEditing('start');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handlePreset = useCallback((p: TimeRangePreset) => {
    const now = Date.now();
    onChange({ start: now - p.ms, end: now, preset: p.label });
    setOpen(false);
  }, [onChange]);

  // Calendar day click
  const selectDay = useCallback((day: number) => {
    const { year, month } = calView;
    if (editing === 'start') {
      const h = Math.max(0, Math.min(23, parseInt(startH) || 0));
      const m = Math.max(0, Math.min(59, parseInt(startM) || 0));
      const newStart = datePartsToMs(year, month, day, h, m);
      setStartMs(newStart);
      setEditing('end');
      // Push end forward if it's now before start
      if (endMs <= newStart) {
        const ep = msToDateParts(endMs);
        const newEnd = datePartsToMs(year, month, day, Math.min(h + 1, 23), m);
        setEndMs(newEnd);
        setEndH(pad(Math.min(h + 1, 23)));
        setEndM(pad(m));
      }
    } else {
      const h = Math.max(0, Math.min(23, parseInt(endH) || 23));
      const m = Math.max(0, Math.min(59, parseInt(endM) || 59));
      const newEnd = datePartsToMs(year, month, day, h, m);
      if (newEnd > startMs) setEndMs(newEnd);
    }
  }, [calView, editing, startH, startM, endH, endM, startMs, endMs]);

  const applyCustom = useCallback(() => {
    const sh = Math.max(0, Math.min(23, parseInt(startH) || 0));
    const sm = Math.max(0, Math.min(59, parseInt(startM) || 0));
    const eh = Math.max(0, Math.min(23, parseInt(endH) || 23));
    const em = Math.max(0, Math.min(59, parseInt(endM) || 59));
    const sp = msToDateParts(startMs);
    const ep = msToDateParts(endMs);
    const s  = datePartsToMs(sp.year, sp.month, sp.day, sh, sm);
    const e  = datePartsToMs(ep.year, ep.month, ep.day, eh, em);
    if (s >= e) return;
    onChange({ start: s, end: e, preset: 'custom' });
    setOpen(false);
  }, [startMs, endMs, startH, startM, endH, endM, onChange]);

  const setQuickCustom = useCallback((ms: number) => {
    const now = Date.now();
    const s   = now - ms;
    const sd  = new Date(s);
    const ed  = new Date(now);
    setStartMs(s);
    setEndMs(now);
    setCalView({ year: sd.getFullYear(), month: sd.getMonth() });
    setStartH(pad(sd.getHours()));
    setStartM(pad(sd.getMinutes()));
    setEndH(pad(ed.getHours()));
    setEndM(pad(ed.getMinutes()));
  }, []);

  // Build calendar grid
  const daysInMonth = new Date(calView.year, calView.month + 1, 0).getDate();
  const firstDow    = new Date(calView.year, calView.month, 1).getDay();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const sp = msToDateParts(startMs);
  const ep = msToDateParts(endMs);
  const tp = msToDateParts(Date.now());

  const isStart = (d: number) => d === sp.day && calView.month === sp.month && calView.year === sp.year;
  const isEnd   = (d: number) => d === ep.day && calView.month === ep.month && calView.year === ep.year;
  const inRange = (d: number) => {
    const t = new Date(calView.year, calView.month, d).getTime();
    return t > startMs && t < endMs;
  };
  const isToday = (d: number) => d === tp.day && calView.month === tp.month && calView.year === tp.year;

  const navMonth = useCallback((dir: -1 | 1) => {
    setCalView(v => {
      const d = new Date(v.year, v.month + dir, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const updateStartTime = (hStr: string, mStr: string) => {
    const h = Math.max(0, Math.min(23, parseInt(hStr) || 0));
    const m = Math.max(0, Math.min(59, parseInt(mStr) || 0));
    setStartMs(datePartsToMs(sp.year, sp.month, sp.day, h, m));
  };

  const updateEndTime = (hStr: string, mStr: string) => {
    const h = Math.max(0, Math.min(23, parseInt(hStr) || 0));
    const m = Math.max(0, Math.min(59, parseInt(mStr) || 0));
    setEndMs(datePartsToMs(ep.year, ep.month, ep.day, h, m));
  };

  const canApply = endMs > startMs;
  const duration = endMs - startMs;

  return (
    <div className={cn('relative flex items-center gap-0.5', className)}>
      {/* Preset buttons row */}
      <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
        <Clock className={cn('text-muted-foreground ml-1.5', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => handlePreset(p)}
            className={cn(
              'rounded-md px-2 py-1 font-semibold transition-colors',
              compact ? 'text-[10px]' : 'text-[11px]',
              value.preset === p.label
                ? 'bg-primary text-white'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}

        {/* Custom trigger */}
        <button
          ref={triggerRef}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition-colors',
            compact ? 'text-[10px]' : 'text-[11px]',
            value.preset === 'custom'
              ? 'bg-primary text-white'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          <Calendar className="h-3 w-3" />
          {value.preset === 'custom' ? formatCustomLabel(value.start, value.end) : 'Custom'}
          <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {/* Calendar popover */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-50 mt-2 w-[364px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center h-6 w-6 rounded-lg bg-primary/10">
                <Calendar className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-[12px] font-semibold text-foreground">Custom Time Range</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Quick shortcuts */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_CUSTOM.map((q) => (
                <button
                  key={q.label}
                  onClick={() => setQuickCustom(q.ms)}
                  className="rounded-full border border-border/80 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all"
                >
                  {q.label}
                </button>
              ))}
            </div>

            {/* Start / End summary cards */}
            <div className="grid grid-cols-2 gap-2">
              {(['start', 'end'] as const).map((end) => {
                const isActive = editing === end;
                const p        = end === 'start' ? sp : ep;
                return (
                  <button
                    key={end}
                    onClick={() => setEditing(end)}
                    className={cn(
                      'flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-all duration-150',
                      isActive
                        ? 'border-primary/60 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
                        : 'border-border hover:border-border hover:bg-muted/30',
                    )}
                  >
                    <span className={cn(
                      'text-[9px] font-bold uppercase tracking-widest mb-1',
                      isActive ? 'text-primary' : 'text-muted-foreground/70',
                    )}>
                      {end === 'start' ? 'From' : 'To'}
                    </span>
                    <span className="text-[11px] font-semibold text-foreground font-mono leading-none">
                      {MONTH_SHORT[p.month]} {p.day}, {p.year}
                    </span>
                    <span className={cn(
                      'text-[10px] font-mono mt-0.5',
                      isActive ? 'text-primary/80' : 'text-muted-foreground',
                    )}>
                      {pad(p.hours)}:{pad(p.minutes)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Calendar */}
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => navMonth(-1)}
                  className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-[12px] font-semibold text-foreground">
                  {MONTH_FULL[calView.month]} {calView.year}
                </span>
                <button
                  onClick={() => navMonth(1)}
                  className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_ABBR.map((d) => (
                  <div key={d} className="text-center text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wide py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {cells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} className="h-8" />;

                  const start  = isStart(day);
                  const end    = isEnd(day);
                  const ranged = inRange(day);
                  const today  = isToday(day);
                  const both   = start && end;

                  return (
                    <div key={day} className="relative flex items-center justify-center h-8">
                      {/* Range fill (behind button) */}
                      {ranged && (
                        <div className="absolute inset-y-1 inset-x-0 bg-primary/10" />
                      )}
                      {/* Range cap for start day */}
                      {start && !both && (
                        <div className="absolute inset-y-1 right-0 left-1/2 bg-primary/10" />
                      )}
                      {/* Range cap for end day */}
                      {end && !both && (
                        <div className="absolute inset-y-1 left-0 right-1/2 bg-primary/10" />
                      )}

                      <button
                        onClick={() => selectDay(day)}
                        className={cn(
                          'relative z-10 flex items-center justify-center h-7 w-7 rounded-full text-[11px] font-medium transition-all duration-100',
                          (start || end)
                            ? 'bg-primary text-white font-semibold shadow-md shadow-primary/25'
                            : ranged
                              ? 'text-primary hover:bg-primary/20'
                              : 'text-foreground hover:bg-muted/60',
                          today && !start && !end && 'font-bold',
                        )}
                      >
                        {day}
                        {today && !start && !end && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-0.5 rounded-full bg-primary" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Time inputs */}
            <div className="grid grid-cols-2 gap-3">
              {/* Start time */}
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
                  Start time
                </label>
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                  <Clock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <input
                    type="number"
                    min={0} max={23}
                    value={startH}
                    onChange={(e) => { setStartH(e.target.value); updateStartTime(e.target.value, startM); }}
                    onBlur={(e) => { const v = pad(Math.max(0, Math.min(23, parseInt(e.target.value) || 0))); setStartH(v); updateStartTime(v, startM); }}
                    className="w-8 bg-transparent text-[12px] font-mono font-semibold text-center text-foreground outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="HH"
                  />
                  <span className="text-muted-foreground/60 text-[12px] font-semibold select-none">:</span>
                  <input
                    type="number"
                    min={0} max={59}
                    value={startM}
                    onChange={(e) => { setStartM(e.target.value); updateStartTime(startH, e.target.value); }}
                    onBlur={(e) => { const v = pad(Math.max(0, Math.min(59, parseInt(e.target.value) || 0))); setStartM(v); updateStartTime(startH, v); }}
                    className="w-8 bg-transparent text-[12px] font-mono font-semibold text-center text-foreground outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="MM"
                  />
                </div>
              </div>

              {/* End time */}
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
                  End time
                </label>
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                  <Clock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <input
                    type="number"
                    min={0} max={23}
                    value={endH}
                    onChange={(e) => { setEndH(e.target.value); updateEndTime(e.target.value, endM); }}
                    onBlur={(e) => { const v = pad(Math.max(0, Math.min(23, parseInt(e.target.value) || 0))); setEndH(v); updateEndTime(v, endM); }}
                    className="w-8 bg-transparent text-[12px] font-mono font-semibold text-center text-foreground outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="HH"
                  />
                  <span className="text-muted-foreground/60 text-[12px] font-semibold select-none">:</span>
                  <input
                    type="number"
                    min={0} max={59}
                    value={endM}
                    onChange={(e) => { setEndM(e.target.value); updateEndTime(endH, e.target.value); }}
                    onBlur={(e) => { const v = pad(Math.max(0, Math.min(59, parseInt(e.target.value) || 0))); setEndM(v); updateEndTime(endH, v); }}
                    className="w-8 bg-transparent text-[12px] font-mono font-semibold text-center text-foreground outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="MM"
                  />
                </div>
              </div>
            </div>

            {/* Duration / validation feedback */}
            <div className="flex items-center justify-center h-5">
              {canApply ? (
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  Duration: <span className="font-semibold text-foreground/80">{formatDuration(duration)}</span>
                </span>
              ) : (
                <span className="text-[10px] text-destructive/80 font-medium">
                  End must be after start
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/60">
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl border border-border px-3 py-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyCustom}
                disabled={!canApply}
                className="rounded-xl bg-primary px-3 py-2.5 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
