import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CitedText } from "@/components/CitedText";
import { EvidenceSheet } from "@/components/EvidenceSheet";
import {
  headlineOf,
  serviceOf,
  confidenceOf,
  rcaOf,
  resolutionStepsOf,
  timelineOf,
} from "@/lib/incident";

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

export function IncidentDetail({ incident }) {
  const [citedId, setCitedId] = useState(null);

  if (!incident) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-text">
        Select an incident to see its cited root-cause analysis.
      </div>
    );
  }

  const confidence = confidenceOf(incident);
  const rca = rcaOf(incident);
  const steps = resolutionStepsOf(incident);
  const timeline = timelineOf(incident);

  return (
    <motion.div
      key={incident.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col"
    >
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 text-xs text-muted-text">
          <span className="font-mono">{incident.id}</span>
          <span>·</span>
          <span className="font-mono">{serviceOf(incident)}</span>
          <Badge className={`ml-auto border ${CONFIDENCE_BADGE[confidence] || CONFIDENCE_BADGE.unknown}`}>
            confidence: {confidence}
          </Badge>
        </div>
        <h2 className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">
          {headlineOf(incident)}
        </h2>
      </div>

      <Tabs defaultValue="rca" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="rca">Root cause</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
          <TabsTrigger value="resolution">Resolution ({steps.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="rca" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            {rca ? (
              <CitedText text={rca} onCite={setCitedId} />
            ) : (
              <p className="text-sm text-muted-text">No root-cause analysis recorded yet for this incident.</p>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="timeline" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <ol className="flex flex-col gap-3">
              {timeline.map((e, i) => {
                const tag = STATUS_TAG[e.kind] || STATUS_TAG.step;
                return (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-border-strong" />
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2 text-[10px] font-medium tracking-wide">
                        <span className={tag.cls}>{tag.label}{e.status ? `[${e.status}]` : ""}</span>
                        {e.at && <span className="text-muted-text-2">{new Date(e.at).toLocaleTimeString()}</span>}
                      </span>
                      <CitedText text={e.hypothesis || e.thought || e.query || e.text} onCite={setCitedId} />
                    </div>
                  </li>
                );
              })}
              {!timeline.length && <p className="text-sm text-muted-text">No timeline recorded yet.</p>}
            </ol>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="resolution" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            {steps.length ? (
              <ol className="flex flex-col gap-2">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-text-2">{i + 1}.</span>
                    <CitedText text={s} onCite={setCitedId} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-text">No resolution steps recorded yet.</p>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <AnimatePresence>
        {citedId && <EvidenceSheet id={citedId} onClose={() => setCitedId(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}
