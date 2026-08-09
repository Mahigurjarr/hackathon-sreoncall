import { LiveCounter } from "@/components/LiveCounter";

// The brand mark is small and quiet by design — the signature moment in this app
// is the service grid's pulse, not the header. A dashboard's boldness should spend
// itself on the data, per frontend-design's restraint principle.
export function TopBar({ state }) {
  const openCount = state.incidents.filter((i) => !["resolved", "closed", "mitigated"].includes(i.status)).length;
  const lastSweep = state.lastSweep ? new Date(state.lastSweep).toLocaleTimeString() : "never";

  return (
    <header className="flex items-center gap-6 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-signal signal-pulse" />
        <span className="text-sm font-medium tracking-tight text-foreground">SREonCall</span>
        <span className="font-mono text-[11px] text-muted-text-2">/ astronomy-shop</span>
      </div>

      <div className="ml-auto flex items-center gap-6">
        <LiveCounter value={openCount} label="open incidents" />
        <LiveCounter value={state.evidence.length} label="evidence entries" />
        <LiveCounter value={state.installs.length} label="capabilities" />
        <span className="text-[11px] text-muted-text-2">last sweep {lastSweep}</span>
      </div>
    </header>
  );
}
