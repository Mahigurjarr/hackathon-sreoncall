'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  useMetricsRangeQuery,
  useMetricsQuery,
  MetricResult,
} from '@/lib/hooks/useObservabilityProxy';
import {
  useProviderMetricsRangeQuery,
  useProviderMetricsQuery,
} from '@/lib/hooks/useProviderObservability';
import {
  useMetricNames,
  useMetricLabelNames,
  useMetricFacetValues,
  useMetricType,
} from '@/lib/hooks/useMetricsDiscovery';
import { buildMetricQuery, inferMetricTypeFromName, escapePromValue, MetricType } from '@/lib/observability/promql-build';
import { useGenerateQuery, GenerateQueryResult } from '@/lib/hooks/useGenerateQuery';
import { useAskFeedback } from '@/lib/hooks/useAskFeedback';
import { goldenSignalQueries, GoldenSignalDef } from '@/lib/observability/golden-signals';
import { classifyAiResult } from '@/lib/observability/ai-query-result';
import { podStatQueries, PodScope } from '@/lib/observability/pod-stats';
import { AddToDashboardModal } from './AddToDashboardModal';
// External stylesheet (CSP blocks inline <style>; style-src-elem allows 'self').
import './MetricsExploreV2.css';

/* ─────────────────────────── helpers ─────────────────────────── */
const COLORS = ['#FF6B2B', '#D97706', '#475569', '#0D9488', '#16A34A', '#2563EB', '#7C3AED'];
const SERIES_LABELS = ['pod', 'instance', 'service_name', 'namespace'];

function seriesName(metric: Record<string, string>, i: number): string {
  for (const k of SERIES_LABELS) if (metric[k]) return metric[k];
  const keys = Object.keys(metric);
  return keys.length ? `${keys[0]}=${metric[keys[0]]}` : `series ${i + 1}`;
}

// MetricResult (matrix) → { rows for recharts, names, stats per series }
function toChart(res?: MetricResult) {
  const result = res?.data?.result ?? [];
  const names: string[] = [];
  const stats: Record<string, { last: number; min: number; max: number; avg: number }> = {};
  const byTs: Record<number, any> = {};
  result.forEach((s, i) => {
    const name = seriesName(s.metric || {}, i);
    names.push(name);
    const vals = (s.values ?? []).map(([t, v]) => ({ t, v: Number(v) }));
    if (vals.length) {
      const nums = vals.map((x) => x.v);
      stats[name] = {
        last: nums[nums.length - 1],
        min: Math.min(...nums),
        max: Math.max(...nums),
        avg: nums.reduce((a, b) => a + b, 0) / nums.length,
      };
    }
    vals.forEach(({ t, v }) => {
      byTs[t] = byTs[t] || { t };
      byTs[t][name] = v;
    });
  });
  const rows = Object.values(byTs).sort((a: any, b: any) => a.t - b.t);
  return { rows, names, stats };
}

function fmtNum(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
function fmtGolden(v: number | null, unit: GoldenSignalDef['unit']): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (unit === 'percent') return `${v.toFixed(1)}%`;
  if (unit === 'ms') return `${Math.round(v)} ms`;
  if (unit === 'bytes') return v > 1e6 ? `${(v / 1e6).toFixed(0)} MB` : `${(v / 1e3).toFixed(0)} KB`;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1);
}

// PromQL label-matcher fragment from the flat facet selection, e.g. {cluster="c",namespace="n"}.
// Used for the golden-signal cards + the pod-drawer "Plot in query" fallback — NOT for the
// metric-driven query itself (that goes through buildMetricQuery, which escapes/orders the same
// way but also picks the metric-type-appropriate function wrapper).
function selectorFromSelection(selection: Record<string, string>): string {
  const parts = Object.keys(selection)
    .sort()
    .map((k) => `${k}="${escapePromValue(selection[k])}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

/* ─────────────────────────── golden-signal card ─────────────────────────── */
function GoldenCard({
  def, start, end, step, consumerId, active, onPick,
}: {
  def: GoldenSignalDef; start: string; end: string; step: string; consumerId?: string;
  active: boolean; onPick: (def: GoldenSignalDef) => void;
}) {
  const own = useMetricsRangeQuery(def.query, start, end, step, !consumerId);
  const prov = useProviderMetricsRangeQuery(def.query, consumerId, start, end, step, !!consumerId);
  const q = consumerId ? prov : own;
  const { rows, names } = toChart(q.data);
  const latest = names.length && rows.length ? Number(rows[rows.length - 1][names[0]]) : null;
  const spark = rows.map((r: any) => ({ v: names.length ? r[names[0]] : 0 }));
  return (
    <button type="button" data-testid="golden-card" className={`card${active ? ' active' : ''}`} onClick={() => onPick(def)}>
      <div className="ctitle">{def.title}</div>
      <div className="val">{q.isLoading ? '…' : fmtGolden(latest, def.unit)}</div>
      <div className="spark">
        {spark.length > 1 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark}>
              <defs>
                <linearGradient id={`g_${def.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF6B2B" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#FF6B2B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="#FF6B2B" strokeWidth={1.5} fill={`url(#g_${def.key})`} isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </button>
  );
}

/* ─────────────────────────── facet rail (metric name → label facets) ─────────────────────────── */
// Labels that are usually most useful open-by-default across metrics sources (K8s, EC2, bare metal).
const DEFAULT_OPEN_LABELS = new Set(['namespace', 'service_name', 'pod', 'instance', 'job']);

function FacetRow({
  metric, label, selection, onToggle, consumerId, defaultOpen,
}: {
  metric: string;
  label: string;
  selection: Record<string, string>;
  onToggle: (label: string, value: string) => void;
  consumerId?: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Self-exclusion: never pass this facet's own selected value into its own values query. The
  // backend already self-excludes the queried label (listMetricLabelValues), so this client-side
  // omit is belt-and-suspenders — keeps the value list correct even if that ever changes, and
  // mirrors LogsExploreV2's FacetRow / useLogFacetValues call.
  const { [label]: _omit, ...scopedSelection } = selection;
  const vals = useMetricFacetValues(metric, label, scopedSelection, { consumerId, enabled: open });
  const selectedVal = selection[label];

  return (
    <div className={`facet${open ? ' open' : ''}`} data-testid="facet-row">
      <button type="button" className="fh" onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? '▾' : '▸'}</span>
        <span className="fk">{label}</span>
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
  metric, metricActive, metricType, selection, onPickMetric, onToggleLabel, consumerId, customerName, filter, onFilterChange,
  collapsed, onToggleCollapsed,
}: {
  metric: string | null;
  // True when the facet browser is what's driving the chart. When false, a metric may still be
  // stored (so its labels stay visible) but it is NOT highlighted — the chart is showing an
  // AI/golden/manual query, and the rail must not claim otherwise.
  metricActive: boolean;
  metricType?: MetricType;
  selection: Record<string, string>;
  onPickMetric: (name: string) => void;
  onToggleLabel: (label: string, value: string) => void;
  consumerId?: string;
  customerName?: string;
  filter: string;
  onFilterChange: (v: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  // Metric-name facet: scoped by the current selection so narrowing by label can also narrow
  // which OTHER metrics still match (single-select — picking a metric resets `selection`).
  const names = useMetricNames(selection, { consumerId });
  const rawMetrics = names.data?.metrics ?? [];
  const metrics = rawMetrics.filter((m) => m.toLowerCase().includes(filter.toLowerCase()));

  // Label facets for the selected metric only — no metric, no labels (source-agnostic: whatever
  // labels this metric actually carries, be it a K8s pod, an EC2 instance, or a bare-metal host).
  const labelNames = useMetricLabelNames(metric ?? '', selection, { consumerId, enabled: !!metric });
  const rawLabels = labelNames.data?.labels ?? [];

  return (
    <aside className="browser" data-testid="mev2-facet-rail">
      <div className="full">
        <div className="bhead">
          <div className="beyebrow">Explore</div>
          <button
            type="button"
            className="rail-collapse"
            data-testid="mev2-rail-collapse"
            aria-expanded={!collapsed}
            title="Collapse panel"
            onClick={onToggleCollapsed}
          >
            »
          </button>
        </div>
        <div className="bsub">{customerName ?? 'this tenant'} · live metrics &amp; labels</div>
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            data-testid="metric-search"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search metrics…"
          />
        </div>
        <div className="sectlbl">Metric</div>
        <div className="mlist" data-testid="metric-list">
          {names.isLoading && <div className="tnote">loading…</div>}
          {names.error && <div className="tnote">discovery unavailable</div>}
          {!names.isLoading && !names.error && metrics.length === 0 && <div className="tnote">no metrics found</div>}
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              className={`metric${metric === m && metricActive ? ' sel' : ''}`}
              data-testid="metric-row"
              onClick={() => onPickMetric(m)}
            >
              <span className="mn">{m}</span>
            </button>
          ))}
          {names.data?.truncated && <div className="tnote">showing {metrics.length} of {names.data.total}</div>}
        </div>
        <div className="divider" />
        <div className="sectlbl">Filter by label</div>
        {metric && !metricActive && (
          <div className="pickfirst" data-testid="facet-custom-note">
            Showing a custom query. Pick a metric or label to return to browsing.
          </div>
        )}
        {!metric && (
          <div className="pickfirst" data-testid="facet-pickfirst">
            Pick a metric above to see its labels.
          </div>
        )}
        {metric && (
          <div data-testid="facet-list">
            {labelNames.isLoading && <div className="tnote">loading…</div>}
            {labelNames.error && <div className="tnote">unavailable</div>}
            {!labelNames.isLoading && !labelNames.error && rawLabels.length === 0 && (
              <div className="tnote">no labels for this metric</div>
            )}
            {rawLabels.map((label) => {
              // Histogram: `le` is baked into buildMetricQuery's own inner `sum by(le,…)` for the
              // p95 quantile — never render it as a filterable facet (review fix #4).
              if (label === 'le' && metricType === 'histogram') {
                return (
                  <div className="facet" key={label} data-testid="facet-row-le">
                    <div className="fh"><span className="tw" /><span className="fk le">le</span></div>
                    <div className="lehint">used by the p95 quantile · not filterable</div>
                  </div>
                );
              }
              return (
                <FacetRow
                  key={label}
                  metric={metric as string}
                  label={label}
                  selection={selection}
                  onToggle={onToggleLabel}
                  consumerId={consumerId}
                  defaultOpen={DEFAULT_OPEN_LABELS.has(label)}
                />
              );
            })}
          </div>
        )}
        <div className="legend-tree">Click a value to filter · click it again to clear</div>
      </div>
      <div className="mini">
        <button
          type="button"
          className="rail-reopen"
          data-testid="mev2-rail-reopen"
          aria-expanded={!collapsed}
          title="Open Explore"
          onClick={onToggleCollapsed}
        >
          «
        </button>
        <div className="vlabel">Explore</div>
      </div>
    </aside>
  );
}

/* ─────────────────────────── pod drawer ─────────────────────────── */
function DrawerStat({ def, consumerId }: { def: { key: string; title: string; unit: string; query: string }; consumerId?: string }) {
  const own = useMetricsQuery(def.query, undefined, !consumerId);
  const prov = useProviderMetricsQuery(def.query, consumerId, undefined, !!consumerId);
  const q = consumerId ? prov : own;
  const s = q.data?.data?.result?.[0];
  const v = s?.value ? Number(s.value[1]) : null;
  const text = v == null ? '—' : def.unit === 'bytes' ? `${(v / 1e6).toFixed(0)} MiB` : def.unit === 'cores' ? v.toFixed(2) : String(Math.round(v));
  return (
    <div className="dstat" data-testid={`pod-stat-${def.key}`}>
      <div className="l">{def.title}</div>
      <div className="v">{q.isLoading ? '…' : text}</div>
    </div>
  );
}
function PodDrawerV2({ pod, consumerId, onClose, onPlot }: { pod: PodScope | null; consumerId?: string; onClose: () => void; onPlot: () => void }) {
  if (!pod) return null;
  const defs = podStatQueries(pod);
  const logsHref = `/observability/logs?namespace=${encodeURIComponent(pod.namespace ?? '')}&pod=${encodeURIComponent(pod.pod)}`;
  const tracesHref = `/observability/traces?service=${encodeURIComponent(pod.service ?? '')}`;
  return (
    <>
      <div className="mev2-scrim" data-testid="pod-drawer-scrim" onClick={onClose} />
      <aside className="mev2-drawer" data-testid="pod-drawer">
        <div className="dhead">
          <div className="dtop">
            <div className="ebrow">{pod.service ?? 'pod'} · {pod.namespace ?? ''}</div>
            <button className="dclose" data-testid="pod-drawer-close" onClick={onClose}>×</button>
          </div>
          <h2>{pod.pod}</h2>
        </div>
        <div className="dstats">{defs.map((d) => <DrawerStat key={d.key} def={d} consumerId={consumerId} />)}</div>
        <div className="dbody">
          <div className="dsec">Recent events</div>
          <div className="tl" data-testid="pod-events">
            <div className="ev"><span className="dot ok" /><div className="evt">Live metrics streaming</div><div className="evs">CPU / memory / restarts above are current</div></div>
            <div className="ev"><span className="dot info" /><div className="evt">Pod selected from Explore</div><div className="evs">{pod.namespace ?? ''} · {pod.service ?? ''}</div></div>
            <div className="ev"><span className="dot warn" /><div className="evt" data-testid="pod-events-placeholder">Full event feed pending</div><div className="evs">deploys / OOMKills / restarts need a Kubernetes events source — coming soon</div></div>
          </div>
          <div className="dsec" style={{ marginTop: 16 }}>Actions</div>
          <div className="dlinks">
            <button className="dlink primary" data-testid="pod-plot" onClick={onPlot} style={{ cursor: 'pointer', font: 'inherit' }}>Plot in query</button>
            <a className="dlink" data-testid="pod-jump-logs" href={logsHref}>Logs</a>
            <a className="dlink" data-testid="pod-jump-traces" href={tracesHref}>Traces</a>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────── main component ─────────────────────────── */
const TIME_PRESETS: Record<string, number> = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };

export function MetricsExploreV2({
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
  // `metric` = the single selected metric-name facet. `selection` = flat label-facet picks for
  // that metric (source-agnostic: whatever labels the metric actually carries — pod, instance,
  // namespace, …). Replaces the old K8s cluster→namespace→service→pod `ExploreScope`.
  const [metric, setMetric] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'ask' | 'promql'>('ask');
  const [ask, setAsk] = useState('');
  const [pql, setPql] = useState('');
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Who owns `activeQuery` right now. This is the single source of truth for what's on the chart:
  //   'facet'  → built from the metric-name facet + label selection (the L472 effect below)
  //   'ai'     → an AI Ask result   'golden' → a golden-signal card   'manual' → hand-typed PromQL
  //   null     → nothing plotted
  // The metric-driven effect only rebuilds when source is 'facet', so an AI/golden/manual query is
  // never clobbered by a metric/label/Refine change, and the rail never claims to drive a query it
  // isn't driving. Picking a metric or label switches back to 'facet'.
  const [querySource, setQuerySource] = useState<'facet' | 'ai' | 'golden' | 'manual' | null>(null);
  const [drawerPod, setDrawerPod] = useState<PodScope | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [custOpen, setCustOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [range, setRange] = useState('1h');
  const [metricFilter, setMetricFilter] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);
  // Refine + viz state (functional).
  const [chartType, setChartType] = useState<'line' | 'area' | 'stacked'>('line');
  const [agg, setAgg] = useState('(raw)'); // (raw) = no aggregation wrapper
  const [groupBy, setGroupBy] = useState('(none)');
  const [win, setWin] = useState('5m'); // rate window for golden cards + the metric-driven query
  // AI ask-mode: explanation line, valid-but-empty note, single auto-repair.
  const gen = useGenerateQuery();
  const feedback = useAskFeedback();
  // Survives box edits so Run (runFreeform) can report whether the user edited the AI query (Inc 4).
  const aiGeneratedRef = useRef<{ question: string; query: string } | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [genEmpty, setGenEmpty] = useState(false);
  // Advisory: server-side syntax validation flagged the generated PromQL as invalid (Inc 1 —
  // see applyGenerated). The box still fills and Run stays enabled; we just don't auto-run.
  const [genInvalid, setGenInvalid] = useState(false);
  const [repairCount, setRepairCount] = useState(0);
  // The question behind the CURRENT active query (null = query is manual, not AI-originated).
  const aiQuestionRef = useRef<string | null>(null);

  // Switching customer resets the in-page selection (metric/selection/query/result/drawer) so we
  // never show one customer's scope against another's data.
  useEffect(() => {
    setMetric(null);
    setSelection({});
    setPql('');
    setMode('ask');
    setActiveQuery(null);
    setActiveKey(null);
    setQuerySource(null);
    setDrawerPod(null);
    setMetricFilter('');
    setExplanation(null);
    setGenEmpty(false);
    setRepairCount(0);
    aiQuestionRef.current = null;
  }, [consumerId]);

  const metricTypeQuery = useMetricType(metric ?? '', { consumerId, enabled: !!metric });
  // Metadata (Mimir /metadata) is tier-1; when it hasn't resolved yet or came back 'unknown' (it's
  // keyed under the base family name, so it misses on expanded series names like `..._bucket`),
  // fall back to the name-suffix heuristic (tier-2) — synchronously, since it needs no network
  // round-trip. This makes histogram detection + the `le`-facet hiding below both available on
  // pick, with no window where `le` is briefly filterable for a `_bucket` metric (review fix #1/#5).
  const metaType: MetricType | undefined = metric ? metricTypeQuery.data : undefined;
  const metricType: MetricType | undefined = metric
    ? (metaType && metaType !== 'unknown' ? metaType : inferMetricTypeFromName(metric))
    : undefined;

  const selector = selectorFromSelection(selection);
  // Scope subject for titles — derived from the label selection (or the customer/tenant), NEVER from
  // the picked metric. An AI/golden/manual query must not be titled with a metric it doesn't plot;
  // the facet-driven title already carries the metric name explicitly (`${metric} · ${subject}`).
  const subject = selection.pod || selection.instance || selection.service_name || selection.namespace
    || customerName || 'your stack';
  const crumb = (metric ? [metric, selection.namespace, selection.service_name, selection.pod] : [])
    .filter(Boolean) as string[];
  // Only providers have customers to switch between; for a plain tenant the switcher is noise.
  const isProvider = !!(consumers && consumers.length > 0);

  const now = Math.floor(Date.now() / 1000);
  const start = String(now - (TIME_PRESETS[range] ?? 3600));
  const end = String(now);
  const step = '60s';

  const goldens = useMemo(() => goldenSignalQueries(selector, win), [selector, win]);

  // Refine: wrap any query as `<agg> by(<groupBy>)(<q>)`. Valid PromQL on top of any vector.
  // Defaults ((raw)/(none)) are a no-op, so the query is unchanged unless the user picks. Used
  // for golden-card / Ask / manual-PromQL queries only — the metric-driven facet query below
  // bakes agg/by straight into buildMetricQuery instead (composed, not re-wrapped).
  function applyRefine(q: string): string {
    const hasAgg = agg !== '(raw)';
    const hasGroup = groupBy !== '(none)';
    if (!hasAgg && !hasGroup) return q;
    const fn = hasAgg ? agg : 'sum';
    return hasGroup ? `${fn} by(${groupBy}) (${q})` : `${fn}(${q})`;
  }

  // result query (own/provider)
  const ownRes = useMetricsRangeQuery(activeQuery ?? '', start, end, step, !!activeQuery && !consumerId);
  const provRes = useProviderMetricsRangeQuery(activeQuery ?? '', consumerId, start, end, step, !!activeQuery && !!consumerId);
  const res = consumerId ? provRes : ownRes;
  const chart = toChart(res.data);

  // Metric pick / label pick / Refine change → recompute the smart-shaped query and render it
  // immediately (no separate Run needed, mirrors LogsExploreV2's facet-driven flow). Also mirrors
  // into the editable `pql` box so the user can flip to PromQL (Tab) and hand-edit from there.
  // No metric selected → no active query (clears the chart / shows the empty state).
  useEffect(() => {
    // Only the facet browser owns the query here. If an AI/golden/manual query is showing, a
    // metric/label/Refine change must NOT rebuild or clear it (that was the old clobbering bug).
    // Picking a metric or label sets querySource='facet' first, so this effect then takes over.
    if (querySource !== 'facet') return;
    if (!metric) {
      setActiveQuery(null);
      setActiveKey(null);
      return;
    }
    const q = buildMetricQuery(metric, selection, {
      type: metricType ?? 'unknown',
      window: win,
      agg,
      by: groupBy,
    });
    if (!q) {
      setActiveQuery(null);
      setActiveKey(null);
      return;
    }
    setPql(q);
    setActiveQuery(q);
    setActiveTitle(`${metric} · ${subject}`);
    setActiveKey(null);
    aiQuestionRef.current = null;
    setGenEmpty(false);
    setExplanation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, selection, metricType, win, agg, groupBy, querySource]);

  // Single-select metric facet: picking a new metric resets the label selection (a previous
  // metric's label picks don't necessarily apply to the new one) and closes any open pod drawer.
  function pickMetric(name: string) {
    // Toggle off only when this metric is the one currently DRIVING the chart (facet mode). When a
    // non-facet query is showing, the metric may still be stored (un-highlighted) — clicking it then
    // re-selects it (returns to browsing) rather than clearing it.
    setMetric((cur) => (cur === name && querySource === 'facet' ? null : name));
    setSelection({});
    setDrawerPod(null);
    setQuerySource('facet');
    setExplanation(null);
    setGenEmpty(false);
    aiQuestionRef.current = null;
  }
  // Label facet toggle (mirrors LogsExploreV2.toggleFacet). A `pod` value picked (not cleared)
  // opens the pod drawer; deselecting the pod the drawer is showing closes it.
  function toggleLabel(label: string, value: string) {
    // Picking/clearing a label returns to facet mode (the facet browser drives the chart again).
    setQuerySource('facet');
    setExplanation(null);
    setGenEmpty(false);
    aiQuestionRef.current = null;
    const wasSelected = selection[label] === value;
    setSelection((prev) => {
      const next = { ...prev };
      if (next[label] === value) delete next[label];
      else next[label] = value;
      return next;
    });
    if (label === 'pod') {
      if (!wasSelected) {
        setDrawerPod({
          cluster: selection.cluster,
          namespace: selection.namespace,
          service: selection.service_name,
          pod: value,
        });
      } else if (drawerPod?.pod === value) {
        setDrawerPod(null);
      }
    }
  }
  function removeChip(key: string) {
    setSelection((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (key === 'pod') setDrawerPod(null);
  }
  function runGolden(def: GoldenSignalDef) {
    aiQuestionRef.current = null; setGenEmpty(false); setExplanation(null);
    setActiveQuery(applyRefine(def.query)); setActiveTitle(`${def.title} · ${subject}`); setActiveKey(def.key);
    setQuerySource('golden');
  }
  function runFreeform() {
    const q = mode === 'promql' ? pql : (selector || 'up');
    // Beacon (Inc 4): if this query originated from the AI, report whether the user edited it.
    const ai = aiGeneratedRef.current;
    if (ai) {
      feedback.send({ lang: 'promql', question: ai.question, generatedQuery: ai.query, finalQuery: q.trim(), edited: q.trim() !== ai.query });
      aiGeneratedRef.current = null;
    }
    aiQuestionRef.current = null; setGenEmpty(false); setExplanation(null);
    setActiveQuery(applyRefine(q)); setActiveTitle(`Result · ${subject}`); setActiveKey(null);
    setQuerySource('manual');
  }

  // Map the in-page selection to the generate-query payload shape. Phase 1b shipped — the
  // backend's generate-query scope now accepts the full flat scope (any facet label, not just
  // cluster/namespace/service/pod), so this is a direct passthrough.
  function scopeForGen() {
    return selection;
  }
  // Apply an AI-generated query: fill the editable box, show the explanation, render the chart.
  function applyGenerated(r: GenerateQueryResult) {
    setPql(r.promql);
    setExplanation(r.explanation);
    setGenEmpty(false);
    setGenInvalid(r.valid === false);
    // Shared repair budget: if the server already spent its one syntax-repair, mark the budget
    // consumed so the frontend won't ALSO fire an error/empty repair (never >1 model repair/question).
    if (r.repaired) setRepairCount(1);
    setMode('promql');
    // Advisory (Inc 1): if the server flagged the generated PromQL as invalid (even after its one
    // shared model-repair), fill the box and warn but do NOT auto-run — Run stays enabled so the
    // user can review/edit and execute it themselves.
    if (r.valid === false) { aiGeneratedRef.current = null; return; }
    // Remember what the AI produced so Run can report whether the user edited it (Inc 4 beacon).
    aiGeneratedRef.current = { question: aiQuestionRef.current ?? '', query: r.promql };
    setActiveQuery(applyRefine(r.promql));
    setActiveTitle(`Result · ${subject}`);
    setActiveKey(null);
    setQuerySource('ai');
  }
  // Ask mode: natural language → grounded PromQL via the backend, then render.
  function runAsk() {
    const question = ask.trim();
    if (!question || gen.isPending) return;
    aiQuestionRef.current = question;
    setRepairCount(0);
    setGenEmpty(false);
    gen.mutate({ question, scope: scopeForGen(), consumerId }, { onSuccess: applyGenerated });
  }

  // Validate-and-repair: the chart render IS the validation. For AI-originated queries only,
  // a Mimir ERROR triggers a single auto-repair; a valid-but-empty result shows an info note.
  // The decision lives in the pure classifyAiResult() helper (unit-tested).
  useEffect(() => {
    const question = aiQuestionRef.current;
    const action = classifyAiResult({
      hasActiveQuery: !!activeQuery,
      aiOriginated: !!question,
      isError: res.isError || (res.data as { status?: string } | undefined)?.status === 'error',
      isSuccess: res.isSuccess,
      seriesCount: chart.names.length,
      repairCount,
    });
    if (action === 'repair' && question && activeQuery && !gen.isPending) {
      setRepairCount(1);
      const message = res.error?.message || 'query failed to render';
      gen.mutate(
        { question, scope: scopeForGen(), consumerId, repair: { previousQuery: activeQuery, error: message } },
        { onSuccess: applyGenerated },
      );
    } else if (action === 'empty-repair' && question && activeQuery && !gen.isPending) {
      // Valid query, zero series: spend the shared repair to try a better metric/selector.
      setRepairCount(1);
      gen.mutate(
        {
          question,
          scope: scopeForGen(),
          consumerId,
          repair: {
            previousQuery: activeQuery,
            error:
              'query was valid but returned no data — the metric name, labels, or rate window may not match; try a different metric or a broader selector',
          },
        },
        { onSuccess: applyGenerated },
      );
    } else if (action === 'empty-note') {
      setGenEmpty(true);
    } else if (action === 'ok') {
      setGenEmpty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.isError, res.isSuccess, res.data, res.error, activeQuery, repairCount]);

  const chips = Object.keys(selection);

  return (
    <div className="mev2" data-testid="mev2">

      {/* topstrip: breadcrumb + customer switcher (providers only) */}
      <div className="topstrip">
        <div className="crumb">Observability <b>·</b> Metrics <b>·</b> Explore</div>
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
                {/* Own-tenant view (consumerId = undefined) — the single way back from a customer. */}
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
                      {c.id === consumerId ? 'viewing' : c.obs ? 'metrics ✓' : 'incidents only'}
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
            {/* editorial header */}
            <div className="eyebrow" data-testid="mev2-eyebrow">
              {crumb.length ? crumb.map((c, i) => <span key={i}>{i > 0 && <span className="sep">/</span>}{c}</span>) : (customerName ?? 'pick a metric →')}
            </div>
            <h1 className="headline">What&apos;s happening in <i data-testid="mev2-subject">{subject}.</i></h1>
            <p className="lede">Pick a <b>metric</b> from Explore on the right, then narrow by its labels — or just ask below. No PromQL required.</p>

            {/* query hero */}
            <div className="ai">
              <div className="ai-bar">
                <div className="ai-glyph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5L15 9M9 15l-2.5 2.5" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></svg>
                </div>
                {mode === 'ask' ? (
                  <input
                    data-testid="ask-input"
                    value={ask}
                    disabled={gen.isPending}
                    onChange={(e) => setAsk(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); setMode('promql'); } else if (e.key === 'Enter') { e.preventDefault(); runAsk(); } }}
                    placeholder={gen.isPending ? 'Thinking…' : 'Ask anything — e.g. cpu busy % per node, memory for these pods…'}
                  />
                ) : (
                  <input
                    data-testid="promql-input"
                    value={pql}
                    onChange={(e) => setPql(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); setMode('ask'); } else if (e.key === 'Enter') { e.preventDefault(); runFreeform(); } }}
                    placeholder="PromQL — {namespace=…} or any expression"
                    style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14 }}
                  />
                )}
                <div className="hint"><kbd>Tab</kbd> {mode === 'ask' ? 'PromQL' : 'Ask'} · <kbd>↵</kbd> Run</div>
                <button className="send" data-testid="run-btn" disabled={gen.isPending} onClick={() => (mode === 'ask' ? runAsk() : runFreeform())}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>
              <div className="scope" data-testid="scope-chips">
                <span className="sl">Scope</span>
                {chips.length === 0 && <span className="chip hint">pick a metric and a label in Explore →</span>}
                {chips.map((k) => (
                  <span key={k} className="chip">
                    <span className="k">{k}</span>
                    <span className="v">{selection[k]}</span>
                    <button className="rm" data-testid={`scope-chip-remove-${k}`} onClick={() => removeChip(k)}>×</button>
                  </span>
                ))}
              </div>
              {explanation && (
                <div className="ai-explain" data-testid="ai-explanation">
                  <span className="ai-explain-mark">✦</span>
                  <span className="ai-explain-text">{explanation}</span>
                  {gen.isPending && repairCount > 0 && <span className="ai-refining">· refining…</span>}
                </div>
              )}
              {genInvalid && (
                <div className="ai-invalid" data-testid="mev2-ai-invalid-warning">
                  ⚠ generated query may be invalid — review before running.
                </div>
              )}
              {genEmpty && (
                <div className="ai-empty" data-testid="ai-empty-note">
                  Query is valid but returned no data — try a broader scope or a different metric.
                </div>
              )}
            </div>

            {/* tucked controls */}
            <div className="barrow">
              <div className="times">
                {Object.keys(TIME_PRESETS).map((r) => (
                  <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
              <button className={`ghost${refineOpen ? ' on' : ''}`} data-testid="configure-btn" onClick={() => setRefineOpen((o) => !o)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" /></svg>
                Configure
              </button>
              <div className="spacer" />
              {/* Own-tenant only: a panel's managed data source runs against this tenant's Mimir. */}
              {!consumerId && (
                <button
                  className="ghost"
                  data-testid="add-to-dashboard-btn"
                  disabled={!activeQuery}
                  title={activeQuery ? 'Add the current query to a dashboard' : 'Run a query first'}
                  onClick={() => activeQuery && setDashOpen(true)}
                >
                  + Add to dashboard
                </button>
              )}
            </div>
            {refineOpen && (
              <div className="refine show" data-testid="refine-row">
                <span className="rl">Refine</span>
                <span className="field"><label>Aggregation</label>
                  <select data-testid="refine-agg" value={agg} onChange={(e) => setAgg(e.target.value)}>
                    <option>(raw)</option><option>avg</option><option>sum</option><option>max</option><option>min</option>
                  </select>
                </span>
                <span className="field"><label>Window</label>
                  <select data-testid="refine-window" value={win} onChange={(e) => setWin(e.target.value)}>
                    <option>1m</option><option>5m</option><option>15m</option><option>1h</option>
                  </select>
                </span>
                <span className="field"><label>Group by</label>
                  <select data-testid="refine-groupby" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option>(none)</option><option>pod</option><option>instance</option><option>namespace</option><option>service_name</option>
                  </select>
                </span>
                <span className="field"><label>Chart</label>
                  <select data-testid="refine-chart" value={chartType} onChange={(e) => setChartType(e.target.value as 'line' | 'area' | 'stacked')}>
                    <option value="line">line</option><option value="area">area</option><option value="stacked">stacked</option>
                  </select>
                </span>
              </div>
            )}

            {/* golden signals */}
            {selector && (
              <div className="overview" data-testid="golden-signals">
                <div className="ovhead"><span className="t">Golden signals</span><span className="cap">auto-generated for {subject} · no query needed · click a card to open it below</span></div>
                <div className="grid">
                  {goldens.map((d) => (
                    <GoldenCard key={d.key} def={d} start={start} end={end} step={step} consumerId={consumerId} active={activeKey === d.key} onPick={runGolden} />
                  ))}
                </div>
              </div>
            )}

            {/* result panel (opens below) */}
            {activeQuery && (
              <div className="detail" data-testid="result-panel">
                <div className="rtop">
                  <button className="backbtn" data-testid="result-close" onClick={() => { setActiveQuery(null); setActiveKey(null); setQuerySource(null); setExplanation(null); }}>✕ Close</button>
                  <span className="rtoptitle">Showing <b>{activeTitle}</b> · signals stay above</span>
                </div>
                <div className="reading">
                  <span className="rl">Reading</span>
                  <span className="gloss">{activeQuery}</span>
                  <span className="pill"><b>{chart.names.length}</b> series</span>
                  <span className="pill">range <b>{range}</b></span>
                </div>
                <div className="panel">
                  <div className="phead">
                    <div><div className="ptitle">{activeTitle}</div><div className="psub">{consumerId ? 'customer' : 'own'} · {chart.names.length} series · last {range}</div></div>
                    <div className="vizseg" data-testid="viz-toggle">
                      {(['line', 'area', 'stacked'] as const).map((t) => (
                        <button key={t} className={chartType === t ? 'on' : ''} data-testid={`viz-${t}`} onClick={() => setChartType(t)}>
                          {t[0].toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="plot">
                    <div className="chartbox">
                      <ResponsiveContainer width="100%" height={300}>
                        {chartType === 'line' ? (
                          <LineChart data={chart.rows}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9AA0AA' }} tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
                            <YAxis tick={{ fontSize: 10, fill: '#9AA0AA' }} width={48} />
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }} />
                            {chart.names.map((n, i) => (
                              <Line key={n} type="monotone" dataKey={n} stroke={COLORS[i % COLORS.length]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                            ))}
                          </LineChart>
                        ) : (
                          <AreaChart data={chart.rows}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9AA0AA' }} tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
                            <YAxis tick={{ fontSize: 10, fill: '#9AA0AA' }} width={48} />
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }} />
                            {chart.names.map((n, i) => (
                              <Area
                                key={n}
                                type="monotone"
                                dataKey={n}
                                stroke={COLORS[i % COLORS.length]}
                                fill={COLORS[i % COLORS.length]}
                                fillOpacity={chartType === 'stacked' ? 0.5 : 0.18}
                                strokeWidth={1.6}
                                stackId={chartType === 'stacked' ? '1' : undefined}
                                isAnimationActive={false}
                              />
                            ))}
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                    <div className="leg">
                      <div className="lh">Series</div>
                      {res.isLoading && <div className="tnote">loading…</div>}
                      {!res.isLoading && chart.names.length === 0 && <div className="tnote">no data</div>}
                      {chart.names.map((n, i) => (
                        <div key={n} className="legrow">
                          <span className="sw" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="lnm" title={n}>{n}</span>
                          <span className="vv">{chart.stats[n] ? fmtNum(chart.stats[n].last) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="tablewrap">
                    <table data-testid="result-table">
                      <thead><tr><th className="l">Series</th><th>Last</th><th>Min</th><th>Max</th><th>Avg</th></tr></thead>
                      <tbody>
                        {chart.names.map((n, i) => {
                          const st = chart.stats[n];
                          return (
                            <tr key={n}>
                              <td className="l"><span className="sw" style={{ background: COLORS[i % COLORS.length] }} />{n}</td>
                              <td>{st ? fmtNum(st.last) : '—'}</td><td>{st ? fmtNum(st.min) : '—'}</td>
                              <td>{st ? fmtNum(st.max) : '—'}</td><td>{st ? fmtNum(st.avg) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="pfoot">
                    <span className="ghost" style={{ cursor: 'default' }}><span className="hdot ok" /> {chart.names.length} series returned</span>
                    <span className="meta">grounded in live labels · cardinality cap 50 series</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* explore rail: metric-name facet → label facets */}
        <FacetRail
          metric={metric}
          metricActive={querySource === 'facet'}
          metricType={metricType}
          selection={selection}
          onPickMetric={pickMetric}
          onToggleLabel={toggleLabel}
          consumerId={consumerId}
          customerName={customerName}
          filter={metricFilter}
          onFilterChange={setMetricFilter}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        />
      </div>

      <PodDrawerV2
        pod={drawerPod}
        consumerId={consumerId}
        onClose={() => setDrawerPod(null)}
        onPlot={() => {
          if (drawerPod && metric) {
            const q = buildMetricQuery(metric, selection, { type: metricType ?? 'unknown', window: win, agg, by: groupBy });
            setPql(q);
            setMode('promql');
            setActiveQuery(q);
            setActiveTitle(`${metric} · ${subject}`);
            setActiveKey(null);
            setQuerySource('facet');
          }
          setDrawerPod(null);
        }}
      />

      <AddToDashboardModal
        open={dashOpen}
        onClose={() => setDashOpen(false)}
        query={activeQuery ?? ''}
        defaultTitle={activeTitle || metric || 'Metric'}
      />
    </div>
  );
}
