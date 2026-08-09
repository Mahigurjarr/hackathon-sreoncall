// Investigator tools — thin wrappers around the read-only LGTM spine.
//
// Every function here does exactly three things, in order:
//   1. call the spine (src/lgtm/client.js) — GET-only, so nothing here can write anywhere
//   2. read the raw response into a short human-readable `summary`
//   3. record { kind, query, target, raw, summary } through the evidence ledger and
//      return the ledger id alongside the summary
//
// Nothing here decides what's "anomalous" — that judgement belongs to the model reading
// the summaries, never to a comparison in this file. There is no threshold constant below.
//
// Ledger convention: every tool takes the caller's `Ledger` instance (require("../evidence/
// ledger").Ledger) as its LAST parameter. Callers (src/investigator/loop.js, or anything else
// that wants a citable reading) construct one Ledger per investigation and pass it through —
// tools.js never constructs its own, so every citation in a run traces back to one ledger.

const lgtm = require("../lgtm/client");

// ---- OTLP attribute helpers -------------------------------------------------------------
// Tempo's /api/traces/<id> and /api/search responses encode attributes as OTLP-JSON:
// [{ key, value: { stringValue | intValue | boolValue | doubleValue | arrayValue } }, ...].
// Flatten that to a plain object once so summaries don't have to re-walk it.

function flattenAttrs(attrs) {
  const out = {};
  for (const a of attrs || []) {
    if (!a || !a.key) continue;
    const v = a.value || {};
    if ("stringValue" in v) out[a.key] = v.stringValue;
    else if ("intValue" in v) out[a.key] = v.intValue;
    else if ("boolValue" in v) out[a.key] = v.boolValue;
    else if ("doubleValue" in v) out[a.key] = v.doubleValue;
    else if ("arrayValue" in v) out[a.key] = JSON.stringify(v.arrayValue);
    else out[a.key] = JSON.stringify(v);
  }
  return out;
}

// Walk a Tempo /api/traces/<id> response (OTLP-JSON: batches[].resource +
// batches[].scopeSpans[].spans[], each span carrying its own `events[]`) into a flat list
// of spans with status AND events flattened — events carry root-cause text (e.g.
// event.exception.message) that span status alone does not.
function extractTraceSpans(raw) {
  const batches = raw?.batches || raw?.resourceSpans || [];
  const spans = [];
  for (const batch of batches) {
    const resourceAttrs = flattenAttrs(batch.resource?.attributes);
    const serviceName = resourceAttrs["service.name"];
    const scopeGroups = batch.scopeSpans || batch.instrumentationLibrarySpans || [];
    for (const scope of scopeGroups) {
      for (const span of scope.spans || []) {
        spans.push({
          spanId: span.spanId,
          name: span.name,
          kind: span.kind,
          serviceName,
          status: span.status || null,
          attributes: flattenAttrs(span.attributes),
          events: (span.events || []).map((e) => ({
            name: e.name,
            attributes: flattenAttrs(e.attributes),
          })),
        });
      }
    }
  }
  return spans;
}

// Walk a Tempo /api/search (tag filter or TraceQL) response into a flat, readable shape.
// A TraceQL query with a `| select(...)` clause returns the selected fields flattened onto
// each matched span's attributes — that's where event.exception.message etc. show up here.
function extractTraceSearchResults(raw) {
  const traces = raw?.traces || [];
  return traces.map((t) => ({
    traceId: t.traceID,
    rootService: t.rootServiceName,
    rootName: t.rootTraceName,
    durationMs: t.durationMs ?? null,
    spans: (t.spanSets?.[0]?.spans || t.spanSet?.spans || []).map((s) => ({
      spanId: s.spanID,
      name: s.name,
      attributes: flattenAttrs(s.attributes),
    })),
  }));
}

// ---- Summaries ---------------------------------------------------------------------------
// Short, human-readable readings of raw responses. These describe what came back; they never
// judge whether it's a problem — that stays the model's call.

function summarizeMetric(promql, raw) {
  const data = raw?.data;
  if (!data) return `no data returned for: ${promql}`;

  if (data.resultType === "vector") {
    const rows = data.result || [];
    if (!rows.length) return `0 series returned (absent ≠ zero here) for: ${promql}`;
    const parts = rows.slice(0, 10).map((r) => {
      const label = r.metric.service_name || Object.values(r.metric)[0] || "?";
      return `${label}=${Number(r.value?.[1]).toPrecision(4)}`;
    });
    const more = rows.length > 10 ? ` (+${rows.length - 10} more)` : "";
    return `${rows.length} series: ${parts.join(", ")}${more}`;
  }

  if (data.resultType === "matrix") {
    const rows = data.result || [];
    if (!rows.length) return `0 series returned (absent ≠ zero here) for: ${promql}`;
    const parts = rows.slice(0, 6).map((r) => {
      const label = r.metric.service_name || Object.values(r.metric)[0] || "?";
      const vals = (r.values || []).map((v) => Number(v[1])).filter((n) => !Number.isNaN(n));
      const last = vals.length ? vals[vals.length - 1] : null;
      const max = vals.length ? Math.max(...vals) : null;
      return `${label}: last=${last?.toPrecision(4) ?? "?"} max=${max?.toPrecision(4) ?? "?"} (${vals.length}pts)`;
    });
    const more = rows.length > 6 ? ` (+${rows.length - 6} more)` : "";
    return `${rows.length} series over range: ${parts.join("; ")}${more}`;
  }

  return `unrecognized resultType "${data.resultType}" for: ${promql}`;
}

function summarizeLogs(logql, raw) {
  const streams = raw?.data?.result || [];
  const totalLines = streams.reduce((n, s) => n + (s.values?.length || 0), 0);
  if (!totalLines) return `0 matching lines for: ${logql}`;

  let latest = null;
  for (const s of streams) {
    for (const entry of s.values || []) {
      const [ts, line] = entry;
      if (!latest || ts > latest.ts) latest = { ts, line };
    }
  }
  const sample = latest ? String(latest.line).slice(0, 200) : "";
  return `${streams.length} stream(s), ${totalLines} line(s); latest: "${sample}"`;
}

function summarizeTraceSpans(spans) {
  if (!spans.length) return "trace had no spans (empty or not-yet-received)";
  const services = [...new Set(spans.map((s) => s.serviceName).filter(Boolean))];
  const notable = spans.filter(
    (s) => s.events.length > 0 || (s.status && s.status.code && s.status.code !== "STATUS_CODE_OK" && s.status.code !== "STATUS_CODE_UNSET"),
  );

  if (!notable.length) {
    return `${spans.length} span(s) across [${services.join(", ")}], no error status and no span events`;
  }

  const bits = notable.slice(0, 6).map((s) => {
    const exc = s.events.find((e) => e.name === "exception");
    const excMsg = exc?.attributes?.["exception.message"];
    const statusMsg = s.status?.message;
    return (
      `${s.serviceName || "?"}/${s.name}` +
      (excMsg ? ` exception="${excMsg}"` : "") +
      (statusMsg ? ` statusMessage="${statusMsg}"` : "")
    );
  });
  const more = notable.length > 6 ? ` (+${notable.length - 6} more)` : "";
  return `${spans.length} span(s) across [${services.join(", ")}], ${notable.length} with error status/events: ${bits.join(" | ")}${more}`;
}

function summarizeTraceSearch(query, results) {
  if (!results.length) return `0 traces matched: ${query}`;
  const bits = results.slice(0, 5).map((t) => {
    const attrBits = t.spans
      .flatMap((s) => Object.entries(s.attributes).map(([k, v]) => `${k}=${v}`))
      .slice(0, 4);
    return `${t.traceId} root=${t.rootService || "?"}/${t.rootName || "?"}${attrBits.length ? ` [${attrBits.join(", ")}]` : ""}`;
  });
  const more = results.length > 5 ? ` (+${results.length - 5} more)` : "";
  return `${results.length} trace(s) matched "${query}": ${bits.join(" | ")}${more}`;
}

// Real statistics over real historical data — mean/stddev/percentiles computed from whatever
// queryMetricRange actually returned. No number in this function is a business threshold; it
// is arithmetic over live points. The caller (a model deciding on an alert rule or judging a
// current reading) chooses how to combine these into a condition — this function only ever
// hands back what history actually shows.
function computeSeriesStats(raw) {
  const rows = raw?.data?.result || [];
  if (raw?.data?.resultType !== "matrix" || !rows.length) {
    return { ok: false, seriesCount: 0 };
  }

  const series = rows.map((r) => {
    const label = r.metric.service_name || Object.values(r.metric)[0] || "?";
    const values = (r.values || []).map((v) => Number(v[1])).filter((n) => !Number.isNaN(n));
    if (!values.length) return { label, count: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

    return {
      label, count: values.length, mean, stddev: Math.sqrt(variance),
      min: sorted[0], max: sorted[sorted.length - 1],
      p50: pct(0.5), p95: pct(0.95), p99: pct(0.99),
    };
  });

  return { ok: true, seriesCount: series.length, series };
}

function summarizeBaseline(promql, hours, stats) {
  if (!stats.ok) return `no historical data over the last ${hours}h for: ${promql}`;
  const parts = stats.series.slice(0, 8).map((s) => {
    if (!s.count) return `${s.label}: no points`;
    return `${s.label}: mean=${s.mean.toPrecision(4)} stddev=${s.stddev.toPrecision(3)} p95=${s.p95.toPrecision(4)} (${s.count}pts)`;
  });
  const more = stats.series.length > 8 ? ` (+${stats.series.length - 8} more)` : "";
  return `${stats.seriesCount} series over last ${hours}h: ${parts.join("; ")}${more}`;
}

// Attach a PromQL `offset` to every range-vector selector in the expression — the correct
// position is right after the selector's closing bracket (`metric[5m] offset 30m`), which is
// also the general case: every verified query in docs/TELEMETRY.md's vocabulary is of the
// `rate(metric{...}[5m])` shape, and a global replace handles ratio queries with more than
// one range vector too. A bracket-less bare instant selector (rare for this system's error/
// latency queries) falls back to appending offset at the end, which is not exact for every
// possible wrapping — documented here rather than silently assumed correct.
function withOffset(promql, minutes) {
  const suffix = ` offset ${minutes}m`;
  const rangeVectorPattern = /(\[\s*\d+[smhdwy]\s*\])/g;
  if (rangeVectorPattern.test(promql)) {
    return promql.replace(rangeVectorPattern, `$1${suffix}`);
  }
  return `${promql}${suffix}`;
}

// ---- Tools --------------------------------------------------------------------------------

async function query_metrics(promql, ledger) {
  const raw = await lgtm.queryMetric(promql);
  const summary = summarizeMetric(promql, raw);
  const entry = ledger.record({ kind: "metric", query: promql, target: null, raw, summary });
  return { id: entry.id, summary, raw };
}

async function query_logs(logql, sinceMinutes, ledger) {
  const raw = await lgtm.queryLogs(logql, sinceMinutes);
  const summary = summarizeLogs(logql, raw);
  const entry = ledger.record({
    kind: "log",
    query: logql,
    target: null,
    raw,
    summary,
  });
  return { id: entry.id, summary, raw };
}

async function search_traces(tagFilter, limit, ledger) {
  const raw = await lgtm.searchTraces(tagFilter, limit);
  const results = extractTraceSearchResults(raw);
  const summary = summarizeTraceSearch(tagFilter, results);
  const entry = ledger.record({ kind: "trace", query: tagFilter, target: null, raw, summary });
  return { id: entry.id, summary, raw, traces: results };
}

async function search_traces_ql(traceql, limit, ledger) {
  const raw = await lgtm.searchTracesQL(traceql, limit);
  const results = extractTraceSearchResults(raw);
  const summary = summarizeTraceSearch(traceql, results);
  const entry = ledger.record({ kind: "trace", query: traceql, target: null, raw, summary });
  return { id: entry.id, summary, raw, traces: results };
}

async function get_trace(traceId, ledger) {
  const raw = await lgtm.getTrace(traceId);
  const spans = extractTraceSpans(raw);
  const summary = summarizeTraceSpans(spans);
  const entry = ledger.record({
    kind: "trace",
    query: `trace:${traceId}`,
    target: null,
    raw,
    summary,
  });
  return { id: entry.id, summary, raw, spans };
}

async function compare_baseline(promql, minutes, ledger) {
  const baselineQuery = withOffset(promql, minutes);
  const [now, past] = await Promise.all([
    lgtm.queryMetric(promql),
    lgtm.queryMetric(baselineQuery),
  ]);
  const nowSummary = summarizeMetric(promql, now);
  const pastSummary = summarizeMetric(baselineQuery, past);
  const summary = `now: ${nowSummary}  ||  ${minutes}m ago: ${pastSummary}`;
  const entry = ledger.record({
    kind: "metric",
    query: `${promql}  <=>  ${baselineQuery}`,
    target: null,
    raw: { now, baseline: past },
    summary,
  });
  return { id: entry.id, summary, raw: { now, baseline: past } };
}

async function derive_baseline(promql, lookbackHours, ledger) {
  const hours = Number(lookbackHours) > 0 ? Number(lookbackHours) : 24;
  const raw = await lgtm.queryMetricRange(promql, hours * 60);
  const stats = computeSeriesStats(raw);
  const summary = summarizeBaseline(promql, hours, stats);
  const entry = ledger.record({ kind: "metric", query: `${promql} (${hours}h history)`, target: null, raw, summary });
  return { id: entry.id, summary, raw, stats };
}

// ---- OpenAI-format tool definitions ---------------------------------------------------

function toToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "query_metrics",
        description:
          "Run a PromQL instant query against Mimir. Default error/latency queries to " +
          "traces_span_metrics_calls_total / traces_span_metrics_duration_milliseconds_bucket " +
          "— the only metric family emitted by every service in this fleet; http_server_* " +
          "and rpc_server_* only cover a handful of services and will silently miss faults " +
          "elsewhere. Make error-rate queries absent-safe with an `or (... * 0)` term, since " +
          "several services return no series at all (not a zero) when healthy.",
        parameters: {
          type: "object",
          properties: {
            promql: {
              type: "string",
              description:
                'PromQL expression, e.g. sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) or (sum by (service_name) (rate(traces_span_metrics_calls_total[5m])) * 0)',
            },
          },
          required: ["promql"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "query_logs",
        description:
          "Run a LogQL range query against Loki. Loki's service_name label is prefixed " +
          '"opentelemetry-demo/<svc>" (Mimir/Tempo use the bare name). frontend-proxy carries ' +
          'no `level` label — match its body text (e.g. |= "HTTP/1.1\\" 5") instead of ' +
          "level=\"ERROR\". Six services (frontend, frontend-web, flagd, flagd-ui, " +
          "image-provider, telemetry-docs) emit no logs at all, so silence there is not " +
          "evidence of health.",
        parameters: {
          type: "object",
          properties: {
            logql: {
              type: "string",
              description: 'LogQL query, e.g. {service_name="opentelemetry-demo/cart", level="ERROR"}',
            },
            sinceMinutes: {
              type: "number",
              description: "Lookback window in minutes (default 10)",
            },
          },
          required: ["logql"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_traces",
        description:
          'Search Tempo by a simple tag filter, e.g. "service.name=cart". Returns summaries ' +
          "of matching traces (id, root service/span, any attributes on the matched spans).",
        parameters: {
          type: "object",
          properties: {
            tagFilter: {
              type: "string",
              description: 'Tempo tag filter, e.g. "service.name=cart"',
            },
            limit: { type: "number", description: "Max traces to return (default 5)" },
          },
          required: ["tagFilter"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_traces_ql",
        description:
          'Search Tempo with a TraceQL expression, e.g. "{status=error}" or ' +
          '"{status=error && resource.service.name=\\"cart\\"}". Add a `| select(...)` clause ' +
          "(e.g. select(event.exception.message, span.response_flags, span.error.reason)) to " +
          "pull specific span/event attributes into the result instead of just matching.",
        parameters: {
          type: "object",
          properties: {
            traceql: { type: "string", description: "TraceQL expression" },
            limit: { type: "number", description: "Max traces to return (default 5)" },
          },
          required: ["traceql"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_trace",
        description:
          "Fetch one full trace by id from Tempo, including every span's status AND its " +
          "events. Span EVENTS often carry the sharpest root-cause text — " +
          "event.exception.message on an event can name the exact fault (including a " +
          "feature-flag string) more precisely than the span's own status ever does.",
        parameters: {
          type: "object",
          properties: {
            traceId: {
              type: "string",
              description: "Tempo trace id, as returned by search_traces / search_traces_ql",
            },
          },
          required: ["traceId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "compare_baseline",
        description:
          "Run a PromQL query both right now and shifted back by `minutes` (a real PromQL " +
          "offset), returning both readings side by side so you can judge whether the current " +
          "value differs from that same query's own recent history.",
        parameters: {
          type: "object",
          properties: {
            promql: {
              type: "string",
              description: "PromQL expression to compare against its own recent past",
            },
            minutes: {
              type: "number",
              description: "How many minutes back the baseline window should be shifted",
            },
          },
          required: ["promql", "minutes"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "derive_baseline",
        description:
          "Compute a REAL statistical baseline (mean, stddev, p50/p95/p99) for a PromQL " +
          "expression from its actual last N hours of history. This is the only legitimate " +
          "way to justify a number in an alert rule or a 'this is X times normal' claim — " +
          "never invent a threshold; derive it from this. Absent-safe: says plainly when " +
          "there isn't enough history rather than guessing.",
        parameters: {
          type: "object",
          properties: {
            promql: { type: "string", description: "PromQL expression to compute history for" },
            lookbackHours: { type: "number", description: "Hours of history to pull (default 24)" },
          },
          required: ["promql"],
        },
      },
    },
  ];
}

module.exports = {
  query_metrics,
  query_logs,
  search_traces,
  search_traces_ql,
  get_trace,
  compare_baseline,
  derive_baseline,
  computeSeriesStats,
  toToolDefinitions,
};
