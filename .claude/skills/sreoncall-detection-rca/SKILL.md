---
name: sreoncall-detection-rca
description: How detection surfaces an anomaly and how the resulting RCA gets written and shown so a non-expert can read it — plain-language root cause up front, exact downtime, every timestamp in explicit UTC, and a resolved-incident summary that lives in the app itself rather than a separate export. Use this skill whenever touching src/sentinel/{triage,frame}.js (detection), src/investigator/loop.js (RCA authoring), any date/time formatting anywhere in web/src, or the resolved-incident summary in OwnershipPanel.jsx. Read it before writing a timestamp with new Date(...).toLocaleString() — that call is a bug this skill exists to prevent.
---

# Detection and RCA

Two jobs, one standard: **detection** decides something is worth investigating; **RCA**
explains what it found in a way that answers "what broke, for how long, and are we sure" on
first read — not after scrolling, not after doing timezone math.

## Detection — where an incident starts

`src/sentinel/frame.js` builds a live numeric snapshot of the fleet each sweep;
`src/sentinel/triage.js` asks the model to judge which readings are worth a closer look. No
threshold lives in either file on purpose — see `sreoncall-alerting`'s "no bare threshold"
rule, which applies here exactly as it applies to an authored alert rule. Detection is a
judgement call over live data, not a comparison against a constant.

Once triage flags a service, `src/sentinel/daemon.js` opens an incident and hands it to the
investigator (`src/investigator/loop.js`) — see `sreoncall-memory` for what happens first
(recall checks whether this is a known recurrence before spending a full investigation).

## Writing an RCA a non-expert can read

The investigator's system prompt (`loop.js`) already requires this shape — this skill exists
to keep the discipline intact when that prompt or any UI rendering it changes:

1. **2–3 line headline first**: the responsible service, the mechanism, the confidence. This
   is `incident.headline` — someone reading only this sentence should know what's wrong and
   whether to trust it.
2. **Plain words, not telemetry jargon, in the headline specifically.** "Checkout is failing
   because it can't resolve the payment service's address" beats "gRPC UNAVAILABLE, DNS
   NXDOMAIN on payment.svc." Save the exact error string for the cited evidence one click away
   — the headline is read by someone who may not know what a gRPC status code is.
3. **Evidence, then the reasoning trail, in that order** — never a wall of raw data before the
   conclusion. See `sre-as-code/practices/incident-response.md`'s progressive-disclosure
   section, which this file's UI half implements.
4. **Ordered next steps tied to what was actually found**, not a restated generic runbook.

## Every timestamp is UTC, explicitly labelled

**The rule:** any time shown anywhere in `web/src` must go through `lib/time.js`
(`formatUtcTime` / `formatUtcDateTime`), never a bare `new Date(...).toLocaleString()` or
`.toLocaleTimeString()`. Those default to the *browser's* local timezone, which means an
on-call engineer in one timezone and a reviewer in another read different clock times off the
same incident — "when did this start" must have exactly one answer regardless of who's
looking.

```js
// Wrong — silently renders in whoever's browser timezone happens to be, unlabelled
<span>{new Date(incident.openedAt).toLocaleTimeString()}</span>

// Right
import { formatUtcTime } from "@/lib/time";
<span>{formatUtcTime(incident.openedAt)}</span>
```

Every timestamp already stored in state is `new Date().toISOString()` (UTC internally) — this
is purely a display-layer rule. `lib/time.js`'s two functions cover it:

| Function | Output | Use for |
|---|---|---|
| `formatUtcTime(iso)` | `14:23:05 UTC` | Compact — sweep times, hover details, timeline entries |
| `formatUtcDateTime(iso)` | `09 Aug 2026, 14:23:05 UTC` | Full context — incident opened/resolved, evidence timestamps, revision history |

## Downtime — computed, not estimated

`lib/incident.js`'s `downtimeOf(inc)` is the only place downtime is calculated:
`resolvedAt - openedAt` once [[sreoncall-memory]]'s redemption check actually closes an
incident, or elapsed-so-far (`ongoing: true`) while still open. Never let a component subtract
two ISO strings inline — a second call site computing it differently is how "downtime" quietly
means two different numbers in two different places.

```js
const downtime = downtimeOf(incident); // { ms, ongoing } | null
formatDuration(downtime.ms);           // "2h 14m", "45m", "3d 2h"
```

`resolvedAt` is set by exactly one code path — `src/actions/redemption.js`'s
`recordRedemptionResult()`, only on a `confirmed` verdict. If you find code setting
`incident.status = "resolved"` anywhere else, that's a bug: an unverified closure defeats the
entire redemption mechanism (`sreoncall-ownership`, guarantee: "resolved is set ONLY by a
confirmed redemption check").

## The resolved-incident summary — where the RCA gets "shared"

When an incident resolves, `OwnershipPanel.jsx` renders a summary banner **above everything
else on the page**: root cause headline, downtime, opened/resolved timestamps (UTC), and the
cited evidence that proved recovery. This is deliberately an in-app surface, not an export or
an external integration — the RCA already lives in this dashboard, and a reviewer opening a
resolved incident should see the whole postmortem in the first screenful, not go hunting
through tabs for what happened.

**Do not build a "share" button that sends the RCA somewhere external** (Slack, email, a PDF
export) unless that is explicitly asked for — it would be exactly the kind of bolted-on SaaS
feature `CLAUDE.md`'s AI-native gate rejects on sight, and it adds a write path to a system
outside this one for no functional gain over "the RCA is already visible in the app."

## Before you touch detection, RCA authoring, or any timestamp

- [ ] Detection still has no hardcoded threshold — a live judgement over real data
- [ ] The RCA headline is plain language; jargon lives in the cited evidence, not the headline
- [ ] Every new timestamp render uses `formatUtcTime`/`formatUtcDateTime`, never a bare
      `toLocaleString`/`toLocaleTimeString`
- [ ] Downtime is read from `downtimeOf()`, never recomputed inline
- [ ] `incident.status = "resolved"` is still set only by a confirmed redemption check
- [ ] The resolved summary still renders above the rest of `OwnershipPanel`, not buried in a
      disclosure

## Related

- [[sreoncall-memory]] — recall and redemption, which decide when an incident actually resolves
- [[sreoncall-ownership]] — the full pipeline this skill's resolved-summary sits at the end of
- [[sreoncall-alerting]] — detection's "no hardcoded threshold" rule, applied identically here
- `sre-as-code/practices/incident-response.md` — "Progressive disclosure", the prose-level
  statement of the RCA-readability rule this skill enforces at the UI layer
