# Plan — AI-Native SREonCall prototype (team-3)

## Context

We're building a **new, standalone prototype** for the AI-Native SREonCall hackathon: what
SREonCall looks like when an AI agent runs it instead of a human clicking through it. Scoring
has a pass/fail gate applied *before* any trait scoring — *delete every LLM call; if the product
still works, just dumber, it's AI-enabled and fails outright.* Then 6 traits are scored:
Observability, Agency, Auditability, Malleability, Progressive disclosure, Ownership.

Registration is done (`team-3` → `https://github.com/Mahigurjarr/hackathon-sreoncall`, active).
Nothing scores until `/update` runs against pushed `main`.

**Constraints chosen:** <8h to code freeze · vendored demo source + SRE-as-code for PRs ·
self-installing capabilities as the differentiator · local web dashboard as the interface.

### Working directory — moved

All work now happens in the **repo clone**, not the original download:

```
/Users/devopsengineer/alyssum/hackathon/hackathon-sreoncall     ← build here
/Users/devopsengineer/Downloads/hackathon-stack                 ← original zip, reference only
```

State of that clone, verified: on `main`, working tree clean, synced with `origin`
(`dcc7f3b first code push`). The **entire starter package is already committed there** —
`CLAUDE.md`, `docs/`, `starter/`, `reference/`, `.claude/` (1,146 files). `.env` is fully
populated and correctly **untracked** (the only tracked `.env*` paths are two harmless
`.env.example` templates inside `reference/`, so the OpenAI key is not exposed).

Because the repo already holds the starter, we build **in place** — new code goes into `src/`
alongside it. There is no separate "push to another repo" step. `/update` scores the diff
against the starting codebase, so the committed reference tree is neutral.

**Two setup gaps to close first (5 minutes, before Phase 1):**

1. `.hackathon-team.json` **does not exist** in the clone. Without it the SessionStart hook
   re-triggers onboarding and `/update` cannot resolve the team id. Recreate it there:
   `{"team": "team-3", "repo": "https://github.com/Mahigurjarr/hackathon-sreoncall"}`
2. **A GitHub PAT is embedded in plaintext in the clone's git remote URL** (`.git/config`).
   It is *not* published — `.git/config` is never committed — but it prints in full on any
   `git remote -v`, which is a live hazard during a screen-shared demo, and it has already
   surfaced in this session. **Rotate it**, then set the remote to the clean URL and keep the
   new token in `.env` as `GITHUB_TOKEN` (already gitignored). This also resolves the Phase 5
   dependency — see below.

### Environment — verified live, not assumed

| Fact | Value |
|---|---|
| Mimir / Loki / Tempo | reachable, `X-Scope-OrgID: hackathon`, 379 metrics / 8 streams / traces OK |
| Services in Mimir | 19 (`ad cart checkout currency email flagd frontend frontend-proxy frontend-web image-provider load-generator otelcol-contrib payment product-catalog quote recommendation shipping telemetry-docs`) |
| Golden signal | `traces_span_metrics_calls_total{service_name,span_name,span_kind,status_code}` — `status_code` ∈ `STATUS_CODE_ERROR/OK/UNSET` |
| Latency | `http_server_request_duration_seconds_bucket`, `rpc_server_duration_milliseconds_bucket` (histograms → p95/p99) |
| Resource | `jvm_*` (ad/email GC + heap), `db_client_operation_duration_seconds_*`, `kestrel_*` |
| Tempo | **TraceQL works** — `GET /api/search?q={status=error}` |
| **Loki name mismatch** | Loki `service_name` = `opentelemetry-demo/<svc>`; Mimir = `<svc>`. Must normalize. |
| **Baseline noise** | With all flags **off**, payment/recommendation/flagd sit at ~0.0042 err/s. **Static thresholds false-positive constantly.** |
| Runtime | Node v24.6.0 (built-in `fetch`), Python 3.13.7 |
| AI key | valid — `gpt-5`, `gpt-5-mini`, `gpt-5-pro` available |
| **`gh` CLI** | **NOT installed** → PRs must go through the GitHub REST API with a PAT |

The baseline-noise finding is the load-bearing design fact: thresholds are not merely
inelegant here, they are *wrong*. That is what makes reasoning-based detection the honest
engineering choice rather than a rubric-chasing one.

---

## The core design rule

> **No threshold constant exists anywhere in the codebase.**

Not "few". None. No `if (errorRate > 0.05)`. This is the single rule that makes the AI-native
gate pass, and it is **grep-checkable by a judge**. Every decision — is this anomalous, what do
I query next, is my hypothesis wrong, which monitors does this service need, what goes in the
PR — is made by the model reasoning over evidence it chose to gather.

Delete the LLM and there is no detection, no query selection, no RCA, no capability install,
no PR. Nothing remains but an HTTP client.

---

## Architecture

All paths relative to `/Users/devopsengineer/alyssum/hackathon/hackathon-sreoncall`.

```
bin/sre                      CLI entry (start | status | why <id> | evidence <id> | trace <id>)
src/
  lgtm/client.js             port of starter/lgtm-client.js + normalizeService() for the
                             Loki `opentelemetry-demo/` prefix mismatch; GET-only by construction
  evidence/ledger.js         every query → {id:'E7', kind, query, ts, rawResponse, summary}
  evidence/validator.js      rejects claims without a resolvable [E#]; blocks self-blinding acts
  sentinel/frame.js          compact situational frame: RED per service now vs 1h-ago baseline,
                             log level counts, error-trace counts. NO judgement, just numbers.
  sentinel/triage.js         gpt-5-mini: "is anything here anomalous, and what next?"  ← detection
  investigator/loop.js       gpt-5 tool-use loop: hypothesise → query → disconfirm → revise
  investigator/tools.js      query_metrics · query_logs · search_traces · get_trace · compare_baseline
  capabilities/discover.js   service inventory + characteristics straight from telemetry
  capabilities/install.js    gpt-5 decides which monitors fit each service  ← differentiator
  actions/github.js          REST PR opener (branch → contents PUT → POST /pulls). No `gh`.
  actions/proposals.js       draft-then-approve; nothing writes live
  web/server.js              node:http — serves state.json + one static file
  web/index.html             single page, no build step, polls the JSON endpoint
store/state.json             incidents · evidence ledger · capability installs · reasoning traces
services/                    vendored OTel demo source (see Phase 5)
sre-as-code/                 alert rules · runbooks · SLOs as YAML — the other PR target
```

Zero npm dependencies — Node 24 has `fetch` and `node:http`. Matches the starter's posture and
removes install risk during a timed build. Existing top-level files (`docs/`, `reference/`,
`starter/`, `CLAUDE.md`) stay untouched; `starter/lgtm-client.js` is read and ported, not edited.

### How each scored trait is earned

- **Observability** — the sentinel frame is a real, continuous, multi-signal read of all 19
  services (metrics + logs + traces), not a periodic summary.
- **Agency** — a daemon loop runs the sentinel unprompted on an interval and opens incidents on
  its own. It must be *running* during judging.
- **Auditability** — the evidence ledger. Every claim carries `[E7]`; `sre evidence E7` prints
  the exact PromQL/LogQL/TraceQL and the raw response. `validator.js` strips uncited claims
  before they can reach output, so an uncited claim is structurally impossible.
- **Malleability** — the investigator is required to state a hypothesis, run a query chosen to
  *disconfirm* it, and record the revision when contradicted. The revision history is part of
  the incident, not hidden.
- **Progressive disclosure** — headline is 2–3 lines; `why` / `evidence` / `trace` / `timeline`
  are separate on-demand views in both CLI and dashboard.
- **Ownership** — ordered next steps naming this service and this span, plus a real PR.

### Two hard guards, implemented not promised

1. **Self-blinding is impossible by construction.** `lgtm/client.js` exposes GET only; there is
   no code path to collector config, alert muting, or telemetry routing. `validator.js`
   additionally rejects any proposed action whose target matches the observability pipeline, and
   logs the rejection so the guard is *visible* rather than merely claimed.
2. **The agent never reads the flag API.** `10.10.1.141:4001` appears nowhere in `src/` — only
   in the operator-run test script. Grep-checkable. If the agent could read the flag list it
   would be pattern-matching, not diagnosing, and the judges' re-trigger test would expose it.

---

## Build order — ~7h with a 1h buffer

Commit and `/update` at the end of **every** phase, not once at the end. Only pushed `main`
scores, and `/update` is rate-limited to once per minute.

**Phase 0 · Land the plan + close the setup gaps (0:00–0:10)**
- Write this plan into the repo as `PLAN.md` (committed, so the team and the judges can see the
  intent), plus `docs/DECISIONS.md` capturing the verified environment facts above — the
  baseline-noise finding, the Loki/Mimir name mismatch, the metric surface. These are expensive
  to rediscover and are the evidence behind the no-thresholds rule.
- Append a "Working agreement" section to the repo's `CLAUDE.md` so any future session in this
  folder inherits the design rule (no threshold constants, never read the flag API, GET-only
  LGTM client) without re-deriving it.
- Recreate `.hackathon-team.json` in the clone.
- Rotate the leaked PAT, clean the remote URL, put the new token in `.env` as `GITHUB_TOKEN`.

**Phase 1 · Foundation (0:05–0:50)**
Scaffold `src/` inside the repo; port `starter/lgtm-client.js` → `src/lgtm/client.js`, adding
`normalizeService()` for the Loki/Mimir prefix mismatch and a `compare_baseline` helper (`X` now
vs `X offset 1h`). Build `evidence/ledger.js` so *every* query routes through it and gets an ID
from the first commit onward — retrofitting citations later is the classic way this fails.

**Phase 2 · Investigator (0:50–2:00)** — the heart; build before detection.
gpt-5 tool-use loop over the 5 tools. System prompt demands: state hypothesis → choose a query
that could *disconfirm* it → revise explicitly on contradiction → cite `[E#]` on every claim.
Wire `evidence/validator.js`. **Checkpoint:** with `productCatalogFailure` on, `sre why` must
name the right service and cite real evidence IDs that resolve.

**Phase 3 · Sentinel + agency (2:00–3:00)**
`frame.js` (numbers only, no judgement) + `triage.js` on gpt-5-mini for cheap wide sweeps,
escalating to the Phase-2 investigator only when the model itself says something warrants it.
Daemon loop on an interval. **Checkpoint:** toggle a flag, walk away, come back to an incident
that was opened unprompted.

**Phase 4 · Self-installing capabilities (3:00–4:00)** — the differentiator.
`discover.js` derives each service's characteristics from telemetry alone (runtime from
`process_runtime_name`, JVM presence, DB clients, span kinds). `install.js` asks gpt-5 which
monitors are warranted *for this service as discovered* and writes `AgentInstallation`-shaped
records into `state.json` with the reasoning attached. Fills the documented gap: no human
install call anywhere. Re-running after topology change must visibly change the install set.

**Phase 5 · Ownership / real PRs (4:00–5:00)**
`actions/github.js` against the REST API — create branch ref, `PUT /contents/{path}`,
`POST /pulls`, authenticating with `GITHUB_TOKEN` from Phase 0. Pre-vendor the handler files for
the four most likely targets — `product-catalog`, `cart`, `payment`, `recommendation` — into
`services/`; everything else PRs against `sre-as-code/`. PR body carries the cited RCA and links
the incident. PRs land on the same repo we're building in, which is exactly what `docs/04` §4
expects.

**Phase 6 · Dashboard (5:00–6:00)**
`node:http` serving `state.json` + one static `index.html` that polls it. Service grid coloured
by live signal, incident feed, click-through to evidence. No framework, no bundler, no build
step. **This is the drop if we run late — it is explicitly not judged.**

**Phase 7 · Adversarial rehearsal (6:00–7:00)** — do not skip; this is where builds lose points.
Run all four probes from `docs/04-testing-your-incident-flow.md` §5:
- **A** — same fault twice, diff the outputs. Byte-identical ⇒ hardcoding. Must differ.
- **B** — two different faults concurrently, no reset. Must attribute separately, not conflate.
- **C** — ask "why didn't you check X first?" Must answer from its own trace.
- **D** — flip the flag **off** mid-incident. Must notice recovery and revise, not stay stuck.

Then `/hackathon-judge`, fix what it flags, push, `/update`.

---

## Verification

Run from `/Users/devopsengineer/alyssum/hackathon/hackathon-sreoncall`:

```bash
# connectivity (already passing)
node starter/lgtm-client.js

# the gate, checkable the same way a judge would
grep -rnE '\b(0\.[0-9]+|[0-9]+)\s*(>|<|>=|<=)' src/     # expect: no threshold comparisons
grep -rn '4001' src/                                     # expect: no hits (never reads flags)

# no credential in the remote after Phase 0
git remote -v                                            # expect: clean https URL, no ghp_ token

# end-to-end
curl -X POST http://10.10.1.141:4001/toggle/productCatalogFailure/on
node bin/sre start                  # daemon; wait for unprompted detection
node bin/sre status                 # 2-3 line headline
node bin/sre why <id>               # cited RCA
node bin/sre evidence E7            # raw query + raw response behind claim E7
curl -X POST http://10.10.1.141:4001/toggle/productCatalogFailure/off   # probe D: recovery
gh_pr_check() { curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/Mahigurjarr/hackathon-sreoncall/pulls | grep '"title"'; }

# scoring
git push origin main && /update     # then watch sreoncall-leaderboard.vercel.app (~3 min)
```

**Pass bar (from `docs/04`):** every sentence in the postmortem traces to a real trace ID, log
line, or metric value we can point at.
