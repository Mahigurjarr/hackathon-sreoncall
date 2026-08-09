---
name: sreoncall-memory
description: The agent's self-learning loop, at two scopes — PER-INCIDENT (recall decides reuse vs related vs novel by MECHANISM, redemption checks later whether a fix actually held) and CROSS-INCIDENT (src/memory/lessons.js turns a human's correction — an outright rejection OR a push-back/revise — into a durable, general lesson appended to sre-as-code/practices/learned-lessons.md, loaded into every future prompt, with a size guard warning when that file grows large). Use whenever touching src/memory/, src/actions/redemption.js, or learned-lessons.md, whenever changing how investigations are triggered or budgeted, and whenever someone asks the agent to stop wasting tokens on repeated problems or to learn from a human's correction beyond one incident. Read it before changing recall/redemption (a wrong reuse costs far more than a missed one) and before changing lessons.js (a manufactured lesson pollutes every future prompt).
---

# Memory / self-learning

The sentinel sweeps every ~45s and the same underlying fault recurs. Re-running a twelve-turn
investigation to rediscover a root cause the agent already established, cited, and wrote a
runbook for is pure waste — it burns budget a genuinely novel failure needs, and it produces a
second incident that says the same thing as the first.

> The agent should get **cheaper and faster** at problems it has seen, spend its full budget
> on ones it hasn't, and **stop trusting an answer once it's seen that answer fail.**

That third clause is what separates learning from lookup. A pure recall-and-reuse system
retrieves; it never finds out whether what it retrieved was right. This subsystem has two
halves: **recall** decides whether a new trigger matches prior art, and **redemption**
(`src/actions/redemption.js`) checks, after the fact, whether prior art's fix actually worked
— and feeds that verdict back into the next recall decision. Read both halves; they are one
feedback loop, not two features.

Files: `src/memory/recall.js` (the reuse/related/novel decision), `src/actions/redemption.js`
(the outcome check), `src/sentinel/daemon.js` (`openIncidentFromInvestigation` and
`attachRemediation` act on recall; `scheduleRedemption`/`runRedemptionChecks` drive
redemption), `web/src/components/{IncidentDetail,OwnershipPanel,IncidentList}.jsx` (surface
both).

## The core design decision: mechanism, not name

The matching is **not** a string hash, a service-name equality check, or an embedding
similarity threshold. It is a model call, because the question is genuinely a judgement:

- Two incidents on `checkout` can be a DNS failure and a payment timeout — **same service,
  unrelated failures.**
- A flagd deadline can surface on `recommendation` one sweep and `payment` the next —
  **different services, one fault.**

A shared service name is weak evidence; a shared causal mechanism is strong evidence. Plain
code only narrows the candidate set (`findCandidates` → the 6 most recent incidents that
already have an RCA) so that judgement stays cheap.

**Do not replace this with a similarity score.** The moment matching becomes a threshold on a
distance metric, the system stops reasoning about mechanisms and starts pattern-matching on
words — which is exactly the failure the whole product argues against.

## The three verdicts

| Verdict | Meaning | What the daemon does |
|---|---|---|
| `reuse` | Same underlying failure mode as one specific prior incident | Short **verification** pass: `maxTurns: 4` instead of the default 12, with the prior diagnosis as prior art. Reuses the prior fix rather than authoring a new one. |
| `related` | Informative but NOT the same failure | Full investigation, prior diagnosis supplied as orientation only. |
| `novel` | Nothing in history bears on this | Full investigation, no prior art. |

### Reuse still verifies. Always.

`reuse` means *"start from this answer"*, never *"skip looking"*. The agent still runs live
queries to confirm the mechanism is active right now, and is explicitly told to say so if the
evidence disagrees. Prior art is a starting point, never a conclusion.

Dropping that verification would let a stale answer outlive the condition that produced it —
the agent would confidently restate a diagnosis for a fault that has since changed. The saving
comes from a **shorter search**, not from **no search**.

## Be conservative — the asymmetry matters

A wrong `reuse` is far more expensive than a missed one:

- **Missed reuse** costs some tokens. The agent investigates something twice. Annoying.
- **Wrong reuse** costs correctness. The agent confidently restates an answer to a question
  nobody asked, and the real fault goes undiagnosed while looking handled.

So the prompt says: when the trigger text is too thin to distinguish two prior mechanisms,
answer `related` or `novel` — **never** `reuse`. Preserve that bias in any change.

## Failing open, never closed

Recall is an optimisation. Every failure path returns a `novel` verdict rather than throwing:

- no diagnosed incidents to compare against → `novel`
- the model call fails → `novel`, marked `degraded: true`
- no usable tool call returned → `novel`, `degraded: true`
- verdict names an incident not in the candidate set → `novel`, `degraded: true`

Losing memory must degrade the agent to "investigate everything from scratch" — which is
precisely its behaviour without this module. It must **never** block an incident from being
investigated at all. A memory subsystem that can take down detection is worse than no memory.

The last case matters more than it looks: acting on a verdict that names a hallucinated
incident id would reuse a diagnosis that does not exist.

## Reusing the fix, not just the diagnosis

`attachRemediation()` checks the recall verdict before authoring anything. On `reuse`:

- If the prior incident has a live proposal (`draft`/`revised`/`approved`/`applied`), record
  `remediation: { kind: "reused", proposalId, fromIncident, note }` and **author nothing**.
  Saves a full model call *and* a duplicate PR nobody wanted to review twice.
- If the prior incident concluded `no_code_fix`, inherit that decision with its reason.

The dashboard resolves the referenced proposal so the shared fix stays reviewable from the new
incident, rather than only from the original.

## The redemption loop — closing the feedback circuit

Recall alone can only ever get *faster*. Redemption is what lets it get *smarter*: after any
remediation outcome lands (a drafted PR, a decline, a reuse — every path, not just success),
`scheduleRedemption()` marks the incident for a re-check after a delay (`SRE_REDEMPTION_DELAY_MS`,
default 15 minutes — long enough for a merged PR or an operator's flag flip to take effect).
Each sweep, `runRedemptionChecks()` runs a short evidence-gathering pass (`verifyRecovery()`,
`src/actions/redemption.js`) against **fresh** telemetry — never the original investigation's
evidence — and records one of three outcomes on `incident.redemption`:

| Status | Meaning | What happens |
|---|---|---|
| `confirmed` | Recovered, and not on shaky evidence (`confidence !== "low"`) | Incident closes: `status → "resolved"`, `resolvedBy: "redemption-check"`, citations attached |
| `unresolved` | Re-checked and the symptom is still present | Incident stays open. This is the learning signal — see below |
| `pending` | Recovered but only at low confidence, or not yet due | Re-scheduled for another check rather than closing on weak evidence |

**A confident "recovered" verdict is required to close an incident — never a guess.** The
verifier is explicitly told to report low confidence when evidence is ambiguous, precisely
because a false "confirmed" closes an incident that is still live, which is worse than leaving
it open one more sweep.

### The part that makes this self-learning rather than self-reporting

`unresolved` is not a dead end — it changes future behaviour in two places:

1. **`attachRemediation()`'s reuse shortcut** (`daemon.js`) checks
   `memory.priorIncident.redemption?.status === "unresolved"` before pointing a new incident at
   an old proposal. If the prior fix is known to have failed, the agent does **not** reuse it —
   it falls through to authoring fresh, logging why. Reusing a fix already known not to work
   would repeat a mistake the system has direct evidence about.
2. **`recall.js`'s SYSTEM_PROMPT and `summarizeCandidate()`** surface each candidate's verified
   outcome (`CONFIRMED recovered` / `UNRESOLVED — still present` / `not yet verified`) and
   instruct the model explicitly: a candidate marked `unresolved` should get `related` at most,
   never `reuse`, even if the mechanism looks identical. `priorArtBlock()` carries the same
   warning into the investigator's own frame, so a fresh investigation triggered this way knows
   not to propose the same fix without new evidence for why it would work now.

This is the actual mechanism, not a metaphor: an outcome the agent observed changes what it
does the next time it sees the same mechanism. Delete either integration point and the system
regresses to "recall that never checks its own homework" — a lookup cache with an RCA format,
not a learning loop.

### Redemption is still read-only

`verifyRecovery()` calls exactly the same GET-only tools an investigation uses
(`query_metrics`, `query_logs`, `search_traces*`, `get_trace`, `compare_baseline`,
`derive_baseline`). Verifying a fix is not a special case of guardrail #1 — it is another
ordinary application of it. Nothing about "closing the loop" implies write access to anything.

## The lessons loop — self-learning that outlives one incident

Recall and redemption are both scoped to a single incident and its direct recurrences. What
was missing — the gap a rubric pass explicitly called out as unimproved — is a loop where a
human's correction changes the agent's behaviour on incidents that have **nothing else in
common** with the one that was corrected. `src/memory/lessons.js` is that loop.

**Two triggers, one judgement**: `src/web/server.js` calls `extractLesson(proposal, reason,
{ action })` from both review outcomes a human can produce —

- the **reject** handler, after every outright rejection (`action: "rejected"`);
- the **revise** handler, after every push-back (`action: "pushed back on"`) — fired only once
  `reviseRemediation()` has already succeeded, so a lesson is never extracted from a revision
  that itself failed.

Both calls are fired-and-forgotten: neither can block or fail the HTTP response, since the
reject/revise action is already persisted regardless of whether a broader lesson can be drawn
from it. `action` only changes how the prompt frames what happened (`buildUserMessage`) and
how the recorded entry is labelled — it does **not** relax the judgement's conservatism for
push-backs. That matters because a push-back is often the *richer* signal of the two: the
human's objection AND the agent's revised attempt are both visible, so the model can judge not
just what was wrong but whether the reasoning pattern is likely to recur — but it's also the
easier one to over-mine, since most revisions are just the agent successfully self-correcting
in the moment and reveal nothing that needs to change beyond that one incident. `no_lesson`
stays the default outcome for both trigger types.

**The judgement**: the model decides whether this ONE rejection reveals a GENERAL principle —
"don't propose an alert rule when confidence is medium or below without saying so in the
rationale" is a lesson; "the human just disagreed with this specific call" is not. This mirrors
`recall()`'s own conservatism: a manufactured lesson from a single data point is worse than no
lesson, because the file it lands in is read by every future incident, not just similar ones.
**`no_lesson` is the common, correct outcome** — most single rejections don't reveal a systemic
gap, and treating "record something" as the default would turn a curated practice file into
noise.

**Where it lands**: `sre-as-code/practices/learned-lessons.md`, appended (never overwritten),
registered in `src/practices.js`'s `DOCS` array between `incident-response.md` and
`guardrails.md`. This is what makes it "wider behaviour retuning" rather than another
incident-scoped memory: `practices.js` loads it into the investigator's prompt, the
remediation author's prompt, AND redemption's prompt — every reasoning step, on every future
incident, whether or not recall judges it related to whatever triggered the lesson.

**Why plain `fs.appendFileSync`, not the state lock**: this path is human-paced — a rejection
happens at most a few times per session, never in a hot loop — so `store.js`'s cross-process
lock (built for concurrent incident/evidence writes at sweep frequency) would be unjustified
machinery here. If lessons are ever written from more than one process concurrently, revisit
this; until then, matching the write frequency to the mechanism's weight is the right call, not
reflexively reusing the heaviest available primitive.

**The file is meant to be human-curated, not just machine-appended.** Like every other practice
doc, a human can open `learned-lessons.md` and edit or prune it directly — a lesson recorded
automatically is a draft earning its place through use, not untouchable history.

**The size guard — a warning, never a prune.** A file loaded into every future prompt that
grows forever eventually degrades every future prompt, not just this one. After every append,
`appendLesson()` checks the file's byte size against `SIZE_WARNING_BYTES` (8000 — roughly
30-40 entries at this format's size) and logs a `console.warn` if it's over. That's the entire
mechanism: no entry is ever dropped, reordered, or summarised away automatically. Deleting a
human's accumulated practice without asking is a worse failure mode than a slightly-too-long
file, so the response to growth is a visible nudge for a human curation pass — the same
`console.warn`-only pattern this codebase already uses for other visible-not-silent signals
(`groundedIn`'s dropped-hallucination warning in `sreoncall-auditability` is the closest
analogue). If this file is ever seen growing unchecked in practice, the fix is a human pruning
session or a summarisation pass a human triggers deliberately — never an automatic prune added
to `appendLesson()` itself.

## What gets recorded, and why it's visible

Every incident carries a `memory` field and, once a remediation outcome lands, a `redemption`
field:

```js
memory:      { verdict, fromIncident, mechanism, reason, candidatesConsidered, turnsUsed, turnBudget }
redemption:  { status, note?, reason?, confidence?, citedEvidence?, scheduledAt, dueAt, checkedAt?, attempts }
```

`IncidentDetail` renders `memory` as "Recognised as a recurrence of INC-9 — verified in 3 turns
instead of a full investigation," and `redemption` as "Verified fixed" / "Still recurring after
the fix" with the cited reason. `OwnershipPanel` shows the full verification card.

Keep both visible. "The agent recognised this and spent a quarter of the budget" and "the fix
actually held" are **claims**, and this product's whole standard is that claims are checkable.
A silent optimisation — or a silent verification nobody can see — is indistinguishable from a
bug that skipped the work.

## Tuning constants

| Constant | Where | Value | Why |
|---|---|---|---|
| `MAX_CANDIDATES` | `recall.js` | 6 | Enough for a recurring fault and its neighbours; small enough that recall stays far cheaper than the investigation it may replace |
| `VERIFY_TURNS` (reuse) | `daemon.js` | 4 | Enough to confirm a known hypothesis with live queries; not enough to drift into an open-ended search |
| `VERIFY_TURNS` (redemption) | `redemption.js` | 5 | Same idea, applied to "did it recover" instead of "is the diagnosis still true" |
| `SRE_REDEMPTION_DELAY_MS` | `redemption.js` | 900000 (15m), env-overridable | Long enough for a merged PR or a flag flip to take effect and for fresh telemetry to accumulate |
| recall / redemption / lessons model | all three | `MODELS.fast` | Cheap calls gating potentially expensive ones (or, for lessons, judging a rare event that doesn't need the deep model's cost) |

These are engineering tuning knobs, not business thresholds — see `sreoncall-alerting`'s
"Tuning constants are not thresholds" section for the distinction and why it matters here too.
If recall or redemption costs approach investigation costs, the subsystem is pointless — check
these first.

## Before you change this subsystem

- [ ] Matching is still a model judgement about mechanism, not a similarity threshold
- [ ] `reuse` still runs a live verification pass — never zero queries
- [ ] The conservative bias holds (ambiguous → `related`/`novel`, never `reuse`)
- [ ] Every failure path still returns `novel` and never throws
- [ ] A verdict naming an unknown incident is still rejected
- [ ] `incident.memory` and `incident.redemption` are still recorded and still surfaced in the UI
- [ ] Recall and redemption still emit exactly one log line per decision (`sreoncall-logs`)
- [ ] Reuse still skips duplicate PR authoring rather than only shortening the investigation
- [ ] Every remediation outcome (drafted, declined, reused, failed) still gets a redemption check — not just successes
- [ ] `confirmed` still requires non-low confidence before closing an incident
- [ ] An `unresolved` prior fix still blocks the reuse shortcut and still gets surfaced to recall's prompt
- [ ] `verifyRecovery()` still uses only GET-only tools — never a write path
- [ ] `extractLesson()` still defaults to `no_lesson` for a one-off disagreement — recording
      is the exception, not the default, and push-backs are judged just as conservatively as
      outright rejections despite being the richer signal
- [ ] A recorded lesson still appends to `learned-lessons.md` — never overwrites or truncates
      the file
- [ ] `learned-lessons.md` stays registered in `practices.js`'s `DOCS`, between
      `incident-response.md` and `guardrails.md`
- [ ] Lesson extraction still fires after the reject/revise action is already persisted or
      already succeeded, and its own failure still can't turn a successful reject/revise into
      an error response
- [ ] The revise trigger still fires only after `reviseRemediation()` succeeds — never from a
      revision that itself failed
- [ ] The size guard still only warns (`console.warn`) — it must never auto-prune, truncate,
      or summarise `learned-lessons.md` on its own

## Related

- [[sreoncall-ownership]] — what happens to the fix once memory decides whether to author one,
  and how redemption is what lets ownership close an incident rather than stop at "PR opened"
- [[sreoncall-alerting]] — `derive_baseline`, the same real-history tool redemption prefers
  over a bare current reading when judging recovery
- [[sreoncall-detection-rca]] — the completion gate is the same "don't trust a self-report,
  check it structurally" instinct as this skill's redemption/lessons mechanisms, applied to
  signal coverage during diagnosis instead of outcomes after it
- `sre-as-code/practices/incident-response.md` and `guardrails.md` §9 — "Reuse before
  re-investigation", "Verification", and "Learned lessons are practice, not suggestion" — the
  team-editable statement of this policy loaded into every prompt
