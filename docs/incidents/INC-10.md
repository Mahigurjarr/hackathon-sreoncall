Load-generator: span-to-metric error-slice missing while traces show errors — confidence: high

Summary
- What broke: The span-to-metric pipeline did not emit the error-status slice for load-generator, even though Tempo traces contained error spans and the span-metrics total-call series for the service was present.
- What changed here: Added a precise alert-rule to surface this mismatch and a runbook to triage/restore the span→metric mapping for load-generator.

Key evidence
- Tempo search matched multiple error traces involving load-generator ([E412]).
- A concrete trace (ed62681e94c476fa0f7c2a5c897357fa) shows a real exception on the path load-generator → frontend → product-catalog; spans carry status=ERROR and exception events ([E414]).
- Prometheus query for the error-status span-metrics series for load-generator returned no series (absent ≠ zero) ([E407]).
- The total-call span-metrics series for load-generator was present and non-empty ([E415]).
- Error-status series existed for other services, indicating the issue is isolated to load-generator rather than a global outage of span-metrics ([E413]).

Mechanism and scope
- Mechanism: selective failure in the span→metric aggregation for load-generator’s error-status slice; total-call slice still emitted.
- Scope: isolated to load-generator; other services have error slices, corroborated by [E413].

Next steps
1. Coordinate with operators on the productCatalogFailure feature flag seen in the trace if that behaviour is unintended (flag-layer action; out of scope for this repo) ([E414]).
2. Triage the span→metric path for load-generator: verify status_code mapping and label usage (service_name vs. resource.service.name) and remove any filter blocking STATUS_CODE_ERROR for this service. Use the runbook added in this PR to validate restoration ([E407], [E415], [E412]).

Out of scope / not fixed by this PR
- No live system changes (collector/flag) are performed here.
- No suppression of existing alerts; this PR only adds a more precise signal and guidance.
