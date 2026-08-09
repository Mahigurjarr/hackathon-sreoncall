---
name: sreoncall-ai-native-gate
description: The checkable version of CLAUDE.md's AI-native-vs-AI-enabled gate for THIS codebase — every judgement call (detect, diagnose, remediate, verify) must route through src/llm/client.js and must fail loud, never fall back to a deterministic stand-in, when the model is unavailable. Use this skill before adding a try/catch around a chat()/runToolLoop()/runDecisionLoop() call, before adding ANY threshold constant, and whenever someone asks to verify, strengthen, or audit "AI-native" as a property rather than a slogan. Read it before writing a fallback branch for a model call — that is the single most common way a codebase drifts from AI-native to AI-enabled without anyone deciding to make that trade.
---

# The AI-native gate, made checkable

`CLAUDE.md`'s test is a thought experiment: "delete every AI/LLM call from this in your head —
does the product still basically work, just dumber?" That's the right question, but a thought
experiment run once at design time doesn't stay true as code accumulates. This skill turns it
into something checkable against the actual repository, every time.

## The one rule

> **Every path that PRODUCES A JUDGEMENT — is this anomalous, what's the root cause, does this
> warrant a fix, did the fix work — routes through `src/llm/client.js`'s `chat()` /
> `runToolLoop()` / `runDecisionLoop()`, with NO deterministic fallback that lets it keep
> producing that judgement when the model is unavailable.**

If the LLM is down, the correct behaviour is: **that specific judgement stops happening, loudly
(a thrown error, a logged failure) — never a quieter, dumber version of the same answer.**

## What this looks like, verified against the real code

Every module that reasons is wired to the choke point, with no bypass:

| File | Judgement | What happens if `chat()` throws |
|---|---|---|
| `sentinel/triage.js` | Is anything in the fleet worth investigating? | Throws, uncaught — no try/catch in the file. Propagates out of `sweepOnce()` to `runDaemon()`'s outer catch, which logs `[sentinel] sweep failed` and retries next interval. **No anomalies get silently invented or silently skipped as "fine."** |
| `investigator/loop.js` | What's the root cause? | Throws out of `investigate()`. No incident gets created from a failed investigation — never a generic "something's wrong" placeholder. |
| `memory/recall.js` | Is this a known recurrence? | Caught internally, returns `verdict: "novel", degraded: true`. This is the ONE intentional exception — see below, it degrades to "do the full AI investigation" not to a non-AI answer. |
| `actions/remediation.js` | Does this warrant a fix, and what should it be? | Throws out of `draftRemediation()`/`reviseRemediation()`. No fix gets drafted from a template. |
| `actions/redemption.js` | Did the fix actually work? | Throws out of `verifyRecovery()`; the caller reschedules rather than guessing. No incident closes on a failed check. |
| `actions/explain.js` | Plain-language fleet summary | Caught, returns `null` — see below, this is presentation, not judgement. |
| `capabilities/install.js` | Which capability suits this service? | No fallback list, no lookup table — the model's reasoning is the only path to an answer. |

## The one legitimate exception, and why it doesn't violate the rule

`memory/recall.js` catches its own failures and returns `{verdict: "novel", degraded: true}`
instead of throwing. This looks like a fallback — it is not a *non-AI* fallback. "Novel" means
"skip the optimisation, run the full AI investigation as if nothing was recalled." The
judgement (root cause, remediation) still happens entirely through the model; only the
*shortcut* to a cheaper path is what's skipped. Losing memory must never mean losing
investigation — the fallback exists precisely to guarantee that.

**The test for whether a caught error is legitimate:** does the fallback path still reach a
real model call for the actual judgement, just by a longer route? If yes, it's a resilience
pattern. If the fallback path invents an answer without asking the model at all, it's a
violation, however small the case it covers.

## Presentation is allowed to degrade. Judgement is not.

`actions/explain.js` returns `null` on failure, and the dashboard shows no plain-language
summary that sweep — the raw numbers (already real, already computed by `lgtm/health.js`
without any model involvement) still display. This is fine: a missing *narration* of real data
is not the same as a *fabricated judgement* replacing a real one. The line:

- **Fine to degrade**: a summary, a label, a friendly restatement of data that exists
  independent of the model.
- **Never allowed to degrade into a fallback**: whether something is anomalous, what caused it,
  what to do about it, whether it's fixed. If a judgement silently downgrades to "always assume
  healthy" or "always assume it worked," that is the product quietly becoming AI-enabled.

## Guardrail-enforcement code is correctly deterministic — don't confuse the two

`actions/remediation.js`'s `isAllowedPath()`, `actions/proposals.js`'s status-transition
checks, and `store/state.js`'s lockfile are all plain, non-AI code, and that is correct. The
AI-native rule is about **decisions** (what's wrong, what to do), not about **the mechanism
that constrains or applies a decision**. A guardrail that limits what the model is allowed to
do should be deterministic precisely so it can't be argued around by a clever prompt — making
the enforcement itself another model call would weaken it, not strengthen the product's
AI-native claim. If you're ever unsure which category a piece of code falls into, ask: "does
this decide something about the world, or does it enforce a boundary on a decision already
made?" The first must be AI; the second must not be.

## No hardcoded threshold, anywhere, ever — the sibling rule

Every judgement above must also never fall back to a **fixed threshold** standing in for the
model's live comparison against a baseline — this is `sreoncall-alerting`'s rule, restated here
because it's the same failure mode wearing a different disguise. A hardcoded number is a
smaller, quieter version of the same problem a hardcoded fallback is: the system stops
reasoning and starts pattern-matching against a constant that will eventually stop meaning
anything. `triage.js`'s own comment says it plainly: "No threshold constant exists here on
purpose."

## How to actually check this, not just assert it

```bash
# Every file that reasons should require the LLM choke point:
grep -rl "require(\"../llm/client\")" src/

# Any try/catch immediately around a chat()/runToolLoop()/runDecisionLoop() call is worth
# reading closely — confirm its catch block either re-throws, logs-and-stops, or falls back
# to "run the full AI path anyway" (recall.js's pattern). Anything else is a candidate
# violation:
grep -rn -B2 -A8 "await chat(\|await runToolLoop(\|await runDecisionLoop(" src/ | grep -A8 "try {"

# No bare numeric comparison should be deciding anomalousness on its own — a stray
# `if (errorRate > 0.05)` style line in a judgement path is the smell to look for:
grep -rn "> 0\.\|>= 0\." src/sentinel/ src/investigator/ src/actions/
```

None of these commands should ever need a code change to keep returning "clean" — if one
starts turning up a real hit, that's the gate catching a real regression.

## Before you add a try/catch around a model call

- [ ] Does the catch block re-throw, or log-and-halt that specific judgement? → fine
- [ ] Does the catch block fall back to running the SAME judgement through the model a
      different way (like recall's "novel")? → fine, document why like recall.js does
- [ ] Does the catch block return a guessed answer, a default "healthy", or a canned string
      standing in for what the model would have said? → **not fine, this is the violation**
- [ ] Is the thing degrading a presentation label, or an actual judgement about the world?
      Only the former may degrade silently
- [ ] Did you just add a numeric threshold anywhere in a judgement path? → remove it; derive
      it live or don't compare against a fixed number at all

## Related

- [[sreoncall-alerting]] — the same no-hardcoded-threshold rule, applied specifically to
  authored alert rules
- [[sreoncall-agency]] — why the judgement side of this loop runs completely unprompted, and
  where the one legitimate human gate sits (never as a fallback for a missing model call — as
  an approval step on an already-made decision)
- [[sreoncall-auditability]] — a correction to a model's own output must come from asking the
  model again over real evidence (`Ledger.repair`), never from deterministic code patching the
  text — the same principle this skill applies to judgements applies to corrections
- `CLAUDE.md` — the original thought-experiment version of this gate; this skill is its
  checkable, code-grounded restatement for this specific repository
