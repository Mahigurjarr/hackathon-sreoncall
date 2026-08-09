import { useId, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Database,
  ExternalLink,
  FileSearch,
  GitPullRequest,
  RotateCw,
  ScrollText,
  Server,
  Sparkles,
  Waypoints,
  Workflow,
} from "lucide-react";
import { CitedText } from "@/components/CitedText";
import { FleetStrip } from "@/components/FleetStrip";
import { KpiListSheet } from "@/components/KpiListSheet";
import { citedIdsIn, leadOf, rcaOf } from "@/lib/incident";
import { formatUtcShortTime, formatUtcTime } from "@/lib/time";
import { formatFailureCount } from "@/lib/utils";

const TERMINAL = new Set(["resolved", "closed", "mitigated"]);
const AWAITING = new Set(["draft", "revised", "apply_failed"]);
const HISTORY_POINTS = 28;
const EMPTY_ARRAY = [];
const CONFIDENCE_WEIGHT = { high: 30, medium: 18, low: 8 };
const ERROR_WINDOWS = [1, 2, 6, 24];

const PRIORITY_STYLE = {
  P1: { color: "var(--severity-critical)", label: "P1" },
  P2: { color: "var(--severity-high)", label: "P2" },
  P3: { color: "var(--severity-medium)", label: "P3" },
};

function numberFromVector(entry, aggregate = "sum") {
  const values = (entry?.raw?.data?.result || [])
    .map((result) => Number(result?.value?.[1]))
    .filter(Number.isFinite);
  if (!values.length) return 0;
  return aggregate === "max" ? Math.max(...values) : values.reduce((total, value) => total + value, 0);
}

function evidenceSeries(evidence, summary, multiplier = 1, aggregate = "sum", windowHours = null) {
  const cutoff = windowHours ? Date.now() - windowHours * 60 * 60 * 1000 : null;
  const points = evidence
    .filter((entry) => entry.summary === summary)
    .map((entry) => ({
      at: new Date(entry.at).getTime(),
      value: numberFromVector(entry, aggregate) * multiplier,
      id: entry.id,
    }))
    .filter((point) => Number.isFinite(point.at) && (!cutoff || point.at >= cutoff));
  const windowed = windowHours ? points : points.slice(-HISTORY_POINTS);
  if (windowed.length <= 240) return windowed;
  const stride = Math.ceil(windowed.length / 240);
  return windowed.filter((_, index) => index % stride === 0 || index === windowed.length - 1);
}

function latestEvidence(evidence, predicate) {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    if (predicate(evidence[index])) return evidence[index];
  }
  return null;
}

function concise(text, max = 420) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const clipped = normalized.slice(0, max);
  return `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return Math.round(value).toString();
  return value < 10 && value % 1 ? value.toFixed(1) : Math.round(value).toString();
}

function formatRelativeTime(iso) {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function incidentPriority(incident, healthByService) {
  const health = healthByService.get(incident.service)?.status;
  if (health === "silent" || (incident.confidence === "high" && health === "erroring")) return "P1";
  if (incident.confidence === "high" || health === "erroring") return "P2";
  return "P3";
}

function proposalState(proposal) {
  if (!proposal) return { label: "Analysis ready", tone: "var(--severity-high)" };
  if (proposal.status === "applied") return { label: `MR #${proposal.result?.number || "created"}`, tone: "var(--severity-ok)" };
  if (AWAITING.has(proposal.status)) return { label: "Review required", tone: "var(--signal)" };
  return { label: proposal.status?.replaceAll("_", " ") || "Remediation drafted", tone: "var(--severity-medium)" };
}

function TrendChart({ points, color, label, unit, windowHours, empty = "Building a trend from live checks" }) {
  const gradientId = useId().replaceAll(":", "");
  const width = 720;
  const height = 160;
  const inset = 12;
  const max = Math.max(...points.map((point) => point.value), 0.001);
  const min = Math.min(...points.map((point) => point.value), 0);
  const range = Math.max(max - min, max * 0.18, 0.001);
  const timeEnd = Date.now();
  const timeStart = windowHours ? timeEnd - windowHours * 60 * 60 * 1000 : points[0]?.at || timeEnd;
  const timeSpan = Math.max(timeEnd - timeStart, 1);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: inset + (windowHours ? Math.max(0, Math.min(1, (point.at - timeStart) / timeSpan)) : index / Math.max(points.length - 1, 1)) * (width - inset * 2),
    y: height - inset - ((point.value - min) / range) * (height - inset * 2),
  }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = coordinates.length
    ? `${line} L${coordinates.at(-1).x.toFixed(1)},${height} L${coordinates[0].x.toFixed(1)},${height} Z`
    : "";
  const latest = points.at(-1)?.value;
  const previous = points.at(-2)?.value;
  const change = Number.isFinite(latest) && Number.isFinite(previous) ? latest - previous : null;

  return (
    <div className="chart-wrap">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="dashboard-eyebrow">{label}</p>
          <p className="mt-1 font-mono text-2xl font-medium tracking-[-0.06em] text-foreground">
            {formatCompact(latest)} <span className="text-[10px] tracking-normal text-muted-text-2">{unit}</span>
          </p>
        </div>
        {change !== null ? (
          <div className="text-right">
            <p className={`font-mono text-[9px] ${change > 0 ? "text-severity-critical" : change < 0 ? "text-severity-ok" : "text-muted-text-2"}`}>
              {change > 0 ? "+" : ""}{formatCompact(change)} since last check
            </p>
            <p className="mt-1 text-[8px] uppercase tracking-[0.12em] text-muted-text-2">AI monitoring trend →</p>
          </div>
        ) : null}
      </div>
      {points.length > 1 ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-[140px] w-full overflow-visible" role="img" aria-label={`${label} trend`}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 7" />
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {coordinates.map((point, index) => (
            <circle key={point.id || index} cx={point.x} cy={point.y} r={index === coordinates.length - 1 ? 4 : 1.7} fill={color} opacity={index === coordinates.length - 1 ? 1 : 0.5}>
              <title>{`${formatUtcTime(point.at)} · ${formatCompact(point.value)} ${unit}`}</title>
            </circle>
          ))}
        </svg>
      ) : (
        <div className="mt-3 flex h-[140px] items-center justify-center rounded-xl border border-dashed border-border text-[10px] text-muted-text-2">{empty}</div>
      )}
      {windowHours ? (
        <div className="chart-time-axis">
          <span>{formatUtcShortTime(timeStart)}</span>
          <span>{formatUtcShortTime(timeStart + timeSpan / 2)}</span>
          <span>{formatUtcShortTime(timeEnd)}</span>
        </div>
      ) : null}
    </div>
  );
}

function SourceCard({ icon: Icon, name, system, detail, evidence, tone, onOpen }) {
  return (
    <button onClick={() => evidence && onOpen(evidence.id)} disabled={!evidence} className="source-card group text-left">
      <div className="flex items-start gap-3">
        <span className="source-icon" style={{ color: tone }}><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-foreground">{name}</span>
            {evidence ? <ArrowUpRight className="size-3.5 text-muted-text-2 transition-colors group-hover:text-signal" /> : null}
          </span>
          <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color: tone }}>{system}</span>
          <span className="mt-2 block text-[9px] leading-4 text-muted-text">{detail}</span>
          <span className="mt-2 block truncate font-mono text-[8px] text-muted-text-2">{evidence ? `${evidence.id} · ${evidence.summary}` : "No record captured yet"}</span>
        </span>
      </div>
    </button>
  );
}

function AlertRow({ incident, healthByService, proposal, onSelectIncident }) {
  const priority = incidentPriority(incident, healthByService);
  const priorityStyle = PRIORITY_STYLE[priority];
  const state = proposalState(proposal);
  const evidenceCount = citedIdsIn(rcaOf(incident)).length;
  return (
    <button onClick={() => onSelectIncident(incident.id)} className="alert-row group" aria-label={`Open ${incident.id}: ${leadOf(incident)}`}>
      <span className="client-status-pill justify-center" style={{ color: priorityStyle.color, borderColor: `color-mix(in srgb, ${priorityStyle.color} 30%, transparent)` }}>{priorityStyle.label}</span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-foreground">{leadOf(incident)}</span>
        <span className="mt-1 block truncate text-[9px] text-muted-text-2">{evidenceCount} cited findings · opened {formatRelativeTime(incident.openedAt)}</span>
      </span>
      <span className="truncate font-mono text-[9px] text-muted-text">{incident.service}</span>
      <span className="capitalize text-[9px] text-muted-text">{incident.confidence} confidence</span>
      <span className="flex items-center gap-2 text-[9px]" style={{ color: state.tone }}><span className="size-1.5 rounded-full bg-current" />{state.label}</span>
      <ArrowRight className="size-3.5 justify-self-end text-muted-text-2 transition-colors group-hover:text-signal" />
    </button>
  );
}

function LogFinding({ entry, onCite }) {
  const query = entry.query || entry.raw?.query || "Loki query recorded with this evidence";
  const hasMatches = !/^0 matching lines/.test(entry.summary || "");
  return (
    <button onClick={() => onCite(entry.id)} className="log-finding group">
      <span className={`mt-1 size-1.5 shrink-0 rounded-full ${hasMatches ? "bg-severity-high" : "bg-severity-ok"}`} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block line-clamp-2 text-[9px] leading-4 text-foreground">{concise(entry.summary, 180)}</span>
        <span className="mt-1 block truncate font-mono text-[8px] text-muted-text-2">{query}</span>
      </span>
      <span className="shrink-0 text-right"><span className="block font-mono text-[8px] text-signal">{entry.id}</span><span className="mt-1 block text-[8px] text-muted-text-2">{formatRelativeTime(entry.at)}</span></span>
      <ArrowUpRight className="size-3 shrink-0 text-muted-text-2 transition-colors group-hover:text-signal" />
    </button>
  );
}

function RemediationCard({ proposal, onSelectIncident }) {
  const state = proposalState(proposal);
  const incidentId = proposal.payload?.incidentId;
  const url = proposal.result?.url || proposal.result?.html_url;
  return (
    <article className="remediation-card">
      <div className="flex items-center justify-between gap-3">
        <span className="client-status-pill" style={{ color: state.tone, borderColor: `color-mix(in srgb, ${state.tone} 30%, transparent)` }}>{state.label}</span>
        <span className="font-mono text-[8px] text-muted-text-2">{proposal.id} · {incidentId}</span>
      </div>
      <p className="mt-3 line-clamp-3 text-[10px] leading-5 text-foreground">{proposal.summary}</p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="font-mono text-[8px] text-muted-text-2">{proposal.payload?.files?.length || 0} files · {proposal.payload?.service || "service"}</span>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[9px] text-severity-ok hover:underline">Open MR <ExternalLink className="size-3" /></a>
        ) : (
          <button onClick={() => onSelectIncident(incidentId)} className="flex items-center gap-1.5 text-[9px] text-signal hover:underline">Review & create MR <ArrowRight className="size-3" /></button>
        )}
      </div>
    </article>
  );
}

export function Overview({ state, onSelectIncident, onCite }) {
  const [activeListKey, setActiveListKey] = useState(null);
  const [errorWindowHours, setErrorWindowHours] = useState(1);
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const services = state.health?.services || EMPTY_ARRAY;
  const evidence = state.evidence || EMPTY_ARRAY;
  const proposals = state.proposals || EMPTY_ARRAY;
  const openIncidents = useMemo(() => state.incidents.filter((incident) => !TERMINAL.has(incident.status)), [state.incidents]);
  const awaiting = useMemo(() => proposals.filter((proposal) => AWAITING.has(proposal.status)), [proposals]);
  const applied = useMemo(() => proposals.filter((proposal) => proposal.status === "applied"), [proposals]);
  const healthByService = useMemo(() => new Map(services.map((service) => [service.service, service])), [services]);
  const proposalByIncident = useMemo(() => new Map(proposals.map((proposal) => [proposal.payload?.incidentId, proposal])), [proposals]);
  const errorTrend = useMemo(() => evidenceSeries(evidence, "fleet-wide error rate, now", 60, "sum", errorWindowHours), [evidence, errorWindowHours]);
  const trafficTrend = useMemo(() => evidenceSeries(evidence, "fleet-wide total call rate, now"), [evidence]);

  const dashboard = useMemo(() => {
    const reporting = services.filter((service) => service.status === "reporting");
    const erroring = services.filter((service) => service.status === "erroring");
    const silent = services.filter((service) => service.status === "silent");
    const totalErrorsPerSecond = services.reduce((total, service) => total + (Number(service.errorRate) || 0), 0);
    return { reporting, erroring, silent, totalErrorsPerSecond };
  }, [services]);

  const prioritized = useMemo(() => [...openIncidents].sort((a, b) => {
    const score = (incident) => {
      const health = healthByService.get(incident.service)?.status;
      return (CONFIDENCE_WEIGHT[incident.confidence] || 0) + (health === "silent" ? 40 : health === "erroring" ? 35 : 0) + (AWAITING.has(proposalByIncident.get(incident.id)?.status) ? 8 : 0);
    };
    return score(b) - score(a);
  }), [healthByService, openIncidents, proposalByIncident]);

  const affectedServices = new Set(openIncidents.map((incident) => incident.service));
  const highConfidenceCount = openIncidents.filter((incident) => incident.confidence === "high").length;
  const estimatedErrors5m = dashboard.totalErrorsPerSecond * 300;
  const latestMetric = latestEvidence(evidence, (entry) => entry.kind === "metric");
  const latestLog = latestEvidence(evidence, (entry) => entry.kind === "log");
  const latestTrace = latestEvidence(evidence, (entry) => entry.kind === "trace");
  const logEvidence = useMemo(() => evidence.filter((entry) => entry.kind === "log"), [evidence]);
  const recentLogs = logEvidence.slice(-4).reverse();
  const approvalIncident = awaiting.length ? openIncidents.find((incident) => incident.id === awaiting[0].payload?.incidentId) : null;
  const recommendations = approvalIncident
    ? [approvalIncident, ...prioritized.filter((incident) => incident.id !== approvalIncident.id)]
    : prioritized;
  const recommendationPosition = recommendations.length ? recommendationIndex % recommendations.length : 0;
  const primaryIncident = recommendations[recommendationPosition];
  const primaryProposal = primaryIncident ? proposalByIncident.get(primaryIncident.id) : null;
  const primaryRca = primaryIncident ? rcaOf(primaryIncident) : null;
  const primaryEvidenceCount = citedIdsIn(primaryRca).length;
  const overall = dashboard.silent.length
    ? { label: "Attention required", tone: "var(--severity-low)", headline: `${openIncidents.length} active alerts, with ${dashboard.silent.length} visibility gap${dashboard.silent.length === 1 ? "" : "s"}` }
    : openIncidents.length
      ? { label: "AI investigating", tone: "var(--severity-high)", headline: `${openIncidents.length} active alerts across ${affectedServices.size} services` }
      : { label: "Environment stable", tone: "var(--severity-ok)", headline: "No active alerts require attention" };

  const errorEvidence = useMemo(() => evidence.filter((entry) => /error|fail|exception/i.test(entry.summary || "")), [evidence]);
  const listDefinitions = useMemo(() => {
    const byService = new Map();
    for (const incident of prioritized) {
      const incidents = byService.get(incident.service) || [];
      incidents.push(incident);
      byService.set(incident.service, incidents);
    }
    const serviceItems = [...byService.entries()].map(([service, incidents]) => {
      const health = healthByService.get(service);
      const primary = incidents[0];
      return {
        id: service,
        title: `${incidents.length} active alert${incidents.length === 1 ? "" : "s"}`,
        subtitle: health?.status === "silent" ? "Telemetry is currently missing for this service." : `Current call rate: ${formatCompact(Number(health?.callRate) || 0)} requests / second.`,
        meta: health?.status || "unknown",
        badge: primary.confidence ? `${primary.confidence} confidence` : null,
        tone: health?.status === "silent" ? "var(--severity-low)" : health?.status === "erroring" ? "var(--severity-critical)" : "var(--severity-high)",
        action: "incident",
        ref: primary.id,
      };
    });
    const evidenceItem = (entry) => ({
      id: entry.id,
      title: entry.summary || "Recorded telemetry evidence",
      subtitle: entry.query || entry.raw?.query || "Raw response and query are available.",
      meta: formatRelativeTime(entry.at),
      badge: entry.kind,
      tone: entry.kind === "log" ? "var(--severity-high)" : entry.kind === "trace" ? "var(--signal)" : "var(--chart-blue)",
      action: "evidence",
      ref: entry.id,
    });
    const proposalItem = (proposal) => {
      const url = proposal.result?.url || proposal.result?.html_url;
      return {
        id: proposal.id,
        title: proposal.summary,
        subtitle: `${proposal.payload?.files?.length || 0} proposed files for ${proposal.payload?.service || "the affected service"}.`,
        meta: proposal.payload?.incidentId || "incident",
        badge: proposalState(proposal).label,
        tone: proposal.status === "applied" ? "var(--severity-ok)" : "var(--signal)",
        href: url,
        action: url ? null : "incident",
        ref: proposal.payload?.incidentId,
      };
    };

    return {
      alerts: {
        title: "Active alerts",
        description: "Every currently open alert, ranked by service health, investigation confidence, and remediation readiness.",
        searchLabel: "alerts, services, or confidence",
        items: prioritized.map((incident) => ({
          id: incident.id,
          title: leadOf(incident),
          subtitle: `${citedIdsIn(rcaOf(incident)).length} cited findings · ${proposalState(proposalByIncident.get(incident.id)).label}`,
          meta: formatRelativeTime(incident.openedAt),
          badge: `${incident.service} · ${incident.confidence}`,
          tone: PRIORITY_STYLE[incidentPriority(incident, healthByService)].color,
          action: "incident",
          ref: incident.id,
        })),
      },
      services: {
        title: "Affected services",
        description: "All services connected to an active alert. Open a service to inspect its highest-priority incident.",
        searchLabel: "services or health states",
        items: serviceItems,
      },
      errors: {
        title: "Recorded error evidence",
        description: "All stored metric, log, and trace observations mentioning an error, failure, or exception. The headline error count is a rate-based estimate, so it does not equal this evidence-record count.",
        searchLabel: "error evidence",
        items: [...errorEvidence].reverse().map(evidenceItem),
      },
      evidence: {
        title: "Telemetry evidence",
        description: "The complete paginated audit list of metric, log, and trace evidence collected by the AI.",
        searchLabel: "evidence ids, queries, or summaries",
        items: [...evidence].reverse().map(evidenceItem),
      },
      logs: {
        title: "Complete log evidence",
        description: "Every Loki log investigation stored by the AI, including the exact LogQL query, match summary, timestamp, and raw response.",
        searchLabel: "log evidence, services, or LogQL",
        items: [...logEvidence].reverse().map(evidenceItem),
      },
      remediations: {
        title: "Remediation proposals",
        description: "Every drafted, reviewed, failed, or applied remediation proposal with its incident and file scope.",
        searchLabel: "proposals, incidents, or services",
        items: [...proposals].reverse().map(proposalItem),
      },
      mergeRequests: {
        title: "Created merge requests",
        description: "Human-approved changes created through the remediation workflow. Each entry links to its Git provider record.",
        searchLabel: "merge requests or incidents",
        items: [...applied].reverse().map(proposalItem),
      },
    };
  }, [applied, errorEvidence, evidence, healthByService, logEvidence, prioritized, proposalByIncident, proposals]);

  const kpis = [
    { key: "alerts", label: "Active alerts", value: openIncidents.length, note: `${highConfidenceCount} high-confidence`, action: "View all alerts", tone: "var(--severity-critical)", icon: AlertTriangle },
    { key: "services", label: "Services affected", value: affectedServices.size, note: `of ${services.length || state.services?.length || 0} observed`, action: "View affected services", tone: "var(--severity-high)", icon: Server },
    { key: "errors", label: "Failed requests", value: formatFailureCount(estimatedErrors5m), note: "estimated, last 5 minutes", action: "Inspect error evidence", tone: "var(--severity-critical)", icon: Activity },
    { key: "logs", label: "Log records", value: logEvidence.length, note: "searchable Loki evidence", action: "View complete logs", tone: "var(--chart-blue)", icon: ScrollText },
    { key: "remediations", label: "Remediations", value: proposals.length, note: `${awaiting.length} waiting for review`, action: "View all proposals", tone: "var(--severity-medium)", icon: Workflow },
    { key: "mergeRequests", label: "Merge requests", value: applied.length, note: "human-approved changes", action: "View all MRs", tone: "var(--severity-ok)", icon: GitPullRequest },
  ];

  return (
    <div className="dashboard-scroll h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1580px] flex-col gap-4 px-4 py-4 pb-28 sm:px-6 lg:px-7">
        <section className="client-hero">
          <div className="dashboard-orbit dashboard-orbit-one" />
          <div className="dashboard-orbit dashboard-orbit-two" />
          <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(350px,0.65fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="status-pulse" style={{ color: overall.tone }} />
                <span className="dashboard-eyebrow" style={{ color: overall.tone }}>{overall.label}</span>
                <span className="rounded-full border border-border bg-black/20 px-2 py-1 text-[8px] text-muted-text-2">Updated {state.health?.at ? `${formatRelativeTime(state.health.at)} · ${formatUtcTime(state.health.at)}` : "when telemetry connects"}</span>
              </div>
              <h1 className="mt-4 max-w-4xl text-[clamp(1.7rem,3.2vw,3rem)] font-medium leading-[1.06] tracking-[-0.058em] text-foreground">{overall.headline}</h1>
              <div className="mt-4 flex items-center gap-2"><Sparkles className="size-3.5 text-signal" /><span className="text-[9px] uppercase tracking-[0.13em] text-signal">AI operations brief</span><span className="text-[9px] text-muted-text-2">grounded in metrics, logs, and traces</span></div>
              {state.fleetSummary?.text ? <CitedText text={concise(state.fleetSummary.text)} onCite={onCite} className="mt-2 max-w-4xl text-[12px] leading-6 text-muted-text" /> : <p className="mt-2 text-[11px] text-muted-text">The first autonomous investigation is preparing a grounded environment summary.</p>}
              {state.fleetSummary?.text ? <details className="client-summary-details mt-3 max-w-4xl"><summary><span>Read full AI analysis</span><ChevronDown className="size-3" /></summary><CitedText text={state.fleetSummary.text} onCite={onCite} className="mt-3 text-[10px] leading-5 text-muted-text" /></details> : null}
            </div>

            <aside className="client-next-action">
              <div className="flex items-center justify-between gap-3">
                <div><p className="dashboard-eyebrow text-signal">Next AI-recommended action</p>{recommendations.length > 1 ? <p className="mt-1 font-mono text-[8px] text-muted-text-2">{recommendationPosition + 1} of {recommendations.length} ranked actions</p> : null}</div>
                {recommendations.length > 1 ? <button onClick={() => setRecommendationIndex((current) => (current + 1) % recommendations.length)} className="recommendation-rotate" aria-label="Show next AI recommendation" title="Rotate to the next AI-ranked action"><RotateCw className="size-3" />Next</button> : <Bot className="size-4 text-signal" />}
              </div>
              {primaryIncident ? <>
                <div className="mt-4 flex items-center gap-2"><span className="client-status-pill" style={{ color: PRIORITY_STYLE[incidentPriority(primaryIncident, healthByService)].color, borderColor: "var(--border-strong)" }}>{incidentPriority(primaryIncident, healthByService)}</span><span className="font-mono text-[9px] text-muted-text-2">{primaryIncident.id} · {primaryIncident.service}</span></div>
                <p className="mt-3 line-clamp-3 text-[12px] font-medium leading-5 text-foreground">{leadOf(primaryIncident)}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border bg-black/15 p-2.5"><p className="client-field-label">Confidence</p><p className="mt-1 capitalize text-[10px] text-foreground">{primaryIncident.confidence}</p></div>
                  <div className="rounded-lg border border-border bg-black/15 p-2.5"><p className="client-field-label">Cited evidence</p><p className="mt-1 text-[10px] text-foreground">{primaryEvidenceCount} findings</p></div>
                </div>
                <button onClick={() => onSelectIncident(primaryIncident.id)} className="mt-4 flex w-full items-center justify-between rounded-lg bg-signal px-3 py-2.5 text-[10px] font-medium text-signal-foreground transition-[filter] hover:brightness-110">{primaryProposal && AWAITING.has(primaryProposal.status) ? "Review remediation & create MR" : "Open AI investigation"}<ArrowRight className="size-3.5" /></button>
                <p className="mt-2 text-center text-[8px] text-muted-text-2">No change is executed without human approval</p>
              </> : <div className="mt-5 flex items-center gap-3 text-severity-ok"><CheckCircle2 className="size-5" /><span className="text-[11px]">No action is currently required.</span></div>}
            </aside>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" aria-label="Operational summary">
          {kpis.map(({ key, label, value, note, action, tone, icon: Icon }) => <article key={key} className="client-metric"><div className="flex items-center justify-between"><p className="client-field-label">{label}</p><Icon className="size-3.5" style={{ color: tone }} /></div><p className="mt-4 font-mono text-2xl font-medium tracking-[-0.07em]" style={{ color: tone }}>{value}</p><p className="mt-1 text-[9px] leading-4 text-muted-text">{note}</p><button onClick={() => setActiveListKey(key)} className="client-metric-action">{action}<ArrowRight className="size-3" /></button></article>)}
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(350px,0.6fr)]">
          <article className="dashboard-panel overflow-hidden p-0">
            <div className="panel-heading px-[18px] pt-[18px]"><div><p className="dashboard-eyebrow text-severity-critical">Prioritised alert queue</p><h2 className="dashboard-title">What requires attention</h2></div><span className="data-badge">{openIncidents.length} active</span></div>
            <div className="alert-table-head mt-4"><span>Priority</span><span>Alert & evidence</span><span>Service</span><span>Confidence</span><span>AI state</span><span /></div>
            <div className="alert-table-body">{prioritized.slice(0, 7).map((incident) => <AlertRow key={incident.id} incident={incident} healthByService={healthByService} proposal={proposalByIncident.get(incident.id)} onSelectIncident={onSelectIncident} />)}</div>
            {openIncidents.length > 7 ? <button onClick={() => onSelectIncident(prioritized[7].id)} className="flex w-full items-center justify-center gap-2 border-t border-border py-3 text-[9px] text-signal hover:bg-signal-dim">View all {openIncidents.length} incidents <ArrowRight className="size-3" /></button> : null}
          </article>

          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="dashboard-eyebrow text-signal">AI analysis</p><h2 className="dashboard-title">Highest-priority finding</h2></div><CircleDot className="size-4 text-signal" /></div>
            {primaryIncident ? <>
              <div className="mt-5 flex items-center gap-2"><span className="font-mono text-[9px] text-signal">{primaryIncident.id}</span><span className="text-[8px] text-muted-text-2">·</span><span className="font-mono text-[9px] text-muted-text">{primaryIncident.service}</span></div>
              <p className="mt-3 text-[11px] font-medium leading-5 text-foreground">{leadOf(primaryIncident)}</p>
              <div className="mt-4 rounded-xl border border-border bg-black/15 p-3"><p className="client-field-label">Root-cause analysis</p>{primaryRca ? <CitedText text={concise(primaryRca, 520)} onCite={onCite} className="mt-2 line-clamp-[8] text-[9px] leading-5 text-muted-text" /> : <p className="mt-2 text-[9px] text-muted-text">Analysis is still in progress.</p>}</div>
              <button onClick={() => onSelectIncident(primaryIncident.id)} className="mt-4 flex w-full items-center justify-between rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 text-[9px] text-foreground hover:border-signal/30">Inspect reasoning, evidence & remediation <ArrowRight className="size-3.5 text-signal" /></button>
            </> : <div className="mt-8 flex items-center gap-3 text-severity-ok"><CheckCircle2 className="size-5" /><span className="text-[10px]">No active analysis required.</span></div>}
          </article>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
          <article id="error-telemetry" className="dashboard-panel">
            <div className="panel-heading"><div><p className="dashboard-eyebrow text-severity-critical">Error telemetry</p><h2 className="dashboard-title">Failure rate over time</h2></div><div className="time-range-control" role="group" aria-label="Failure-rate time range">{ERROR_WINDOWS.map((hours) => <button key={hours} onClick={() => setErrorWindowHours(hours)} aria-pressed={errorWindowHours === hours} className="time-range-button">{hours}h</button>)}</div></div>
            <TrendChart points={errorTrend} color="var(--severity-critical)" label="Estimated errors" unit="per minute" windowHours={errorWindowHours} />
          </article>
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="dashboard-eyebrow text-severity-high">Loki log analysis</p><h2 className="dashboard-title">Latest log findings</h2></div><button onClick={() => setActiveListKey("logs")} className="panel-action-button">View all {logEvidence.length} logs <ArrowRight className="size-3" /></button></div>
            <div className="mt-4 divide-y divide-border">{recentLogs.length ? recentLogs.map((entry) => <LogFinding key={entry.id} entry={entry} onCite={onCite} />) : <div className="flex h-[180px] items-center justify-center text-[9px] text-muted-text-2">No log investigations recorded yet.</div>}</div>
          </article>
        </section>

        <section id="evidence-sources" className="dashboard-panel">
          <div className="panel-heading"><div><p className="dashboard-eyebrow text-chart-blue">Investigation data sources</p><h2 className="dashboard-title">Telemetry available for incident analysis</h2></div><button onClick={() => setActiveListKey("evidence")} className="panel-action-button">Browse all {evidence.length} records <ArrowRight className="size-3" /></button></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SourceCard icon={Database} name="Metrics" system="Grafana Mimir" detail="Traffic, failure rate, latency, and runtime health." evidence={latestMetric} tone="var(--chart-blue)" onOpen={onCite} />
            <SourceCard icon={ScrollText} name="Logs" system="Grafana Loki" detail="Exact service events, matching lines, and LogQL queries." evidence={latestLog} tone="var(--severity-high)" onOpen={onCite} />
            <SourceCard icon={Waypoints} name="Distributed traces" system="Grafana Tempo" detail="Cross-service request paths, trace ids, spans, and failures." evidence={latestTrace} tone="var(--signal)" onOpen={onCite} />
            <SourceCard icon={FileSearch} name="Decision ledger" system="Local audit store" detail="AI hypotheses, evidence citations, revisions, and approvals." evidence={evidence.at(-1)} tone="var(--severity-low)" onOpen={onCite} />
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="dashboard-eyebrow text-signal">Remediation ownership</p><h2 className="dashboard-title">Proposals and merge requests</h2></div><GitPullRequest className="size-4 text-signal" /></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">{proposals.length ? proposals.slice().reverse().slice(0, 4).map((proposal) => <RemediationCard key={proposal.id} proposal={proposal} onSelectIncident={onSelectIncident} />) : <div className="col-span-full flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-[9px] text-muted-text-2">The AI has not drafted a remediation yet.</div>}</div>
          </article>
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="dashboard-eyebrow text-chart-blue">Traffic across monitored services</p><h2 className="dashboard-title">Fleet traffic rate</h2></div><Activity className="size-4 text-chart-blue" /></div>
            <TrendChart points={trafficTrend} color="var(--chart-blue)" label="Observed traffic" unit="requests / second" />
          </article>
        </section>

        <section id="fleet-health" className="dashboard-panel">
          <div className="panel-heading"><div><p className="dashboard-eyebrow text-severity-low">Monitored services</p><h2 className="dashboard-title">Service health and telemetry status</h2></div><span className="data-badge">{dashboard.reporting.length} reporting · {dashboard.erroring.length} erroring · {dashboard.silent.length} silent</span></div>
          <div className="mt-5"><FleetStrip services={state.services} incidents={state.incidents} health={state.health} onSelectIncident={onSelectIncident} /></div>
        </section>

        <details className="technical-disclosure dashboard-panel">
          <summary><div><p className="dashboard-eyebrow text-signal">Runtime & audit details</p><h2 className="dashboard-title">Where the logs and records live</h2><p className="mt-1 text-[9px] text-muted-text">Commands and storage paths for operators who need the raw system.</p></div><div className="flex items-center gap-3"><span className="data-badge">Operator reference</span><ChevronDown className="size-4 text-muted-text-2" /></div></summary>
          <div className="mt-5 grid gap-3 border-t border-border pt-5 md:grid-cols-3">
            {[{ icon: ScrollText, label: "Container logs", value: "docker compose logs -f", note: "All API and autonomous sentinel output" }, { icon: Bot, label: "AI sentinel logs", value: "docker compose logs -f sentinel", note: "Investigation sweeps and model failures" }, { icon: Database, label: "Durable audit state", value: "./store/state.json", note: "Incidents, evidence, proposals, and decisions" }].map(({ icon: Icon, label, value, note }) => <div key={label} className="rounded-xl border border-border bg-black/15 p-4"><div className="flex items-center gap-2 text-signal"><Icon className="size-3.5" /><span className="client-field-label text-signal">{label}</span></div><code className="mt-3 block break-all text-[9px] text-foreground">{value}</code><p className="mt-2 text-[8px] leading-4 text-muted-text-2">{note}</p></div>)}
          </div>
        </details>
      </div>
      {activeListKey ? <KpiListSheet key={activeListKey} list={listDefinitions[activeListKey]} onClose={() => setActiveListKey(null)} onOpenIncident={onSelectIncident} onOpenEvidence={onCite} /> : null}
    </div>
  );
}
