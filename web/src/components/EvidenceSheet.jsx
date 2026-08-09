import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getEvidence } from "@/lib/api";
import { formatUtcDateTime } from "@/lib/time";

// The "show me the evidence" drill-down — auditability made concrete. Clicking any
// [E7] citation anywhere in the app opens this with the literal query and raw
// response behind that claim, same content bin/sre evidence prints, just closer
// to where the claim was made.
export function EvidenceSheet({ id, onClose }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    setEntry(null);
    setError(null);
    getEvidence(id).then(setEntry).catch((err) => setError(err.message));
  }, [id]);

  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-signal">{id}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6 t-body">
          {error && <p className="text-severity-critical">Could not load {id}: {error}</p>}
          {!entry && !error && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {entry && (
            <>
              <div className="flex items-center gap-2 t-label text-muted-text">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono uppercase">{entry.kind}</span>
                <span>{formatUtcDateTime(entry.at)}</span>
              </div>
              {entry.target && <p className="t-label text-muted-text">target: {entry.target}</p>}
              <div>
                <p className="mb-1 t-label font-medium text-muted-text">Query</p>
                <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono t-label text-foreground whitespace-pre-wrap">
                  {entry.query}
                </pre>
              </div>
              {entry.summary && (
                <div>
                  <p className="mb-1 t-label font-medium text-muted-text">Summary</p>
                  <p className="t-body">{entry.summary}</p>
                </div>
              )}
              <div>
                <p className="mb-1 t-label font-medium text-muted-text">Raw response</p>
                <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono t-label text-foreground">
                  {JSON.stringify(entry.raw, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
