import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CitedText } from "@/components/CitedText";
import { EvidenceSheet } from "@/components/EvidenceSheet";
import { OwnershipPanel } from "@/components/OwnershipPanel";
import { leadOf, serviceOf, confidenceOf, rcaOf, timelineOf } from "@/lib/incident";

// Progressive disclosure, structurally rather than decoratively.
//
// Layer 1 (always visible): the headline — service, mechanism, confidence. Someone reading
// only this already knows what is wrong and whether the agent is sure.
// Layer 2 (one click): Ownership — what the agent intends to DO about it. This is the default
// tab on purpose; a conclusion with no proposed action is where most agent demos stop.
// Layer 3 (one more click): the full RCA prose, the hypothesis trail.
// Layer 4 (one more): the literal query and raw response behind any [E#] chip.

const CONFIDENCE_BADGE = {
  high: "border-severity-critical/40 bg-severity-critical-bg text-severity-critical",
  medium: "border-severity-high/40 bg-severity-high-bg text-severity-high",
  low: "border-severity-medium/40 bg-severity-medium-bg text-severity-medium",
  unknown: "border-border bg-surface-2 text-muted-text",
};

const STATUS_TAG = {
  hypothesis: { label: "HYPOTHESIS", cls: "text-signal" },
  step: { label: "QUERY", cls: "text-muted-text" },
};

// The hypothesis trail is the malleability evidence — a model that stated one theory and
// never revised it should not look identical to one that tried to break its own case.
const HYPOTHESIS_STATUS = {
  NEW: "text-signal",
  CONFIRMED: "text-severity-ok",
  REVISED: "text-severity-medium",
  DISCONFIRMED: "text-severity-critical",
};

export function IncidentDetail({ incident, proposals = [], github, onRefresh }) {
  const [citedId, setCitedId] = useState(null);

  if (!incident) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center t-body text-muted-text">
        Select a service tile or an incident to see what the agent found — and what it wants to
        do about it.
      </div>
    );
  }

  const confidence = confidenceOf(incident);
  const rca = rcaOf(incident);
  const timeline = timelineOf(incident);

  // Surfaced in the tab label so the reviewer can see there's something waiting on them
  // without opening the tab first.
  const proposal = proposals.find((p) => p.payload?.incidentId === incident.id) || null;
  const awaitingReview = proposal && ["draft", "revised", "apply_failed"].includes(proposal.status);

  return (
    <motion.div
      key={incident.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col"
    >
      {/* --- Layer 1: the headline, always visible --- */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 t-label text-muted-text">
          <span className="font-mono">{incident.id}</span>
          <span>·</span>
          <span className="font-mono">{serviceOf(incident)}</span>
          <Badge className={`ml-auto border ${CONFIDENCE_BADGE[confidence] || CONFIDENCE_BADGE.unknown}`}>
            confidence: {confidence}
          </Badge>
        </div>
        <h2 className="mt-1.5 t-display font-medium leading-snug text-foreground">
          {leadOf(incident)}
        </h2>

        {/* What memory did to this investigation. Shown here rather than buried, because
            "the agent recognised this and spent a quarter of the budget" is a claim that
            should be checkable, not invisible. */}
        {incident.memory && incident.memory.verdict !== "novel" && incident.memory.fromIncident && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 t-label text-muted-text">
            <Brain className="size-3 text-signal" />
            <span className="font-medium text-signal">
              {incident.memory.verdict === "reuse" ? "Recognised" : "Related"}
            </span>
            <span>
              {incident.memory.verdict === "reuse" ? "as a recurrence of" : "to"} {incident.memory.fromIncident}
              {incident.memory.mechanism ? ` — ${incident.memory.mechanism}` : ""}
            </span>
            {incident.memory.turnBudget && (
              <span className="text-muted-text-2">
                · verified in {incident.memory.turnsUsed} turn{incident.memory.turnsUsed === 1 ? "" : "s"} instead of a
                full investigation
              </span>
            )}
          </p>
        )}
      </div>

      <Tabs defaultValue="ownership" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="ownership" className="gap-1.5">
            Ownership
            {awaitingReview && (
              <span className="size-1.5 rounded-full bg-signal breathe" aria-label="awaiting review" />
            )}
          </TabsTrigger>
          <TabsTrigger value="rca">Root cause</TabsTrigger>
          <TabsTrigger value="timeline">Reasoning ({timeline.length})</TabsTrigger>
        </TabsList>

        {/* --- Layer 2: what the agent intends to do --- */}
        <TabsContent value="ownership" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <OwnershipPanel
              incident={incident}
              proposals={proposals}
              github={github}
              onCite={setCitedId}
              onChanged={onRefresh}
            />
          </ScrollArea>
        </TabsContent>

        {/* --- Layer 3: the full cited analysis --- */}
        <TabsContent value="rca" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            {rca ? (
              <CitedText text={rca} onCite={setCitedId} />
            ) : (
              <p className="t-body text-muted-text">No root-cause analysis recorded yet for this incident.</p>
            )}
            {incident.unresolvedCitations?.length > 0 && (
              <p className="mt-4 rounded-md border border-severity-critical/40 bg-severity-critical-bg p-2.5 t-label text-severity-critical">
                {incident.unresolvedCitations.length} citation(s) in this analysis did not resolve to a
                recorded query ({incident.unresolvedCitations.join(", ")}) — treat those specific claims
                as unbacked.
              </p>
            )}
          </ScrollArea>
        </TabsContent>

        {/* --- Layer 3b: how it got there, including what it ruled out --- */}
        <TabsContent value="timeline" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <ol className="flex flex-col gap-3">
              {timeline.map((e, i) => {
                const tag = STATUS_TAG[e.kind] || STATUS_TAG.step;
                const statusCls = HYPOTHESIS_STATUS[e.status] || tag.cls;
                return (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-border-strong" />
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2 t-micro font-medium tracking-wide">
                        <span className={statusCls}>
                          {tag.label}{e.status ? `[${e.status}]` : ""}
                        </span>
                        {e.at && <span className="text-muted-text-2">{new Date(e.at).toLocaleTimeString()}</span>}
                      </span>
                      <CitedText text={e.hypothesis || e.thought || e.query || e.text} onCite={setCitedId} />
                    </div>
                  </li>
                );
              })}
              {!timeline.length && <p className="t-body text-muted-text">No reasoning trail recorded yet.</p>}
            </ol>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* --- Layer 4: the raw evidence behind any single claim --- */}
      <AnimatePresence>
        {citedId && <EvidenceSheet id={citedId} onClose={() => setCitedId(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}
