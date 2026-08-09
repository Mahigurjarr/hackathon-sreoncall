import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

// The agent's operating procedure, readable from the dashboard.
//
// These documents are not a description of what the agent does — they are loaded into its
// system prompt on every incident (src/practices.js), so what is rendered here IS the
// behaviour. Showing them matters for the same reason the evidence sheet matters: a limit
// nobody can inspect is a claim, not a guardrail. Editing the underlying markdown changes the
// agent on the next sweep, which is exactly why it's worth being able to read it.

export function PracticesSheet({ open, onClose }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDocs(null);
    setError(null);
    fetch("/api/practices")
      .then((r) => r.json())
      .then((d) => setDocs(d.docs))
      .catch((e) => setError(e.message));
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-signal">Operating procedure</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
          <p className="t-label leading-relaxed text-muted-text">
            Loaded into the agent's system prompt on every incident, read fresh from{" "}
            <span className="font-mono text-muted-text-2">sre-as-code/practices/</span> each time.
            Edit those files and the next sweep behaves differently — no redeploy, no code change.
          </p>

          {error && <p className="t-body text-severity-critical">Could not load: {error}</p>}
          {!docs && !error && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {docs?.map((doc) => (
            <div key={doc.file}>
              <p className="mb-1.5 flex items-center gap-2 t-label font-medium text-foreground">
                {doc.title}
                <span className="font-mono t-micro text-muted-text-2">{doc.file}</span>
              </p>
              {doc.content ? (
                <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono t-label leading-relaxed whitespace-pre-wrap text-foreground">
                  {doc.content}
                </pre>
              ) : (
                <p className="t-body text-severity-medium">
                  Missing on disk — the agent is running without this document.
                </p>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
