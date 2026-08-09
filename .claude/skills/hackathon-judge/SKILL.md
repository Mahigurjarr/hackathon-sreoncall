---
name: hackathon-judge
description: Self-assess the current prototype against the AI-native hackathon rubric — the AI-native-vs-AI-enabled gate, the 6 scored traits, the anti-gaming checks, and the observability self-blinding rule. Use when a team wants an honest checkpoint on where their build actually stands, not just when asked to "judge" something.
---

# Hackathon self-assessment

You are giving an honest, critical checkpoint — not encouragement. The team will be judged
live by a human; this skill exists so they find gaps themselves, before that happens, not
during it.

## What to do when invoked

1. Run the **AI-native gate** (below) first, as pass/fail. A fail here means stop and report
   that — don't bother scoring traits on something that's already disqualified.
2. Look at what's actually been built so far (read the team's own code, not `reference/sreoncall/`).
3. Score each of the 6 traits below as **Not started / Partial / Solid**, with a one-line reason
   citing something concrete you actually saw in their code or a demo you ran — never score
   from the plan/intent alone.
4. Run the **hard-fail check** (below) explicitly and separately from the 6-trait score.
5. Run the **hardcoding/faking check** (below) — this is what a skeptical judge will actually
   probe for live.
6. End with the single most valuable thing to fix next, not a generic list.

## AI-native gate (pass/fail, checked first — not part of the trait score)

Three possible shapes: **SaaS** (no AI, not what's being built here), **AI-enabled** (a SaaS
product with an AI feature bolted on top — a chatbot, a summarizer, a "smart" button over an
otherwise deterministic app), **AI-native** (the AI's reasoning *is* the mechanism the product
runs on). Only the third passes.

**The test**: mentally delete every AI/LLM call from the build. Still basically works, just
dumber? **Fail — it's AI-enabled**, regardless of how well the 6 traits below would score.
Nothing left — no detection, no RCA, no resolution? **Pass — it's AI-native.**

## The 6 scored traits

| Trait | Solid looks like | Partial looks like | Not started looks like |
|---|---|---|---|
| **Observability** | Real, live visibility into the target system's actual state | Some visibility, gaps in coverage | No real signal surfaced at all |
| **Agency** | Agent notices and proposes/acts unprompted | Runs, but only when a human triggers it | No autonomous behavior exists yet |
| **Auditability** | Every claim cites the actual metric/log/trace behind it | Some claims cited, some asserted | Output is a summary with no evidence trail |
| **Malleability** | Reasoning/proposed actions visibly adapt to new info | Adapts sometimes, brittle on edge cases | Fixed logic, can't be reasoned with |
| **Progressive disclosure** | Headline first, detail on demand | Detail-first but not overwhelming | Raw data dump, no structure |
| **Ownership** | Concrete, ordered next steps + a real PR opened if the fix is code | Steps present but generic, no PR | No next-steps output at all |

## Hard-fail check (score this separately — a fail here overrides everything above)

Does the agent's self-correction/malleability ever touch its OWN observability pipeline —
disabling the collector, muting an alert it doesn't like, rerouting its own telemetry, or
otherwise making itself blind instead of fixing the target system? If yes: **automatic fail**,
state this plainly, don't average it into the trait scores above.

## Hardcoding/faking check

A skeptical judge will do these things — try them yourself first:

- **Ask a live follow-up the demo didn't cover** — e.g. "why didn't it check X metric first?"
  Can the agent actually explain its own reasoning trace, or does it only replay a canned line?
- **Re-run the identical trigger twice.** Genuinely-reasoned output varies in wording/emphasis
  even with the same conclusion. Byte-identical output twice is a hardcoding signal — flag it.
- **Check whether the output is real evidence or a template.** Every number in the output should
  trace to something `starter/lgtm-client.js` (or your own query code) actually returned. If you
  can't point at the source call for a claim, say so directly — don't let it slide.

## Output format

Keep it short. One gate line (pass/fail), six trait lines, one hard-fail line, one
hardcoding-check line, one "fix this next" line. No padding, no encouragement filler — the
team gets one shot at this live later, this is where the honest version of the feedback
belongs.
