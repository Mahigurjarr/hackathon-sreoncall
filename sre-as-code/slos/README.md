# SLOs

## Schema

```yaml
name: <slug>
service: <one of the known service names>
sli_query_good: <PromQL for the "good events" count/rate>
sli_query_total: <PromQL for the "total events" count/rate>
objective_pct: <target percentage, e.g. 99.5>
rationale: >
  Why this SLI and this target for this service — reference service_criticality
  (docs/TELEMETRY.md) or other real signal, not a round number picked for looking tidy.
```

## `objective_pct` is a target, not a live anomaly threshold — and that distinction is load-bearing

It is tempting to read `objective_pct` as "alert when the live SLI crosses this number" and
wire it into an `if (sli < objective_pct)` somewhere. Don't — that would smuggle exactly the
kind of static threshold `CONTRACTS.md` bans back into the system, just relabeled as an SLO
instead of an alert rule.

`objective_pct` is a **standing commitment** the business has made for this service ("we're
targeting 99.5% availability this quarter"), used for framing — burn-rate context in a
postmortem, "did we spend our error budget," business-impact language keyed off
`service_criticality`. Whether *this specific incident* is worth raising is still the
investigating agent's live judgement from evidence (current reading vs. its own recent
baseline, corroborating logs/traces), exactly as in `alert-rules/`. The SLO number answers "is
this an ongoing pattern we should be worried about over the quarter," a different question
from "is what I'm seeing right now, in this trace/log/metric, a real incident" — conflating
the two by wiring the target into a comparison is the mistake this file's schema is written to
avoid.

See `product-catalog-availability.yaml` for a worked example.
