---
name: sreoncall-malleability
description: The explicit policy layer that judges whether a hypothesis trail actually EARNED its confidence, instead of trusting the model's last self-reported tag at face value. Use this skill whenever touching src/investigator/policy.js, whenever changing how hypothesis trails are parsed or scored, whenever confidence gets derived from hypothesis_history anywhere, and whenever someone asks to strengthen malleability, adaptive reasoning, or self-correction as a checkable property rather than a claim about prompting. Read it before trusting a HYPOTHESIS[CONFIRMED] tag without checking what came before it — that is exactly the gap this skill closes.
---

# Malleability

Malleability is not "the model can change its mind" — a model can always emit different text.
It's whether the SYSTEM can tell the difference between a hypothesis that was genuinely tested
and one that was declared and dressed up to look tested. Prompting alone can't guarantee that
distinction; a model under pressure can self-report `HYPOTHESIS[CONFIRMED]` on the very first
thing it thought of, and nothing reading only the last tag would know.

## The gap this skill closes

Before `src/investigator/policy.js`, confidence was derived by looking at
`hypothesis_history`'s last entry and trusting its status: `CONFIRMED` → `high`, full stop. That
is **prompting plus a convention**, not a policy — the discipline
(`sre-as-code/practices/incident-response.md`: state it, genuinely try to break it, only then
confirm or revise) lived entirely in what the model was *asked* to do, with nothing checking
whether it actually happened.

## The policy — judging the trail's shape, not the world

`src/investigator/policy.js`'s `evaluateTrail()` and `deriveConfidence()` check the STRUCTURE
of what the model already produced:

| Trail shape | Verdict |
|---|---|
| `CONFIRMED` as the only entry | **Not disciplined** — declared, never tested. Confidence capped at `medium` even though the model said `CONFIRMED`. |
| `CONFIRMED` after at least one earlier tag | Disciplined — some follow-up turn happened before it called the case closed. `high`. |
| `REVISED` with no `DISCONFIRMED` anywhere earlier in the trail | **Not disciplined** — a second guess with nothing contradicting the first one to justify it. `medium`, not trusted as an earned revision. |
| `REVISED` following a real `DISCONFIRMED` | Disciplined — the revision responds to actual contradicting evidence. `medium`. |
| Ends on `NEW` or `DISCONFIRMED` | Disciplined by default — an honest lower-confidence state, not a violation. Nothing to police when nothing was claimed. |
| Empty trail | Not disciplined — no hypothesis was ever stated at all. |

Every incident stores the full verdict as `confidencePolicy: { disciplined, reason, capped }`
alongside `confidence` — so a capped confidence is visible and explainable, not silently
indistinguishable from an earned one of the same level.

## Why this is deterministic code, and correctly so

This is the same distinction `sreoncall-ai-native-gate` draws between judgement and
enforcement: `policy.js` makes **no claim about the world** — it never decides a service is
unhealthy, never proposes a root cause, never picks a remediation. It only checks whether a
self-report the model already made followed the shape the discipline requires. That is
enforcement of a discipline, not a judgement instead of one — running it through another model
call would be strictly worse: gameable by the same pressure that produces an undisciplined
trail in the first place, and it would add a second point of failure to something that should
be a simple, auditable structural check.

**Do not "upgrade" this into an LLM call that judges the trail's quality.** That would trade a
reliable, cheap, always-consistent check for a second opinion that can itself be wrong or
manipulated — the opposite of what a policy layer is for.

## What this deliberately does NOT check

`evaluateTrail()` checks ORDER and PRESENCE of tags, not semantic content — it can't verify
that a `DISCONFIRMED` tag's disconfirming query was actually a *good* attempt to break the
hypothesis, only that one was logged before a `REVISED`/`CONFIRMED` claim. That's a real,
accepted limit: verifying the semantic quality of a disconfirmation attempt would require
either another model call (see above, worse) or a much richer rubric that risks becoming its
own source of false confidence. Catching "confirmed with literally nothing before it" and
"revised with literally nothing contradicting it" is the load-bearing 80% of the discipline;
don't let scope creep here turn a reliable structural check into an unreliable semantic one.

## Before you change this subsystem

- [ ] The policy still checks trail SHAPE (order, presence of tags), never trail CONTENT —
      no model call inside `policy.js`
- [ ] A `CONFIRMED` with no prior tag is still capped, never granted `high` on trust alone
- [ ] A `REVISED` with no earlier `DISCONFIRMED` is still flagged as undisciplined
- [ ] `confidencePolicy` is still stored on every incident, not only the capped ones — a
      reviewer should be able to see WHY a high confidence was trusted, not just when it wasn't
- [ ] Ending mid-cycle (`NEW`/`DISCONFIRMED` as the last tag) is still treated as honest, not
      as a violation — malleability includes "investigation ran out of budget," not just
      "investigation reached a confident answer"
- [ ] New tests added here still run standalone, no API dependency — `evaluateTrail`/
      `deriveConfidence` are pure functions over plain objects on purpose

## Related

- [[sreoncall-ai-native-gate]] — the judgement-vs-enforcement distinction this skill's core
  design decision rests on
- [[sreoncall-detection-rca]] — the hypothesis trail this policy scores is produced during
  the investigation this skill's sibling covers
- [[sreoncall-agency]] — "tries to disprove itself rather than randomly retrying" is the
  behaviour this skill verifies actually happened, rather than assuming it did
- `sre-as-code/practices/incident-response.md` — the hypothesis discipline stated in prose,
  loaded into the model's own prompt; this skill is its code-side enforcement
