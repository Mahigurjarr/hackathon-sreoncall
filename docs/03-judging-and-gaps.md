# Judging parameters, the 6 pillars, and what's actually missing today

## AI-native, not AI-enabled — a pass/fail gate, checked before anything else

Three possible shapes: **SaaS** (no AI, not what you're building), **AI-enabled** (a SaaS
product with an AI feature bolted on — a chatbot, a summarizer, a "smart" button over an
otherwise deterministic app), **AI-native** (the AI's reasoning *is* the mechanism the product
runs on). Only the third passes.

**The test**: delete every AI/LLM call from your build in your head. Still basically works,
just dumber? That's AI-enabled — fails the gate, regardless of how well the 6 pillars below
score. Nothing left — no detection, no RCA, no resolution? That's AI-native. This is checked
*before* the pillar scoring, as pass/fail, not folded into the weighted score.

## The 6 pillars — what "AI-native" means here, concretely

| Pillar | Solid looks like | Weak looks like |
|---|---|---|
| **Observability** | Real, live visibility into what's actually happening in the target system | Occasional summaries with no real view underneath |
| **Agency** | Agent notices and proposes/acts on its own initiative | Only runs when a human clicks something to trigger it |
| **Auditability** | Every claim cites the actual metric/log/trace behind it | "Something looks wrong" with no evidence attached |
| **Malleability** | Reasoning/proposed actions visibly adapt to new information | Fixed if/else logic that can't be reasoned with |
| **Progressive disclosure** | Headline first, detail available on demand | A wall of raw data dumped up front |
| **Ownership** | Concrete, ordered next steps tied to *this specific* incident — a real PR opened on your repo if the fix is code | A generic runbook restated regardless of what broke |

**Hard rule, checked separately from the 5 above**: self-correction/malleability applies to the
agent's reasoning and its actions *on the target system* — never to its own observability
pipeline. An agent that "resolves" something by muting its own alert or disabling its own
collector is blinding itself, not fixing anything. Automatic fail on that trait if it happens.

**Anti-gaming, so you know what to expect live**: a judge may re-trigger the same fault twice
(byte-identical output both times is a hardcoding signal), ask a live follow-up your demo run
didn't cover, or ask to see the actual reasoning trace/API call log behind a claim, not just the
final message. Build for that from the start rather than polishing only the happy-path demo.

## What's genuinely already built in the real SREonCall platform (don't rebuild these)

The production codebase already has real, working agent-native scaffolding — this is context,
not something to reinvent:

- **`agent-orchestrator.service.ts`** — builds context, reasons via tool-use, gates high-risk
  actions behind a real approval flow.
- **`propose_ticket` / `propose_change` / `propose_runbook` / `propose_alert_rule` /
  `propose_oncall_override`** (in `mcp/tools.ts`) — draft-then-approve tools, never write live.
- **`lgtm-query.service.ts`** — real typed query access to Mimir/Loki/Tempo (the pattern
  `starter/lgtm-client.js` is a minimal version of).
- **12 cataloged marketplace agents** with real trigger wiring via NATS events.

## What's concretely missing — this is the actual opportunity

Verified by direct code inspection, not guessed:

1. **No agent ever installs itself.** All 12 agents exist as definitions, but the only way an
   `AgentInstallation` gets created is a manual API call — there's no automatic "this agent is
   relevant here, turn it on" step anywhere. If your prototype's onboarding flow decides which
   capabilities are relevant to the environment it just discovered and switches them on without
   a human manually calling an install endpoint, that's a real, currently-missing capability,
   not a toy feature.
2. **A predictive-risk pipeline with no publisher.** `EmergingRisk` (the model) and
   `predictive.worker.ts` (the consumer) both exist and work — but nothing in the codebase ever
   publishes to the NATS subjects this worker listens on. It's a watcher with no heartbeat. If
   your prototype produces a real "here's a risk forming before it's an incident" signal, you're
   filling an actual gap, not padding a feature list.
3. **No modify step between propose and approve.** `AgentApproval` and `McpProposal` are both
   strictly binary — `approved` or `rejected`, nothing in between. A human can't edit a draft
   before it executes, only accept or kill it outright. A genuinely useful "edit this proposal,
   then approve the edited version" flow is a real, currently-absent capability.

None of these three are required — they're where the real platform is thinnest today, which
makes them good places to build something that's obviously new rather than a nicer version of
something that already exists.
