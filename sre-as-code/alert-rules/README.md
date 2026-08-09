# Alert rules

An alert rule names **where to look** and **why that place matters**. It does not name a
number to cross. Whether today's reading at that spot is actually anomalous is a judgement
the investigating agent makes at query time — from the live value, its own recent baseline,
and correlated logs/traces — never a static comparison baked into this file.

This is deliberate, not an oversight: `CONTRACTS.md`'s one hard rule for this whole system is
"no threshold constant anywhere in `src/`" (no `if (errorRate > 0.05)`), because anomaly
judgement belongs to the model, never to code. An alert-rules file with a numeric threshold
field would just relocate that same violation from `src/` into YAML. So the schema below has
no threshold field at all — not `warn_at`, not `critical_above`, nothing.

## Schema

```yaml
name: <slug — unique, human-readable>
service: <one of the known service names, e.g. product-catalog>
signal:
  type: promql | logql       # which query language `query` below is written in
  query: <the literal PromQL or LogQL string, run as-is against Mimir/Loki>
rationale: >
  Why this particular signal is the right place to watch for this service — what it would
  mean if the agent, reasoning over a live reading of it plus surrounding context, judged it
  anomalous. Reference docs/TELEMETRY.md's verified query vocabulary and traps (absent ≠
  zero, ratio vs. rate, etc.) rather than re-deriving them here.
```

## How this gets used

A rule here is read by the investigating agent as "worth running `signal.query` and reasoning
about the result," not evaluated by any comparison operator. The agent decides for itself,
from the evidence it gathers when the rule fires its attention, whether the current reading
is a real problem — and it can and should explain that reasoning with citations
(`[E#]` against the evidence ledger), the same way it would for a signal nobody wrote a rule
for at all. A rule like this typically lands as part of a draft-then-approve proposal (see
`src/actions/proposals.js`'s shape) rather than being hand-edited — a human or agent proposes
the file, a human approves the PR.

See `product-catalog-error-rate.yaml` for a worked example, built on the absent-safe error-rate
query verified live against this stack in `docs/TELEMETRY.md`.
