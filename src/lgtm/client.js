// GET-only client for the shared LGTM stack.
//
// Deliberately exposes no write/config path: the agent physically cannot mute an alert,
// reconfigure a collector, or reroute telemetry, because no such function exists here.
// Self-blinding is prevented by construction, not by a rule the model is asked to follow.
//
// Ported from starter/lgtm-client.js, which stays untouched.

const MIMIR_URL = process.env.MANAGED_MIMIR_URL || "http://10.10.1.139:9009";
const LOKI_URL = process.env.MANAGED_LOKI_URL || "http://10.10.1.139:3100";
const TEMPO_URL = process.env.MANAGED_TEMPO_URL || "http://10.10.1.139:3200";
const ORG_ID = process.env.MANAGED_LGTM_ORG_ID || "hackathon";
const REQUEST_TIMEOUT_MS = Number(process.env.SRE_LGTM_REQUEST_TIMEOUT_MS) || 15000;

const headers = { "X-Scope-OrgID": ORG_ID };

// Loki labels the demo's services as "opentelemetry-demo/cart"; Mimir calls the same
// service "cart". Everything downstream speaks the Mimir form.
const LOKI_PREFIX = "opentelemetry-demo/";

const SERVICES = [
  "ad", "cart", "checkout", "currency", "email", "flagd", "frontend",
  "frontend-proxy", "frontend-web", "image-provider", "load-generator",
  "otelcol-contrib", "payment", "product-catalog", "quote", "recommendation",
  "shipping", "telemetry-docs",
];

function normalizeService(name) {
  if (typeof name !== "string") return name;
  return name.startsWith(LOKI_PREFIX) ? name.slice(LOKI_PREFIX.length) : name;
}

function lokiService(name) {
  if (typeof name !== "string") return name;
  return name.startsWith(LOKI_PREFIX) ? name : LOKI_PREFIX + name;
}

async function get(url, what) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === "TimeoutError") {
      throw new Error(`${what} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function queryMetric(promql) {
  const url = `${MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  return get(url, "Mimir query");
}

async function queryMetricRange(promql, minutes = 30) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - minutes * 60;
  // Aim for roughly 60 points regardless of window so the model sees shape, not noise.
  const step = Math.max(15, Math.floor((end - start) / 60));
  const url =
    `${MIMIR_URL}/prometheus/api/v1/query_range?query=${encodeURIComponent(promql)}` +
    `&start=${start}&end=${end}&step=${step}`;
  return get(url, "Mimir range query");
}

async function listMetricNames() {
  return get(`${MIMIR_URL}/prometheus/api/v1/label/__name__/values`, "Mimir label query");
}

async function queryLogs(logql, sinceMinutes = 10) {
  const start = (Date.now() - sinceMinutes * 60 * 1000) * 1e6; // ns
  const url =
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logql)}` +
    `&start=${start}&limit=50`;
  return get(url, "Loki query");
}

async function searchTraces(tagFilter, limit = 5) {
  const url = `${TEMPO_URL}/api/search?tags=${encodeURIComponent(tagFilter)}&limit=${limit}`;
  return get(url, "Tempo search");
}

async function searchTracesQL(traceql, limit = 5) {
  const url = `${TEMPO_URL}/api/search?q=${encodeURIComponent(traceql)}&limit=${limit}`;
  return get(url, "Tempo TraceQL search");
}

async function getTrace(traceId) {
  return get(`${TEMPO_URL}/api/traces/${encodeURIComponent(traceId)}`, "Tempo trace fetch");
}

module.exports = {
  queryMetric, queryMetricRange, listMetricNames,
  queryLogs, searchTraces, searchTracesQL, getTrace,
  normalizeService, lokiService, SERVICES,
};
