---
name: sreoncall-alerting
description: SRE best practices for authoring alert rules and interpreting readings against them — symptom-based signals, the four golden signals, absent-safe queries, deriving every comparison from real historical data (derive_baseline) instead of a hardcoded number, AND the structural rationale gate (alertRuleNeedsRationaleRepair) that checks in code — not just in the prompt — that every authored rule actually has a cited rationale before it ships in a real PR. Use this skill whenever writing or reviewing anything in sre-as-code/alert-rules/*.yaml, whenever touching remediation.js's file-authoring path, whenever a PromQL/LogQL/TraceQL query needs a "is this anomalous?" judgement, whenever the word "threshold" comes up, and whenever tempted to write a literal numeric cutoff into a rule, a prompt, or a practice doc. Read it before writing an alert rule, not after — this is the discipline that keeps every rule in this repo generic, portable, and structurally verified rather than merely requested.
---

# Alerting

An alert rule in this repo is not a threshold. It is a **signal selection** plus a **rationale**
for why that signal, over what window, using what comparison — with the actual "is this bad?"
judgement left to whoever (model or human) reads a live value against it. That is not a style
preference; it is the only way an alert rule stays true when the fleet's traffic shape,
services, or scale change out from under it.

## The one rule everything else serves

> **No alert rule, guardrail, or practice doc in this repo may contain a bare numeric
> threshold with no citation behind it.** A number with no `[E#]` beside it is a hardcoded
> threshold wearing a rationale as camouflage, and it is exactly the kind of rule that looks
> fine on day one and silently stops meaning anything three weeks later when traffic doubles.

Every comparison in an authored rule must be one of:

1. **Self-relative** — the query compared against its own recent past (`compare_baseline`,
   a real PromQL `offset`).
2. **Derived from real history** — `derive_baseline`'s actual computed mean/stddev/percentiles
   for that exact query, cited by the `[E#]` the tool call returned. Never a number typed from
   memory or "seems about right."
3. **Absent-safe by construction** — `or (... * 0)` so "no series" and "a real zero" can never
   be confused (see the worked example below).

If none of these three describe the comparison you're about to write, you don't have enough
evidence to write it yet — go call `derive_baseline` first.

## Symptom-based, not cause-based

Alert on what a user or downstream service actually experiences (error rate, latency,
saturation, traffic anomaly), never on an internal implementation detail that only sometimes
correlates with a real problem ("this specific function was called," "this queue's internal
counter"). A symptom-based rule catches every mechanism that produces that symptom, including
ones nobody anticipated; a cause-based rule only catches the one cause someone thought of.

## The four golden signals, applied generically

Classic SRE framing (Google SRE book), kept deliberately generic — no fleet-specific metric
names belong in this skill, only the shape of the question:

| Signal | The question | Where it usually lives in OTel-shaped telemetry |
|---|---|---|
| **Latency** | Is this taking longer than it used to? | A duration histogram's `_bucket` series, read as a rate or percentile |
| **Traffic** | Is the request volume itself unusual (a spike, a drop, or gone silent)? | A calls/requests counter, rate-windowed |
| **Errors** | What fraction of requests are failing? | The same calls counter, filtered to an error status, as **both** rate and ratio |
| **Saturation** | Is a resource close to its limit? | Whatever this fleet actually exposes for the resource in question — discover it, don't assume it |

Discover which metric family actually covers a signal for a given service before building a
rule on it — a family with partial coverage will silently report "healthy" for the services it
doesn't cover, which reads identically to actually healthy.

## Rate AND ratio, always both

A rate alert misses low-traffic faults (2 errors/sec looks huge on a 3 req/sec service, tiny
on a 3000 req/sec one). A ratio alert misses high-traffic faults at true zero baseline noise.
Author both from the same query family, or explain in the rationale why one alone is
sufficient for this specific signal.

## Absent-safe queries — worked example

```promql
sum by (service_name) (rate(<error_count_metric>{status="error", service_name="X"}[5m]))
  or
  (sum by (service_name) (rate(<same_metric>{service_name="X"}[5m])) * 0)
```

Without the `or (...) * 0` term, a service with zero traffic returns **no series at all**,
which is a different fact from **zero errors**. A rule that can't tell those apart will read
"absent" as "healthy" — exactly backwards, since absent usually means something stopped
reporting, not that it's fine.

## Deriving a real baseline — the mechanism, not a number

`derive_baseline(promql, lookbackHours)` (in `src/investigator/tools.js`, available to both
the investigator and the remediation author) pulls the query's actual history via
`queryMetricRange` and computes mean, stddev, min/max, and p50/p95/p99 from the real points
returned. **The function itself contains no threshold, no multiplier, no cutoff** — it hands
back arithmetic over live data and nothing else. Whoever calls it (a model) decides how to
combine those numbers into a comparison, and must cite the `[E#]` the call produced wherever
that comparison appears.

This is the literal mechanism behind "use historical metrics to set alerts, not a hardcoded
rule": the numbers in a rule's rationale should trace to a real `derive_baseline` or
`compare_baseline` call, not to a guess.

Absent-safe applies here too: `derive_baseline` reports plainly when there isn't enough
history rather than fabricating a baseline from nothing (`ok: false` when the range query
returns no matrix data) — treat that as "too soon to derive a baseline," never as license to
fall back to an invented number.

## The rationale gate — a structural check, not a prompt request

Everything above was, until now, entirely a prompt request: the remediation author was ASKED
to cite real evidence in a rule's rationale, with nothing verifying it actually did. That is
exactly the same gap `sreoncall-detection-rca`'s completion gate closes for RCAs, applied here
to authored alert rules.

`src/actions/remediation.js`'s `alertRuleNeedsRationaleRepair(file, ledger)` checks, in code,
every file a proposal touches under `sre-as-code/alert-rules/*.yaml`:

1. Does it have a `rationale:` key at all?
2. If so, does that rationale contain at least one `[E#]` citation that actually **resolves**
   against the real ledger — not just a citation-shaped bracket, a real one?

A file failing either check gets **one bounded repair attempt**
(`repairAlertRuleRationale`): the model is shown the flagged file, every real evidence id
available, and asked to rewrite the full file with a properly cited rationale — the same
"show it what's missing, re-check in code afterward, never trust the rewrite blindly" shape as
`Ledger.repair()`. A file that still fails after one attempt ships as-is with a `console.warn`
— the PR review a human already does is the backstop an automated repair couldn't replace, not
grounds for an unbounded retry loop here.

**This is wired into the real path, not a side check**: `draftRemediation()` and
`reviseRemediation()` both run every proposed file through this gate, and the REPAIRED content
— not the original — is what lands in `proposal.payload.files`, which is exactly what
`applyGithubPrProposal`/`openFixPR` uses as the literal PR file content on approval. A rule
that gets repaired here is repaired in the actual PR a human reviews, not just in an
intermediate check nobody sees the effect of.

**Verified without live model credits** (this was built while the shared API key was
exhausted): the detection half — `alertRuleNeedsRationaleRepair` — is pure logic over a ledger
and a string, and was unit-tested standalone against five cases (missing key, fake citation,
real citation, non-alert-rule file, each behaving correctly). The repair CALL itself needs the
model and gets exercised the same way `Ledger.repair()`'s network path does: on failure, it
returns the original content unchanged, still flagged by the re-check — fail open, never lose
the file.

## Avoiding alert fatigue

- Prefer a **duration/hold** condition (sustained over a window) to a single-sample spike,
  where the signal's own noise floor would otherwise page on every blip.
- A rule that would have fired on a **known-benign pattern** (a long-poll floor, a startup
  ramp) needs that pattern named in its rationale, with the evidence that established it —
  not silently tuned around with a magic number.
- If an existing rule is too noisy, the fix is a **more precise signal**, never a suppressed
  or muted one (`sreoncall-ownership` guarantee 5; `guardrails.md` §3). Noise is a signal
  quality problem, not a threshold problem — chasing it with threshold tweaks is how alert
  rules quietly rot into "loosen it until it stops paging."

## Tuning constants are not thresholds — keep the two honest

A **business/anomaly threshold** answers "is this reading a problem?" — that judgement must
never be hardcoded (see above). A **tuning constant** answers "how much budget does this
mechanism get?" (a turn count, a delay window, a candidate-list size) — that's an engineering
knob, not a claim about the world, and hardcoding *those* is fine **as long as they're
documented, named, and env-overridable where a runtime operator would plausibly want to change
one without a rebuild.**

Don't let a tuning constant smuggle in a business judgement. `REDEMPTION_DELAY_MS` (how long
to wait before re-checking a fix) is a tuning constant — it says nothing about what counts as
recovered. If you ever find yourself hardcoding a number that answers "how much is too much,"
that's rung one of this skill, not this section.

Current tuning constants in this codebase, kept here so a change is a one-place lookup:

| Constant | File | Default | Overridable |
|---|---|---|---|
| `SRE_SWEEP_INTERVAL_MS` | `sentinel/daemon.js` | 45000 | env |
| `VERIFY_TURNS` (recall reuse) | `sentinel/daemon.js` | 4 | code |
| `MAX_CANDIDATES` | `memory/recall.js` | 6 | code |
| `MAX_AUTHOR_TURNS` | `actions/remediation.js` | 6 | code |
| `SRE_REDEMPTION_DELAY_MS` | `actions/redemption.js` | 900000 (15m) | env |
| `VERIFY_TURNS` (redemption) | `actions/redemption.js` | 5 | code |

## Before you author or review an alert rule

- [ ] Symptom-based, not cause-based
- [ ] Built on a metric family with real coverage for the services it claims to watch
- [ ] Absent-safe (`or (...) * 0`, or the LogQL/TraceQL equivalent judgement in the rationale)
- [ ] Every number in the rationale traces to a cited `derive_baseline`/`compare_baseline` call
- [ ] No bare literal threshold anywhere in the PromQL or the rationale
- [ ] Rate and ratio both considered, or the choice of one alone is justified
- [ ] A noisy existing rule gets a more precise signal, never a suppressed one
- [ ] `alertRuleNeedsRationaleRepair` still checks REAL citation resolution, not just the
      presence of a `rationale:` key or a citation-shaped bracket
- [ ] The repaired file content, not the original, still flows into
      `proposal.payload.files` — repairing a check that has no effect on the real PR is
      security theatre, not a gate
- [ ] The repair attempt is still bounded to one try per file, with a warning (not a thrown
      error) if it still fails afterward

## Related

- [[sreoncall-memory]] — recall also treats "this alert rule already covers that mechanism" as
  a candidate signal when judging reuse vs. novel
- [[sreoncall-detection-rca]] — the completion gate is the identical "structural check, one
  repair attempt, never trust the self-report" shape applied to RCA signal coverage instead of
  alert-rule rationales
- [[sreoncall-ownership]] — the path from a derived baseline to an actual PR; the rationale
  gate is what makes guardrail #7 (no number without a citation) checkable in code rather than
  only stated in a prompt
- `sre-as-code/practices/incident-response.md` and `guardrails.md` §7 — the
  live-judgement-over-baseline principle this skill's mechanism section implements in code
