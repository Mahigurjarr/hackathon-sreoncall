# CONTRACTS — frozen module interfaces

Parallel build. Every agent codes against these signatures **exactly**. Do not change a
signature; if one is wrong, say so instead of silently diverging — another agent is importing it.

Runtime: Node 24, CommonJS (`require`/`module.exports`), **zero npm dependencies**.

## The one rule that overrides everything

**No threshold constant anywhere in `src/`.** No `if (errorRate > 0.05)`, no
`SPIKE_FACTOR = 3`, no `if (count >= 10)`. Anomaly judgement is the model's, never the code's.
A judge greps for this. Comparisons for pagination/array bounds/retry counts are fine —
comparisons that decide *"is this a problem"* are not.

**Never read `10.10.1.141:4001`** (the fault-flag API) from `src/`. That would be
pattern-matching, not diagnosing. Operator test scripts only.

---

## `src/lgtm/client.js`

GET-only by construction — there is no write path, so the agent cannot blind itself.

```js
queryMetric(promql)                    -> Promise<object>   // Mimir instant query
queryMetricRange(promql, minutes)      -> Promise<object>   // Mimir range query
listMetricNames()                      -> Promise<object>
queryLogs(logql, sinceMinutes = 10)    -> Promise<object>   // Loki
searchTraces(tagFilter, limit = 5)     -> Promise<object>   // Tempo tag search
searchTracesQL(traceql, limit = 5)     -> Promise<object>   // Tempo TraceQL, e.g. '{status=error}'
getTrace(traceId)                      -> Promise<object>   // Tempo single trace
normalizeService(name)                 -> string            // strips 'opentelemetry-demo/' prefix
lokiService(name)                      -> string            // adds it back for LogQL
SERVICES                               -> string[]          // the 18 known service names
```

**Loki/Mimir name mismatch is real:** Loki `service_name` is `opentelemetry-demo/cart`,
Mimir `service_name` is `cart`. Always normalize at the boundary.

## `src/evidence/ledger.js`

Every query in the system routes through here. Citations are not retrofittable — if a query
bypasses the ledger, its result can never be cited.

```js
new Ledger(store)
ledger.record({ kind, query, target, raw, summary }) -> { id: 'E7', ... }   // kind: metric|log|trace
ledger.get(id)                                       -> entry | null
ledger.all()                                         -> entry[]
ledger.cited(text)                                   -> string[]            // ['E7','E9'] found in text
ledger.validate(text)                                -> { ok, unresolved[] } // every [E#] must exist
```

## `src/store/state.js`

Single JSON file at `store/state.json`. Read-modify-write, no db.

```js
load()                    -> state
save(state)               -> void
update(fn)                -> state          // fn(state) mutates, then persists
newIncident(fields)       -> incident       // { id:'INC-1', status:'open', evidence:[], revisions:[] }
```

State shape:
```js
{ incidents: [], evidence: [], installs: [], traces: [], lastSweep: null }
```

## `src/llm/client.js`

The single choke point for every model call. **Nothing else in `src/` may call the API directly.**

```js
chat({ model, system, messages, tools, toolChoice }) -> { text, toolCalls[], raw }
runToolLoop({ model, system, messages, tools, handlers, maxTurns, onStep })
                                                     -> { text, steps[] }
MODELS -> { fast: 'gpt-5-mini', deep: 'gpt-5' }
```

`handlers` maps tool name -> `async (args) => result`. `onStep(step)` fires per turn so the
reasoning trace can be persisted for auditability.

**Mock mode** — set `SRE_LLM_MODE`:
- `live` (default) — real API
- `record` — real API, writes each exchange to `fixtures/llm/<hash>.json`
- `replay` — no network, reads fixtures. **Use this while credits are exhausted.**

A replay miss throws loudly rather than returning a plausible-looking stub. Silent stubs would
let a broken reasoning loop look like it works.

---

## File ownership — do not write outside your lane

| Lane | Owns | Imports (never edits) |
|---|---|---|
| Spine | `src/lgtm/` `src/evidence/` `src/store/` `src/llm/` | — |
| A · Investigator | `src/investigator/` | spine |
| B · Capabilities | `src/capabilities/` | spine |
| C · Actions/PR | `src/actions/` | spine |
| D · CLI + Web | `bin/sre` `src/web/` | spine, reads state only |

Phase 3 (`src/sentinel/`) is built after A lands, by the integrator.

---

## `src/web/server.js` — read-only JSON API for the web dashboard (built)

Zero npm dependencies, `node:http` only, matching the rest of `src/`. No judgement logic —
pure passthrough of `store/state.json`, the same data `bin/sre` reads, so the CLI and the web
UI can never disagree about what the backend found.

```
GET /api/state              -> { incidents, evidence, installs, emergingRisks, lastSweep, services }
GET /api/evidence/:id       -> one ledger entry (404 if it doesn't resolve)
GET /api/health             -> { ok: true, at }
```

Serves `web/dist` directly if it's been built (`npm run build` in `web/`); otherwise run
`web/`'s own dev server (`npm run dev`), which proxies `/api` to this server. Full detail in
`web/README.md`. This is a scoped, deliberate exception to the backend's zero-dependency rule —
`web/` is its own npm project, `src/` stays dependency-free.
