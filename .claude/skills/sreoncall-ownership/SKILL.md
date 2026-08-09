---
name: sreoncall-ownership
description: How the agent takes ownership of an incident — the draft→approve→apply proposal state machine, the fail-closed path allowlist, the PR-authoring rules, and the review gate (approve / push back / reject). Use this skill whenever touching src/actions/ (remediation.js, proposals.js, github.js), whenever changing what the agent is allowed to propose or write, whenever adding a proposal status or a review action, whenever wiring anything that writes to GitHub, and whenever someone asks the agent to "fix", "remediate", "open a PR", or "act on" an incident. Read it before changing the action path, because the guarantees here are safety properties, not preferences.
---

# Ownership

Ownership is the difference between an agent that produces a good paragraph and one that
produces a reviewable change. The rule this subsystem exists to enforce:

> The agent decides **on its own** what to do. A human decides **whether it happens.**
> Drafting is autonomous. Publishing is not.

Everything below protects one of those two halves. Weakening either breaks the subsystem's
whole claim.

## The pipeline

```
investigation concludes (cited RCA)
        │
        ▼
draftRemediation()          ← the model decides IF a change is warranted, and writes it
        │
        ├── no_code_fix ────────────► recorded on the incident, with the reason. Done.
        │
        ▼
draftProposal()             ← status: "draft". Nothing has left this machine yet.
        │
        ▼
   ┌────┴─────────────────────────────┐
   │  human reviews in the dashboard  │
   └────┬───────────┬─────────────┬───┘
    approve      push back      reject
        │            │             │
        ▼            ▼             ▼
approveProposal   reviseRemediation  status: "rejected"
 status:"approved"  model re-authors
        │           status:"revised"
        ▼           (or "withdrawn")
applyGithubPrProposal ──► branch → files → PR ──► status: "applied", url + number stored
        │
        └── on failure ──► status: "apply_failed", error stored. Never stuck on "approved".
```

Files: `src/actions/remediation.js` (authoring), `src/actions/proposals.js` (state machine),
`src/actions/github.js` (REST client), `src/sentinel/daemon.js` (`attachRemediation` wires it
into the running loop), `src/web/server.js` (review routes),
`web/src/components/OwnershipPanel.jsx` (the gate).

## The five guarantees

### 1. The agent never writes to the running system

There is no write path to the target fleet. `src/lgtm/client.js` is GET-only by construction —
no restart, no scale, no flag flip, no config edit function exists to call. When the correct
remediation *is* an operator action, the agent says so precisely as an ordered next step and
stops there.

### 2. Never commit to a default branch; always branch → PR

`openFixPR()` is the only write path implemented, and its shape is fixed: resolve the default
branch sha → create `agent/<incident-id>-<slug>` → write files → open a PR against `main`.
There is no merge call, no force-push, no direct-commit path. Do not add one.

### 3. Publishing requires an explicit approval transition

`applyGithubPrProposal()` **throws** unless `proposal.status === "approved"`. The status is
not a label the UI renders; it is the precondition. Any code path that reaches GitHub without
passing through `approveProposal()` is a bug, however convenient.

### 4. Scope is enforced in code, not requested in the prompt

```js
const ALLOWED_PREFIXES = ["sre-as-code/", "docs/incidents/"];
```

`isAllowedPath()` rejects anything outside these, and anything containing `..`, **before a
human ever sees the draft**. The prompt also forbids it — but a model that ignores the prompt
must still fail closed. This is what stops the agent editing `src/`, `bin/`, or `.env`: its own
senses and its own secrets.

### 5. It may never reduce what it can see

No proposal may mute, delete, loosen, narrow, or reroute an alert rule, query, or collector so
a symptom stops appearing. If a signal is genuinely noisy, the only acceptable proposal is a
**more precise** one. "The alert stopped firing" is not a resolution — it is the agent
blinding itself, and the failure would be invisible precisely because it succeeded.

This is the one rule with no exception. It is stated in
`sre-as-code/practices/guardrails.md` §3 and enforced by guarantee 4.

## Declining is a first-class outcome

`no_code_fix` is not a failure. The model is explicitly told to reach for it when:

- the root cause is an operator/flag action, so a repo change would paper over something
  nobody needed to change;
- confidence is too low to justify committing anything;
- existing rules and runbooks already cover this failure mode.

**A well-argued decline is a better answer than a redundant runbook.** This is load-bearing
evidence that the reasoning is real: an agent that proposes a fix for every incident is
pattern-matching, not judging. Live proof — INC-5 (product-catalog) was declined because the
traced exception named a feature flag, while INC-1 (checkout DNS) produced a real PR.

Never add a fallback that emits a generic runbook when the model declines. That single change
would convert this system from AI-native to AI-enabled.

## Statuses — the complete set

| Status | Meaning | Can approve? |
|---|---|---|
| `draft` | Authored, awaiting review | yes |
| `revised` | Re-authored after pushback | yes |
| `apply_failed` | PR attempt failed; error stored | yes (retry) |
| `approved` | Approval recorded, apply in flight | no (in progress) |
| `applied` | PR is open; `result.url` / `result.number` stored | no |
| `rejected` | Human declined, with `rejectionReason` | no |
| `withdrawn` | Model withdrew it during revision | no |

The server guards this — approving anything outside `draft`/`revised`/`apply_failed` returns
409. Without that guard, re-approving an `applied` proposal opens a **second PR for the same
fix**, and approving a `rejected` one silently reverses a human's decision.

If you add a status, add it here, to `STATUS_STYLE` in `OwnershipPanel.jsx`, and to the guard.
A status with no pill entry falls back silently and looks like a bug.

## Push back — the malleability affordance

"Push back" is not an edit form. The reviewer argues in prose; `reviseRemediation()` hands the
objection plus the previous draft back to the model, which **re-authors the change itself** and
may withdraw it entirely if the objection shows a repo change was wrong.

The prior version is kept in `proposal.revisions[]` with the feedback that caused it, so the
disagreement stays auditable. Never overwrite a draft in place — the trail is the evidence
that the agent adapted rather than merely being corrected.

Only `draft`/`revised` can be revised. Once a PR is open, revision belongs on the PR.

## Writing the PR itself

- Body leads with 2–3 lines a reviewer can act on: what broke, what this changes, why.
- Every factual claim carries a `[E#]` citation resolving to a query the agent actually ran.
- Amend an existing alert rule/runbook rather than dropping a near-duplicate beside it — the
  current SRE-as-code inventory is passed into the prompt for exactly this reason.
- New alert rules carry a `rationale:` block explaining why that metric family and not another.
- **Encode no static threshold.** Whether a reading is anomalous stays a live judgement against
  a baseline; a hardcoded number freezes today's traffic shape into the repo.
- Say plainly what the change does **not** fix.

## Before you change this subsystem

- [ ] Drafting still happens unprompted, with no human trigger
- [ ] Nothing reaches GitHub without `status === "approved"`
- [ ] `ALLOWED_PREFIXES` still rejects out-of-scope paths in code
- [ ] No new write path to the target fleet
- [ ] No path that mutes or narrows a signal
- [ ] `no_code_fix` still possible, with no generic-runbook fallback
- [ ] Every terminal state recorded on the proposal — never stuck mid-transition
- [ ] Every autonomous decision emits exactly one log line (`sreoncall-logs`)

## Related

- [[sreoncall-memory]] — decides whether a fix needs authoring at all, or whether a prior
  incident's proposal already covers this one
- `sre-as-code/practices/guardrails.md` — the team-editable statement of guarantees 1–5,
  loaded into the model's prompt on every reasoning step. Change both together, or the
  enforced behaviour and the stated policy drift apart.
