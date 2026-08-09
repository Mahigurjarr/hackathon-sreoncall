import { useMemo, useState } from "react";
import { Activity, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// Pre-incident signal: trouble forming that hasn't become an incident yet.
//
// This used to render every risk as a chip in a wrapping row. At 86 risks that filled the
// entire viewport below the fold and pushed the incident detail — the actual product — off
// screen. It was the exact "wall of raw data dumped up front" that progressive disclosure
// exists to prevent, and the irony of a console built around that principle failing it in
// its own footer is why this was rewritten rather than restyled.
//
// The rule applied: never render an unbounded collection inline. Lead with the count and the
// shape of it (which services, how concentrated), and let someone ask for the list. Grouping
// by service is not cosmetic — 86 loose chips say "everything is wrong"; "12 services, and
// half of them are load-generator" says something true and actionable.

function riskLabel(risk) {
  return risk.riskType || risk.type || risk.reason || "unspecified signal";
}

export function EmergingRisks({ risks }) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of risks || []) {
      const key = r.service || "unattributed";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [risks]);

  if (!risks?.length) return null;

  const topServices = grouped.slice(0, 3);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 border-t border-border bg-surface/40 px-4 py-2.5 text-left transition-colors hover:bg-surface"
      >
        <Activity className="size-3.5 shrink-0 text-severity-medium" />
        <span className="t-label text-foreground">
          {risks.length} emerging signals
        </span>
        <span className="t-label truncate text-muted-text-2">
          across {grouped.length} services — mostly{" "}
          {topServices.map((g) => `${g[0]} (${g[1].length})`).join(", ")}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 t-micro text-muted-text-2 transition-colors group-hover:text-foreground">
          view
          <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="text-severity-medium">Emerging signals</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4 pb-8">
            <p className="t-label leading-relaxed text-muted-text">
              Patterns the sweep noticed but did not judge worth opening an incident for. They
              are watch items, not work — grouped by service so concentration is visible.
            </p>

            {grouped.map(([service, items]) => (
              <div key={service}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="font-mono t-label text-foreground">{service}</span>
                  <span className="t-micro text-muted-text-2">{items.length}</span>
                </div>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                  {items.map((r, i) => (
                    <li key={i} className="px-3 py-2">
                      <p className="t-label text-foreground">{riskLabel(r)}</p>
                      {r.reason && r.reason !== riskLabel(r) && (
                        <p className="mt-0.5 t-label text-muted-text-2">{r.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
