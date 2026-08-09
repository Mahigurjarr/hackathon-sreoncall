---
name: sreoncall-agency
description: What makes the agent act like an experienced, cautious SRE engineer rather than a script that hits a threshold and fires — unprompted detection, hypothesis-driven investigation that tries to disprove itself rather than randomly retrying, a real postmortem-then-redemption cycle, and initiative that stops exactly at the one external write step a human gates. Use this skill whenever touching src/sentinel/daemon.js, whenever changing how or when the agent acts on its own, whenever someone asks to strengthen "agency" or autonomy, and whenever tempted to add a human trigger to something the agent could reasonably decide for itself. Read it before adding a new "click to run" button — that is very often agency moving the wrong direction.
---

# Agency

Agency is not "the code runs on a timer." A cron job runs on a timer. Agency is that **every
decision inside that loop is made by the agent's own judgement, unprompted, and the loop keeps
going whether or not a human is watching.** The measure is not "does it act" — it's "does it
act like someone who knows what they're doing."

## The persona this whole subsystem is built to earn: a cautious, experienced SRE

Not a script that fires on a threshold. Not a fuzzer that tries fixes until one sticks. An
engineer who:

- **investigates before acting** — states a hypothesis, then deliberately tries to break it,
  rather than gathering only confirming evidence (`investigator/loop.js`'s hypothesis
  discipline: `NEW → attempted disconfirm → CONFIRMED/REVISED`, cycling as needed);
- **never randomly retries** — a failed query is reasoned about, not blindly re-sent; a
  declined incident states *why* a fix isn't warranted rather than trying one anyway to see if
  it helps (`sreoncall-ownership`'s "declining is a first-class outcome");
- **remembers what it's seen** — recognises a recurrence by mechanism, not by guessing again
  from scratch (`sreoncall-memory`);
- **writes its own postmortem, then checks its own work** — see below, this is the part most
  agent demos skip entirely;
- **knows the edge of its own authority** — drafts freely, but the one action that leaves this
  machine and touches a shared system waits for a second pair of eyes. A real senior engineer
  does this too, for the same reason: not because they doubt their own diagnosis, but because
  an external, irreversible-ish action (a PR on a shared repo) is categorically different from
  an internal one (a query, a draft).

## Where the initiative actually lives — `src/sentinel/daemon.js`

`runDaemon()` is a `for (;;)` loop with no exit condition and no human in it. Every sweep:

1. **Detects unprompted** — `triage()` judges the fleet's current numbers with no fixed
   threshold; a quiet fleet correctly produces an empty result, not a padded one.
2. **Decides whether to investigate at all** — `recall()` judges reuse/related/novel before
   committing a full investigation's budget (`sreoncall-memory`).
3. **Investigates methodically** — the hypothesis-disconfirmation cycle above, not a straight
   line from trigger to conclusion.
4. **Decides on its own whether a fix is warranted** — `draftRemediation()`'s decision loop
   (`sreoncall-ownership`), including the discretion to conclude `no_code_fix`.
5. **Schedules its own follow-up** — `scheduleRedemption()` runs unconditionally after step 4,
   regardless of outcome. Nobody asks it to check its work; it always does.
6. **Checks its own work later, unprompted** — `runRedemptionChecks()` runs every sweep,
   re-verifying whatever came due against fresh evidence (`src/actions/redemption.js`).
7. **Learns from what it finds** — an `unresolved` check blocks the same fix from being
   reused blindly next time (`sreoncall-memory`'s reuse guard).

No step above has a "click here to run this" button. The only human-facing surface in the
whole loop is a review gate on step 4's *external* half — see below.

## Postmortem, then redemption — the part that makes this agency, not automation

A script that fires an action and moves on is automation. An agent that comes back later,
unprompted, to find out whether what it did actually worked — and changes its future behaviour
based on the answer — is exercising judgement over time, which is what "agency" is supposed to
mean and rarely does in practice.

Concretely, this is `src/actions/redemption.js`:

- **The postmortem is the RCA plus the remediation decision** — already written, already
  cited, before any redemption check happens.
- **The redemption check is the agent auditing its own postmortem's conclusion** — did the
  diagnosis and the resulting decision actually hold, checked against telemetry that didn't
  exist yet when the postmortem was written.
- **The outcome changes future judgement**, not just the one incident's status — an
  `unresolved` verdict makes the agent distrust that specific fix the next time recall would
  otherwise have reused it (`sreoncall-memory`).

This cycle is what separates "the agent did a thing" from "the agent behaves like it's
accountable for the thing it did." Do not let a future change schedule a redemption check only
for successful outcomes — a wrongly-declined incident deserves exactly the same follow-up as a
wrongly-applied fix, and `scheduleRedemption()` is called unconditionally for this reason.

## Where initiative correctly stops, and why that is not a weakness

Approval is required before `applyGithubPrProposal()` — the one call that writes to a system
outside this one. This is not agency held back by timidity; it is the same judgement a careful
senior engineer applies to themselves:

- **Drafting is reversible and cheap.** A wrong draft costs a re-read. It has already happened,
  unprompted, by the time a human sees it.
- **Publishing is not fully the agent's to unilaterally decide**, because a PR on a shared,
  public repository is a fact visible to other people the moment it exists — it is a different
  class of action from anything internal to this system, and treating it identically to a
  draft would be recklessness wearing autonomy's clothing.
- **The gate is on the ACTION, not on the REASONING.** Everything upstream of "open the PR" —
  detect, investigate, diagnose, decide, draft, schedule a check, verify, learn — is already
  fully autonomous today. Only the single external write waits.

**Do not close this gap by removing the approval step.** That would not be "more agency" — it
would be the one guardrail (`sreoncall-ownership` guarantee 3) that makes every other claim in
this file trustworthy. If autonomy needs to grow further, grow it by narrowing *what* needs
approval with real evidence (e.g., auto-approving a class of low-risk changes once enough
redemption history exists to justify the trust) — never by deleting the gate itself.

## Drafts that never become completed actions — the honest remaining gap

Some remediation outcomes stay `draft`/`revised` because no human has reviewed them yet — the
agent has done everything it can do alone, and the loop is genuinely waiting on a person. This
is not the agent failing to finish; it is the agent correctly recognising the boundary of its
own authority and stopping exactly there; see the review-gate section above. Where this
*could* legitimately move: shrinking review latency (a clearer diff, a tighter summary) or
narrowing what requires review — never by having the agent approve its own drafts.

## Before you change how or when the agent acts

- [ ] A new capability still runs from `sweepOnce()`'s own loop, not from a UI trigger a human
      has to click
- [ ] A new decision point still tries to disconfirm itself before concluding, not just
      confirms
- [ ] A declining outcome is still preserved as legitimate — no pressure to always "do
      something" to look productive
- [ ] Any new action that produces a durable outcome gets a redemption check scheduled
      unconditionally, success or not
- [ ] The approval gate before an external write is still intact — agency grows by narrowing
      what needs review with evidence, never by removing the review

## Related

- [[sreoncall-ownership]] — the mechanics of the draft→approve→apply pipeline this skill's
  initiative flows into, and the guarantee that keeps the approval gate real
- [[sreoncall-memory]] — the redemption loop in full detail, and how its outcome changes what
  the agent trusts next time
- [[sreoncall-ai-native-gate]] — the deeper property this skill assumes: every decision above
  is made by the model reasoning over evidence, never a deterministic stand-in
