---
name: sreoncall-memory
description: The agent's self-learning loop — how it recalls previously diagnosed incidents, decides reuse vs related vs novel by MECHANISM rather than service name, spends a 4-turn verification instead of a 12-turn search on a recurrence, and reuses an existing fix rather than authoring a duplicate PR. Use this skill whenever touching src/memory/, whenever changing how investigations are triggered or budgeted, whenever adding caching/dedup/"don't repeat work" behaviour, whenever the incident.memory field or recall verdicts are involved, and whenever someone asks the agent to stop wasting tokens on repeated or similar problems. Read it before changing the recall path, because a wrong reuse is far more expensive than a missed one.
---

# Memory / self-learning

The sentinel sweeps every ~45s and the same underlying fault recurs. Re-running a twelve-turn
investigation to rediscover a root cause the agent already established, cited, and wrote a
runbook for is pure waste — it burns budget a genuinely novel failure needs, and it produces a
second incident that says the same thing as the first.

> The agent should get **cheaper and faster** at problems it has seen, and spend its full
> budget on ones it hasn't.

Files: `src/memory/recall.js` (the decision), `src/sentinel/daemon.js`
(`openIncidentFromInvestigation` and `attachRemediation` act on it),
`web/src/components/IncidentDetail.jsx` (surfaces what memory did).

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

## What gets recorded, and why it's visible

Every incident carries a `memory` field:

```js
memory: { verdict, fromIncident, mechanism, reason, candidatesConsidered, turnsUsed, turnBudget }
```

`IncidentDetail` renders this as "Recognised as a recurrence of INC-9 — verified in 3 turns
instead of a full investigation."

Keep it visible. "The agent recognised this and spent a quarter of the budget" is a **claim**,
and this product's whole standard is that claims are checkable. A silent optimisation is
indistinguishable from a bug that skipped the work.

## Tuning constants

| Constant | Where | Value | Why |
|---|---|---|---|
| `MAX_CANDIDATES` | `recall.js` | 6 | Enough for a recurring fault and its neighbours; small enough that recall stays far cheaper than the investigation it may replace |
| `VERIFY_TURNS` | `daemon.js` | 4 | Enough to confirm a known hypothesis with live queries; not enough to drift into an open-ended search |
| recall model | `recall.js` | `MODELS.fast` | One cheap call gating a potentially expensive one. Using the deep model here would erase the saving |

If recall costs approach investigation costs, the subsystem is pointless — check these first.

## Before you change this subsystem

- [ ] Matching is still a model judgement about mechanism, not a similarity threshold
- [ ] `reuse` still runs a live verification pass — never zero queries
- [ ] The conservative bias holds (ambiguous → `related`/`novel`, never `reuse`)
- [ ] Every failure path still returns `novel` and never throws
- [ ] A verdict naming an unknown incident is still rejected
- [ ] `incident.memory` is still recorded and still surfaced in the UI
- [ ] Recall still emits exactly one log line per decision (`sreoncall-logs`)
- [ ] Reuse still skips duplicate PR authoring rather than only shortening the investigation

## Related

- [[sreoncall-ownership]] — what happens to the fix once memory decides whether to author one
- `sre-as-code/practices/incident-response.md` — "Reuse before re-investigation", the
  team-editable statement of this policy that is loaded into the investigator's prompt
