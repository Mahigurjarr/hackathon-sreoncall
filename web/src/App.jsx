import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBar } from "@/components/TopBar";
import { FleetStrip } from "@/components/FleetStrip";
import { IncidentList } from "@/components/IncidentList";
import { IncidentDetail } from "@/components/IncidentDetail";
import { Overview } from "@/components/Overview";
import { EvidenceSheet } from "@/components/EvidenceSheet";
import { CapabilitiesPanel } from "@/components/CapabilitiesPanel";
import { EmergingRisks } from "@/components/EmergingRisks";
import { useSreState } from "@/hooks/useSreState";
import { isOpen } from "@/lib/incident";

export default function App() {
  const { state, error, loading, refresh } = useSreState();
  const [selectedId, setSelectedId] = useState(null);
  // Landing on the plain-language board rather than an incident is deliberate: the first
  // thing any reader sees should be something they can understand without being an SRE.
  // Selecting an incident switches away from it; the Overview button switches back.
  const [showOverview, setShowOverview] = useState(true);
  const [overviewCite, setOverviewCite] = useState(null);

  function openIncident(id) {
    setSelectedId(id);
    setShowOverview(false);
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
      setShowOverview(false);
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
        <TopBar state={state} proposals={proposals} onSelectIncident={openIncident} />

        {/* Fleet health as one strip, not a two-row grid. Fixed height so it can never
            crowd out the detail pane the way the old grid did. */}
        <div className="shrink-0 border-b border-border px-4 py-3">
          <FleetStrip
            services={state.services}
            incidents={state.incidents}
            health={state.health}
            onSelectIncident={openIncident}
          />
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Tabs defaultValue="incidents" className="flex w-[320px] shrink-0 flex-col border-r border-border">
            <TabsList className="mx-3 mt-3 w-fit">
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
              <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            </TabsList>
            <TabsContent value="incidents" className="flex-1 overflow-y-auto">
              {/* Way back to the plain-language board. Sits above the incident list because
                  it's the view a non-engineer belongs in, and losing it inside a tab would
                  make the board feel like a splash screen you can't return to. */}
              <button
                onClick={() => setShowOverview(true)}
                className={`mx-2 mt-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${
                  showOverview ? "bg-surface-2 text-foreground" : "text-muted-text hover:bg-surface-2/60"
                }`}
              >
                <LayoutDashboard className="size-3.5" />
                <span className="t-label font-medium">How the shop is doing</span>
              </button>

              <IncidentList
                incidents={state.incidents}
                proposals={proposals}
                selectedId={selectedId}
                onSelect={openIncident}
              />
            </TabsContent>
            <TabsContent value="capabilities" className="flex-1 overflow-hidden">
              <CapabilitiesPanel installs={state.installs} />
            </TabsContent>
          </Tabs>

          <div className="min-w-0 flex-1 overflow-hidden">
            {showOverview ? (
              <Overview state={state} onSelectIncident={openIncident} onCite={setOverviewCite} />
            ) : (
              <IncidentDetail
                incident={selected}
                proposals={proposals}
                github={state.github}
                onRefresh={refresh}
              />
            )}
          </div>
        </div>

        <div className="shrink-0">
          <EmergingRisks risks={state.emergingRisks} />
        </div>

        {/* Citations clicked inside the Overview board resolve to the same raw-evidence
            drill-down the incident view uses — disclosure layer 4, one component. */}
        {overviewCite && (
          <EvidenceSheet id={overviewCite} onClose={() => setOverviewCite(null)} />
        )}
      </div>
    </TooltipProvider>
  );
}
