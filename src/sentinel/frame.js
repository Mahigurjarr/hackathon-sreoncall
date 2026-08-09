// Builds a compact, numbers-only situational frame across the fleet. This file makes no
// judgement about what any of these numbers mean — that's triage.js's job, reasoning in
// prose over exactly what's gathered here. Every query is ledgered so the frame itself is
// auditable, not just whatever gets concluded from it downstream.
//
// Bulk (fleet-wide, grouped by service_name) queries only — one round trip per signal
// instead of one per service, per the verified query vocabulary in docs/TELEMETRY.md.
// traces_span_metrics_* is used throughout because it's the only metric family all 18
// services emit; error-rate queries are absent-safe because 8 services return no series at
// all (not a zero value) when healthy.

const client = require("../lgtm/client");

const ERROR_RATE_NOW =
  'sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) ' +
  "or (sum by (service_name) (rate(traces_span_metrics_calls_total[5m])) * 0)";

const ERROR_RATE_BASELINE_1H =
  'sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m] offset 1h)) ' +
  "or (sum by (service_name) (rate(traces_span_metrics_calls_total[5m] offset 1h)) * 0)";

const TOTAL_CALL_RATE_NOW = "sum by (service_name) (rate(traces_span_metrics_calls_total[5m]))";

const P95_LATENCY_NOW =
  'histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket{span_kind="SPAN_KIND_SERVER"}[5m])))';

const RECENT_ERROR_TRACES = "{status=error}";

function vectorToMap(raw) {
  const map = {};
  for (const row of raw?.data?.result || []) {
    const svc = row.metric?.service_name;
    if (!svc) continue;
    map[svc] = Number(row.value[1]);
  }
  return map;
}

async function buildFrame(ledger) {
  const [errNowRaw, errBaseRaw, totalRaw, latencyRaw, errTracesRaw] = await Promise.all([
    client.queryMetric(ERROR_RATE_NOW),
    client.queryMetric(ERROR_RATE_BASELINE_1H),
    client.queryMetric(TOTAL_CALL_RATE_NOW),
    client.queryMetric(P95_LATENCY_NOW),
    client.searchTracesQL(RECENT_ERROR_TRACES, 50),
  ]);

  const evidenceIds = [
    ledger.record({ kind: "metric", query: ERROR_RATE_NOW, raw: errNowRaw, summary: "fleet-wide error rate, now" }).id,
    ledger.record({ kind: "metric", query: ERROR_RATE_BASELINE_1H, raw: errBaseRaw, summary: "fleet-wide error rate, 1h ago" }).id,
    ledger.record({ kind: "metric", query: TOTAL_CALL_RATE_NOW, raw: totalRaw, summary: "fleet-wide total call rate, now" }).id,
    ledger.record({ kind: "metric", query: P95_LATENCY_NOW, raw: latencyRaw, summary: "fleet-wide p95 latency (ms), now" }).id,
    ledger.record({ kind: "trace", query: RECENT_ERROR_TRACES, raw: errTracesRaw, summary: `${errTracesRaw.traces?.length || 0} recent error traces fleet-wide` }).id,
  ];

  const errNow = vectorToMap(errNowRaw);
  const errBase = vectorToMap(errBaseRaw);
  const total = vectorToMap(totalRaw);
  const latency = vectorToMap(latencyRaw);

  const errTraceCounts = {};
  for (const t of errTracesRaw.traces || []) {
    const svc = t.rootServiceName || "unknown";
    errTraceCounts[svc] = (errTraceCounts[svc] || 0) + 1;
  }

  const perService = client.SERVICES.map((service) => ({
    service,
    errorRateNow: errNow[service] ?? null,
    errorRateBaseline1h: errBase[service] ?? null,
    totalCallRateNow: total[service] ?? null,
    // null, not 0, when there's no traffic to divide by — a real "no data" fact, not a fake zero.
    errorRatioNow: total[service] ? (errNow[service] ?? 0) / total[service] : null,
    p95LatencyMs: Number.isFinite(latency[service]) ? latency[service] : null,
    recentErrorTraceCount: errTraceCounts[service] || 0,
  }));

  return { at: new Date().toISOString(), perService, evidenceIds };
}

module.exports = { buildFrame, ERROR_RATE_NOW, ERROR_RATE_BASELINE_1H, TOTAL_CALL_RATE_NOW, P95_LATENCY_NOW, RECENT_ERROR_TRACES };
