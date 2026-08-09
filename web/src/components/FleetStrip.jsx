import { memo, useMemo } from "react";
import { serviceOf, isOpen, leadOf } from "@/lib/incident";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUtcTime } from "@/lib/time";

// THE SIGNATURE ELEMENT — the fleet, as one instrument.
//
// It replaced an eighteen-tile grid where every service, healthy or on fire, occupied an
// identical card across two full rows. That grid was honest but useless: it spent the top
// third of the console telling you about the fifteen services that are fine, and it made
// "checkout is down" the same size as "email is fine."
//
// This reads left to right as a single strip. A healthy service is a thin breathing tick
// with no label — present, watched, not asking for anything. A service with an open incident
// swells to take real width, stops breathing, and picks up a pastel wash plus its incident
// id. Fleet state is one glance, and the eye lands on the widest, brightest, stillest cell
// without being told to.
//
// Width IS the severity encoding here, which is why the pastel palette works: the colors
// don't have to shout because size and stillness already did the shouting.

const SEVERITY = {
  critical: { fg: "var(--severity-critical)", bg: "var(--severity-critical-bg)" },
  high: { fg: "var(--severity-high)", bg: "var(--severity-high-bg)" },
  medium: { fg: "var(--severity-medium)", bg: "var(--severity-medium-bg)" },
  low: { fg: "var(--severity-low)", bg: "var(--severity-low-bg)" },
};

const CONFIDENCE_TO_SEVERITY = { high: "critical", medium: "high", low: "medium" };

// Live health, separate from the incident list. A service with no incident is NOT
// automatically healthy — it might have stopped emitting entirely and simply not been
// investigated yet. These are the facts the probe reports (src/lgtm/health.js); none of them
// is a judgement about whether the state is acceptable.
const HEALTH = {
  reporting: { dot: "var(--severity-ok)", breathe: true, note: "reporting, no errors" },
  erroring: { dot: "var(--severity-high)", breathe: false, note: "errors above zero" },
  silent: { dot: "var(--severity-low)", breathe: false, hollow: true, note: "no telemetry" },
  unknown: { dot: "var(--muted-text-2)", breathe: false, hollow: true, note: "backend unreachable" },
};

function formatRate(n) {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0";
  return n < 0.01 ? n.toExponential(1) : n.toFixed(2);
}

function Cell({ service, incident, health, index, growth, onSelect }) {
  const severity = incident ? CONFIDENCE_TO_SEVERITY[incident.confidence] || "medium" : null;
  const tone = severity ? SEVERITY[severity] : null;
  const vitals = HEALTH[health?.status] || HEALTH.unknown;

  const cell = (
    <button
      onClick={() => incident && onSelect(incident.id)}
      disabled={!incident}
      aria-label={
        incident
          ? `${service}: ${incident.id}, open incident, ${vitals.note}`
          : `${service}: ${vitals.note}`
      }
      style={{
        animationDelay: `${index * 22}ms`,
        background: tone ? tone.bg : "transparent",
        borderColor: tone ? `color-mix(in srgb, ${tone.fg} 32%, transparent)` : "var(--border)",
        // An affected service earns more width than a healthy one — this is the hierarchy,
        // not the colour. The multiplier is computed by the parent rather than fixed at 3:
        // when most of the fleet is affected, a flat 3× squeezes the healthy cells until
        // their names truncate to a single letter, which loses the very information the
        // strip exists to convey. Emphasis has to stay relative to how much is wrong.
        flexGrow: incident ? growth : 1,
        // Below this the name is unreadable at any growth ratio, so never go under it.
        minWidth: "3.75rem",
      }}
      className={`cell-in group relative flex min-w-0 basis-0 flex-col justify-between overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-colors duration-200 ${
        incident
          ? "cursor-pointer hover:brightness-125"
          : "cursor-default bg-surface/40 hover:bg-surface"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {/* The health dot is the live probe, not the incident. An incident overrides its
            colour (that judgement is downstream of the raw reading), but a service with no
            incident still shows what the probe actually found — including "silent", which
            the old incident-derived dot rendered as healthy green. */}
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            !incident && vitals.breathe ? "breathe" : ""
          }`}
          style={
            tone
              ? { background: tone.fg }
              : vitals.hollow
                ? { background: "transparent", boxShadow: `inset 0 0 0 1.5px ${vitals.dot}` }
                : { background: vitals.dot }
          }
        />
        {/* Healthy names are lowercase, untracked mono on purpose. `t-micro` is uppercase
            with 0.055em tracking, which is ~30% wider per character — at eighteen cells in
            one row that was the difference between "currency" and "CUR…". An eyebrow style
            is right for a label; it is wrong for a name that has to survive truncation. */}
        <span
          className={`truncate font-mono ${
            incident ? "t-label text-foreground" : "t-label normal-case tracking-normal text-muted-text-2"
          }`}
        >
          {service}
        </span>
      </span>

      {incident ? (
        <span className="t-micro mt-1.5 truncate" style={{ color: tone.fg }}>
          {incident.id}
        </span>
      ) : (
        <span
          className="t-micro mt-1.5 truncate"
          style={{ color: health?.status === "reporting" ? "var(--muted-text-2)" : vitals.dot }}
        >
          {health?.status === "reporting" ? `${formatRate(health.callRate)}/s` : health?.status || "—"}
        </span>
      )}
    </button>
  );

  // Every cell gets a tooltip now, because every cell carries a real reading. The literal
  // rate is the point: it's the difference between "we think it's fine" and "it served
  // 4.21 req/s in the last 5 minutes with zero errors".
  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="max-w-[300px]">
          <p className="t-label font-mono text-foreground">{service}</p>
          {incident && <p className="mt-1 t-label">{leadOf(incident)}</p>}
          <p className="mt-1 t-label text-muted-text">
            {vitals.note}
            {health?.status === "reporting" || health?.status === "erroring"
              ? ` · ${formatRate(health.callRate)} calls/s · ${formatRate(health.errorRate)} errors/s`
              : ""}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const MemoCell = memo(Cell);

export function FleetStrip({ services, incidents, health, onSelectIncident }) {
  // Map service -> its most recent OPEN incident, if any. Plain O(n) pass, not a
  // premature index — 18 services, never worth a Map lookup structure here.
  const openByService = useMemo(() => {
    const map = new Map();
    for (const inc of incidents) {
      if (!isOpen(inc)) continue;
      map.set(serviceOf(inc), inc);
    }
    return map;
  }, [incidents]);

  const healthByService = useMemo(() => {
    const map = new Map();
    for (const h of health?.services || []) map.set(h.service, h);
    return map;
  }, [health]);

  const affected = services.filter((s) => openByService.has(s)).length;
  const silent = (health?.services || []).filter((h) => h.status === "silent").length;
  const erroring = (health?.services || []).filter((h) => h.status === "erroring").length;

  // The summary states what the probe found, in the order a human cares about. When the
  // metrics backend is unreachable it says so instead of implying health — the one case where
  // a monitoring UI must never fall back to a comforting default.
  const summary = !health
    ? "no health reading yet — first sweep pending"
    : !health.reachable
      ? `metrics backend unreachable — the agent is blind${health.error ? ` (${health.error.slice(0, 60)})` : ""}`
      : [
          affected ? `${affected} with open incidents` : null,
          erroring ? `${erroring} erroring` : null,
          silent ? `${silent} silent` : null,
        ].filter(Boolean).join(" · ") || `all ${services.length} reporting, no errors`;

  return (
    <section className="flex flex-col gap-2" aria-label="Service health and telemetry status">
      <div className="flex items-baseline gap-2">
        <h2 className="t-micro text-muted-text-2">Fleet</h2>
        <span className={`t-label ${health && !health.reachable ? "text-severity-medium" : "text-muted-text-2"}`}>
          {summary}
        </span>
        {health?.at && (
          <span className="ml-auto t-label text-muted-text-2">
            probed {formatUtcTime(health.at)}
          </span>
        )}
      </div>

      {/* Emphasis scales down as more of the fleet breaks. When two services are affected
          they should dominate; when eleven are, insisting each is 3× wide just starves the
          healthy ones of legible width and tells you less, not more. */}
      <div className="flex h-14 items-stretch gap-1.5">
        {services.map((service, i) => (
          <MemoCell
            key={service}
            service={service}
            index={i}
            growth={affected > services.length / 2 ? 1.7 : affected > services.length / 4 ? 2.2 : 3}
            incident={openByService.get(service) || null}
            health={healthByService.get(service) || null}
            onSelect={onSelectIncident}
          />
        ))}
      </div>
    </section>
  );
}
