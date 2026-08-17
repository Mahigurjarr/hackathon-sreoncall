# SREonCall — team-3 submission

Repo: https://github.com/Mahigurjarr/hackathon-sreoncall

## Team + members

**team-3** — Mahi Singh, Kashish Jain, Rishabh (Alyssum). *(pulled from commit history —
flag if anyone's missing or should be spelled differently before this goes out)*

## One-line pitch

An SRE agent that watches a live microservices fleet unprompted, writes a cited root-cause
analysis for anything it judges anomalous, decides for itself whether a repo fix is warranted,
and opens a real PR only after a human approves — with every claim traceable to the exact
metric, log, or trace call behind it.

## Interface we built

**Both a CLI (`bin/sre`) and a web dashboard (`web/` — React, served at `:8420`)** — deliberately
reading the identical backend state so the two can never disagree about what happened.

| Interface | Ladder rungs it carries |
|---|---|
| **CLI** (`sre status/list/why/evidence/timeline`) | **Auditability** (`evidence <id>` prints the literal query + raw response) and **Progressive disclosure** (headline → why → evidence, nothing dumped by default) |
| **Web dashboard** | All six, visibly: **Observability** (per-service health probe, independent of the incident list — `silent` shown distinctly from `reporting`); **Agency** (the daemon's own unprompted sweeps drive the UI, not a refresh button); **Auditability** (every `[E#]` in any RCA/reasoning/PR body is a clickable chip to the raw query+response); **Malleability** (the hypothesis trail — `NEW → DISCONFIRMED → REVISED → CONFIRMED` — rendered per incident, not just claimed); **Progressive disclosure** (four fixed layers: headline → intent → analysis → raw; no unbounded list ever renders inline — 778 emerging risks became one line + a drawer); **Ownership** (the Ownership tab *is* the default tab — draft → approve/push-back/reject → real PR, plus a redemption check against fresh evidence before anything is marked resolved) |

## Architecture

- **`src/sentinel/daemon.js`** — an unbounded `for(;;)` sweep loop, no human trigger. Per
  anomaly: `memory/recall.js` (reuse/related/novel by *mechanism*, not incident name) →
  `investigator/loop.js` (cited RCA, hypothesis-driven) → `actions/remediation.js`
  (`propose_fix` or `no_code_fix` — declining is a first-class outcome) → `proposals.js`
  (draft → human approve → `github.js` opens the PR).
- **`src/evidence/ledger.js`** — every `[E#]` is assigned *at query time*, never attached to
  prose after the fact, so a claim can only cite evidence that already exists. An invented
  citation gets exactly one bounded repair attempt, then is re-validated, not trusted.
- **No threshold constant decides anomaly status anywhere.** `grep -rnE "[><]=? *0?\.[0-9]" src/sentinel/ src/investigator/ src/actions/` returns nothing. The constants that do exist
  (`RISK_ESCALATION_COUNT`, `MAX_CANDIDATES`) govern *how much history to weigh*, never *is this
  a problem* — that stays a live model judgement every sweep.
- **Two containers, one shared state file** (`store/state.json`/SQLite via `node:sqlite`, still
  zero npm dependencies in `src/`) — `api` serves the read-only JSON + dashboard, `sentinel`
  runs the daemon; a cross-process lockfile guards every read-modify-write so a sweep can't
  clobber a human's approval mid-write.
- **A third entry point** (`src/mcp/server.js`) exposes the same read tools and the same
  draft-then-approve proposal machinery over MCP stdio — **no** approve tool, **no** apply
  tool, **no** write path — so any model client can query this fleet's evidence and draft a
  gated fix without ever being able to push it live itself.

**Key tool definitions** (all gated through `src/llm/client.js`, the single choke point for
every model call — delete that file and detection, RCA, remediation, and summarization all
stop existing rather than degrading):
`query_metrics` / `query_logs` / `search_traces` / `get_trace` / `compare_baseline` (investigator's
senses) → `propose_fix` / `no_code_fix` (remediation's only two outcomes, no third path) →
`approve` / `push_back` / `reject` (the only human-facing verbs; push-back re-authors the fix
from the objection rather than editing it as a form).

## What's NOT production-ready yet

Being specific rather than modest about it — pulled straight from our own judging self-check
(`docs/08-judging.md`), dated against the actual running system, not the design:

- **The newest reasoning-quality layer has zero live data.** `policy.js` checks whether a
  `CONFIRMED` hypothesis was *earned* rather than just declared (and caps an unearned one at
  medium confidence) — wired, exported, covered by 7 unit tests, but stored on **0 of 11** live
  incidents, because it landed after those incidents opened and no new one has fired since (the
  daemon correctly won't open a second incident for a service already being tracked).
- **The cross-incident learning loop has never actually fired.** A human correction (reject or
  push-back) is supposed to become a durable lesson in `sre-as-code/practices/learned-lessons.md`,
  loaded into every future prompt — but nobody has rejected or pushed back on a draft yet, so
  that file doesn't exist. Six drafts are sitting in review right now; one push-back would prove
  it end to end.
- **No MCP client has driven a `propose_*` call in production.** The surface is real and its
  refusals are tested (out-of-scope path, invented citation) — but every one of the 8 live
  proposals so far came from the daemon's own path, not an external MCP caller.
- **6 of 8 redemption (verification) checks came back `unresolved`, not confirmed.** That's the
  system correctly refusing to claim a recovery it can't evidence — but it means only 2 of 8
  attempted fixes have actually closed the loop end-to-end.
- **Custom, user-composed dashboards were asked for and not built.** The honest reason to not
  just bolt on a drag-and-drop builder: that would be rebuilding a SaaS feature with an AI label
  on it. The AI-native version — a user states an intent in prose and the *agent* picks the
  queries and chart forms itself, citing why — is scoped but not started.
- **GitHub token needs rotation.** The current one is a classic PAT with far broader scope
  (`admin:org`, `delete_repo`) than this app needs. Should be a fine-grained token scoped to
  just this repo's Contents + Pull requests before this goes anywhere near production.

## One thing the real SREonCall product should borrow

**The redemption check — verifying a fix against fresh evidence before ever marking anything
resolved, and refusing to self-credit when the evidence doesn't support it.** The most
convincing line our system ever produced wasn't a detection or a PR — it was a refusal:

> *"frontend-proxy p95 latency has dropped below its recent baseline, but the improvement
> coincides with a large drop in request rate, so we cannot confirm recovery."*

An agent that marked that resolved would have looked better in a demo and been wrong. Only a
`confirmed` verification check is allowed to set `status: "resolved"` anywhere in the codebase
— no other code path can. For a real on-call product, an agent that occasionally says "I can't
confirm this actually worked" is worth more than one that always sounds sure. Close second:
self-installing capability monitors decided per-service from live-discovered characteristics
(runtime, DB presence, log availability) rather than a lookup table — the reference platform's
own 12 agent definitions currently only ever get installed via a manual API call, and this is
the missing "decide it's relevant, turn it on" step.

---

*Everything above is drawn from the running system, dated 09 Aug 2026 in `docs/08-judging.md` —
re-verify against a live sweep before quoting a number publicly if more time has passed.*
