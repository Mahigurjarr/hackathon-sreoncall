// Minimal, working client for the shared hackathon LGTM stack.
// No dependencies — uses Node 22's built-in fetch. Copy/adapt this into
// whatever interface you're building (CLI, Slack bot, web UI backend).

const MIMIR_URL = process.env.MANAGED_MIMIR_URL || "http://10.10.1.139:9009";
const LOKI_URL  = process.env.MANAGED_LOKI_URL  || "http://10.10.1.139:3100";
const TEMPO_URL = process.env.MANAGED_TEMPO_URL || "http://10.10.1.139:3200";
const ORG_ID    = process.env.MANAGED_LGTM_ORG_ID || "hackathon";

const headers = { "X-Scope-OrgID": ORG_ID };

async function queryMetric(promql) {
  const url = `${MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Mimir query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function listMetricNames() {
  const res = await fetch(`${MIMIR_URL}/prometheus/api/v1/label/__name__/values`, { headers });
  if (!res.ok) throw new Error(`Mimir label query failed: ${res.status}`);
  return res.json();
}

async function queryLogs(logqlSelector, sinceMinutes = 10) {
  const start = (Date.now() - sinceMinutes * 60 * 1000) * 1e6; // ns
  const url = `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logqlSelector)}&start=${start}&limit=20`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Loki query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function searchTraces(tagFilter, limit = 5) {
  const url = `${TEMPO_URL}/api/search?tags=${encodeURIComponent(tagFilter)}&limit=${limit}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Tempo search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { queryMetric, listMetricNames, queryLogs, searchTraces };

// Self-test when run directly: node lgtm-client.js
if (require.main === module) {
  (async () => {
    console.log(`Connecting to LGTM stack as tenant "${ORG_ID}"...`);
    const names = await listMetricNames();
    console.log(`✓ Mimir: ${names.data.length} metric names available`);
    const logs = await queryLogs('{service_name=~".+"}');
    const streamCount = logs.data?.result?.length ?? 0;
    console.log(`✓ Loki: ${streamCount} log stream(s) in the last 10 minutes`);
    const traces = await searchTraces("service.name=frontend-web");
    console.log(`✓ Tempo: ${traces.traces?.length ?? 0} recent trace(s) found`);
    console.log("\nAll three signal types reachable. You're connected.");
  })().catch((err) => {
    console.error("✗ Connection failed:", err.message);
    console.error("Check: are you on the VPN/office network? (10.10.0.0/24 or 10.10.1.0/24 required)");
    process.exit(1);
  });
}
