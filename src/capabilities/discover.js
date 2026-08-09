// Live telemetry-driven service discovery.
//
// There is no service -> runtime/criticality/etc lookup table anywhere in this file. Every
// characteristic below is read off the live LGTM stack for the actual set of services that
// exist right now (`src/lgtm/client.js#SERVICES`), by asking "does this metric family / label
// / log stream exist for this service_name" and recording the literal query + response in the
// evidence ledger. Re-running this against a different topology (fewer services, or services
// with different real characteristics) changes the output, because the output IS the query
// result — there is nothing here that could produce today's answer regardless of what the
// stack actually reports.
//
// Metric-family name prefixes (jvm_, go_memory_, ...) are OpenTelemetry semantic-convention
// naming, not a per-service decision — we still ask the live stack, for every service, whether
// series in that family actually exist for it. Nothing here hardcodes "service X is runtime Y".

const lgtm = require("../lgtm/client");
const { Ledger } = require("../evidence/ledger");

const RUNTIME_PROBES = [
  { runtime: "jvm", pattern: "jvm_.*" },
  { runtime: "go", pattern: "go_memory_.*" },
  { runtime: "node", pattern: "v8js_.*|nodejs_eventloop_.*" },
  { runtime: "dotnet", pattern: "dotnet_.*" },
  { runtime: "cpython", pattern: "process_runtime_cpython_.*" },
];

function servicesInResult(result) {
  return new Set((result || []).map((r) => r.metric.service_name).filter(Boolean));
}

function emptyRecord(service) {
  return {
    service,
    runtime: [],
    hasDb: false,
    spanKinds: [],
    criticality: "unknown",
    hasLogs: null, // null = not yet determined / genuinely unknown, never assumed false
    approxCallRate: null,
    evidence: [],
  };
}

async function discoverServices() {
  const ledger = new Ledger();
  const services = lgtm.SERVICES;
  const byService = new Map(services.map((s) => [s, emptyRecord(s)]));

  const attach = (svc, evidenceId) => {
    const rec = byService.get(svc);
    if (rec && !rec.evidence.includes(evidenceId)) rec.evidence.push(evidenceId);
  };

  // 0. What metric names does this environment actually export? Grounds the runtime probes
  //    below in reality rather than an assumed list of metric names that may not exist here.
  const nameList = await lgtm.listMetricNames();
  const allNames = new Set(nameList.data || []);
  ledger.record({
    kind: "metric",
    query: "label/__name__/values",
    target: null,
    raw: nameList,
    summary: `${allNames.size} distinct metric names known to Mimir`,
  });

  // 1. Runtime — one live existence query per family, across all services at once. A family
  //    is only probed if this environment exports at least one metric name in it.
  for (const probe of RUNTIME_PROBES) {
    const familyRegex = new RegExp(`^(${probe.pattern})$`);
    if (![...allNames].some((n) => familyRegex.test(n))) continue;

    const promql = `count by (service_name) ({__name__=~"${probe.pattern}"})`;
    const res = await lgtm.queryMetric(promql);
    const found = servicesInResult(res.data?.result);
    const entry = ledger.record({
      kind: "metric",
      query: promql,
      target: null,
      raw: res,
      summary: `${probe.runtime} runtime metrics present for: ${[...found].join(", ") || "none"}`,
    });
    for (const svc of found) {
      if (!byService.has(svc)) continue;
      byService.get(svc).runtime.push(probe.runtime);
      attach(svc, entry.id);
    }
  }

  // 2. DB client presence — universal metric, so a single existence query covers everyone.
  {
    const promql = "count by (service_name) (db_client_operation_duration_seconds_count)";
    const res = await lgtm.queryMetric(promql);
    const found = servicesInResult(res.data?.result);
    const entry = ledger.record({
      kind: "metric",
      query: promql,
      target: null,
      raw: res,
      summary: `db client metrics present for: ${[...found].join(", ") || "none"}`,
    });
    for (const svc of found) {
      if (!byService.has(svc)) continue;
      byService.get(svc).hasDb = true;
      attach(svc, entry.id);
    }
  }

  // 3. Span kinds emitted, per service — SERVER-only vs SERVER+CLIENT(+INTERNAL/PRODUCER).
  {
    const promql = "sum by (service_name, span_kind) (traces_span_metrics_calls_total)";
    const res = await lgtm.queryMetric(promql);
    const entry = ledger.record({
      kind: "metric",
      query: promql,
      target: null,
      raw: res,
      summary: "span_kind breakdown per service from traces_span_metrics_calls_total",
    });
    for (const row of res.data?.result || []) {
      const svc = row.metric.service_name;
      const kind = row.metric.span_kind;
      if (!byService.has(svc) || !kind) continue;
      const rec = byService.get(svc);
      if (!rec.spanKinds.includes(kind)) rec.spanKinds.push(kind);
      attach(svc, entry.id);
    }
  }

  // 4. service_criticality label, read off span metrics where present — never guessed for
  //    services that lack it.
  {
    const promql = "sum by (service_name, service_criticality) (traces_span_metrics_calls_total)";
    const res = await lgtm.queryMetric(promql);
    const entry = ledger.record({
      kind: "metric",
      query: promql,
      target: null,
      raw: res,
      summary: "service_criticality label read off span metrics, where the label exists",
    });
    for (const row of res.data?.result || []) {
      const svc = row.metric.service_name;
      if (!byService.has(svc)) continue;
      const rec = byService.get(svc);
      rec.criticality = row.metric.service_criticality || "unknown";
      attach(svc, entry.id);
    }
  }

  // 5. Approximate call rate — raw number only. No high/low bucketing here: that
  //    categorisation, if it happens at all, is the model's job in install.js.
  {
    const promql = "sum by (service_name) (rate(traces_span_metrics_calls_total[5m]))";
    const res = await lgtm.queryMetric(promql);
    const entry = ledger.record({
      kind: "metric",
      query: promql,
      target: null,
      raw: res,
      summary: "approx call rate (req/s) per service over the last 5m",
    });
    for (const row of res.data?.result || []) {
      const svc = row.metric.service_name;
      if (!byService.has(svc)) continue;
      const rec = byService.get(svc);
      rec.approxCallRate = Number(row.value?.[1]);
      attach(svc, entry.id);
    }
  }

  // 6. Logs presence — per service. A single broad Loki regex selector was tried and rejected:
  //    src/lgtm/client.js's queryLogs() caps the response at a fixed line count, so a query
  //    spanning all 18 services silently under-reports low-volume services (some services
  //    with real logs never showed up because higher-volume services filled the cap first).
  //    Checking each service individually is the only way that doesn't produce false
  //    "no logs" negatives.
  for (const svc of services) {
    const logql = `{service_name="${lgtm.lokiService(svc)}"}`;
    try {
      const res = await lgtm.queryLogs(logql, 60);
      const streams = res.data?.result || [];
      const lines = streams.reduce((n, s) => n + (s.values ? s.values.length : 0), 0);
      const entry = ledger.record({
        kind: "log",
        query: logql,
        target: svc,
        raw: res,
        summary: `${svc}: ${streams.length} stream(s), ${lines} line(s) in the last 60m`,
      });
      const rec = byService.get(svc);
      rec.hasLogs = lines > 0;
      attach(svc, entry.id);
    } catch (err) {
      const entry = ledger.record({
        kind: "log",
        query: logql,
        target: svc,
        raw: { error: err.message },
        summary: `${svc}: Loki query failed — ${err.message}`,
      });
      // Query failure means "we don't know", never "no logs" — absence of evidence isn't
      // evidence of absence.
      byService.get(svc).hasLogs = null;
      attach(svc, entry.id);
    }
  }

  return services.map((svc) => {
    const rec = byService.get(svc);
    return {
      service: svc,
      runtime: rec.runtime.length ? [...new Set(rec.runtime)].join("+") : "unknown",
      hasDb: rec.hasDb,
      spanKinds: rec.spanKinds,
      criticality: rec.criticality,
      hasLogs: rec.hasLogs,
      approxCallRate: rec.approxCallRate,
      evidence: rec.evidence,
    };
  });
}

module.exports = { discoverServices, RUNTIME_PROBES };

if (require.main === module) {
  (async () => {
    console.log("Querying live LGTM stack for per-service characteristics...\n");
    const results = await discoverServices();

    const line = (r) =>
      `${r.service.padEnd(17)} runtime=${String(r.runtime).padEnd(9)} ` +
      `hasDb=${String(r.hasDb).padEnd(5)} ` +
      `spanKinds=${JSON.stringify(r.spanKinds).padEnd(26)} ` +
      `criticality=${String(r.criticality).padEnd(9)} ` +
      `hasLogs=${String(r.hasLogs).padEnd(5)} ` +
      `callRate=${r.approxCallRate == null ? "null" : r.approxCallRate.toFixed(3)} ` +
      `evidence=[${r.evidence.join(",")}]`;

    for (const r of results) console.log(line(r));

    const withSignal = results.filter(
      (r) =>
        r.runtime !== "unknown" ||
        r.hasDb ||
        r.spanKinds.length ||
        r.criticality !== "unknown" ||
        r.hasLogs !== null ||
        r.approxCallRate != null,
    );
    const noSignal = results.filter((r) => !withSignal.includes(r));

    console.log(
      `\n${withSignal.length}/${results.length} services returned at least one discoverable characteristic.`,
    );
    if (noSignal.length) {
      console.log(`No signal at all for: ${noSignal.map((r) => r.service).join(", ")}`);
    }

    if (process.env.SRE_RUN_INSTALL === "1") {
      const { installCapabilities } = require("./install");
      console.log("\nSRE_RUN_INSTALL=1 — running installCapabilities() on the discovery result...\n");
      const installs = await installCapabilities(results);
      for (const i of installs) {
        console.log(`- ${i.service} -> ${i.capability}`);
        console.log(`  ${i.reasoning}`);
        console.log(`  evidence=[${i.evidenceIds.join(",")}]`);
      }
    }
  })().catch((err) => {
    console.error("discoverServices failed:", err.message);
    process.exitCode = 1;
  });
}
