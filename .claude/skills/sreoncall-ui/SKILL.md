---
name: sreoncall-ui
description: The design system and UI laws for the SREonCall agent console (web/ — React + Vite + Tailwind v4 + shadcn, dark-locked "night watch" direction). Use this skill whenever touching anything under web/, adding or restyling a component, choosing a colour, size, spacing value, or animation, laying out a panel, rendering a list or collection, or reviewing the dashboard's look — even when the request sounds purely functional ("add a button", "show the proposals", "make this fit"). Every visual decision in this project must come from here rather than from generic dashboard defaults, so read it before writing UI code, not after.
---

# SREonCall console — design system

The console watches a live microservices fleet while an agent investigates on its own and asks
a human to approve what it wants to do. Audience: one on-call engineer, at 3am, who did not
choose to be here. The page's single job:

> tell me what broke, how sure you are, and what you want me to approve.

Every rule below serves that sentence. If a change does not, it is decoration.

## Direction: "night watch"

A glass cockpit at night. Almost everything is unlit; instruments glow softly; **exactly one
thing is bright when it needs you.** Calm is not a mood choice here — it is what makes the one
urgent thing findable.

## The five laws

Follow these in order. Law 1 outranks law 5.

### 1. Hierarchy is size and stillness, not colour

The console's original failure was that 86 risks, 18 service tiles and 10 incidents all
carried identical visual weight, so nothing read as urgent. Encode importance with **width,
height, and whether something moves** first. Colour is the last channel you reach for, never
the first.

Concretely: a broken service gets 3× the width of a healthy one; a healthy service breathes
and a broken one holds still. Both of those out-rank the pastel wash on the broken cell.

### 2. Never render an unbounded collection inline

Any list whose length is data-driven — risks, evidence, proposals, files, capabilities — gets
a **summary line plus a drawer**, never a wrapping row of chips. Lead with the count and the
*shape* ("86 signals across 12 services, mostly load-generator"), because that is the part a
human can act on. The items themselves go in a `Sheet`.

This is the whole product's thesis applied to its own chrome. Breaking it here is the most
embarrassing possible bug.

### 3. Four layers of disclosure, and know which one you're writing

1. **Headline** — always visible. Service, mechanism, confidence. Reading only this is enough.
2. **Intent** — one click. What the agent wants to *do*. This is the default tab; a conclusion
   with no proposed action is where lesser demos stop.
3. **Analysis** — one more click. Full RCA prose, reasoning trail.
4. **Raw** — one more. The literal query and untouched response behind a single `[E#]` chip.

Never let content from layer 3 or 4 leak upward into layer 1.

### 4. Pastel severity, and never mix the families

Severity colours are desaturated and light on purpose. Saturated red on near-black vibrates,
fatigues the eye, and makes nine simultaneous incidents look identically catastrophic.

`--signal` (mint) is the **brand/agent** colour. It NEVER appears on a severity badge.
Severity colours NEVER appear on brand chrome or a primary CTA. Mixing them makes "something
is on fire" indistinguishable from "click here".

### 5. Motion must mean something

The signature: a healthy service **breathes**; the instant an incident opens it **stops**.
Stopping is the signal — a change in motion is caught peripherally in a way a change in hue is
not, which matters on a screen nobody is staring at directly.

Budget: 150–300ms, `ease-out` or `cubic-bezier(0.16, 1, 0.3, 1)`. **No overshoot/`back.out` on
informational UI** — the bounce reads as sloppy on data. Respect `prefers-reduced-motion`
(already handled globally in `index.css`).

## Tokens — use these, never raw hex

Full values live in [references/tokens.md](references/tokens.md). Read it when you need an
exact value. The short version:

- **Ground/elevation**: `bg-background` → `bg-surface` → `bg-surface-2` → `bg-surface-3`.
  Four steps, each ~4% lighter. Depth comes from these, not from shadows.
- **Text**: `text-foreground` / `text-muted-text` / `text-muted-text-2`. Three steps only — a
  fourth is how you get gray-on-gray.
- **Brand**: `text-signal`, `bg-signal-dim`.
- **Severity**: `severity-{critical,high,medium,low,ok}` each with a matching `-bg`.
- **Type**: the classes `.t-display` / `.t-title` / `.t-body` / `.t-label` / `.t-micro`. This
  is the entire scale. **Do not write `text-[13px]` or `text-xs`** — if a sixth step feels
  necessary, the layout is wrong, not the scale.

Confidence maps to severity as: `high → critical`, `medium → high`, `low → medium`.
(High confidence in a diagnosis means high severity of the finding — not high severity of
the colour.)

## Layout law

```
┌──────────────────────────────────────────────────────────┐
│ TopBar        [review queue]              stats · guards │  shrink-0
├──────────────────────────────────────────────────────────┤
│ Fleet strip — one row, fixed height, never two           │  shrink-0
├────────────┬─────────────────────────────────────────────┤
│ rail 320px │  DETAIL — the product. Gets the space.      │  flex-1, min-h-0
│  incidents │  headline / tabs / ownership-first          │
├────────────┴─────────────────────────────────────────────┤
│ Emerging signals — ONE line, opens a drawer              │  shrink-0
└──────────────────────────────────────────────────────────┘
```

Rules: the detail pane always wins remaining space. Chrome is `shrink-0` with a bounded
height. Any flex parent of a scrolling child needs `min-h-0` / `min-w-0` or the child will
push the layout instead of scrolling.

## Writing UI copy

Plain verbs, sentence case, no filler. Name things by what the person controls, not how the
system is built. An action keeps its name through the whole flow — the button that says
"Approve & open PR" produces a state that says "PR open".

Empty and failure states are directions, not moods: say what happened and what to do next.
"The agent hasn't finished deciding yet — nothing to click" beats "No data".

## Before you ship a component

- [ ] Sizes come from the five type classes; colours from tokens; no raw hex
- [ ] Any data-driven collection is summarised, not dumped (law 2)
- [ ] Interactive elements: `cursor-pointer`, a hover state, a visible `:focus-visible` ring
- [ ] Disabled/pending states exist for anything that hits the network, with the reason shown
- [ ] Motion is 150–300ms, ease-out, and means something
- [ ] Contrast ≥ 4.5:1 for body text (pastels on `--surface` are checked in tokens.md)
- [ ] Nothing from disclosure layer 3–4 leaked into layer 1

## Component recipes

See [references/patterns.md](references/patterns.md) for the established patterns: the
disclosure row, the status pill, the action button trio, the drawer summary line, the cited-
text chip, and the fleet cell. Match an existing pattern before inventing one.
