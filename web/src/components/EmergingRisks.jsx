import { Badge } from "@/components/ui/badge";

// Pre-incident signal — trouble forming that hasn't become an incident yet. Kept
// visually quieter than the incident list (amber, not red) so it reads as "watch
// this" rather than "act now."
export function EmergingRisks({ risks }) {
  if (!risks?.length) return null;

  return (
    <div className="flex flex-wrap gap-2 border-t border-border p-3">
      <span className="w-full text-[11px] font-medium tracking-wide text-muted-text">
        EMERGING RISKS — {risks.length}
      </span>
      {risks.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md border border-severity-medium/30 bg-severity-medium-bg px-2 py-1"
          title={r.reason}
        >
          <Badge variant="outline" className="border-severity-medium/40 font-mono text-[10px] text-severity-medium">
            {r.service}
          </Badge>
          <span className="max-w-[220px] truncate text-xs text-muted-text">{r.riskType}</span>
        </div>
      ))}
    </div>
  );
}
