import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GitPullRequest, ShieldCheck } from "lucide-react";
import { LiveCounter } from "@/components/LiveCounter";
import { PracticesSheet } from "@/components/PracticesSheet";
import { formatUtcTime } from "@/lib/time";

// The header, under law 1 (hierarchy is size and stillness, not colour).
//
// The counters used to sit at the same visual weight as everything else, so four numbers
// competed with the one thing that actually needs a human. They're now demoted to quiet
// metadata, and the review queue — the only element here that represents a decision waiting
// on a person — is the single lit thing in the bar. It's also the only mint fill above the
// fold, which is what makes it findable at a glance.
const AWAITING = new Set(["draft", "revised", "apply_failed"]);

export function TopBar({ state, proposals = [], onSelectIncident }) {
  const [showPractices, setShowPractices] = useState(false);
  const openCount = state.incidents.filter((i) => !["resolved", "closed", "mitigated"].includes(i.status)).length;
  const lastSweep = state.lastSweep ? formatUtcTime(state.lastSweep) : "never";
  const practicesMissing = (state.practices || []).some((p) => !p.present);

  const awaiting = proposals.filter((p) => AWAITING.has(p.status));
  const opened = proposals.filter((p) => p.status === "applied");

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-signal breathe" />
        <span className="t-title text-foreground">SREonCall</span>
        <span className="t-label font-mono text-muted-text-2">astronomy-shop</span>
      </div>

      <AnimatePresence>
        {awaiting.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            onClick={() => onSelectIncident?.(awaiting[0].payload?.incidentId)}
            className="flex items-center gap-2 rounded-md bg-signal px-2.5 py-1 text-signal-foreground transition-[filter] duration-150 hover:brightness-110"
          >
            <GitPullRequest className="size-3.5" />
            <span className="t-label font-medium">
              {awaiting.length} fix{awaiting.length === 1 ? "" : "es"} awaiting review
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <div className="ml-auto flex items-center gap-5">
        <LiveCounter value={openCount} label="open" />
        <LiveCounter value={state.evidence.length} label="evidence" />
        {opened.length > 0 && <LiveCounter value={opened.length} label="PRs" />}
        <LiveCounter value={state.installs.length} label="capabilities" />

        <span className="t-label text-muted-text-2">swept {lastSweep}</span>

        <button
          onClick={() => setShowPractices(true)}
          title="The procedure and guardrails the agent is running under"
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors duration-150 ${
            practicesMissing
              ? "border-severity-medium/40 text-severity-medium hover:bg-severity-medium-bg"
              : "border-border text-muted-text-2 hover:border-border-strong hover:text-foreground"
          }`}
        >
          <ShieldCheck className="size-3.5" />
          <span className="t-label">{practicesMissing ? "guardrails incomplete" : "guardrails"}</span>
        </button>
      </div>

      <PracticesSheet open={showPractices} onClose={() => setShowPractices(false)} />
    </header>
  );
}
