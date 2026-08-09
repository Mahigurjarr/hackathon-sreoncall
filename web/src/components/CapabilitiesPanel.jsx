import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CitedText } from "@/components/CitedText";
import { EvidenceSheet } from "@/components/EvidenceSheet";

const EMPTY_INSTALLS = [];

// Grouped-by-service, collapsed by default — per-service reasoning is real content,
// not filler, but 50 records flat would be a data dump. Native <details> rather than
// a bespoke accordion: it's the simplest correct option and needs no extra state.
export function CapabilitiesPanel({ installs = EMPTY_INSTALLS }) {
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

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-4">
        <section className="dashboard-panel mb-1">
          <div className="panel-heading">
            <div>
              <p className="dashboard-eyebrow text-signal">AI-recommended monitoring coverage</p>
              <h1 className="dashboard-title">Monitoring policies by service</h1>
            </div>
            <span className="data-badge">{installs.length} recommendations</span>
          </div>
          <p className="mt-3 max-w-3xl text-[10px] leading-5 text-muted-text">
            Policies are recommended from each service&apos;s observed runtime, traffic, logs, traces, and criticality. They remain inspectable recommendations in this prototype—not independently running monitors.
          </p>
        </section>

        {byService.length ? byService.map(([service, records]) => (
          <details key={service} className="group rounded-md border border-border bg-surface p-3">
            <summary className="flex cursor-pointer items-center gap-2 t-body [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-foreground">{service}</span>
              <span className="t-label text-muted-text">{records.length} monitoring polic{records.length === 1 ? "y" : "ies"}</span>
              <span className="ml-auto text-muted-text-2 transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
              {records.map((rec, index) => (
                <div key={`${rec.capability}-${rec.decided_at || index}`} className="flex flex-col gap-1">
                  <Badge variant="secondary" className="w-fit font-mono t-micro">
                    {rec.capability}
                  </Badge>
                  <CitedText text={rec.reasoning} onCite={setCitedId} className="t-label text-muted-text" />
                </div>
              ))}
            </div>
          </details>
        )) : <div className="rounded-xl border border-dashed border-border p-8 text-center text-[10px] text-muted-text">No monitoring policies have been recommended yet.</div>}
      </div>
      {citedId ? <EvidenceSheet id={citedId} onClose={() => setCitedId(null)} /> : null}
    </ScrollArea>
  );
}
