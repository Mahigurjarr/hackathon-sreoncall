# How LGTM and your SREonCall talk to each other

**The connection, in one sentence**: your SREonCall prototype makes read-only HTTP requests to
LGTM's 3 query endpoints (metrics/logs/traces), each request carrying one header
(`X-Scope-OrgID: hackathon`) — that single mechanism is the entire relationship between the
two systems. Nothing else connects them.

## What LGTM actually is — 3 components, not a black box

| Component | Watches | Your prototype queries it via |
|---|---|---|
| `Mimir` | Metrics | `http://10.10.1.139:9009` |
| `Loki` | Logs | `http://10.10.1.139:3100` |
| `Tempo` | Traces | `http://10.10.1.139:3200` |

That's the whole component list. No internals to learn beyond this — exact request commands
are in `02-connecting-to-lgtm.md`.

## The two connections in this picture

```
   Target app                          LGTM
 10.10.1.141              1:      10.10.1.139
 already running    ───OTLP export──▶  Mimir + Loki + Tempo
 real traffic          (not your                 │
                        concern)                  │ 2: read-only query
                                                   │    X-Scope-OrgID: hackathon
                                    ┌──────────────┼──────────────┐
                                    ▼                              ▼
                             Your SREonCall               Another team's SREonCall
                             (this laptop)                (their laptop)
```

1. **Target app → LGTM** — already built, already running, exports automatically. Not
   something you touch or need to understand internally.
2. **LGTM → your SREonCall** — this is the connection *you* build: a query, not a subscription
   or a push. Your prototype asks; LGTM answers. Nothing flows the other way.

- **Production LGTM** (`10.10.1.21`) — the real platform's real customer telemetry. You never
  touch this.
- **Hackathon LGTM** (`10.10.1.139`) — built fresh for this event, isolated, short retention,
  torn down afterward. This is the one your `.env` points at.

**One source, many readers.** Every team's SREonCall reads from the same shared pool
independently — nobody's query affects anybody else's, and nobody needs their own copy of
anything centrally hosted. How to actually write the connection code is in
`02-connecting-to-lgtm.md`.
