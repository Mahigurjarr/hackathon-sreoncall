# Component recipes

Established patterns in `web/src/components/`. **Match one of these before inventing a new
one.** Each entry says where the canonical implementation lives so you can copy rather than
re-derive.

## Contents

- [Disclosure row](#disclosure-row) — collapsing a section
- [Status pill](#status-pill) — a state badge
- [Action trio](#action-trio) — approve / push back / reject
- [Drawer summary line](#drawer-summary-line) — an unbounded collection
- [Cited text](#cited-text) — prose with evidence chips
- [Fleet cell](#fleet-cell) — one service in the strip
- [Empty and pending states](#empty-and-pending-states)

---

## Disclosure row

**Canonical:** `OwnershipPanel.jsx` → `Disclosure`

A left-aligned chevron that rotates 90°, the title, and an optional count in mono. Content
animates `height: 0 → auto` with opacity over 200ms inside `overflow-hidden`.

Use for anything below disclosure layer 2. Default closed unless the content is the single
most likely next thing a reader wants (ordered next steps is the only current exception).

```jsx
<Disclosure title="Files this PR changes" count={files.length}>…</Disclosure>
<Disclosure title="Ordered next steps" count={steps.length} defaultOpen>…</Disclosure>
```

Count goes in the row, not the title string — `("Files (3)")` is a string; `count={3}` is data.

## Status pill

**Canonical:** `OwnershipPanel.jsx` → `STATUS_STYLE`

`.t-micro`, `rounded border px-1.5 py-0.5`, always a triple of `border-X/40 bg-X-bg text-X`.
Never a solid fill — solid pills compete with the primary CTA for attention.

Map every state your component can be in, including failure. A state with no pill entry falls
back silently and looks like a bug.

## Action trio

**Canonical:** `OwnershipPanel.jsx` → `ActionButton`

Three variants only:

| Variant | Look | Use |
|---|---|---|
| `primary` | solid `bg-signal`, `text-signal-foreground` | The one action you want taken |
| `ghost` | `border-border-strong`, transparent | Secondary, reversible |
| `danger` | `border-severity-critical/40`, critical text | Destructive/terminal |

Exactly one `primary` per panel. Every button that hits the network takes `pending` (swaps its
icon for a spinning `Loader2`) and `disabled`. When disabled for a *reason* — GitHub not
configured, empty feedback — say the reason in `.t-label` next to it. A disabled control with
no explanation is a dead end.

## Drawer summary line

**Canonical:** `EmergingRisks.jsx`

The law-2 pattern. A full-width button showing: icon, **count**, the *shape* of the data, and
a "view →" affordance. Opens a `Sheet` with the items grouped by a meaningful key.

The shape line is the important part and must be computed, not written:

```jsx
across {grouped.length} services — mostly {top.map(g => `${g[0]} (${g[1].length})`).join(", ")}
```

"86 signals" alone is a number. "86 across 12 services, mostly load-generator (14)" is a
finding. Always give the second.

## Cited text

**Canonical:** `CitedText.jsx` + `lib/incident.js` → `splitCitations`

Any model-authored prose renders through `CitedText`, which turns `[E7]` into a mint chip that
opens `EvidenceSheet` (disclosure layer 4). Never render an RCA, PR body, decline reason, or
resolution step as a plain string — the citation is the auditability, and dropping it silently
converts a cited claim into an assertion.

```jsx
<CitedText text={incident.rca} onCite={setCitedId} />
```

## Fleet cell

**Canonical:** `FleetStrip.jsx` → `Cell`

`flexGrow: incident ? 3 : 1` on `basis-0` cells, so affected services take three times the
width. Healthy: transparent, dot has `.breathe`, name in `.t-micro` muted. Affected: pastel
`-bg` wash, border `color-mix(... 32%)` of the severity colour, dot **static**, name in
`.t-label` foreground, incident id below in the severity colour.

Disabled when healthy (`disabled={!incident}`), so keyboard focus skips the fifteen cells that
do nothing.

The dot is driven by the **live health probe**, not by the incident list — `reporting`
(sage, breathing), `erroring` (apricot, still), `silent` (hollow periwinkle), `unknown`
(hollow grey). An incident overrides the *cell* colour but never the dot's underlying reading.
This distinction matters: "no incident" must never render as "healthy", because a service that
stopped emitting entirely is the worst state it can be in and the one most easily missed.

Every cell gets a tooltip carrying the literal rate — that's the difference between "we think
it's fine" and "4.21 calls/s, zero errors, in the last 5 minutes".

## Empty and pending states

Direction, not mood. Each names what is true and what happens next:

- No selection → "Select a service tile or an incident to see what the agent found — and what
  it wants to do about it."
- No proposal yet → "The agent hasn't finished deciding on this incident yet. It drafts a fix
  on its own immediately after concluding — nothing to click."
- Revision in flight → "re-authoring the fix — this is a full model call, give it a moment"

Never "No data", "Nothing here", or a bare spinner. If a wait is long because of a model call,
say so — an unexplained 20-second spinner reads as broken.
