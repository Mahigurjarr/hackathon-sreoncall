'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useLogsQuery, useLogVolume } from '@/lib/hooks/useObservabilityProxy';
import { useProviderLogsQuery, useProviderLogVolume } from '@/lib/hooks/useProviderObservability';
import { useLogLabelNames, useLogFacetValues } from '@/lib/hooks/useLogsDiscovery';
import { useGenerateLogQL, GenerateLogQLResult } from '@/lib/hooks/useGenerateLogQL';
import { useAskFeedback } from '@/lib/hooks/useAskFeedback';
import { buildLogQLSelector } from '@/lib/observability/logql';
import { getLevelColor, parseLogLineFields, LogLevel } from '@/lib/observability/log-line';
import { classifyAiResult } from '@/lib/observability/ai-query-result';
import { effectiveLogQuery, canRunBarQuery } from '@/lib/observability/log-bar';
import { toVolumeRows } from '@/lib/observability/log-volume';
// External stylesheet (CSP blocks inline <style>; style-src-elem allows 'self').
import './LogsExploreV2.css';

/* ─────────────────────────── constants ─────────────────────────── */
// Matches logs/page.tsx:190 — do not invent a different catch-all.
const DEFAULT_ALL_STREAMS = '{job=~".+"}';
const TIME_PRESETS: Record<string, number> = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };
const LEVEL_KEYS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const LEVEL_VAR: Record<LogLevel, string> = {
  error: '--lvl-error', warn: '--lvl-warn', info: '--lvl-info', debug: '--lvl-debug',
};
type Levels = Record<LogLevel, boolean>;
const ALL_LEVELS_ON: Levels = { error: true, warn: true, info: true, debug: true };
const DEFAULT_OPEN_FACETS = new Set(['cluster', 'namespace', 'service_name']);
// Copied from app/(app)/observability/logs/page.tsx's HISTOGRAM_LEVEL_COLORS (not exported there).
const HISTOGRAM_LEVEL_COLORS: Record<LogLevel, string> = {
  error: '#ef4444', warn: '#eab308', info: '#3b82f6', debug: '#6b7280',
};
// Volume-histogram bucket step per time-range preset (mirrors logs/page.tsx's volumeStep thresholds).
const HIST_STEP: Record<string, string> = { '15m': '30s', '1h': '1m', '6h': '5m', '24h': '15m', '7d': '1h' };

/* ─────────────────────────── helpers ─────────────────────────── */
interface FlatLine {
  key: string;
  tsNs: string;
  line: string;
  streamLabels: Record<string, string>;
  level: LogLevel;
  fields: Record<string, unknown> | null;
}

// Flatten LogStream[] (each { stream, values: [[ns_ts, line]] }) into a single, newest-first,
// capped list of renderable lines.
function flattenLogResult(
  result?: Array<{ stream: Record<string, string>; values: [string, string][] }>,
): FlatLine[] {
  if (!result?.length) return [];
  const out: FlatLine[] = [];
  for (const s of result) {
    for (const [tsNs, line] of s.values) {
      out.push({
        key: `${tsNs}-${out.length}`,
        tsNs,
        line,
        streamLabels: s.stream,
        level: getLevelColor(line, s.stream),
        fields: parseLogLineFields(line),
      });
    }
  }
  out.sort((a, b) => {
    const ta = BigInt(a.tsNs);
    const tb = BigInt(b.tsNs);
    return ta > tb ? -1 : ta < tb ? 1 : 0;
  });
  return out.slice(0, 200);
}

function fmtTs(tsNs: string): string {
  const ms = Number(BigInt(tsNs) / BigInt(1_000_000));
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Highlight every occurrence of `needle` in `msg` with <mark>, like the mockup's filter box.
function highlightContains(msg: string, needle: string): React.ReactNode {
  if (!needle) return msg;
  const idx = msg.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return msg;
  return (
    <>
      {msg.slice(0, idx)}
      <mark>{msg.slice(idx, idx + needle.length)}</mark>
      {highlightContains(msg.slice(idx + needle.length), needle)}
    </>
  );
}

/* ─────────────────────────── facet rail (right side) ─────────────────────────── */
function FacetRow({
  label, selection, onToggle, consumerId, defaultOpen,
}: {
  label: string;
  selection: Record<string, string>;
  onToggle: (label: string, value: string) => void;
  consumerId?: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Every facet the rail shows IS a stream label — the shipped backend's labels-discovery
  // endpoint only returns Loki stream labels (detected_fields/line-field discovery was
  // deferred). No static-name check needed; the rail is never handed a line field.
  // Exclude this facet's own selection from the scope query — the backend does not strip the
  // queried label from the selection filter, so passing it through would collapse this facet's
  // value list down to just the already-selected value once picked (can't switch without
  // clearing first). Other selected labels are still passed through so cross-facet narrowing
  // continues to work.
  const { [label]: _omit, ...scopedSelection } = selection;
  const vals = useLogFacetValues(label, scopedSelection, { consumerId, enabled: open });
  const selectedVal = selection[label];

  return (
    <div className={`facet${open ? ' open' : ''}`} data-testid="facet-row">
      <button type="button" className="fh" onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? '▾' : '▸'}</span>
        <span className="fk stream">{label}</span>
      </button>
      {open && (
        <div className="fvals">
          {vals.isLoading && <div className="tnote">loading…</div>}
          {vals.error && <div className="tnote">unavailable</div>}
          {!vals.isLoading && !vals.error && (vals.data?.values?.length ?? 0) === 0 && (
            <div className="tnote">no values</div>
          )}
          {vals.data?.values?.map((v) => (
            <button
              key={v}
              type="button"
              className={`fval${selectedVal === v ? ' sel' : ''}`}
              data-testid="facet-value"
              onClick={() => onToggle(label, v)}
            >
              <span className="fv" title={v}>{v}</span>
            </button>
          ))}
          {vals.data?.truncated && (
            <div className="tnote">showing {vals.data.values.length} of {vals.data.total}</div>
          )}
        </div>
      )}
    </div>
  );
}

function FacetRail({
  selection, onToggle, consumerId, customerName, collapsed, onToggleCollapsed,
}: {
  selection: Record<string, string>;
  onToggle: (label: string, value: string) => void;
  consumerId?: string;
  customerName?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [search, setSearch] = useState('');
  const names = useLogLabelNames({ consumerId, enabled: true });
  const rawLabels = names.data?.labels ?? [];
  const labels = rawLabels.filter((l) => l.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="browser" data-testid="lev2-facet-rail">
      <div className="full">
        <div className="bhead">
          <div className="beyebrow">Filter</div>
          <button
            type="button"
            className="rail-collapse"
            data-testid="lev2-rail-collapse"
            aria-expanded={!collapsed}
            title="Collapse panel"
            onClick={onToggleCollapsed}
          >
            »
          </button>
        </div>
        <div className="bsub">{customerName ?? 'this tenant'} · fields in this view</div>
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            data-testid="facet-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fields…"
          />
        </div>
        <div data-testid="facet-list">
          {names.isLoading && <div className="tnote" data-testid="facet-rail-loading">loading…</div>}
          {!names.isLoading && names.error && (
            <div className="railempty" data-testid="facet-rail-empty">
              No fields found for this tenant / time range.
            </div>
          )}
          {!names.isLoading && !names.error && rawLabels.length === 0 && (
            <div className="railempty" data-testid="facet-rail-empty">
              No fields found for this tenant / time range.
            </div>
          )}
          {!names.isLoading && !names.error && rawLabels.length > 0 && labels.length === 0 && (
            <div className="tnote">no fields match &ldquo;{search}&rdquo;</div>
          )}
          {labels.map((label) => (
            <FacetRow
              key={label}
              label={label}
              selection={selection}
              onToggle={onToggle}
              consumerId={consumerId}
              defaultOpen={DEFAULT_OPEN_FACETS.has(label)}
            />
          ))}
        </div>
        <div className="legend-tree">Click a value to filter · click it again to clear</div>
      </div>
      <div className="mini">
        <button
          type="button"
          className="rail-reopen"
          data-testid="lev2-rail-reopen"
          aria-expanded={!collapsed}
          title="Open Filter"
          onClick={onToggleCollapsed}
        >
          «
        </button>
        <div className="vlabel">Filter</div>
      </div>
    </aside>
  );
}

/* ─────────────────────────── log stream (center) ─────────────────────────── */
function LogRowDetail({
  line, onFilterField,
}: {
  line: FlatLine;
  onFilterField: (label: string, value: string, origin: 'stream' | 'line') => void;
}) {
  const filterable = new Set([...Object.keys(line.streamLabels), ...Object.keys(line.fields ?? {})]);
  // Origin matters: a key from `streamLabels` really is a Loki stream label (it came off
  // this row's actual stream), so its "+ filter" belongs in the stream selector `{...}`.
  // A key from `fields` came from parsing the line as JSON — that's a genuine line field,
  // filtered via `| json | k="v"` after the selector. See lib/observability/logql.ts.
  const entries: Array<[string, string, 'stream' | 'line']> = [
    ['level', line.level, 'line'],
    ['timestamp', fmtTs(line.tsNs), 'line'],
    ...Object.entries(line.streamLabels).map(([k, v]) => [k, v, 'stream'] as [string, string, 'stream']),
    ...Object.entries(line.fields ?? {}).map(([k, v]) => [k, String(v), 'line'] as [string, string, 'line']),
  ];
  const traceId = (line.fields?.trace_id ?? line.fields?.traceId) as string | number | undefined;
  const service = line.streamLabels.service_name;

  return (
    <div className="logdetail" onClick={(e) => e.stopPropagation()}>
      <div className="kv">
        {entries.map(([k, v, origin], i) => (
          <div className="p" key={`${i}-${k}`}>
            <span className="k">{k}</span>
            <span className="v">
              {v}
              {filterable.has(k) && (
                <button
                  type="button"
                  className="add"
                  data-testid={`lev2-row-add-filter-${k}`}
                  onClick={() => onFilterField(k, v, origin)}
                >
                  + filter
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="dpivots">
        {traceId != null && (
          <a className="dlink primary" href={`/observability/traces?search=${encodeURIComponent(String(traceId))}`}>View trace</a>
        )}
        {service && (
          <a className="dlink" href={`/observability/metrics?service=${encodeURIComponent(service)}`}>Metrics</a>
        )}
        <a
          className="dlink"
          href={`/observability/logs?q=${encodeURIComponent(buildLogQLSelector(line.streamLabels, {}, DEFAULT_ALL_STREAMS))}`}
        >
          Surrounding logs
        </a>
      </div>
    </div>
  );
}

function LogStream({
  lines, isLoading, isError, lineContains, wrapOn, expandedKey, onToggleRow, onFilterField,
}: {
  lines: FlatLine[];
  isLoading: boolean;
  isError: boolean;
  lineContains: string;
  wrapOn: boolean;
  expandedKey: string | null;
  onToggleRow: (key: string) => void;
  onFilterField: (label: string, value: string, origin: 'stream' | 'line') => void;
}) {
  return (
    <div className="panel" data-testid="lev2-log-stream">
      <div className="loghead">
        <span>Time</span><span>Level</span><span>Service</span><span>Status</span><span>Message</span><span className="r">Dur</span>
      </div>
      {isLoading && <div className="emptyrows" data-testid="lev2-stream-loading">Loading log lines…</div>}
      {!isLoading && isError && (
        <div className="emptyrows" data-testid="lev2-stream-error">Unable to load log lines. Try a different scope or time range.</div>
      )}
      {!isLoading && !isError && lines.length === 0 && (
        <div className="emptyrows" data-testid="lev2-stream-empty">No log lines match these filters.</div>
      )}
      {!isLoading && !isError && lines.map((l) => {
        const svc = l.streamLabels.service_name || l.streamLabels.job || l.streamLabels.app
          || Object.values(l.streamLabels)[0] || '—';
        const statusRaw = l.fields?.status_code ?? l.fields?.statusCode;
        const statusText = statusRaw != null ? String(statusRaw) : '—';
        const scCls = statusRaw != null ? `st${statusText[0]}` : 'st0';
        const durationRaw = l.fields?.duration_ms ?? l.fields?.durationMs;
        const durationText = durationRaw != null ? `${String(durationRaw)}ms` : '—';
        const isOpen = expandedKey === l.key;
        return (
          <div
            key={l.key}
            className={`logrow${wrapOn ? ' wrap' : ''}`}
            data-testid="lev2-log-row"
            onClick={() => onToggleRow(l.key)}
          >
            <span className="ts">{fmtTs(l.tsNs)}</span>
            <span><span className={`lvlbadge ${l.level}`}>{l.level.toUpperCase().slice(0, 3)}</span></span>
            <span className="svc" title={svc}>{svc}</span>
            <span className={`stcode ${scCls}`}>{statusText}</span>
            <span className="msg">{highlightContains(l.line, lineContains)}</span>
            <span className="dur">{durationText}</span>
            {isOpen && <LogRowDetail line={l} onFilterField={onFilterField} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── pod drawer ─────────────────────────── */
// Opens when a single `pod` facet value is picked. Deliberately reads from the already-loaded
// `lines` (the flattened stream) rather than issuing a new query — mirrors the brief's "counts
// from the loaded stream lines for that pod." Structure mirrors MetricsExploreV2's PodDrawerV2.
function PodDrawer({
  pod, lines, onClose,
}: {
  pod: string | null;
  lines: FlatLine[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!pod) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pod, onClose]);

  if (!pod) return null;

  const podLines = lines.filter((l) => l.streamLabels.pod === pod);
  const sample = podLines[0];
  const service = sample?.streamLabels.service_name ?? '';
  const namespace = sample?.streamLabels.namespace ?? '';
  const cluster = sample?.streamLabels.cluster ?? '';
  const errCount = podLines.filter((l) => l.level === 'error').length;
  const warnCount = podLines.filter((l) => l.level === 'warn').length;
  const infoCount = podLines.filter((l) => l.level === 'info').length;
  const recent = podLines.slice(0, 7);
  const metricsHref = `/observability/metrics?service=${encodeURIComponent(service)}`;
  const tracesHref = `/observability/traces?service=${encodeURIComponent(service)}`;

  return (
    <>
      <div className="lev2-scrim" data-testid="pod-drawer-scrim" onClick={onClose} />
      <aside className="lev2-drawer" data-testid="pod-drawer">
        <div className="dhead">
          <div className="dtop">
            <div className="ebrow">{service || 'pod'} · {namespace || '—'} · {cluster || '—'}</div>
            <button type="button" className="dclose" data-testid="pod-drawer-close" onClick={onClose}>×</button>
          </div>
          <h2>{pod}</h2>
        </div>
        <div className="dstats">
          <div className="dstat"><div className="l">Errors</div><div className="v crit">{errCount}</div></div>
          <div className="dstat"><div className="l">Warns</div><div className="v warn">{warnCount}</div></div>
          <div className="dstat"><div className="l">Info</div><div className="v">{infoCount}</div></div>
        </div>
        <div className="dbody">
          <div className="dsec">Recent logs</div>
          <div data-testid="pod-drawer-logs">
            {recent.length === 0 && <div className="tnote">no recent lines for this pod</div>}
            {recent.map((l) => (
              <div className="dlogline" key={l.key}>
                <span className={`lb ${l.level}`}>{l.level.toUpperCase().slice(0, 3)}</span>
                <span className="ts">{fmtTs(l.tsNs)}</span>
                <span className="lm" title={l.line}>{l.line}</span>
              </div>
            ))}
          </div>
          <div className="dsec" style={{ marginTop: 16 }}>Actions</div>
          <div className="dlinks">
            <a className="dlink primary" data-testid="pod-jump-metrics" href={metricsHref}>Jump to Metrics</a>
            <a className="dlink" data-testid="pod-jump-traces" href={tracesHref}>Jump to Traces</a>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────── main component ─────────────────────────── */
export function LogsExploreV2({
  consumers,
  consumerId,
  onConsumerChange,
  customerName,
}: {
  consumers?: Array<{ id: string; name: string; obs: boolean }>;
  consumerId?: string;
  onConsumerChange?: (id: string | undefined) => void;
  customerName?: string;
}) {
  // `selection` = facet-rail picks. Every rail facet IS a stream label (see FacetRow) so
  // this map only ever holds stream labels and feeds the `{...}` selector.
  const [selection, setSelection] = useState<Record<string, string>>({});
  // `lineFieldFilters` = row-detail "+ filter" clicks on a PARSED JSON line field. These are
  // NOT stream labels — they render as `| json | k="v"` after the selector, and must never
  // be sent to the label-values endpoint (that treats any key as a stream-label filter,
  // which empties the facet's value list — see useLogFacetValues call in FacetRow).
  const [lineFieldFilters, setLineFieldFilters] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState<Levels>({ ...ALL_LEVELS_ON });
  const [lineContains, setLineContains] = useState('');
  const [range, setRange] = useState('1h');
  const [wrapOn, setWrapOn] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Ask ⇄ LogQL bar (Increment 3). `barLogql` is the bar's DRAFT text (what the input shows
  // while typing) and may be '' (the AI's empty-scope contract). `committedBarQuery` is the
  // manual-override that actually feeds `effectiveQuery` — it is set on Run (LogQL mode) or
  // when an AI result lands (mirrors MetricsExploreV2's pql/activeQuery split). It is also
  // auto-cleared back to '' the instant the user touches the facet browser or filters
  // (toggleFacet, level-chip toggle, scope-chip removal, row-detail "+ filter") — see
  // clearCommittedQuery() below — so a stale committed query never permanently dead-ends the
  // facet-driven view with no way back to it.
  const [mode, setMode] = useState<'ask' | 'logql'>('ask');
  const [ask, setAsk] = useState('');
  const [barLogql, setBarLogql] = useState('');
  const [committedBarQuery, setCommittedBarQuery] = useState('');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [genEmpty, setGenEmpty] = useState(false);
  // Advisory: server-side syntax validation flagged the generated LogQL as invalid (Inc 1 —
  // see applyGenerated). The box still fills and Run stays enabled; we just don't auto-run.
  const [genInvalid, setGenInvalid] = useState(false);
  const [repairCount, setRepairCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const gen = useGenerateLogQL();
  const feedback = useAskFeedback();
  // Survives box edits (aiQuestionRef is nulled on edit) so we can report, on Run, whether the
  // user edited the AI-generated query. { question, query } of the last AI generation, or null.
  const aiGeneratedRef = useRef<{ question: string; query: string } | null>(null);
  // The question behind the CURRENT AI-originated bar query (null = manual/no repair candidate).
  const aiQuestionRef = useRef<string | null>(null);

  const isProvider = !!(consumers && consumers.length > 0);

  // Switching customer resets the in-page selection so we never mix one customer's
  // scope/filters with another's data (mirrors MetricsExploreV2).
  useEffect(() => {
    setSelection({});
    setLineFieldFilters({});
    setLevels({ ...ALL_LEVELS_ON });
    setLineContains('');
    setExpandedKey(null);
    setMode('ask');
    setAsk('');
    setBarLogql('');
    setCommittedBarQuery('');
    setExplanation(null);
    setGenEmpty(false);
    setGenInvalid(false);
    setRepairCount(0);
    setDrawerPod(null);
    aiQuestionRef.current = null;
  }, [consumerId]);

  // The ambient, facet-derived fetch query — always non-empty (falls back to
  // DEFAULT_ALL_STREAMS). NEVER surfaced in the bar directly; see effectiveQuery below.
  const fetchLogql = useMemo(
    () => buildLogQLSelector(selection, { lineFieldFilters, lineContains, levels }, DEFAULT_ALL_STREAMS),
    [selection, lineFieldFilters, lineContains, levels],
  );
  // What actually drives the stream/histogram: the COMMITTED manual query (set on Run, or by
  // an accepted AI result) when non-empty, else the live facet-derived fetchLogql. Typing in
  // the LogQL box only updates the `barLogql` draft — it does not affect this until Run, so
  // partial/invalid LogQL never triggers refetch churn. Touching the facet browser/filters
  // auto-clears `committedBarQuery` (see clearCommittedQuery/toggleFacet/toggleLevel/
  // removeChip/toggleLineFieldFilter/removeLineFieldFilter below), so facet/level/
  // lineContains selection is never permanently shadowed by a stale committed query — never
  // substitutes DEFAULT_ALL_STREAMS into `barLogql`/`committedBarQuery` themselves.
  const effectiveQuery = useMemo(
    () => effectiveLogQuery(committedBarQuery, fetchLogql),
    [committedBarQuery, fetchLogql],
  );

  // Floor to whole seconds (mirrors MetricsExploreV2.tsx) so start/end are stable across a
  // render burst — un-floored Date.now() changed every render, which changed the React Query
  // keys for useLogsQuery/useProviderLogsQuery/useLogVolume/useProviderLogVolume on every
  // render, causing an infinite refetch loop (0 rows ever rendered).
  const nowSec = Math.floor(Date.now() / 1000); // seconds — stable within a render burst
  const start = String((nowSec - (TIME_PRESETS[range] ?? 3600)) * 1e9); // ns, matches logs/page.tsx's ms*1e6 convention (seconds*1e9 === ms*1e6)
  const end = String(nowSec * 1e9); // ns
  const limit = '200';
  const histStep = HIST_STEP[range] ?? '1m';

  const ownRes = useLogsQuery(effectiveQuery, start, end, limit, 'backward', !consumerId);
  const provRes = useProviderLogsQuery(effectiveQuery, consumerId, start, end, limit, 'backward', !!consumerId);
  const res = consumerId ? provRes : ownRes;

  const ownVol = useLogVolume(effectiveQuery, start, end, histStep, !consumerId);
  const provVol = useProviderLogVolume(effectiveQuery, consumerId, start, end, histStep, !!consumerId);
  const volRes = consumerId ? provVol : ownVol;
  const volumeRows = useMemo(() => toVolumeRows(volRes.data?.data?.result), [volRes.data]);
  const chartRows = useMemo(
    () => volumeRows.map((r) => ({
      time: new Date(r.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      error: r.error,
      warn: r.warn,
      info: r.info,
      debug: r.debug,
    })),
    [volumeRows],
  );

  const lines = useMemo(() => flattenLogResult(res.data?.data?.result), [res.data]);

  const subject = selection.service_name || selection.namespace || selection.cluster || customerName || 'your stack';
  const crumb = [selection.cluster, selection.namespace, selection.service_name].filter(Boolean);
  const streamChips = Object.entries(selection);
  const lineFieldChips = Object.entries(lineFieldFilters);
  const allLevelsOn = LEVEL_KEYS.every((k) => levels[k]);

  // Fix: a non-empty `committedBarQuery` used to ALWAYS win in effectiveQuery, so touching a
  // facet/level/chip after a Run or an accepted AI result silently stopped affecting the
  // stream — with no way back short of a full page reload. Every entry point that mutates
  // the facet-driven state calls this so the live facet-derived fetchLogql takes back over.
  // Also resets the bar/explanation/empty-hint/repair-question so the UI doesn't show stale
  // AI/manual-query chrome for a query that's no longer active. Never substitutes
  // DEFAULT_ALL_STREAMS into the bar — it goes back to a plain empty string.
  function clearCommittedQuery() {
    setCommittedBarQuery('');
    setBarLogql('');
    setExplanation(null);
    setGenEmpty(false);
    setGenInvalid(false);
    aiQuestionRef.current = null;
  }

  function toggleFacet(label: string, value: string) {
    const wasSelected = selection[label] === value;
    setSelection((prev) => {
      const next = { ...prev };
      if (next[label] === value) delete next[label];
      else next[label] = value;
      return next;
    });
    clearCommittedQuery();
    // A single `pod` value picked (not cleared) opens the pod drawer; deselecting the pod the
    // drawer is currently showing closes it (Esc/scrim close are handled separately in PodDrawer).
    if (label === 'pod') {
      if (!wasSelected) setDrawerPod(value);
      else if (drawerPod === value) setDrawerPod(null);
    }
  }
  function removeChip(key: string) {
    setSelection((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    clearCommittedQuery();
  }
  function toggleLineFieldFilter(label: string, value: string) {
    setLineFieldFilters((prev) => {
      const next = { ...prev };
      if (next[label] === value) delete next[label];
      else next[label] = value;
      return next;
    });
    clearCommittedQuery();
  }
  function removeLineFieldFilter(key: string) {
    setLineFieldFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    clearCommittedQuery();
  }
  // Row-detail "+ filter": dispatch by the entry's ORIGIN (see LogRowDetail) — a stream label
  // goes through the same path as a facet-rail click; a parsed JSON line field goes to the
  // separate lineFieldFilters map. Both auto-clear the committed query (via toggleFacet /
  // toggleLineFieldFilter above).
  function onRowFilterField(label: string, value: string, origin: 'stream' | 'line') {
    if (origin === 'stream') toggleFacet(label, value);
    else toggleLineFieldFilter(label, value);
  }
  function toggleLevel(l: LogLevel | 'all') {
    if (l === 'all') {
      const turnOn = !allLevelsOn;
      setLevels({ error: turnOn, warn: turnOn, info: turnOn, debug: turnOn });
    } else {
      setLevels((prev) => ({ ...prev, [l]: !prev[l] }));
    }
    clearCommittedQuery();
  }

  function flashBar() {
    setFlash(true);
    setTimeout(() => setFlash(false), 650);
  }

  // Apply an AI-generated LogQL result: fill the bar (may be ''), commit it as the active
  // fetch query too (an accepted AI query drives data, same as before this fix), show the
  // explanation, switch to logql mode. NEVER substitutes DEFAULT_ALL_STREAMS into barLogql/
  // committedBarQuery — an empty `r.logql` stays empty in both (Run disabled; the fetch
  // quietly falls back to fetchLogql).
  // Advisory syntax validation (Inc 1): when the server flags `valid:false` (it already spent
  // its one shared model-repair attempt), fill the box and warn but do NOT commit/auto-run —
  // Run stays enabled so the user can still execute it after reviewing.
  function applyGenerated(r: GenerateLogQLResult) {
    setBarLogql(r.logql);
    setExplanation(r.explanation);
    setGenEmpty(false);
    setGenInvalid(r.valid === false);
    // Shared repair budget: if the server already spent its one syntax-repair, mark the budget
    // consumed so the frontend won't ALSO fire an error/empty repair (never >1 model repair/question).
    if (r.repaired) setRepairCount(1);
    setMode('logql');
    flashBar();
    if (r.valid === false) { aiGeneratedRef.current = null; return; }
    setCommittedBarQuery(r.logql);
    if (!r.logql) {
      // Valid empty-scope contract, not an error — not a repair candidate.
      aiQuestionRef.current = null;
      aiGeneratedRef.current = null;
    } else {
      // Remember what the AI produced so Run can report whether the user edited it (Inc 4 beacon).
      aiGeneratedRef.current = { question: aiQuestionRef.current ?? '', query: r.logql };
    }
  }

  // Ask mode: natural language → grounded LogQL via the backend, then render.
  function runAsk() {
    const question = ask.trim();
    if (!question || gen.isPending) return;
    aiQuestionRef.current = question;
    setRepairCount(0);
    setGenEmpty(false);
    gen.mutate({ question, scope: selection, consumerId }, { onSuccess: applyGenerated });
  }

  // LogQL mode: Run/send guard — never execute a blank bar query. Commits the draft
  // `barLogql` into `committedBarQuery`, which is what effectiveQuery actually reads.
  function runLogqlBar() {
    if (!canRunBarQuery(barLogql)) return;
    const finalQuery = barLogql.trim();
    // Beacon (Inc 4): if this query originated from the AI, report whether the user edited it.
    const ai = aiGeneratedRef.current;
    if (ai) {
      feedback.send({ lang: 'logql', question: ai.question, generatedQuery: ai.query, finalQuery, edited: finalQuery !== ai.query });
      aiGeneratedRef.current = null;
    }
    setCommittedBarQuery(finalQuery);
    setGenEmpty(false);
    setGenInvalid(false);
    flashBar();
  }

  // Validate-and-repair: the stream render IS the validation. For AI-originated queries only,
  // an error triggers a single auto-repair; a valid-but-empty result shows an info note.
  // The decision lives in the pure classifyAiResult() helper (unit-tested), mirroring
  // MetricsExploreV2's repair-once loop.
  useEffect(() => {
    const question = aiQuestionRef.current;
    const action = classifyAiResult({
      hasActiveQuery: !!effectiveQuery,
      aiOriginated: !!question,
      isError: res.isError,
      isSuccess: res.isSuccess,
      seriesCount: lines.length,
      repairCount,
    });
    if (action === 'repair' && question && !gen.isPending) {
      setRepairCount(1);
      const message = res.error?.message || 'query failed to render';
      gen.mutate(
        { question, scope: selection, consumerId, repair: { previousQuery: barLogql, error: message } },
        { onSuccess: applyGenerated },
      );
    } else if (action === 'empty-repair' && question && !gen.isPending) {
      // Valid query, zero lines: spend the shared repair to try a better parser/filter.
      setRepairCount(1);
      gen.mutate(
        {
          question,
          scope: selection,
          consumerId,
          repair: {
            previousQuery: barLogql,
            error:
              'query was valid but returned no log lines — the parser/filter may not match the log format; consider | pattern or | regexp for key=value-in-text instead of | json',
          },
        },
        { onSuccess: applyGenerated },
      );
    } else if (action === 'empty-note') {
      setGenEmpty(true);
    } else if (action === 'ok') {
      setGenEmpty(false);
      setGenInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.isError, res.isSuccess, res.data, res.error, effectiveQuery, repairCount]);

  return (
    <div className="lev2" data-testid="lev2">
      <div className="topstrip">
        <div className="crumb">Observability <b>·</b> Logs <b>·</b> Explore</div>
        <div className="spacer" />
        {isProvider && (
          <div className="custwrap">
            <button className="cust" data-testid="customer-switch" onClick={() => setCustOpen((o) => !o)} style={{ font: 'inherit' }}>
              <div>
                <div className="who">{consumerId ? 'Viewing customer' : 'Viewing your org'}</div>
                <div className="nm"><span className="hdot ok" />{customerName ?? 'Your organization'}</div>
              </div>
              <span style={{ color: '#9AA0AA' }}>▾</span>
            </button>
            {custOpen && (
              <div className="custmenu" data-testid="customer-menu">
                <div
                  className={`custitem${!consumerId ? ' on' : ''}`}
                  data-testid="customer-own"
                  onClick={() => { onConsumerChange?.(undefined); setCustOpen(false); }}
                >
                  <span className="hdot ok" />
                  <span className="cnm">Your organization</span>
                  <span className={`tag ${!consumerId ? 'view' : 'ok'}`}>{!consumerId ? 'viewing' : 'own'}</span>
                </div>
                {(consumers ?? []).map((c) => (
                  <div
                    key={c.id}
                    className={`custitem${c.id === consumerId ? ' on' : ''}${c.obs ? '' : ' disabled'}`}
                    onClick={() => { if (c.obs) { onConsumerChange?.(c.id); setCustOpen(false); } }}
                  >
                    <span className={`hdot ${c.obs ? 'ok' : ''}`} style={c.obs ? {} : { background: '#CBD0D6' }} />
                    <span className="cnm">{c.name}</span>
                    <span className={`tag ${c.id === consumerId ? 'view' : c.obs ? 'ok' : ''}`}>
                      {c.id === consumerId ? 'viewing' : c.obs ? 'logs ✓' : 'incidents only'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`stage${railCollapsed ? ' collapsed' : ''}`}>
        <div className="main">
          <div className="canvaswrap">
            <div className="eyebrow" data-testid="lev2-eyebrow">
              {crumb.length ? crumb.map((c, i) => <span key={i}>{i > 0 && <span className="sep">/</span>}{c}</span>) : (customerName ?? 'all streams')}
            </div>
            <h1 className="headline">Logs for <i data-testid="lev2-subject">{subject}.</i></h1>
            <p className="lede">
              Narrow the stream by clicking any field value in <b>Filter</b> (right) — cluster, service, status,
              method, pod… or clear a scope chip below.
            </p>

            {/* Interactive Ask ⇄ LogQL bar (Increment 3). Tab toggles mode; barLogql is the
                draft text and only commits to committedBarQuery on Run (or an AI result) —
                see effectiveQuery above. */}
            <div className="ai">
              <div className={`ai-bar${flash ? ' flash' : ''}`} data-testid="lev2-logql-line">
                <span className={`modepill${mode === 'logql' ? ' logql' : ''}`}>{mode === 'ask' ? 'Ask' : 'LogQL'}</span>
                <div className="ai-glyph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5L15 9M9 15l-2.5 2.5" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></svg>
                </div>
                {mode === 'ask' ? (
                  <input
                    data-testid="lev2-ask-input"
                    value={ask}
                    disabled={gen.isPending}
                    onChange={(e) => setAsk(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab') { e.preventDefault(); setMode('logql'); }
                      else if (e.key === 'Enter') { e.preventDefault(); runAsk(); }
                    }}
                    placeholder={gen.isPending ? 'Thinking…' : 'Ask anything — e.g. 5xx errors from checkout in the last hour'}
                  />
                ) : (
                  <input
                    data-testid="lev2-logql-input"
                    value={barLogql}
                    onChange={(e) => { setBarLogql(e.target.value); aiQuestionRef.current = null; }}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab') { e.preventDefault(); setMode('ask'); }
                      else if (e.key === 'Enter') { e.preventDefault(); runLogqlBar(); }
                    }}
                    placeholder={explanation || 'LogQL — {cluster=…} or any expression'}
                    style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14 }}
                  />
                )}
                <div className="hint"><kbd>Tab</kbd> {mode === 'ask' ? 'LogQL' : 'Ask'} · <kbd>↵</kbd> Run</div>
                <button
                  type="button"
                  className="send"
                  data-testid="lev2-run-btn"
                  disabled={mode === 'ask' ? gen.isPending || !ask.trim() : !canRunBarQuery(barLogql)}
                  onClick={() => (mode === 'ask' ? runAsk() : runLogqlBar())}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>
              {explanation && (
                <div className="ai-explain" data-testid="lev2-ai-explanation">
                  <span className="ai-explain-mark">✦</span>
                  <span className="ai-explain-text">{explanation}</span>
                  {gen.isPending && repairCount > 0 && <span className="ai-refining">· refining…</span>}
                </div>
              )}
              {genInvalid && (
                <div className="ai-invalid" data-testid="lev2-ai-invalid-warning">
                  ⚠ generated query may be invalid — review before running.
                </div>
              )}
              {genEmpty && (
                <div className="ai-empty" data-testid="lev2-ai-empty-note">
                  Query is valid but returned no lines — try a broader scope or a different search.
                </div>
              )}
              <div className="scope" data-testid="lev2-scope-chips">
                <span className="sl">Scope</span>
                {streamChips.length === 0 && lineFieldChips.length === 0 && (
                  <span className="chip hint">pick a field from Filter →</span>
                )}
                {streamChips.map(([k, v]) => (
                  <span key={`stream-${k}`} className="chip">
                    <span className="k">{k}</span>
                    <span className="v" title={v}>{v}</span>
                    <button
                      type="button"
                      className="rm"
                      data-testid={`scope-chip-remove-${k}`}
                      onClick={() => removeChip(k)}
                      onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') removeChip(k); }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {lineFieldChips.map(([k, v]) => (
                  <span key={`line-${k}`} className="chip field">
                    <span className="k">{k}</span>
                    <span className="v" title={v}>{v}</span>
                    <button
                      type="button"
                      className="rm"
                      data-testid={`scope-chip-remove-field-${k}`}
                      onClick={() => removeLineFieldFilter(k)}
                      onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') removeLineFieldFilter(k); }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="barrow">
              <div className="times">
                {Object.keys(TIME_PRESETS).map((r) => (
                  <button key={r} type="button" className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
              <div className="spacer" />
            </div>

            <div className="levels" data-testid="lev2-levels">
              <span className="ll">Levels</span>
              <button
                type="button"
                className={`lchip all${allLevelsOn ? ' on' : ''}`}
                data-testid="level-chip-all"
                onClick={() => toggleLevel('all')}
              >
                All
              </button>
              {LEVEL_KEYS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`lchip${levels[l] ? '' : ' off'}`}
                  data-testid={`level-chip-${l}`}
                  onClick={() => toggleLevel(l)}
                >
                  <span className="dot" style={{ background: `var(${LEVEL_VAR[l]})` }} />
                  {l}
                </button>
              ))}
            </div>

            {/* Stacked log-volume histogram (Increment 3). Only enabled levels are stacked —
                a toggled-off level shouldn't dominate the chart, matching how level chips filter. */}
            <div className="histwrap" data-testid="lev2-histogram">
              <div className="histhead">
                <span className="t">Log volume</span>
                <span className="leg">
                  {LEVEL_KEYS.map((l) => (
                    <span key={l}><span className="sw" style={{ background: HISTOGRAM_LEVEL_COLORS[l] }} />{l}</span>
                  ))}
                </span>
              </div>
              {volRes.isLoading && <div className="tnote" data-testid="lev2-histogram-loading">loading…</div>}
              {!volRes.isLoading && chartRows.length === 0 && (
                <div className="tnote" data-testid="lev2-histogram-empty">no volume data</div>
              )}
              {!volRes.isLoading && chartRows.length > 0 && (
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={chartRows} barCategoryGap={1}>
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--faint)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
                      formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
                    />
                    {LEVEL_KEYS.filter((l) => levels[l]).map((l) => (
                      <Bar key={l} dataKey={l} stackId="a" fill={HISTOGRAM_LEVEL_COLORS[l]} radius={0} maxBarSize={16} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="viewbar">
              <div className="filterlines">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                <input
                  data-testid="lev2-filter-input"
                  value={lineContains}
                  onChange={(e) => setLineContains(e.target.value)}
                  placeholder="Filter lines — contains…"
                />
                <span className="lit">|= &quot;…&quot;</span>
              </div>
              <button
                type="button"
                className={`ghost${wrapOn ? ' on' : ''}`}
                data-testid="lev2-wrap-toggle"
                onClick={() => setWrapOn((w) => !w)}
              >
                Wrap
              </button>
            </div>

            <LogStream
              lines={lines}
              isLoading={res.isLoading}
              isError={res.isError}
              lineContains={lineContains}
              wrapOn={wrapOn}
              expandedKey={expandedKey}
              onToggleRow={(key) => setExpandedKey((k) => (k === key ? null : key))}
              onFilterField={onRowFilterField}
            />
          </div>
        </div>

        <FacetRail
          selection={selection}
          onToggle={toggleFacet}
          consumerId={consumerId}
          customerName={customerName}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        />
      </div>

      <PodDrawer pod={drawerPod} lines={lines} onClose={() => setDrawerPod(null)} />
    </div>
  );
}
