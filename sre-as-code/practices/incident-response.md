# Incident response practice

The procedure the agent follows on every incident. This is the team's SRE knowledge as an
editable artifact rather than as prompt text buried in source — change this file and the
agent works differently on the next sweep, with the change reviewable in git like any other.

Loaded by `src/practices.js` into the investigator's and the remediation author's system
prompts. Read alongside [guardrails.md](./guardrails.md), which sets the hard limits this
procedure operates inside.

## Progressive disclosure — how to report, at every layer

Whatever you produce, lead with the answer and keep the proof one step away.

- **First 2-3 lines**: the responsible service, the mechanism, your confidence. Someone who
  reads only this should already know what is wrong and whether to trust it.
- **Then**: the handful of evidence entries that actually carry the conclusion — not every
  query you ran.
- **Then**: the reasoning trail, including what you ruled out.
- **Never**: a wall of raw data up front. Raw responses stay in the ledger, one click away.

If a reader has to scroll to learn what broke, the report is wrong regardless of how good the
diagnosis was.

## Diagnosis discipline

1. **Orient before querying.** Read the sweep's framing and any recalled prior incident first.
   A query chosen at random costs the same as a query chosen well.

2. **State a hypothesis early and explicitly**, naming a service and a mechanism. A vague
   hypothesis cannot be disproved, which makes it useless.

3. **Try to break your own hypothesis before confirming it.** The next query after stating a
   theory must be one that could show it false — check whether other services show the same
   symptom, whether the mechanism you claim actually appears in the signal you'd expect it in,
   whether the reading differs from its own recent baseline. Piling on confirming evidence is
   not investigation.

4. **Say it out loud when evidence contradicts you**, and state what replaces the theory.
   A silent change of direction destroys the audit trail that makes the conclusion worth
   anything.

5. **Absence of data is not evidence of health.** A query returning zero series and a query
   returning a zero value are different facts. Treat an empty or errored result as something
   to reason about, never as an all-clear and never as a reason to distrust the tooling.

6. **Always read the logs before concluding — not only metrics and traces.** Metrics tell you
   *that* something changed and traces tell you *where*, but the log line is usually the only
   place the system says *what it thinks went wrong* in its own words. An investigation that
   never queried logs has skipped the cheapest source of the actual error text, and its
   conclusion is weaker than it looks.

   Query logs for the suspect service before you commit to a root cause, and query them again
   for any service you are about to exonerate — "no errors in its logs either" is a real
   disconfirming result and worth stating. If the logs are empty, say so explicitly and treat
   that as a fact about the world, not as permission to skip the step.

7. **Distinguish a fault from a flag.** If a traced exception names a feature-flag or
   fault-injection string, the root cause is an operator action, not a code defect — report it
   as such. Proposing a code change for a deliberately-flipped flag papers over something
   nobody needed to change.

## Signal selection

Principles, not a fixed query list. Which metric families actually exist is a property of the
fleet you are looking at — discover it, don't assume it.

- **Prefer a signal every service emits** over a richer one only some services emit. A metric
  family with partial coverage will silently report "healthy" for the services it doesn't
  cover, which is indistinguishable from actually healthy.
- **Read rate and ratio together.** Low-traffic faults hide in absolute rate; high-traffic
  ones hide in ratio. Either alone will miss a real class of failure.
- **Make queries absent-safe.** "No series returned" and "a value of zero" are different
  facts about the world. Write the query so the two can't be confused, and never read silence
  as health.
- **Go one level below status.** A status code says something failed; the structured detail
  underneath it — exception messages, error reasons, span events — usually names *what*
  failed. Pull that before concluding.
- **Compare against the thing's own recent past**, not against a number. No fixed threshold
  makes a reading a problem. Anomalous means "unlike this service an hour ago", and that
  comparison is a judgement you make live, per incident.
- **When "unlike its own past" needs a real number** — for an alert rule, or to say precisely
  *how* unusual a reading is — derive it from actual history rather than estimating. A single-
  offset comparison (`compare_baseline`) is enough for "is this different from an hour ago";
  a computed mean/stddev/percentile band over a longer window (`derive_baseline`) is the tool
  for "is this different from what's normal here." Cite whichever you used.

Hardcoding a threshold, a metric name, or a service list into this document would freeze
today's fleet into the agent's procedure. Keep this file about *how to decide*; let the
specifics come from what the tools actually return.

## Remediation discipline

Only after a cited root cause exists (guardrails §4):

1. Prefer amending an existing alert rule, runbook, or SLO over adding a near-duplicate
   beside it.
2. A new alert rule should be the signal that would have caught **this** incident earlier —
   and must carry a `rationale:` explaining why that metric family and not another.
3. Encode no static threshold. Whether a reading is anomalous stays a live judgement against
   a baseline; a hardcoded number would freeze today's traffic shape into the repo.
4. A runbook must be the ordered procedure for **this** failure mode, specific enough that
   following it blindly would actually resolve it. A restated generic checklist is not
   ownership.
5. Say plainly what the change does **not** fix.

## Reuse before re-investigation

If a prior incident on this service was diagnosed with the same mechanism, that diagnosis is
prior art — start from it. Confirm it still holds with a fresh query rather than rediscovering
it from scratch, and say explicitly that you are reusing it. Re-deriving a known answer wastes
budget that a genuinely new failure needs.

Prior art is a starting point, never a conclusion. If the current evidence disagrees with the
recalled diagnosis, follow the evidence and say so.

**Prior art that already failed once is a warning, not a shortcut.** If a prior incident's fix
was checked and found NOT to have held, treat that prior art as informative about what doesn't
work, not as an answer to reuse. Proposing the identical fix again without new evidence for why
it would work this time repeats a mistake the team already has direct evidence about.

## Verification — a decision is not the end of the incident

Diagnosing and remediating an incident is not the same as knowing the incident is over. After
a decision lands — a fix drafted and applied, a decline reasoned through, an existing fix
reused — come back later and check reality against the claim, using fresh evidence, not the
evidence that produced the original conclusion.

1. **Check the ORIGINAL symptom, not a new one.** The question is narrow: does the specific
   thing that was flagged as anomalous still look anomalous? This is not a fresh investigation
   with an open scope.
2. **Prefer a real comparison to a bare current reading.** "The error rate is 0 right now" is
   weaker than "the error rate has matched its own historical baseline for the last hour" —
   use `derive_baseline` or `compare_baseline`, not just a single `query_metrics` call.
3. **A fix that was never approved and applied cannot be credited for a recovery.** If the
   remediation was a drafted PR nobody approved yet, and the symptom cleared anyway, say so
   plainly and attribute the recovery to what the evidence actually shows — traffic dropping,
   an operator's own action, or ordinary noise — not to a change that never took effect.
4. **Report low confidence when the evidence is genuinely ambiguous.** A wrong "recovered"
   verdict closes an incident that is still live, which is a worse outcome than checking again
   later. There is no reward for closing quickly.
5. **An unresolved check is real information, not a failure to hide.** State plainly that the
   symptom persists — that fact is exactly what should stop the same fix from being proposed
   again unexamined, and exactly what a human reviewing the incident needs to see first.
