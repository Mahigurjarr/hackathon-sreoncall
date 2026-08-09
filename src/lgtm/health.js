// Live health of the fleet, independent of whether an incident exists.
//
// Why this is separate from the incident list: the dashboard previously derived a service's
// dot from "does it have an open incident?", which silently equates *not investigated* with
// *healthy*. A service that stopped emitting telemetry entirely — arguably the worst state it
// can be in — rendered identically to one running perfectly. That is a monitoring tool lying
// by omission.
//
// What this reports is deliberately FACTS, not judgements:
//   silent    — the service returned no series at all: it is not emitting
//   erroring  — its error rate is above zero
//   reporting — it has traffic and no errors right now
//
// There is no threshold anywhere in this file, and there must never be one. "Errors > 0" is
// an observation; whether a given error rate constitutes an incident stays the investigating
// agent's live judgement against a baseline (CONTRACTS.md, and sre-as-code/practices/
// incident-response.md). This module answers "what is true right now", not "is that bad".
//
// Two queries cover the whole fleet — grouped by service_name rather than one request per
// service, so probing 18 services costs the same as probing one.

"use strict";

const { queryMetric, queryLogs, searchTracesQL, SERVICES } = require("./client");

const SENTINEL_FRESH_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = Number(process.env.SRE_HEALTH_PROBE_TIMEOUT_MS) || 5000;
const LOKI_HEALTH_QUERY = '{service_name=~"opentelemetry-demo/.+"}';
const TEMPO_HEALTH_QUERY = "{status=error}";

// The span-derived metric family is used because it is the one every service in this fleet
// emits; a family with partial coverage would report "silent" for services that are actually
// fine but simply don't publish it (sre-as-code/practices, signal selection).
const CALLS = "sum by (service_name) (rate(traces_span_metrics_calls_total[5m]))";
const ERRORS =
  'sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m]))';

function toMap(result) {
  const map = new Map();
  for (const series of result?.data?.result || []) {
    const name = series.metric?.service_name;
    const value = Number(series.value?.[1]);
    if (name && Number.isFinite(value)) map.set(name, value);
  }
  return map;
}

/**
 * Probes every known service once. Returns
 * `{ at, reachable, error, services: [{ service, status, callRate, errorRate, errorRatio }] }`.
 *
 * If the metrics backend itself is unreachable, `reachable` is false and every service is
 * reported as `unknown` — never as healthy. An observability tool that renders green when it
 * cannot see is worse than one that renders nothing, and this is the one failure mode most
 * likely to go unnoticed.
 */
async function probeFleet() {
  const at = new Date().toISOString();

  let calls;
  let errors;
  try {
    [calls, errors] = await Promise.all([queryMetric(CALLS), queryMetric(ERRORS)]);
  } catch (err) {
    return {
      at,
      reachable: false,
      error: err.message,
      services: SERVICES.map((service) => ({ service, status: "unknown" })),
    };
  }

  const callMap = toMap(calls);
  const errorMap = toMap(errors);

  const services = SERVICES.map((service) => {
    const callRate = callMap.get(service);
    const errorRate = errorMap.get(service) || 0;

    // No series at all is a different fact from a rate of zero — the first means the service
    // isn't reporting, the second means it reported no traffic. Only the former is "silent".
    if (callRate === undefined) {
      return { service, status: "silent", callRate: null, errorRate: null, errorRatio: null };
    }

    return {
      service,
      status: errorRate > 0 ? "erroring" : "reporting",
      callRate,
      errorRate,
      errorRatio: callRate > 0 ? errorRate / callRate : 0,
    };
  });

  return { at, reachable: true, services };
}

/**
 * Reachability of each backend the agent depends on for its senses, plus the fleet probe.
 * Used by the dashboard's own status line: if Mimir is down, the agent is blind, and the UI
 * must say so rather than showing a quiet all-clear.
 */
async function probeStack() {
  const checks = {};
  const probes = [
    ["mimir", async () => {
      const raw = await queryMetric("vector(1)");
      return { series: raw?.data?.result?.length || 0 };
    }],
    ["loki", async () => {
      const raw = await queryLogs(LOKI_HEALTH_QUERY, 1);
      const streams = raw?.data?.result || [];
      let lines = 0;
      let newestNs = null;
      for (const stream of streams) {
        for (const value of stream.values || []) {
          lines += 1;
          try {
            if (!newestNs || BigInt(value[0]) > BigInt(newestNs)) newestNs = value[0];
          } catch {
            // A malformed timestamp should not turn a successful Loki response into downtime.
          }
        }
      }
      const newestAt = newestNs
        ? new Date(Number(BigInt(newestNs) / 1000000n)).toISOString()
        : null;
      return { streams: streams.length, lines, newestAt };
    }],
    ["tempo", async () => {
      const raw = await searchTracesQL(TEMPO_HEALTH_QUERY, 1);
      return { traces: raw?.traces?.length || 0 };
    }],
  ];

  await Promise.all(
    probes.map(async ([name, fn]) => {
      const startedAt = Date.now();
      try {
        const details = await withTimeout(fn(), name, PROBE_TIMEOUT_MS);
        checks[name] = { up: true, latencyMs: Date.now() - startedAt, ...details };
      } catch (err) {
        checks[name] = { up: false, latencyMs: Date.now() - startedAt, error: err.message };
      }
    })
  );

  return checks;
}

function withTimeout(promise, name, timeoutMs) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${name} health probe timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

function assessSentinel(state, now = Date.now(), staleMs = SENTINEL_FRESH_MS) {
  const runtime = state?.sentinel || {};
  const lastSuccessAt = runtime.lastSuccessAt || state?.lastSweep || null;
  const successMs = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
  const startedMs = runtime.startedAt ? new Date(runtime.startedAt).getTime() : NaN;
  const ageMs = Number.isFinite(successMs) ? Math.max(0, now - successMs) : null;
  const fresh = ageMs !== null && ageMs <= staleMs;
  const succeededThisRun = !Number.isFinite(startedMs) || (Number.isFinite(successMs) && successMs >= startedMs);
  const status = runtime.status || (lastSuccessAt ? "legacy" : "not_started");
  const up = fresh && succeededThisRun && status !== "degraded" && status !== "starting";

  return {
    up,
    status,
    startedAt: runtime.startedAt || null,
    lastAttemptAt: runtime.lastAttemptAt || null,
    lastSuccessAt,
    lastFailureAt: runtime.lastFailureAt || null,
    ageMs,
    error: runtime.lastError || null,
  };
}

function assessHealth(checks, state, now = Date.now(), staleMs = SENTINEL_FRESH_MS) {
  const backendsUp = Object.keys(checks).length > 0 && Object.values(checks).every((check) => check.up);
  const sentinel = assessSentinel(state, now, staleMs);
  return { ok: backendsUp && sentinel.up, backendsUp, sentinel };
}

module.exports = {
  probeFleet,
  probeStack,
  assessSentinel,
  assessHealth,
  CALLS,
  ERRORS,
  LOKI_HEALTH_QUERY,
  TEMPO_HEALTH_QUERY,
  SENTINEL_FRESH_MS,
  PROBE_TIMEOUT_MS,
  withTimeout,
};
