import { memo, useMemo } from "react";
import { motion } from "motion/react";
import { serviceOf, isOpen } from "@/lib/incident";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SEVERITY_STYLE = {
  critical: { bg: "var(--severity-critical-bg)", dot: "var(--severity-critical)" },
  high: { bg: "var(--severity-high-bg)", dot: "var(--severity-high)" },
  medium: { bg: "var(--severity-medium-bg)", dot: "var(--severity-medium)" },
  low: { bg: "var(--severity-low-bg)", dot: "var(--severity-low)" },
};

const CONFIDENCE_TO_SEVERITY = { high: "critical", medium: "high", low: "medium" };

// One tile per known service. Healthy services pulse quietly (the "still being
// watched" signal); a service with an open incident stops pulsing and snaps to a
// solid severity color instead — motion communicates state change, not decoration.
function ServiceTile({ service, incident, onSelect }) {
  const severity = incident ? CONFIDENCE_TO_SEVERITY[incident.confidence] || "medium" : null;
  const style = severity ? SEVERITY_STYLE[severity] : null;

  const tile = (
    <motion.button
      layout
      onClick={() => incident && onSelect(incident.id)}
      className={`group relative flex h-16 flex-col items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
        incident ? "cursor-pointer border-border-strong" : "cursor-default border-border signal-pulse"
      }`}
      style={{ background: style ? style.bg : "var(--surface)" }}
      whileHover={incident ? { y: -2 } : undefined}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="size-1.5 rounded-full"
          style={{ background: style ? style.dot : "var(--signal)" }}
        />
        <span className="truncate font-mono text-[11px] text-foreground">{service}</span>
      </span>
      {incident ? (
        <span className="truncate text-[10px] font-medium" style={{ color: style.dot }}>
          {incident.id}
        </span>
      ) : (
        <span className="text-[10px] text-muted-text-2">watching</span>
      )}
    </motion.button>
  );

  if (!incident) return tile;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>
        <p className="max-w-[220px] text-xs">{incident.id}: click to open</p>
      </TooltipContent>
    </Tooltip>
  );
}

const MemoTile = memo(ServiceTile);

export function ServiceGrid({ services, incidents, onSelectIncident }) {
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

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9">
      {services.map((service) => (
        <MemoTile
          key={service}
          service={service}
          incident={openByService.get(service) || null}
          onSelect={onSelectIncident}
        />
      ))}
    </div>
  );
}
