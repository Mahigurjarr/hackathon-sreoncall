import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBar } from "@/components/TopBar";
import { ServiceGrid } from "@/components/ServiceGrid";
import { IncidentList } from "@/components/IncidentList";
import { IncidentDetail } from "@/components/IncidentDetail";
import { CapabilitiesPanel } from "@/components/CapabilitiesPanel";
import { EmergingRisks } from "@/components/EmergingRisks";
import { useSreState } from "@/hooks/useSreState";

export default function App() {
  const { state, error, loading } = useSreState();
  const [selectedId, setSelectedId] = useState(null);

  // react-best-practices (rerender-derived-state-no-effect): derive during render,
  // not in an effect — this is exactly that: a plain expression, no setState.
  const selected = state?.incidents.find((i) => i.id === selectedId) || null;

  useEffect(() => {
    // Default to the first open incident once data first arrives, so the detail
    // pane isn't empty on load if there's already something to show.
    if (state && !selectedId) {
      const firstOpen = state.incidents.find((i) => !["resolved", "closed", "mitigated"].includes(i.status));
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
        <TopBar state={state} />

        <div className="border-b border-border p-4">
          <ServiceGrid services={state.services} incidents={state.incidents} onSelectIncident={setSelectedId} />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <Tabs defaultValue="incidents" className="flex w-[340px] flex-col border-r border-border">
            <TabsList className="mx-2 mt-2 w-fit">
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
              <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            </TabsList>
            <TabsContent value="incidents" className="flex-1 overflow-y-auto">
              <IncidentList incidents={state.incidents} selectedId={selectedId} onSelect={setSelectedId} />
            </TabsContent>
            <TabsContent value="capabilities" className="flex-1 overflow-hidden">
              <CapabilitiesPanel installs={state.installs} />
            </TabsContent>
          </Tabs>

          <div className="flex-1 overflow-hidden">
            <IncidentDetail incident={selected} />
          </div>
        </div>

        <EmergingRisks risks={state.emergingRisks} />
      </div>
    </TooltipProvider>
  );
}
