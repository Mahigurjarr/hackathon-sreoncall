import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CitedText } from "@/components/CitedText";
import { EvidenceSheet } from "@/components/EvidenceSheet";

// Grouped-by-service, collapsed by default — per-service reasoning is real content,
// not filler, but 50 records flat would be a data dump. Native <details> rather than
// a bespoke accordion: it's the simplest correct option and needs no extra state.
export function CapabilitiesPanel({ installs }) {
  const [citedId, setCitedId] = useState(null);

  const byService = useMemo(() => {
    const map = new Map();
    for (const inst of installs) {
      const key = inst.service || inst.target || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(inst);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [installs]);

  if (!installs.length) {
    return <p className="p-4 t-body text-muted-text">No capabilities installed yet.</p>;
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-4">
        {byService.map(([service, records]) => (
          <details key={service} className="group rounded-md border border-border bg-surface p-3">
            <summary className="flex cursor-pointer items-center gap-2 t-body [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-foreground">{service}</span>
              <span className="t-label text-muted-text">{records.length} capabilit{records.length === 1 ? "y" : "ies"}</span>
              <span className="ml-auto text-muted-text-2 transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
              {records.map((rec, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <Badge variant="secondary" className="w-fit font-mono t-micro">
                    {rec.capability}
                  </Badge>
                  <CitedText text={rec.reasoning} onCite={setCitedId} className="t-label text-muted-text" />
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      {citedId && <EvidenceSheet id={citedId} onClose={() => setCitedId(null)} />}
    </ScrollArea>
  );
}
