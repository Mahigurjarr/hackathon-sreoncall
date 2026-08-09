---
name: sreoncall-detection-rca
description: How detection surfaces an anomaly — concurrent fan-out, a real detection-event log, detection-to-diagnosis latency — and how the resulting RCA gets written, STRUCTURALLY CHECKED for multi-signal coverage before it's allowed to finalize (the completion gate), and shown so a non-expert can read it — plain-language root cause up front, exact downtime, every timestamp in explicit UTC, and a resolved-incident summary that lives in the app itself rather than a separate export. Use this skill whenever touching src/sentinel/{triage,frame,daemon}.js (detection), src/investigator/loop.js (RCA authoring, signalKindsUsed, the completion gate), any date/time formatting anywhere in web/src, or the resolved-incident summary in OwnershipPanel.jsx. Read it before writing a timestamp with new Date(...).toLocaleString() — that call is a bug this skill exists to prevent — before turning sweepOnce()'s anomaly fan-out back into a serial loop, and before letting an RCA finalize without checking what signal types it actually used.
---

# Detection and RCA

Two jobs, one standard: **detection** decides something is worth investigating, as close to an
evented pipeline's honesty as a single-process daemon can get; **RCA** explains what it found
in a way that answers "what broke, for how long, and are we sure" on first read — not after
scrolling, not after doing timezone math.

## Detection — where an incident starts

`src/sentinel/frame.js` builds a live numeric snapshot of the fleet each sweep;
`src/sentinel/triage.js` asks the model to judge which readings are worth a closer look. No
threshold lives in either file on purpose — see `sreoncall-alerting`'s "no bare threshold"
rule, which applies here exactly as it applies to an authored alert rule. Detection is a
judgement call over live data, not a comparison against a constant.

### The signal is a real event, whether or not it becomes an incident

The moment triage returns anomalies, `sweepOnce()` appends one entry per anomaly to
`state.detections` (bounded to the most recent 500) **before** anything downstream runs —
recall, investigation, or the `hasOpenIncidentFor` dedup check that skips a service already
being tracked. This exists because a single "incident opened" timestamp quietly discards every
signal that *didn't* result in a new incident: a duplicate this sweep, a service already under
investigation, a transient blip triage correctly judged not worth escalating. An evented
pipeline gives you that record for free; this is the honest, minimal analogue for a
single-process daemon — signal arrival is logged independent of what happens next.

### Anomalies are investigated concurrently, not one at a time

`sweepOnce()` fans every anomaly in a sweep out with `Promise.all`, each one caught and tagged
individually rather than one at a time in a serial `for` loop. Two things make this both safe
and correct rather than a race waiting to happen:

- **Safe**: `store.js`'s cross-process lock already serializes every actual write
  (`sreoncall-*` skills elsewhere assume this), so concurrent callers writing incidents,
  evidence, or proposals can't corrupt each other — this was already true before the fan-out
  existed, which is *why* the fan-out is safe now and wouldn't have been before that lock went
  in.
- **Correct**: one anomaly's investigation failing must never block or delay the others — each
  branch of the `Promise.all` catches its own error and returns a tagged `{ok, service, ...}`
  result rather than letting a rejection propagate, so the aggregation loop can tell exactly
  which service failed without losing the others' results.

**Do not revert this to a serial loop "for simplicity."** A sweep's total wall-clock time is
now bounded by its single slowest investigation, not the sum of all of them — with several
anomalies in one sweep, that's a real latency difference, and it's the more honest shape of
"several signals arrived close together" besides.

### Detection-to-diagnosis latency is a real, stored number

`incident.detectedAt` is the timestamp captured the instant triage flagged the service —
**before** recall or the investigation runs. `incident.openedAt` (set by `store.newIncident`)
is stamped only after the full investigation concludes. The gap between the two is genuine
detection-to-diagnosis latency: how long the agent took to go from noticing to explaining.
Never conflate the two fields or backfill `detectedAt` from `openedAt` — that would erase the
one number this mechanism exists to preserve.

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

## The completion gate — a structural check, not a prompt request

`sre-as-code/practices/incident-response.md` has always asked the model to check logs, not
just metrics and traces, before concluding. Until now that was entirely a prompt request —
nothing verified it happened. `investigator/loop.js`'s completion gate is the structural
version:

- After the model volunteers a final answer, `signalKindsUsed()` inspects the actual ledger
  entries THIS investigation created (not the model's prose claiming what it checked) and
  determines which of `metric` / `log` / `trace` were genuinely used.
- If a whole class is untouched, the investigation gets one more real, tool-enabled turn
  (`COMPLETION_GATE_TURNS = 3`) instructing the model to either use it or state plainly why it
  doesn't apply — some services in this fleet genuinely emit no logs at all (a documented
  fact), so the gate asks for a justified skip, not a forced, pointless query.
- The outcome — which kinds were used, whether the gate fired, whether it resolved the gap —
  is stored on the incident as `signalCoverage`, so "did this RCA actually check the logs" is
  an answerable, auditable question on every incident, not something inferred from reading the
  whole trail.

**Why this is a code-level check on the model's own tool calls, not another model call judging
completeness**: the gate doesn't ask a second model "was this thorough enough" — that would be
gameable by the same pressure that produces incomplete coverage in the first place, and it's
the same distinction `sreoncall-ai-native-gate` and `sreoncall-malleability` both draw between
judgement (must be AI) and structural verification of a self-report (correctly deterministic).
`signalKindsUsed()` only counts what real tool calls actually produced.

**Bounded to one gate pass, and skipped entirely if the main loop already exhausted its
budget** — an already-resource-constrained investigation doesn't get a bonus round bolted on
top; it falls straight through to the existing forced-final-turn handling. This keeps the gate
from becoming an unbounded "keep trying until covered" loop, which would burn budget on a
genuinely hard-to-cover incident instead of accepting an honest, explained gap.

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
- [ ] `sweepOnce()`'s anomaly fan-out is still concurrent (`Promise.all`, each branch tagged
      and self-catching) — not a serial loop
- [ ] `state.detections` still gets an entry per anomaly the instant triage flags it, before
      recall/investigation/dedup run — never gated behind whether an incident results
- [ ] `incident.detectedAt` still captures the pre-investigation moment; `openedAt` still
      captures post-investigation — the two are never merged into one timestamp
- [ ] The completion gate still checks REAL ledger entries (`signalKindsUsed`), never the
      model's own prose claiming what it checked
- [ ] The gate still allows an explicit, stated skip ("this service emits no logs") rather
      than forcing a query that can't possibly return anything
- [ ] The gate is still skipped when the main loop already exhausted its turn budget — no
      bonus round bolted onto an already-constrained investigation
- [ ] `incident.signalCoverage` is still recorded on every incident, not only ones the gate
      had to intervene on

## Related

- [[sreoncall-memory]] — recall and redemption, which decide when an incident actually resolves
- [[sreoncall-malleability]] — the explicit policy layer judging the hypothesis trail this
  skill's RCA is built from, once diagnosis is underway
- [[sreoncall-ownership]] — the full pipeline this skill's resolved-summary sits at the end of
- [[sreoncall-alerting]] — detection's "no hardcoded threshold" rule, applied identically here
- `sre-as-code/practices/incident-response.md` — "Progressive disclosure", the prose-level
  statement of the RCA-readability rule this skill enforces at the UI layer
