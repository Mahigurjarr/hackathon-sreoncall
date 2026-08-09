import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PAGE_SIZE = 40;

export function KpiListSheet({ list, onClose, onOpenIncident, onOpenEvidence }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return list.items;
    return list.items.filter((item) =>
      [item.id, item.title, item.subtitle, item.meta, item.badge]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [list.items, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function updateQuery(event) {
    setQuery(event.target.value);
    setPage(0);
  }

  function openItem(item) {
    onClose();
    if (item.action === "incident") onOpenIncident(item.ref);
    if (item.action === "evidence") onOpenEvidence(item.ref);
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-hidden border-border bg-surface sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-5 py-5 pr-14">
          <div className="flex items-center gap-2">
            <span className="client-status-pill border-signal/25 text-signal">Complete list</span>
            <span className="font-mono text-[9px] text-muted-text-2">{list.items.length} records</span>
          </div>
          <SheetTitle className="mt-2 text-lg tracking-[-0.025em]">{list.title}</SheetTitle>
          <SheetDescription className="mt-1 text-[10px] leading-5 text-muted-text">{list.description}</SheetDescription>
        </SheetHeader>

        <div className="border-b border-border p-4">
          <label className="relative block">
            <span className="sr-only">Search {list.title}</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-text-2" />
            <input
              value={query}
              onChange={updateQuery}
              placeholder={`Search ${list.searchLabel || "records"}…`}
              className="h-10 w-full rounded-lg border border-border bg-background/60 pl-9 pr-3 text-[11px] text-foreground placeholder:text-muted-text-2 focus:border-signal/40 focus:outline-none"
            />
          </label>
          <p className="mt-2 text-right font-mono text-[8px] text-muted-text-2">{filtered.length} matching records</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {visibleItems.length ? (
            <div className="divide-y divide-border">
              {visibleItems.map((item) => {
                const content = (
                  <>
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-current" style={{ color: item.tone || "var(--muted-text-2)" }} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[9px] text-signal">{item.id}</span>
                        {item.badge ? <span className="client-status-pill border-border text-muted-text">{item.badge}</span> : null}
                      </span>
                      <span className="mt-1.5 block text-[10px] font-medium leading-4 text-foreground">{item.title}</span>
                      {item.subtitle ? <span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-muted-text">{item.subtitle}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      {item.meta ? <span className="block font-mono text-[8px] text-muted-text-2">{item.meta}</span> : null}
                      {item.href ? <ArrowUpRight className="ml-auto mt-2 size-3.5 text-severity-ok" /> : <ArrowRight className="ml-auto mt-2 size-3.5 text-muted-text-2" />}
                    </span>
                  </>
                );

                return item.href ? (
                  <a key={`${item.id}-${item.href}`} href={item.href} target="_blank" rel="noreferrer" className="kpi-list-row group">{content}</a>
                ) : item.action ? (
                  <button key={`${item.id}-${item.action}`} onClick={() => openItem(item)} className="kpi-list-row group">{content}</button>
                ) : (
                  <div key={item.id} className="kpi-list-row">{content}</div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-52 items-center justify-center text-[10px] text-muted-text-2">No matching records.</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="font-mono text-[8px] text-muted-text-2">Page {page + 1} of {pageCount}</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="kpi-page-button"><ArrowLeft className="size-3" />Previous</button>
            <button disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="kpi-page-button">Next<ArrowRight className="size-3" /></button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
