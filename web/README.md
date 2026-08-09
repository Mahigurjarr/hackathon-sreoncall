# SREonCall web dashboard

A React dashboard for the same backend `bin/sre` reads — both interfaces read
`store/state.json` through the identical field-alias logic (see
`src/lib/incident.js`, deliberately mirroring `bin/sre`'s own header comment),
so the CLI and the web UI never disagree about what an incident means.

This is purely a presentation layer. No detection, RCA, or judgement logic
lives here — everything shown is already-computed backend data, fetched
read-only from `src/web/server.js`.

## Run it

Two processes, from the repo root:

```bash
# 1. the backend's read-only JSON API (zero dependencies, part of src/)
node src/web/server.js          # http://localhost:8420

# 2. the dashboard itself
cd web && npm install && npm run dev   # http://localhost:5173, proxies /api to :8420
```

Or, for something closer to a single-command demo: `npm run build` in `web/`
first, then `node src/web/server.js` alone serves the built static files
directly from the same port (no second process needed).

## Stack

Vite + React 19, Tailwind v4, shadcn/ui (Radix base), `motion` (Framer
Motion's successor package, imported as `motion/react`), GSAP for the one
genuinely motivated animation (the live evidence/incident counters actually
tweening as real numbers change — see `src/components/LiveCounter.jsx`).

Design direction, concretely:

- **Locked dark theme** — this is an on-call ops tool, not a marketing site;
  see the comment block at the top of `src/index.css`.
- **One signature accent** (`--signal`, a teal) for brand/interactive
  elements, kept strictly separate from the four **severity** colors
  (critical/high/medium/low) used only on incident/confidence badges — mixing
  the two would make "something is on fire" indistinguishable from "click
  here."
- **The signature motion**: a healthy service tile pulses quietly; the
  instant it has an open incident, the pulse stops and the tile snaps to a
  solid severity color. Stopping is the signal, not just the color change.
- Every `[E7]`-style citation anywhere in the app (RCA text, timeline,
  resolution steps, capability reasoning) is a clickable chip that opens the
  literal query and raw response behind it — auditability as a UI affordance,
  not a promise.

## Verified

Screenshotted with a real headless Chromium (Playwright, dev-only
devDependency) against live backend data: service grid, incident detail with
working citation chips, the evidence sheet showing a real TraceQL query and
real trace IDs, and the grouped capabilities panel. Zero browser console
errors across the full interaction. Not re-automated as a permanent test —
if you want to re-run it, launch both servers per above, then drive
`playwright`'s `chromium` against `localhost:5173` the same way.
