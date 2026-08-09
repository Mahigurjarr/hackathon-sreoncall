# Handoff — state as of 2026-08-09

Written so a fresh session can pick this up without re-deriving anything. Read this, then
`CLAUDE.md` (the rules), then the skills in `.claude/skills/`.

## Status right now — read this first

- **Everything is committed and pushed.** `main` is at `310c4a5`, remote in sync.
  - `9306599` — ownership + self-learning wired in, console redesign, container split
  - `fade870` — malleability policy layer, concurrent detection fan-out, citation repair
  - `310c4a5` — MCP server, the committed safety tests, `/api/state` payload trim
- **Run the tests before you change anything**: `npm test` (39 assertions, no deps, ~100ms).
  They encode the ownership guarantees, not just behaviour — if one fails, the agent has
  gained the ability to publish something a human never approved.
- **`store/state.json` will always show as modified.** The sentinel rewrites it every ~45s,
  so `git status` is dirty within seconds of any commit. **This is not an error and does not
  mean a push failed.** It is runtime data, not code.
- **Both containers are running** (`api`, `sentinel`), dashboard at http://localhost:8420.
- **A re-score was requested** for `team-3` after the last push. Scoring is queued, not
  instant; results appear at https://sreoncall-leaderboard.vercel.app. Re-running `/update`
  on an unchanged commit is skipped by the grader — only push, then update.

## Pushing — the one non-obvious trap

The `gh` CLI is logged in as **`kashishj-collab`, which has NO push access** to
`Mahigurjarr/hackathon-sreoncall` (verified: `permissions.push == false`). Only the PAT in
`.env` works — account **`Swiftkish`**, which does have push.

Git therefore uses a credential helper at **`.git/sre-credential-helper.sh`** that reads
`GITHUB_TOKEN` from `.env` at push time. It lives inside `.git/`, so it is never committed,
and it keeps the token out of the remote URL, out of `.git/config`, and off the command line.
`git push` just works.

**Do not** put the token back in the remote URL — it leaks through `git remote -v`, which is
how it was found and removed. **Do not** reach for `gh` to push; it will fail confusingly.

## Run it

```bash
docker compose up -d          # two services: api (:8420) + sentinel
open http://localhost:8420
docker compose logs -f sentinel
```

**Build and run everything in containers — never on the host.** `web/`'s native `rolldown`
and `oxlint` binaries are blocked by macOS Gatekeeper, so `npm run build` / `npm run lint`
fail on this machine and only work inside the Linux image.

## What this is

An AI-native SRE agent for the shared LGTM stack. It sweeps the fleet unprompted every ~45s,
investigates what it judges anomalous, writes a cited RCA, decides on its own whether a repo
change is warranted, drafts it, and waits for a human to approve — then opens a real PR.

The load-bearing claim: delete `src/llm/client.js` and there is no detection, no RCA, no
remediation, no summary. Nothing degrades to a dumber version; it stops existing.

## Architecture

```
sentinel container                          api container
  bin/sre start                               src/web/server.js  :8420
    └─ src/sentinel/daemon.js  sweepOnce()      ├─ GET  /api/state      (+ health, github, practices)
         ├─ frame.js  → live LGTM numbers       ├─ GET  /api/evidence/:id
         ├─ triage.js → model picks anomalies   ├─ GET  /api/practices
         ├─ lgtm/health.js → per-service probe  ├─ GET  /api/health     (probes Mimir)
         ├─ actions/explain.js → plain English  └─ POST /api/proposals/:id/{approve,revise,reject}
         └─ per anomaly:
              memory/recall.js   → reuse | related | novel
              investigator/loop.js → cited RCA (12 turns, or 4 if reuse)
              actions/remediation.js → propose_fix | no_code_fix
                                       └─ proposals.js draft → approve → github.js PR
```

A third entry point, not part of either container: `node src/mcp/server.js` (registered in
`.mcp.json` as `sreoncall`). It serves the same read tools and the same draft-then-approve
proposal machinery over MCP stdio, so any model client — Claude Code, the reference platform's
orchestrator, another agent — can query this fleet's evidence and draft a gated fix. It
exposes **no** approve tool, **no** apply tool and **no** write path to the fleet, and refuses
a `propose_*` call outright when a path is outside `ALLOWED_PREFIXES` or the body cites an
evidence id that does not exist. Zero deps: MCP over stdio is JSON-RPC.

`/api/state` withholds raw log/trace bodies from the wire (`trimEvidenceForWire`) and flags
them `rawAvailable` — 8.0MB → 1.3MB per poll. Nothing is deleted: the full record stays on
disk and `/api/evidence/:id` still serves it. **Only the transport is trimmed, never what the
agent can see** — `test/api-payload.test.js` exists because those two are one careless edit
apart.

Both containers share `./store/state.json` (bind mount). `src/store/state.js` takes a
cross-process lockfile around every read-modify-write — **do not remove it**, or a sweep can
silently clobber a human's approval.

`src/practices.js` reads `sre-as-code/practices/*.md` fresh on **every** reasoning step and
injects them into the prompts. Editing those markdown files changes the agent's behaviour on
the next sweep — no rebuild. That is the intended feedback loop, and it's why `sre-as-code` is
mounted read-only into both containers.

## The six traits, and where each is implemented

| Trait | Where |
|---|---|
| Observability | `src/lgtm/health.js` probes all 18 services every sweep; `silent` is reported distinctly from `reporting` |
| Agency | `src/sentinel/daemon.js` runs forever, opens incidents and drafts fixes with no human trigger |
| Auditability | `src/evidence/ledger.js` assigns `[E#]` at query time; unresolved citations surface as warnings; every `[E#]` chip opens the raw query + response |
| Malleability | Hypothesis trail (`NEW`/`DISCONFIRMED`/`REVISED`/`CONFIRMED`); "Push back" re-authors a fix from a human objection |
| Progressive disclosure | Four layers: headline → intent → analysis → raw evidence. No unbounded list renders inline |
| Ownership | `src/actions/` — draft→approve→apply, real PR on the onboarded repo |

## Skills — read before touching the matching area

In `.claude/skills/`, all validated with `skill-creator`:

| Skill | Covers |
|---|---|
| `sreoncall-ui` | Design system: palette, 5-step type scale, layout law, the five UI laws |
| `sreoncall-charts` | Chart forms, the **validated** series palette, plain-language captions |
| `sreoncall-logs` | `[lane] subject verb — detail` log format; how to render fetched telemetry |
| `sreoncall-ownership` | The proposal state machine and its five safety guarantees |
| `sreoncall-memory` | Recall: mechanism-not-name matching, reuse budget, fail-open behaviour |

Also installed (third-party): `frontend-design`, `ui-ux-pro-max`, `design-taste-frontend`,
`vercel-react-best-practices`, `vercel-react-native-skills`, `motion-framer`,
`convex-create-component`, `gsap-*` (8), `skill-creator`.

**Author the skill first, then invoke it.** Kashish asked for this explicitly — skills exist to
stop decisions drifting, not as documentation.

## Non-negotiables

1. **No write path to the target fleet.** `src/lgtm/client.js` is GET-only by construction.
2. **Never commit to `main`.** Branch → PR only; no merge or force-push function exists.
3. **Nothing reaches GitHub without `status === "approved"`.**
4. **`ALLOWED_PREFIXES` fails closed** — the agent cannot edit `src/`, `bin/`, or `.env`.
5. **Never reduce what the agent can see.** No muting, narrowing, or rerouting a signal. An
   agent that "fixes" an incident by blinding itself is an instant fail.
6. **No hardcoded thresholds, metric names, or service lists** in guardrails or practice docs.
7. **`no_code_fix` must stay possible**, with no generic-runbook fallback. Adding one converts
   this from AI-native to AI-enabled.

## Verified working

- PR **#2** on `Mahigurjarr/hackathon-sreoncall` — authored end-to-end by the agent from INC-1
  (checkout→payment DNS failure), 3 files, 7 citations.
- The agent **declined** INC-5 (`no_code_fix`) because the traced exception named a feature
  flag — an operator action, not a code bug. That discrimination is the proof the reasoning is
  real.
- Recall judged INC-10 `related` to INC-9 by mechanism, not service name.
- Health probe independently caught `otelcol-contrib` emitting nothing — corroborating INC-4.
- Killing the `sentinel` process mid-run: it auto-restarted in <15s, dashboard never dropped a
  request.

## Open items

1. **Custom dashboards (requested, not built).** Kashish wants users to build dashboards for
   their use case. **Do not build a drag-and-drop or form builder** — `CLAUDE.md` explicitly
   fails "a CRUD form a human fills in". Build the AI-native shape: the user states an intent
   in prose, the *agent* composes the panels, picking queries and chart forms itself and citing
   why.
2. **Rotate `GITHUB_TOKEN`.** The current one is a classic PAT with `admin:enterprise`,
   `delete_repo`, `admin:org` and was pasted in plaintext. Replace with a fine-grained token
   scoped to this repo (Contents + Pull requests write). `.env` is gitignored and clean.
3. **`TWENTYFIRST_API_KEY`** is unset, so the 21st.dev Magic MCP server in `.mcp.json` won't
   start. shadcn-ui MCP works via `GITHUB_PERSONAL_ACCESS_TOKEN`.
4. **Push, then run `/update`.** Scoring is not automatic and grades the last *pushed* commit.
   The board was last seen scoring an older commit — showing `Self-learning: 0` and
   `Agency: 80` ("PR machinery not wired into the running daemon path"), both since fixed.
   Team id is `team-3`; never ask for it, it's in `.hackathon-team.json` and `.env`.

5. **`store/state.json` grows without bound** — ~15MB after a day of sweeping, almost all of
   it raw log/trace bodies in the evidence ledger. The wire payload is trimmed, so the
   dashboard no longer feels it, but the file itself and the lock-protected read-modify-write
   around it still get slower. If this needs solving: archive old raw bodies out to
   `store/archive/`, keeping the ledger entries themselves intact. **Do not "fix" it by
   dropping evidence** — the citations must stay resolvable.

## Minor known issues

- A few long service names still truncate in the fleet strip when most of the fleet is
  affected — 18 cells in one row is the real constraint.
- The `sentinel` container shows `8420/tcp` in Docker Desktop despite having no server on it;
  cosmetic, inherited from the shared image's `EXPOSE`.
