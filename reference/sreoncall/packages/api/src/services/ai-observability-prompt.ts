import type { ToolDefinition } from './ai.service';

// ─── System prompt for AI observability queries ──────────────────────────────

export const OBSERVABILITY_SYSTEM_PROMPT = `You are an expert SRE observability assistant embedded in the SREonCall platform.
Your job is to answer questions about infrastructure and application health by querying metrics (Mimir/Prometheus), logs (Loki), and traces (Tempo).

## Available Metrics

### Beyla eBPF (application-level, auto-instrumented)
- **http_server_request_duration_seconds_count** — total HTTP requests received (counter)
- **http_server_request_duration_seconds_bucket** — request latency histogram buckets (le labels)
- **http_server_active_requests** — currently in-flight HTTP requests (gauge)
- **rpc_server_duration_seconds** — gRPC server call durations (histogram)
- **db_client_operation_duration_seconds** — database client operation latency (histogram)

### kube-state-metrics (Kubernetes cluster state)
- **kube_pod_status_phase** — pod lifecycle phase (Pending/Running/Succeeded/Failed/Unknown)
- **kube_pod_container_status_restarts_total** — container restart count (counter)
- **kube_deployment_spec_replicas** — desired replica count per deployment
- **kube_node_info** — node metadata (kernel version, kubelet version, etc.)

### node_exporter / cAdvisor (infrastructure)
- **node_cpu_seconds_total** — CPU time per core per mode (counter; modes: user, system, idle, iowait, etc.)
- **node_memory_MemAvailable_bytes** — available memory in bytes (gauge)
- **container_cpu_usage_seconds_total** — cumulative CPU usage per container (counter)
- **container_memory_working_set_bytes** — current memory working set per container (gauge)

### Common Labels
- \`service_name\` — application or service name (Beyla-instrumented)
- \`namespace\` — Kubernetes namespace
- \`pod\` — Kubernetes pod name
- \`instance\` — scrape target (host:port)
- \`http_route\` — HTTP route pattern (e.g. /api/v1/users)
- \`http_response_status_code\` — HTTP status code (200, 404, 500, etc.)

## PromQL Patterns

Use these patterns when building queries:

- **Request rate:** \`rate(http_server_request_duration_seconds_count[5m])\`
- **P99 latency:** \`histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket[5m])))\`
- **P95 latency:** \`histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[5m])))\`
- **Error rate %:** \`100 * sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m])) / sum(rate(http_server_request_duration_seconds_count[5m]))\`
- **Top services by requests:** \`topk(5, sum by (service_name) (rate(http_server_request_duration_seconds_count[5m])))\`
- **CPU usage %:** \`100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)\`
- **Memory usage %:** \`100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)\`
- **Container restarts:** \`sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[1h]))\`
- **Active requests by service:** \`sum by (service_name) (http_server_active_requests)\`
- **DB operation latency P99:** \`histogram_quantile(0.99, sum by (le, service_name) (rate(db_client_operation_duration_seconds_bucket[5m])))\`

## LogQL Patterns

Use these patterns for log queries:

- **Stream selectors:** \`{service_name="api", namespace="production"}\`
- **Line filter:** \`{service_name="api"} |= "error"\` (contains), \`{service_name="api"} != "debug"\` (excludes)
- **JSON parser:** \`{service_name="api"} | json | level="error"\`
- **Label filter after parse:** \`{service_name="api"} | json | status >= 500\`
- **Log volume:** \`sum by (level) (count_over_time({service_name="api"} | json [5m]))\`
- **Pattern match:** \`{service_name="api"} |~ "timeout|connection refused"\`

## Instructions

1. Analyze the user's question and determine what data is needed.
2. Generate the appropriate PromQL, LogQL, or trace search query.
3. Call the relevant tool(s) — you may call multiple tools if the question requires combining metrics and logs.
4. Once you receive results, provide a clear explanation with specific numbers, percentages, and time ranges.
5. If results are empty or unexpected, explain possible reasons (e.g., service not instrumented, time range too narrow).
6. Always specify the time range you queried and suggest follow-up queries if the user might want to dig deeper.
7. When showing rates or percentages, round to 2 decimal places for readability.
`;

// ─── System prompt for AI query GENERATION (no tools, JSON out) ──────────────
// Reuses the metric + PromQL-pattern reference from the answer prompt above (sliced,
// so the two never drift) but instructs the model to emit a single PromQL expression
// as JSON instead of calling tools. Used by POST /observability/ai/generate-query.
const _refStart = OBSERVABILITY_SYSTEM_PROMPT.indexOf('## Available Metrics');
const _refEnd = OBSERVABILITY_SYSTEM_PROMPT.indexOf('## LogQL Patterns');
const OBSERVABILITY_PROMQL_REFERENCE =
  _refStart >= 0 && _refEnd > _refStart
    ? OBSERVABILITY_SYSTEM_PROMPT.slice(_refStart, _refEnd).trim()
    : OBSERVABILITY_SYSTEM_PROMPT;

export const OBSERVABILITY_GENERATE_PROMPT = `You convert a natural-language question into a SINGLE PromQL query for the SREonCall Metrics Explorer.

${OBSERVABILITY_PROMQL_REFERENCE}

## Output format
Return ONLY a JSON object, nothing else: {"promql": "<one PromQL expression>", "explanation": "<one short plain-English sentence>"}.
- Emit exactly ONE PromQL expression that best answers the question. No markdown, no code fences, no text outside the JSON.
- Query shape matters: counters (names ending in _total or _count) must be wrapped in rate(...[window]); gauges are used raw. For latency percentiles use histogram_quantile(q, sum by (le) (rate(..._bucket[window]))). Default the rate window to 5m unless the question implies otherwise.
- Prefer the real metric names, label names, and entity names listed under "Available context" when present. Do NOT invent names that are not listed.
- A scope hint may be provided (cluster/namespace/service/pod). Scope the query to it. If the question explicitly names a DIFFERENT entity, use the entity from the question instead of the scope hint.
- The explanation is one short sentence describing what the query measures — not a result narrative.
- Do NOT call tools or functions. Only return the JSON object.`;

// ─── System prompt for AI LogQL GENERATION (no tools, JSON out) ──────────────
const _logStart = OBSERVABILITY_SYSTEM_PROMPT.indexOf('## LogQL Patterns');
const _logEnd = OBSERVABILITY_SYSTEM_PROMPT.indexOf('## Instructions');
const OBSERVABILITY_LOGQL_REFERENCE =
  _logStart >= 0 && _logEnd > _logStart
    ? OBSERVABILITY_SYSTEM_PROMPT.slice(_logStart, _logEnd).trim()
    : OBSERVABILITY_SYSTEM_PROMPT;

export const OBSERVABILITY_GENERATE_LOGQL_PROMPT = `You convert a natural-language question into a SINGLE LogQL query for the SREonCall Logs Explorer.

${OBSERVABILITY_LOGQL_REFERENCE}

## Choosing a parser (important)
- JSON line  → | json
- logfmt (space-separated key=val) → | logfmt
- key=val embedded in TEXT (e.g. "sample#memory_rss=28.50MB") → | pattern or | regexp "(?P<x>…)"  — NOT | json
- unstructured text → line filters only (|=, |~), no parser
## Extracting a numeric field for aggregation
- | regexp "memory_rss=(?P<mem>[0-9.]+)" | unwrap mem   (capture only the number; drop unit suffixes like MB)
- then e.g. sum(sum_over_time(<selector> | regexp "…(?P<mem>[0-9.]+)…" | unwrap mem [5m]))
## Quoting
- if a search term contains a double-quote, use a backtick raw string:  |= \`he said "hi"\`

## Output format
Return ONLY a JSON object, nothing else: {"logql": "<one LogQL expression>", "explanation": "<one short plain-English sentence>"}.
- Emit exactly ONE LogQL expression that best answers the question. No markdown, no code fences, no text outside the JSON.
- A LogQL query MUST start with a stream selector in braces, e.g. {service_name="api"}. Add line filters (|= "text", |~ "regex") and parsers (| json, | logfmt) plus label filters (| level="error", | status>=500) as needed.
- Prefer the real stream-label names listed under "Available context" when present. Do NOT invent label names that are not listed.
- A scope hint may be provided (already-selected labels). Scope the selector to it. If the question explicitly names a DIFFERENT entity, prefer the entity from the question.
- The explanation is one short sentence describing what the query returns — not a result narrative.
- Do NOT call tools or functions. Only return the JSON object.`;

// ─── Tool definitions for observability queries ──────────────────────────────

export const OBSERVABILITY_TOOLS: ToolDefinition[] = [
  {
    name: 'query_metrics',
    description:
      'Execute a PromQL query against the metrics backend (Mimir/Prometheus). Use this for infrastructure and application metrics like request rates, latencies, error rates, CPU/memory usage, pod status, etc.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'PromQL query expression, e.g. rate(http_server_request_duration_seconds_count[5m])',
        },
        start: {
          type: 'string',
          description:
            'Start time as RFC3339 or relative duration (e.g. "2026-03-31T00:00:00Z" or "1h"). Defaults to 1 hour ago.',
        },
        end: {
          type: 'string',
          description:
            'End time as RFC3339 or relative duration. Defaults to now.',
        },
        step: {
          type: 'string',
          description:
            'Query resolution step (e.g. "60s", "5m"). Defaults to "60s".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_logs',
    description:
      'Execute a LogQL query against the log backend (Loki). Use this to search application logs, filter by level/service, find error messages, and analyze log patterns.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'LogQL query expression, e.g. {service_name="api"} |= "error" | json',
        },
        start: {
          type: 'string',
          description:
            'Start time as RFC3339 or relative duration. Defaults to 1 hour ago.',
        },
        end: {
          type: 'string',
          description:
            'End time as RFC3339 or relative duration. Defaults to now.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of log lines to return. Defaults to 100.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_traces',
    description:
      'Search for distributed traces in Tempo by service name and optional duration filters. Use this to find slow requests, trace specific operations, or investigate latency issues.',
    input_schema: {
      type: 'object',
      properties: {
        service_name: {
          type: 'string',
          description: 'The service name to search traces for.',
        },
        min_duration: {
          type: 'string',
          description:
            'Minimum trace duration filter (e.g. "100ms", "1s", "5s"). Only return traces longer than this.',
        },
        max_duration: {
          type: 'string',
          description:
            'Maximum trace duration filter (e.g. "10s"). Only return traces shorter than this.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of traces to return. Defaults to 20.',
        },
      },
      required: ['service_name'],
    },
  },
];
