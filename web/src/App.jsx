import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBar } from "@/components/TopBar";
import { IncidentList } from "@/components/IncidentList";
import { IncidentDetail } from "@/components/IncidentDetail";
import { Overview } from "@/components/Overview";
import { EvidenceSheet } from "@/components/EvidenceSheet";
import { CapabilitiesPanel } from "@/components/CapabilitiesPanel";
import { EmergingRisks } from "@/components/EmergingRisks";
import { CopilotWorkspace } from "@/components/CopilotWorkspace";
import { useSreState } from "@/hooks/useSreState";
import { isOpen } from "@/lib/incident";

export default function App() {
  const { state, error, loading, refresh } = useSreState();
  const [selectedId, setSelectedId] = useState(null);
  const [workspace, setWorkspace] = useState("dashboard");
  const [overviewCite, setOverviewCite] = useState(null);

  function openIncident(id) {
    setSelectedId(id);
    setWorkspace("incidents");
  }

  function openWorkspace(next) {
    setWorkspace(next);
  }

  // react-best-practices (rerender-derived-state-no-effect): derive during render,
  // not in an effect — this is exactly that: a plain expression, no setState.
  const selected = state?.incidents.find((i) => i.id === selectedId) || null;
  const proposals = state?.proposals || [];

  // The ordering the keyboard walks and the list renders must be the same one, or j/k
  // would jump around unpredictably relative to what's on screen.
  const ordered = useMemo(() => {
    if (!state) return [];
    return [...state.incidents.filter(isOpen), ...state.incidents.filter((i) => !isOpen(i))];
  }, [state]);

  const move = useCallback(
    (delta) => {
      if (!ordered.length) return;
      const current = ordered.findIndex((i) => i.id === selectedId);
      const next = current === -1 ? 0 : Math.min(ordered.length - 1, Math.max(0, current + delta));
      setSelectedId(ordered[next].id);
      // j/k is a triage gesture — it means "show me incidents", so it leaves the board.
      setWorkspace("incidents");
    },
    [ordered, selectedId]
  );

  // Keyboard nav, because this is an on-call console — an engineer triaging nine incidents
  // shouldn't have to reach for the mouse. Ignored while typing so pushing back on a
  // proposal (a textarea) isn't hijacked by j/k.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "r") {
        e.preventDefault();
        refresh();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, refresh]);

  useEffect(() => {
    // Default to the first open incident once data first arrives, so the detail
    // pane isn't empty on load if there's already something to show.
    if (state && !selectedId) {
      const firstOpen = state.incidents.find(isOpen);
      if (firstOpen) setSelectedId(firstOpen.id);
    }
  }, [state, selectedId]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-severity-critical">
        Could not reach the backend API ({error}). Is `node src/web/server.js` running?
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen flex-col gap-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen flex-col">
        <TopBar
          state={state}
          proposals={proposals}
          activeView={workspace}
          onChangeView={openWorkspace}
          onSelectIncident={openIncident}
        />

        <main className="min-h-0 flex-1 overflow-hidden">
          {workspace === "dashboard" ? (
            <Overview state={state} onSelectIncident={openIncident} onCite={setOverviewCite} />
          ) : workspace === "capabilities" ? (
            <div className="h-full overflow-hidden p-4">
              <CapabilitiesPanel installs={state.installs} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 overflow-hidden">
              <aside className="flex w-[44%] min-w-[160px] shrink-0 flex-col border-r border-border bg-background/70 sm:w-[340px]">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <LayoutDashboard className="size-3.5 text-signal" />
                  <span className="t-micro text-muted-text-2">Incident queue</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <IncidentList
                    incidents={state.incidents}
                    proposals={proposals}
                    selectedId={selectedId}
                    onSelect={openIncident}
                  />
                </div>
              </aside>
              <div className="min-w-0 flex-1 overflow-hidden">
                <IncidentDetail
                  incident={selected}
                  proposals={proposals}
                  github={state.github}
                  onRefresh={refresh}
                />
              </div>
            </div>
          )}
        </main>

        {workspace !== "dashboard" ? (
          <div className="shrink-0">
            <EmergingRisks risks={state.emergingRisks} />
          </div>
        ) : null}

        <CopilotWorkspace
          state={state}
          view={workspace}
          incidentId={workspace === "incidents" ? selectedId : null}
          onSelectIncident={openIncident}
          onCite={setOverviewCite}
        />

        {/* Citations clicked inside the Overview board resolve to the same raw-evidence
            drill-down the incident view uses — disclosure layer 4, one component. */}
        {overviewCite && (
          <EvidenceSheet id={overviewCite} onClose={() => setOverviewCite(null)} />
        )}
      </div>
    </TooltipProvider>
  );
}
