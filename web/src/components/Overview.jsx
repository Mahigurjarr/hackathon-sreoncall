import { useMemo } from "react";
import { AlertTriangle, EyeOff, GitPullRequest, Activity } from "lucide-react";
import { CitedText } from "@/components/CitedText";
import { leadOf } from "@/lib/incident";

// The board for someone who is not an engineer.
//
// Built to sreoncall-charts: every panel leads with a plain-language sentence, the form is a
// stat tile unless comparison is genuinely the question, and the series colours are the
// validated set (all six of dataviz's checks PASS against our dark surface — do not
// substitute values without re-running the validator).
//
// The top sentence is written by the agent each sweep (src/actions/explain.js), not templated
// here. That matters: deciding which of eighteen services is worth mentioning, what
// comparison a lay reader will feel, and whether a reading is even conclusive yet is
// judgement, and judgement belongs to the model. This component only lays out what it said.

// Validated categorical series — fixed order, never cycled (sreoncall-charts).
const SERIES = ["#3d8fc4", "#c9527c", "#6ba830", "#8a54c4", "#c47a2c", "#189e83"];

function StatTile({ label, value, unit, tone = "var(--muted-text-2)", note, icon: Icon }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {Icon ? (
          <Icon className="size-3" style={{ color: tone }} />
        ) : (
          <span className="size-1.5 rounded-full" style={{ background: tone }} />
        )}
        <span className="t-micro text-muted-text-2">{label}</span>
      </div>
      {/* The one deliberate exception to the type scale: a hero number is a different role
          from body text. It is used here and nowhere else. */}
      <p className="mt-1 font-mono text-foreground" style={{ fontSize: "1.375rem", lineHeight: 1.1 }}>
        {value}
        {unit && <span className="ml-1 t-label text-muted-text-2">{unit}</span>}
      </p>
      {note && <p className="mt-0.5 t-label text-muted-text-2">{note}</p>}
    </div>
  );
}

function BarRow({ label, value, max, display, color, onClick }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  const Row = onClick ? "button" : "div";
  return (
    <Row
      onClick={onClick}
      className={`group flex w-full items-center gap-2 py-[3px] text-left ${onClick ? "cursor-pointer" : ""}`}
      title={`${label}: ${display}`}
    >
      <span className="w-32 shrink-0 truncate text-right font-mono t-label text-muted-text group-hover:text-foreground">
        {label}
      </span>
      <div className="h-3 flex-1 rounded-sm bg-surface-2">
        <div
          className="h-full rounded-sm transition-[width] duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="w-20 shrink-0 font-mono t-label text-muted-text-2">{display}</span>
    </Row>
  );
}

function formatRate(n) {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0";
  return n < 0.01 ? n.toExponential(1) : n.toFixed(2);
}

export function Overview({ state, onSelectIncident, onCite }) {
  const health = state.health;
  const services = health?.services || [];

  const { silent, erroring, reporting, busiest, worst, totalCalls, totalErrors } = useMemo(() => {
    const silent = services.filter((s) => s.status === "silent");
    const erroring = services.filter((s) => s.status === "erroring");
    const reporting = services.filter((s) => s.status === "reporting");
    const withTraffic = services.filter((s) => s.callRate > 0);
    return {
      silent,
      erroring,
      reporting,
      busiest: [...withTraffic].sort((a, b) => b.callRate - a.callRate).slice(0, 8),
      worst: [...erroring].sort((a, b) => (b.errorRatio || 0) - (a.errorRatio || 0)).slice(0, 8),
      totalCalls: withTraffic.reduce((n, s) => n + s.callRate, 0),
      totalErrors: services.reduce((n, s) => n + (s.errorRate || 0), 0),
    };
  }, [services]);

  const openIncidents = state.incidents.filter(
    (i) => !["resolved", "closed", "mitigated"].includes(i.status)
  );
  const awaiting = (state.proposals || []).filter((p) =>
    ["draft", "revised", "apply_failed"].includes(p.status)
  );

  const incidentByService = useMemo(() => {
    const map = new Map();
    for (const i of openIncidents) map.set(i.service, i);
    return map;
  }, [openIncidents]);

  // The overall tone of the board. A silent service outranks everything — nobody can see it,
  // which is worse than a service we can see failing.
  const tone = silent.length
    ? "var(--severity-low)"
    : erroring.length
      ? "var(--severity-critical)"
      : "var(--severity-ok)";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* --- The finding, in words, before any number --- */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5" style={{ color: tone }} />
          <span className="t-micro text-muted-text-2">How the shop is doing right now</span>
          {health?.at && (
            <span className="ml-auto t-label text-muted-text-2">
              checked {new Date(health.at).toLocaleTimeString()}
            </span>
          )}
        </div>

        {state.fleetSummary?.text ? (
          <CitedText
            text={state.fleetSummary.text}
            onCite={onCite}
            className="mt-2 t-body text-foreground"
          />
        ) : (
          <p className="mt-2 t-body text-muted-text">
            The agent hasn't written a summary yet — it writes one after each sweep. The numbers
            below are live regardless.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* --- Stat tiles: the default form. "Is this fine?" answered without a plot. --- */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            label="Services healthy"
            value={reporting.length - erroring.length}
            unit={`of ${services.length}`}
            tone="var(--severity-ok)"
            note="reporting, no errors"
          />
          <StatTile
            label="Services failing"
            value={erroring.length}
            tone="var(--severity-critical)"
            icon={erroring.length ? AlertTriangle : undefined}
            note={erroring.length ? "returning errors now" : "none right now"}
          />
          <StatTile
            label="Gone quiet"
            value={silent.length}
            tone="var(--severity-low)"
            icon={silent.length ? EyeOff : undefined}
            note={silent.length ? "sending nothing at all" : "all services reporting"}
          />
          <StatTile
            label="Fixes to review"
            value={awaiting.length}
            tone="var(--signal)"
            icon={awaiting.length ? GitPullRequest : undefined}
            note={awaiting.length ? "the agent is waiting on you" : "nothing waiting"}
          />
        </div>

        {/* --- Comparison IS the question here, so a sorted bar earns its place --- */}
        {worst.length > 0 && (
          <section>
            <p className="t-body text-foreground">
              {worst.length === 1
                ? `One service is returning errors: ${worst[0].service}.`
                : `${worst.length} services are returning errors right now.`}{" "}
              <span className="text-muted-text">
                The bar shows what share of each one's requests are failing.
              </span>
            </p>
            <div className="mt-2 rounded-lg border border-border bg-surface p-3">
              {worst.map((s, i) => (
                <BarRow
                  key={s.service}
                  label={s.service}
                  value={s.errorRatio || 0}
                  max={1}
                  display={`${((s.errorRatio || 0) * 100).toFixed(1)}%`}
                  color={SERIES[1]}
                  onClick={
                    incidentByService.has(s.service)
                      ? () => onSelectIncident(incidentByService.get(s.service).id)
                      : undefined
                  }
                />
              ))}
              <p className="mt-2 t-label text-muted-text-2">
                Bars run 0–100% of that service's own requests, so a small share stays visibly
                small. Click a service with an open incident to see what the agent found.
              </p>
            </div>
          </section>
        )}

        {silent.length > 0 && (
          <section>
            <p className="t-body text-foreground">
              {silent.length === 1
                ? `${silent[0].service} has stopped sending any information at all.`
                : `${silent.length} services have stopped sending any information at all.`}{" "}
              <span className="text-muted-text">
                That is more serious than an error — while a service is silent, nobody can tell
                whether it is working.
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {silent.map((s) => (
                <button
                  key={s.service}
                  onClick={
                    incidentByService.has(s.service)
                      ? () => onSelectIncident(incidentByService.get(s.service).id)
                      : undefined
                  }
                  className="rounded-md border border-severity-low/40 bg-severity-low-bg px-2 py-1 font-mono t-label text-severity-low"
                >
                  {s.service}
                  {incidentByService.has(s.service) && (
                    <span className="ml-1.5 t-micro opacity-70">
                      {incidentByService.get(s.service).id}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {busiest.length > 0 && (
          <section>
            <p className="t-body text-foreground">
              Where the traffic is going.{" "}
              <span className="text-muted-text">
                Together these handle about {formatRate(totalCalls)} requests a second
                {totalErrors > 0 ? `, of which ${formatRate(totalErrors)} are failing` : ", none of them failing"}.
              </span>
            </p>
            <div className="mt-2 rounded-lg border border-border bg-surface p-3">
              {busiest.map((s) => (
                <BarRow
                  key={s.service}
                  label={s.service}
                  value={s.callRate}
                  max={busiest[0].callRate}
                  display={`${formatRate(s.callRate)}/s`}
                  color={SERIES[0]}
                  onClick={
                    incidentByService.has(s.service)
                      ? () => onSelectIncident(incidentByService.get(s.service).id)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
        )}

        {openIncidents.length > 0 && (
          <section>
            <p className="t-body text-foreground">
              The agent is working {openIncidents.length} problem
              {openIncidents.length === 1 ? "" : "s"} right now.{" "}
              <span className="text-muted-text">Pick one to read what it found and what it wants to do.</span>
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {openIncidents.slice(0, 6).map((inc) => (
                <button
                  key={inc.id}
                  onClick={() => onSelectIncident(inc.id)}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="font-mono t-label text-muted-text-2">{inc.id}</span>
                  <span className="font-mono t-label text-muted-text">{inc.service}</span>
                  <span className="truncate t-label text-foreground">{leadOf(inc)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
