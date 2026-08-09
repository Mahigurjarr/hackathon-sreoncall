import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Boxes,
  GitPullRequest,
  LayoutDashboard,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { PracticesSheet } from "@/components/PracticesSheet";
import { formatUtcTime } from "@/lib/time";
import { formatFailureCount } from "@/lib/utils";

const AWAITING = new Set(["draft", "revised", "apply_failed"]);
const NAV = [
  { id: "dashboard", label: "AI operations", icon: LayoutDashboard },
  { id: "incidents", label: "Incident desk", icon: Siren },
  { id: "capabilities", label: "Monitoring policies", icon: Boxes },
];

export function TopBar({
  state,
  proposals = [],
  activeView,
  onChangeView,
  onSelectIncident,
}) {
  const [showPractices, setShowPractices] = useState(false);
  const openCount = state.incidents.filter(
    (incident) => !["resolved", "closed", "mitigated"].includes(incident.status)
  ).length;
  const servicesNeedingAttention = (state.health?.services || []).filter(
    (service) => service.status === "erroring" || service.status === "silent"
  ).length;
  const latestDataAt = state.health?.at || state.lastSweep;
  const latestData = latestDataAt ? new Date(latestDataAt) : null;
  const dataIsFresh = latestData && Date.now() - latestData.getTime() < 3 * 60 * 1000;
  const lastSweep = latestDataAt ? formatUtcTime(latestDataAt) : "never";
  const practicesMissing = (state.practices || []).some((practice) => !practice.present);
  const awaiting = proposals.filter((proposal) => AWAITING.has(proposal.status));

  const estimatedErrors = useMemo(
    () =>
      (state.health?.services || []).reduce(
        (total, service) => total + (Number(service.errorRate) || 0) * 300,
        0
      ),
    [state.health]
  );

  return (
    <header className="command-header shrink-0 border-b border-border/80 px-5">
      <div className="flex h-16 items-center gap-5">
        <button
          onClick={() => onChangeView("dashboard")}
          className="group flex shrink-0 items-center gap-3 text-left"
          aria-label="Open command center"
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <span className="block text-[13px] font-semibold tracking-[-0.02em] text-foreground">
              SRE<span className="text-signal">onCall</span>
            </span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-muted-text-2">
              autonomous sre
            </span>
          </span>
        </button>

        <nav className="flex items-center rounded-xl border border-border bg-surface/70 p-1" aria-label="Primary">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onChangeView(id)}
              aria-label={label}
              aria-current={activeView === id ? "page" : undefined}
              className={`relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] transition-colors ${
                activeView === id ? "text-foreground" : "text-muted-text hover:text-foreground"
              }`}
            >
              {activeView === id ? (
                <motion.span
                  layoutId="top-nav-selection"
                  className="absolute inset-0 rounded-lg border border-border-strong bg-surface-2"
                  transition={{ type: "spring", stiffness: 450, damping: 38 }}
                />
              ) : null}
              <Icon className="relative size-3.5" />
              <span className="relative hidden md:inline">{label}</span>
            </button>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-5 xl:flex">
          <div className="header-stat">
            <span className="header-stat-value text-severity-critical">{formatFailureCount(estimatedErrors)}</span>
            <span className="header-stat-label">failed requests · 5 min</span>
          </div>
          <div className="header-stat">
            <span className="header-stat-value">{servicesNeedingAttention}</span>
            <span className="header-stat-label">services to watch</span>
          </div>
          <div className="header-stat">
            <span className="header-stat-value">{openCount}</span>
            <span className="header-stat-label">issues handled</span>
          </div>
        </div>

        <AnimatePresence>
          {awaiting.length > 0 ? (
            <motion.button
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              onClick={() => onSelectIncident?.(awaiting[0].payload?.incidentId)}
              className="hidden items-center gap-2 rounded-lg bg-signal px-3 py-2 text-signal-foreground shadow-[0_0_24px_rgba(143,217,200,0.2)] transition-[filter] hover:brightness-110 lg:flex"
            >
              <GitPullRequest className="size-3.5" />
              <span className="text-[11px] font-semibold">
                {awaiting.length} fix{awaiting.length === 1 ? "" : "es"} ready
              </span>
            </motion.button>
          ) : null}
        </AnimatePresence>

        <div className="hidden text-right lg:block">
          <p className="font-mono text-[10px] text-muted-text">data {lastSweep}</p>
          <p className={`mt-0.5 text-[9px] uppercase tracking-[0.13em] ${dataIsFresh ? "text-severity-ok" : "text-severity-low"}`}>
            <span className={`mr-1 inline-block size-1.5 rounded-full ${dataIsFresh ? "bg-severity-ok breathe" : "bg-severity-low"}`} />
            {dataIsFresh ? "data current" : "data delayed"}
          </p>
        </div>

        <button
          onClick={() => setShowPractices(true)}
          title="The procedure and guardrails the agent is running under"
          aria-label="Open guardrails"
          className={`rounded-lg border p-2 transition-colors ${
            practicesMissing
              ? "border-severity-medium/40 text-severity-medium hover:bg-severity-medium-bg"
              : "border-border text-muted-text hover:border-border-strong hover:text-foreground"
          }`}
        >
          <ShieldCheck className="size-4" />
        </button>
      </div>

      <PracticesSheet open={showPractices} onClose={() => setShowPractices(false)} />
    </header>
  );
}
