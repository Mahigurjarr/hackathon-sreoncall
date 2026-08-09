# First session: register your team

If `.hackathon-team.json` doesn't exist yet in this folder, do this **before anything else**,
including before reading the rest of this file in detail:

1. Ask the user for their **team id** (format: `team-<number>`, e.g. `team-3`) and the **URL of
   the public git repo** they'll push their prototype to. If they don't have one yet, tell them
   to create one now — a new **public** GitHub repo (`gh repo create <name> --public --clone`,
   or via github.com → New repository → Public) — before answering. This repo is also where
   their agent should open PRs for code-level incident fixes later.
2. Write both to `.hackathon-team.json` at the repo root: `{"team": "...", "repo": "..."}`, and
   also add a `LEADERBOARD_TEAM_ID=<team-id>` line to `.env`. This is the **only time** the
   team id or repo URL gets asked for — every later step reads one of these two files, never
   the user again.
3. **Run `/register <team-id> <repo-url>`** with the exact values from step 1 — this puts the
   team on the live leaderboard. `/register` does its own validation (repo must be public,
   must have a `main` branch) — if it stops you, fix what it says before moving on, don't skip
   this step.
4. Check `.env` — if `OPENAI_API_KEY` is blank, ask for the key their team was issued, have
   them paste it, and save it into `.env`. Never print the key back out or log it anywhere else
   once saved.
5. Only then proceed.

**Registering does not score you.** Run `/update` after every push you want reflected on the
leaderboard — it's not automatic. See `docs/05-leaderboard.md` for the full mechanics.

**`/update` needs the team id too, and must never re-ask for it.** `update.md`'s own fallback
is "ask the user" if `$LEADERBOARD_TEAM_ID` isn't set as a live shell variable — which it won't
be, since env vars don't persist between separate tool calls. **Before running `/update`,
read the team id yourself** from `.hackathon-team.json` (or the `LEADERBOARD_TEAM_ID` line in
`.env`) and use that value directly — the human already answered this once during onboarding,
don't make them answer it again.

A `/hackathon-judge` skill is available in `.claude/skills/` — use it any time the team wants
an honest checkpoint on where their build actually stands against the rubric below, not just
when explicitly asked to "judge" something. This is a private self-check, separate from
`/update`'s real leaderboard score.

# READ THIS FIRST — before writing a single line of code

**You are not extending or running the code in `reference/sreoncall/`.** That folder is a real,
working traditional SaaS platform — incidents, tickets, on-call, alerts, built the way SaaS
products have been built for 20 years: a human opens a page, fills a form, clicks a button,
the system reacts. It's there so you don't have to guess at data shapes or reinvent patterns
that already exist — **read it, don't build inside it, don't `npm install`/build/run it.**

Your actual deliverable is a **new, separate prototype** — a CLI tool, a Slack bot, a small web
UI, whatever interface fits what you're building. `starter/lgtm-client.js` is your actual
starting point: a tested, working connection to the shared observability stack. Build from
there, in your own new project structure, in whatever language/framework you want.

**Every time you're about to write code, ask first: "would this exact feature exist in a
normal SaaS product?"** If yes — a settings toggle, a CRUD form, a "Generate Report" button a
human has to click — stop. You're rebuilding SaaS with different branding, not prototyping
what this product looks like if an AI agent runs it.

## AI-native, not AI-enabled — a pass/fail gate, checked before anything else

There are three shapes your build could end up as. Only one of them is what's being judged:

- **SaaS** — a normal human-driven product. No AI at all. Not what you're building.
- **AI-enabled** — a SaaS product with an AI feature bolted on top (a chatbot, a summarizer, a
  "smart" button). The AI is decoration on a fundamentally deterministic app.
- **AI-native** — the AI's own reasoning *is* the mechanism the product runs on. This is the
  only shape that passes.

**The test — apply it to whatever you just built**: delete every AI/LLM call from it in your
head. Does the product still basically work, just a bit dumber? **That's AI-enabled — it
fails the gate**, no matter how good the 6 traits below score individually. Does the product
have nothing left — no detection, no RCA, no resolution, nothing? **That's AI-native.** The
reasoning has to be load-bearing, not a feature.

This is checked *before* the trait scoring below, as pass/fail — a beautifully-scored
AI-enabled build still fails here.

## The 6 traits you're actually being scored on

Not vibes — each one is a specific, checkable behavior:

| Trait | What it looks like | What it does NOT look like |
|---|---|---|
| **Observability** | Real, live visibility into what's actually happening in the target system | Occasional summaries with no real view underneath |
| **Agency** | The agent notices something and proposes/acts on its own initiative | A feature that only runs when a human clicks a button to trigger it |
| **Auditability** | Every claim the agent makes cites the actual metric/log/trace behind it | "Something looks wrong" with no evidence attached |
| **Malleability** | The agent adapts its own reasoning/proposed actions based on new info | A fixed if/else decision tree that can't be reasoned with |
| **Progressive disclosure** | Leads with a 2-3 line headline, detail available on demand | A wall of raw data dumped on the user up front |
| **Ownership** | Concrete, ordered next steps tied to *this specific* incident — and if the fix is a code change, a real PR opened on your onboarded repo, not just a written suggestion | A generic runbook restated regardless of what actually broke |

**One hard rule, not a suggestion**: self-correction/malleability applies to the agent's
reasoning and its proposed actions on the *target system* — never to its own observability
pipeline. An agent that "fixes" a problem by disabling the collector, muting an alert it
doesn't like, or rerouting its own telemetry so nothing looks wrong isn't self-correcting,
it's blinding itself. Instant fail on that trait, not a clever workaround.

## What to actually look at in `reference/sreoncall/` (for patterns, not to run)

- `packages/api/src/services/agent-orchestrator.service.ts` — how an agent builds context,
  reasons over it via tool-use, and gates high-risk actions behind approval. The correct
  *shape* for "the agent acts" — borrow the pattern, not the running service.
- `packages/api/src/mcp/tools.ts` — the `propose_ticket` / `propose_change` / `propose_runbook`
  / `propose_alert_rule` / `propose_oncall_override` tools. Notice they never write live —
  they draft a proposal a human approves. That draft-then-approve shape is what "ownership
  without recklessness" looks like.
- `packages/api/src/services/lgtm-query.service.ts` — the real query shapes/signatures this
  platform uses against Mimir/Loki/Tempo. `starter/lgtm-client.js` is a minimal reimplementation
  of the same idea in plain Node, already working — use it directly, or port the pattern to
  whatever language you're building in.

## What NOT to imitate the shape of

Any `*.routes.ts` file that's a standard REST CRUD controller (list/create/update/delete) —
e.g. `tickets.routes.ts`, `alert-rules.routes.ts`. These exist because a human-driven SaaS
needs them. Nothing about your new prototype should look like "one more REST endpoint a human
calls from a button."

## The actual test before you commit to a design

1. **Does a human have to initiate this?** If yes — could your agent have noticed and proposed
   it first instead, with the human only approving/editing?
2. **Can you point at the exact evidence** (a metric name, a log line, a trace span) behind
   every claim your output makes?
3. **If a judge saw the raw evidence instead of your summary, would the summary still be
   defensible** — or is it hand-waving dressed as insight?
4. **Did you just build a nicer dashboard, or something that acts?**

If you can't answer all four cleanly, you're probably rebuilding SaaS with a chat window
bolted on, not building AI-native.
