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

const { queryMetric, SERVICES } = require("./client");

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
    ["mimir", () => queryMetric("vector(1)")],
  ];

  await Promise.all(
    probes.map(async ([name, fn]) => {
      const startedAt = Date.now();
      try {
        await fn();
        checks[name] = { up: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        checks[name] = { up: false, latencyMs: Date.now() - startedAt, error: err.message };
      }
    })
  );

  return checks;
}

module.exports = { probeFleet, probeStack, CALLS, ERRORS };
