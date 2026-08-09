# Runbooks

A runbook is written for an agent to execute against live evidence, not for a human to
read off a wiki page while paged. Its `steps` are query/action instructions ("pull X, check
Y, correlate against Z"), not a pre-written conclusion — the actual conclusion for any given
incident comes from what those queries return at the time, cited through the evidence ledger.

## Schema

```yaml
title: <short, human-readable name>
service: <one of the known service names>
trigger_description: >
  What situation this runbook is for — described in terms of a *judgement* the agent makes
  ("errors judged anomalous against baseline"), never a hardcoded number.
steps:
  - <one investigative or remediation action per item, specific to this service's real
    telemetry surface (see docs/TELEMETRY.md) — not a generic "check the logs">
```

## Why this isn't just a written suggestion

The `ownership` trait this scaffolding supports means concrete, ordered next steps tied to
*this specific* incident — restating a generic runbook regardless of what actually broke is
exactly what this format is meant to avoid. A runbook here should still force the agent to go
gather fresh evidence for the incident at hand (a runbook step that just says "conclude X" is
a smell); if the last step of a runbook is a code change, the agent opens a real PR
(`src/actions/github.js` / `openFixPR`) rather than describing the fix in prose.

See `product-catalog-errors.yaml` for a worked example.
