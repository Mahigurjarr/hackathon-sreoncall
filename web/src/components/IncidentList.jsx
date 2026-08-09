import { motion, AnimatePresence } from "motion/react";
import { leadOf, serviceOf, confidenceOf, isOpen } from "@/lib/incident";

const CONFIDENCE_DOT = {
  high: "var(--severity-critical)",
  medium: "var(--severity-high)",
  low: "var(--severity-medium)",
};

// Marks an incident the agent has already drafted a fix for and is waiting on a human to
// review. Shown in the list itself so the review queue is visible without opening anything —
// the agent's initiative should be apparent at a glance, not buried a tab deep.
const AWAITING = new Set(["draft", "revised", "apply_failed"]);

function proposalStateFor(incidentId, proposals) {
  const p = proposals.find((x) => x.payload?.incidentId === incidentId);
  if (!p) return null;
  if (AWAITING.has(p.status)) return "awaiting";
  if (p.status === "applied") return "applied";
  return null;
}

// Headline-first: one line per incident, nothing else. Full detail lives one click
// away in IncidentDetail — the CLI's `status`/`list` split, as a list.
export function IncidentList({ incidents, proposals = [], selectedId, onSelect }) {
  const open = incidents.filter(isOpen);
  const resolved = incidents.filter((i) => !isOpen(i));

  if (!incidents.length) {
    return (
      <p className="p-4 t-body text-muted-text">
        No incidents recorded yet. The sentinel sweeps the fleet every ~45s — this
        panel updates on its own the moment it opens one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {open.length > 0 && (
        <p className="px-2 py-1 t-label font-medium tracking-wide text-muted-text">
          OPEN — {open.length}
        </p>
      )}
      <AnimatePresence initial={false}>
        {open.map((inc) => (
          <IncidentRow
            key={inc.id}
            inc={inc}
            selected={inc.id === selectedId}
            onSelect={onSelect}
            proposalState={proposalStateFor(inc.id, proposals)}
          />
        ))}
      </AnimatePresence>

      {resolved.length > 0 && (
        <>
          <p className="mt-3 px-2 py-1 t-label font-medium tracking-wide text-muted-text">
            RESOLVED — {resolved.length}
          </p>
          {resolved.map((inc) => (
            <IncidentRow
              key={inc.id}
              inc={inc}
              selected={inc.id === selectedId}
              onSelect={onSelect}
              proposalState={proposalStateFor(inc.id, proposals)}
              dim
            />
          ))}
        </>
      )}
    </div>
  );
}

function IncidentRow({ inc, selected, onSelect, proposalState, dim }) {
  const dot = CONFIDENCE_DOT[confidenceOf(inc)] || "var(--severity-low)";
  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: dim ? 0.55 : 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => onSelect(inc.id)}
      className={`relative flex flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${
        selected ? "bg-surface-2" : "hover:bg-surface-2/60"
      }`}
    >
      {selected && (
        <motion.span
          layoutId="incident-selection"
          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-signal"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <span className="flex items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: dim ? "var(--severity-ok)" : dot }} />
        <span className="truncate font-mono t-label text-muted-text">{inc.id}</span>
        <span className="truncate t-label text-muted-text-2">{serviceOf(inc)}</span>
        {proposalState === "awaiting" && (
          <span className="ml-auto shrink-0 rounded border border-signal/40 bg-signal-dim px-1 font-mono t-micro font-medium text-signal">
            FIX READY
          </span>
        )}
        {proposalState === "applied" && (
          <span className="ml-auto shrink-0 rounded border border-severity-ok/40 bg-severity-ok-bg px-1 font-mono t-micro font-medium text-severity-ok">
            PR OPEN
          </span>
        )}
      </span>
      <span className="truncate t-body text-foreground">{leadOf(inc)}</span>
    </motion.button>
  );
}
