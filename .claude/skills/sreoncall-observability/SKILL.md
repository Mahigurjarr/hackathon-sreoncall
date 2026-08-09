---
name: sreoncall-observability
description: What makes a reading real observability rather than a comforting guess — absent-safe queries that never confuse "no series" with "a zero value", a per-service health probe independent of the incident list, and a stack-health check that verifies EVERY backend the agent senses through (Mimir, Loki, Tempo), not just the one that's easiest to check. Use this skill whenever touching src/lgtm/health.js or client.js, whenever adding a new telemetry backend, and whenever someone asks to verify or strengthen observability as a checkable property. Read it before adding a health check that only covers the backend you happened to be testing — that's exactly the blind spot this skill exists to close.
---

# Observability

Observability isn't "the dashboard shows numbers." It's that the numbers shown are an honest
account of what the agent can currently see — including an honest account of what it *can't*.
A monitoring surface that renders green because it stopped looking is worse than one that
renders nothing.

## The three rules, each backed by a real bug this codebase already had and fixed

### 1. Absent is not zero

`src/lgtm/health.js`'s `probeFleet()` treats "no series returned" and "a value of zero" as
different fact classes: a service with `callRate === undefined` is `silent` (not reporting at
all); a service with a real `errorRate` of exactly `0` is `reporting` (present and clean). This
distinction exists because the dashboard used to derive a service's status purely from whether
it had an open incident — a service that stopped emitting entirely rendered identically to one
running perfectly, which is a monitoring tool lying by omission. See the file's own header
comment for the full history; the rule going forward is: **any new probe must classify
"absent" and "present-but-zero" as different states, never collapse them.**

### 2. No threshold, ever — a reading is a fact, a verdict is the model's job

`probeFleet()` reports `silent` / `erroring` / `reporting` — never `healthy` / `unhealthy`.
Whether a given error rate constitutes a real problem is the investigating agent's live
judgement against a baseline (`sreoncall-alerting`), not a comparison this file is allowed to
make. If you're tempted to add `if (errorRate > 0.05) status = "critical"` here, stop — that's
a hardcoded threshold smuggled into what's supposed to be a pure observation, and it's the
exact failure mode `sreoncall-ai-native-gate` and `sreoncall-alerting` both exist to prevent.

### 3. Check every backend you actually depend on, not just the convenient one

Until this skill's own audit, `probeStack()` — the check the dashboard uses to say "is the
agent blind right now?" — verified only Mimir. An investigation reasons over metrics, logs,
AND traces (`investigator/tools.js`'s `query_logs` needs Loki; its trace-search tools need
Tempo). A health check covering one of three senses would report "ok" while a real third of
the agent's ability to investigate was silently broken — precisely the blind spot rule 1 above
exists to prevent, just at the infrastructure layer instead of the per-service one.

`probeStack()` now checks all three, each with a deliberately minimal, cheap query chosen only
to prove the round trip works — `vector(1)` for Mimir, a 1-minute/1-line log query for Loki, an
unfiltered 1-result TraceQL search for Tempo. **When a fourth telemetry backend is ever added
to this system, it gets a fourth entry in `probeStack()`'s `probes` array in the same commit
that wires it into `investigator/tools.js` — not later, not "if there's time."** A tool the
agent can call but the health check doesn't cover is a gap with the exact shape of the one this
skill just closed.

The aggregation (`Object.values(checks).every((c) => c.up)`) in `src/web/server.js`'s
`/api/health` route is already generic — adding a probe here is the only change needed; no
server-side wiring required, which is precisely why it's cheap to keep this complete.

## Presentation may degrade; the underlying facts must not

`src/actions/explain.js`'s plain-language fleet summary can fail and return `null` — the
dashboard just shows no narration that sweep. This is fine (`sreoncall-ai-native-gate`'s
judgement-vs-presentation distinction): the **real numbers** `probeFleet()` produced are
computed with zero model involvement and don't depend on the summary succeeding. Never let a
future change make the raw health data depend on a model call succeeding — that would turn a
presentation-layer convenience into a load-bearing dependency the whole observability claim
rests on.

## Before you touch this subsystem

- [ ] A new probe still distinguishes "absent" from "present-but-zero" — never collapses them
- [ ] No numeric threshold anywhere in `health.js` — facts only, verdicts stay upstream
- [ ] Every backend a tool in `investigator/tools.js` actually calls has a matching entry in
      `probeStack()`'s `probes` array
- [ ] A probe failure still reports `unknown`/`up: false`, never a guessed "healthy"
- [ ] The raw numeric health data still computes with zero model involvement — only the
      plain-language narration on top of it is allowed to degrade

## Related

- [[sreoncall-alerting]] — the no-hardcoded-threshold rule this skill's rule 2 restates for
  the observability layer specifically
- [[sreoncall-ai-native-gate]] — the judgement-vs-presentation line rule 3's coda depends on
- [[sreoncall-detection-rca]] — `probeFleet()`'s per-service readings feed the same fleet
  triage this skill's sibling covers
