"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessSentinel, assessHealth, withTimeout } = require("../src/lgtm/health");

const NOW = Date.parse("2026-08-09T14:00:00.000Z");
const healthyChecks = {
  mimir: { up: true },
  loki: { up: true },
  tempo: { up: true },
};

test("recent successful sentinel state is ready", () => {
  const state = {
    sentinel: {
      status: "healthy",
      startedAt: "2026-08-09T13:55:00.000Z",
      lastAttemptAt: "2026-08-09T13:59:30.000Z",
      lastSuccessAt: "2026-08-09T13:59:50.000Z",
    },
  };

  const result = assessHealth(healthyChecks, state, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.backendsUp, true);
  assert.equal(result.sentinel.up, true);
  assert.equal(result.sentinel.ageMs, 10_000);
});

test("one unavailable telemetry backend makes overall readiness fail", () => {
  const checks = { ...healthyChecks, loki: { up: false, error: "unreachable" } };
  const state = {
    sentinel: {
      status: "healthy",
      startedAt: "2026-08-09T13:55:00.000Z",
      lastSuccessAt: "2026-08-09T13:59:50.000Z",
    },
  };

  const result = assessHealth(checks, state, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.backendsUp, false);
  assert.equal(result.sentinel.up, true);
});

test("a degraded sentinel reports its last failure even when telemetry is reachable", () => {
  const state = {
    sentinel: {
      status: "degraded",
      startedAt: "2026-08-09T13:55:00.000Z",
      lastSuccessAt: "2026-08-09T13:59:30.000Z",
      lastFailureAt: "2026-08-09T13:59:55.000Z",
      lastError: { code: "credit_balance_exhausted", message: "model unavailable" },
    },
  };

  const result = assessHealth(healthyChecks, state, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.sentinel.up, false);
  assert.equal(result.sentinel.error.code, "credit_balance_exhausted");
});

test("a stale success is not ready", () => {
  const state = {
    sentinel: {
      status: "healthy",
      startedAt: "2026-08-09T13:00:00.000Z",
      lastSuccessAt: "2026-08-09T13:40:00.000Z",
    },
  };

  const result = assessSentinel(state, NOW, 5 * 60 * 1000);
  assert.equal(result.up, false);
  assert.equal(result.ageMs, 20 * 60 * 1000);
});

test("a new process must complete its own sweep before becoming ready", () => {
  const state = {
    lastSweep: "2026-08-09T13:59:55.000Z",
    sentinel: {
      status: "running",
      startedAt: "2026-08-09T13:59:58.000Z",
      lastSuccessAt: "2026-08-09T13:59:55.000Z",
    },
  };

  assert.equal(assessSentinel(state, NOW).up, false);
});

test("legacy state remains readable during migration", () => {
  const state = { lastSweep: "2026-08-09T13:59:50.000Z" };
  const result = assessSentinel(state, NOW);

  assert.equal(result.up, true);
  assert.equal(result.status, "legacy");
});

test("backend health probes fail fast instead of hanging readiness", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), "tempo", 5),
    /tempo health probe timed out after 5ms/,
  );
});
