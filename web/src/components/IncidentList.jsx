import { motion, AnimatePresence } from "motion/react";
import { headlineOf, serviceOf, confidenceOf, isOpen } from "@/lib/incident";

const CONFIDENCE_DOT = {
  high: "var(--severity-critical)",
  medium: "var(--severity-high)",
  low: "var(--severity-medium)",
};

// Headline-first: one line per incident, nothing else. Full detail lives one click
// away in IncidentDetail — the CLI's `status`/`list` split, as a list.
export function IncidentList({ incidents, selectedId, onSelect }) {
  const open = incidents.filter(isOpen);
  const resolved = incidents.filter((i) => !isOpen(i));

  if (!incidents.length) {
    return (
      <p className="p-4 text-sm text-muted-text">
        No incidents recorded yet. The sentinel sweeps the fleet every ~45s — this
        panel updates on its own the moment it opens one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {open.length > 0 && (
        <p className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-text">
          OPEN — {open.length}
        </p>
      )}
      <AnimatePresence initial={false}>
        {open.map((inc) => (
          <IncidentRow key={inc.id} inc={inc} selected={inc.id === selectedId} onSelect={onSelect} />
        ))}
      </AnimatePresence>

      {resolved.length > 0 && (
        <>
          <p className="mt-3 px-2 py-1 text-[11px] font-medium tracking-wide text-muted-text">
            RESOLVED — {resolved.length}
          </p>
          {resolved.map((inc) => (
            <IncidentRow key={inc.id} inc={inc} selected={inc.id === selectedId} onSelect={onSelect} dim />
          ))}
        </>
      )}
    </div>
  );
}

function IncidentRow({ inc, selected, onSelect, dim }) {
  const dot = CONFIDENCE_DOT[confidenceOf(inc)] || "var(--severity-low)";
  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: dim ? 0.55 : 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => onSelect(inc.id)}
      className={`flex flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${
        selected ? "bg-surface-2" : "hover:bg-surface-2/60"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: dim ? "var(--severity-ok)" : dot }} />
        <span className="truncate font-mono text-[11px] text-muted-text">{inc.id}</span>
        <span className="truncate text-xs text-muted-text-2">{serviceOf(inc)}</span>
      </span>
      <span className="truncate text-[13px] text-foreground">{headlineOf(inc)}</span>
    </motion.button>
  );
}
