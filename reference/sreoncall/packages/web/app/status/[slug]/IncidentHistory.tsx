'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calendar, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoryUpdate {
  id: string;
  title: string;
  body: string;
  status: string;
  affected_components: Array<{ name: string; status_before: string; status_after: string }>;
  created_at: string;
}

interface HistoryDay {
  date: string;
  updates: HistoryUpdate[];
  has_incident: boolean;
}

interface HistoryResponse {
  from: string;
  to: string;
  total: number;
  days: HistoryDay[];
}

const updateStatusConfig: Record<string, { label: string; pillBg: string; pillText: string; barBg: string }> = {
  investigating: { label: 'Investigating', pillBg: 'bg-rose-50',    pillText: 'text-rose-700',    barBg: 'bg-rose-500'    },
  identified:    { label: 'Identified',    pillBg: 'bg-amber-50',   pillText: 'text-amber-700',   barBg: 'bg-amber-500'   },
  monitoring:    { label: 'Monitoring',    pillBg: 'bg-sky-50',     pillText: 'text-sky-700',     barBg: 'bg-sky-500'     },
  resolved:      { label: 'Resolved',      pillBg: 'bg-emerald-50', pillText: 'text-emerald-700', barBg: 'bg-emerald-500' },
  informational: { label: 'Informational', pillBg: 'bg-slate-100',  pillText: 'text-slate-700',   barBg: 'bg-slate-500'   },
};

const PRESET_RANGES = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
}

function formatDuration(updates: HistoryUpdate[]): string | null {
  if (updates.length < 2) return null;
  const sorted = [...updates].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const first = new Date(sorted[0].created_at).getTime();
  const last = new Date(sorted[sorted.length - 1].created_at).getTime();
  const ms = last - first;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(ms / 86_400_000)}d`;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export function IncidentHistory({
  slug,
  apiUrl,
  component,
  compact = false,
  viewerEmail,
  componentUptime,
}: {
  slug: string;
  apiUrl: string;
  component?: string;
  compact?: boolean;
  viewerEmail?: string;
  componentUptime?: {
    uptime_24h?: number;
    uptime_7d?: number;
    uptime_30d?: number;
    uptime_90d?: number;
  };
}) {
  const [presetDays, setPresetDays] = useState<number>(compact ? 30 : 90);
  const [customMode, setCustomMode] = useState(false);
  const [fromDate, setFromDate] = useState<string>(daysAgoISO(presetDays));
  const [toDate, setToDate] = useState<string>(todayISO());
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveRange = useMemo(() => {
    if (customMode) return { from: fromDate, to: toDate };
    return { from: daysAgoISO(presetDays), to: todayISO() };
  }, [customMode, presetDays, fromDate, toDate]);

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          from: effectiveRange.from,
          to: `${effectiveRange.to}T23:59:59`,
        });
        if (component) params.set('component', component);
        if (viewerEmail) params.set('viewer_email', viewerEmail);
        const url = `${apiUrl}/api/v1/public/status-pages/${slug}/history?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load history');
        const json: HistoryResponse = await res.json();
        setData(json);
      } catch (e: any) {
        setError(e.message || 'Failed to load history');
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [slug, apiUrl, component, effectiveRange.from, effectiveRange.to]);

  const incidentDays = data?.days.filter((d) => d.has_incident) ?? [];
  const totalDays = data?.days.length ?? 0;

  // Compute downtime from each "incident chain": start at first non-resolved
  // status update, end at the next resolved update (or now if still open).
  // Group updates per incident (consecutive non-resolved → resolved cluster).
  const allUpdates = (data?.days || [])
    .flatMap((d) => d.updates)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let downtimeMs = 0;
  let openIncidentStart: number | null = null;
  let resolvedIncidentCount = 0;
  for (const u of allUpdates) {
    const ts = new Date(u.created_at).getTime();
    if (u.status === 'resolved') {
      if (openIncidentStart !== null) {
        downtimeMs += ts - openIncidentStart;
        resolvedIncidentCount++;
        openIncidentStart = null;
      }
    } else if (u.status !== 'informational' && openIncidentStart === null) {
      openIncidentStart = ts;
    }
  }
  // Open incident still ongoing — count downtime until "now" (capped to range end)
  if (openIncidentStart !== null && data) {
    const rangeEnd = Math.min(Date.now(), new Date(data.to).getTime());
    downtimeMs += rangeEnd - openIncidentStart;
  }

  // Total range in ms
  const rangeMs = data ? new Date(data.to).getTime() - new Date(data.from).getTime() : 0;

  // Prefer the component's own per-window uptime (from raw synthetic-check
  // results) so the expanded detail matches what's shown in the list row.
  // Only fall back to downtime-from-status-updates when this isn't a
  // per-component view (e.g., overall status page history).
  let pickedUptime: number | null | undefined;
  if (componentUptime) {
    const effDays = customMode
      ? Math.max(1, Math.ceil((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000))
      : presetDays;
    if (effDays <= 1) pickedUptime = componentUptime.uptime_24h;
    else if (effDays <= 7) pickedUptime = componentUptime.uptime_7d;
    else if (effDays <= 30) pickedUptime = componentUptime.uptime_30d;
    else pickedUptime = componentUptime.uptime_90d;
  }
  const uptimePct =
    pickedUptime != null
      ? pickedUptime.toFixed(3)
      : rangeMs > 0
        ? (Math.max(0, Math.min(1, 1 - downtimeMs / rangeMs)) * 100).toFixed(3)
        : null;
  const totalIncidents = resolvedIncidentCount + (openIncidentStart !== null ? 1 : 0);

  return (
    <div className={cn(compact ? 'mt-3' : 'mb-6')}>
      {/* Header — segmented range selector + summary */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {!compact && (
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            Incident History
          </h2>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {/* Segmented control */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {PRESET_RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => { setPresetDays(r.days); setCustomMode(false); }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all',
                  !customMode && presetDays === r.days
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900',
                )}
              >
                {r.label}
              </button>
            ))}
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              onClick={() => setCustomMode(!customMode)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all flex items-center gap-1',
                customMode
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900',
              )}
            >
              <Calendar className="h-3 w-3" />
              Custom
            </button>
          </div>
        </div>
      </div>

      {/* Custom date picker — appears below segmented control */}
      {customMode && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 mb-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">From</span>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-mono text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">To</span>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              max={todayISO()}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-mono text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
            />
          </div>
          <span className="text-[10px] text-slate-400 ml-auto">Range up to 365 days</span>
        </div>
      )}

      {/* Summary stats bar — visible when data is loaded */}
      {data && !loading && (
        <div className="flex items-center gap-6 px-4 py-3 mb-3 rounded-lg bg-slate-50/80 border border-slate-100">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Uptime</div>
            <div className={cn(
              'text-base font-bold tabular-nums mt-0.5',
              parseFloat(uptimePct ?? '100') >= 99.9 ? 'text-emerald-600' :
              parseFloat(uptimePct ?? '100') >= 99 ? 'text-amber-600' : 'text-rose-600'
            )}>
              {uptimePct ?? '—'}%
            </div>
          </div>
          <div className="h-9 w-px bg-slate-200" />
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Incidents</div>
            <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">{totalIncidents}</div>
          </div>
          <div className="h-9 w-px bg-slate-200" />
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Days affected</div>
            <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
              {incidentDays.length} <span className="text-xs font-normal text-slate-400">/ {totalDays}</span>
            </div>
          </div>
          {downtimeMs > 0 && (
            <>
              <div className="h-9 w-px bg-slate-200" />
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Downtime</div>
                <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                  {(() => {
                    const m = Math.round(downtimeMs / 60_000);
                    if (m < 60) return `${m}m`;
                    const h = Math.floor(m / 60);
                    const r = m % 60;
                    if (h < 24) return r > 0 ? `${h}h ${r}m` : `${h}h`;
                    const d = Math.floor(h / 24);
                    return `${d}d ${h % 24}h`;
                  })()}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-10 rounded-lg border border-slate-100 bg-white">
          <Loader2 className="h-4 w-4 text-slate-300 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 py-8 rounded-lg border border-rose-100 bg-rose-50/50">
          <AlertCircle className="h-4 w-4 text-rose-500" />
          <span className="text-sm text-rose-600">{error}</span>
        </div>
      ) : !data || incidentDays.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 rounded-lg border border-emerald-100 bg-emerald-50/30">
          <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center mb-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900">No incidents reported</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {totalDays > 0 ? `${totalDays} day${totalDays !== 1 ? 's' : ''} of clean operations` : ''}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidentDays.map((day) => (
            <div key={day.date} className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/80 border-b border-slate-100">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  {formatDayLabel(day.date)}
                </span>
                <span className="text-[10px] font-medium text-slate-400">
                  {day.updates.length} update{day.updates.length !== 1 ? 's' : ''}
                  {formatDuration(day.updates) && (
                    <span className="ml-2 text-slate-500">· {formatDuration(day.updates)}</span>
                  )}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {day.updates.map((update) => {
                  const cfg = updateStatusConfig[update.status] || updateStatusConfig.informational;
                  return (
                    <div key={update.id} className="flex items-start gap-3 px-4 py-3.5">
                      <div className={cn('w-1 self-stretch rounded-full shrink-0', cfg.barBg)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn(
                            'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                            cfg.pillBg,
                            cfg.pillText,
                          )}>
                            {cfg.label}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {formatTime(update.created_at)}
                          </span>
                        </div>
                        <div className="text-[13px] font-semibold text-slate-900 leading-snug">{update.title}</div>
                        {update.body && (
                          <div className="text-xs text-slate-600 leading-relaxed mt-1">{update.body}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
