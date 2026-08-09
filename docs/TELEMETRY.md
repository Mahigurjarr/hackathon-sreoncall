# Verified telemetry surface — what this stack actually emits

Every fact below was confirmed by live query against Mimir/Loki/Tempo as tenant `hackathon`,
not read from documentation. Rediscovering this costs an hour; read it before writing a query.

## The one metric that covers everything

`traces_span_metrics_*` is the **only universal signal** — all 18 services emit it.

| Metric | Coverage |
|---|---|
| `traces_span_metrics_calls_total` | **18/18 services** (344 series) |
| `traces_span_metrics_duration_milliseconds_bucket` | **18/18** (5848 series) — units are **milliseconds** |
| `http_server_request_duration_seconds_*` | only ad, cart, frontend, shipping |
| `rpc_server_call_duration_seconds_*` | only checkout, product-catalog |
| `rpc_server_duration_milliseconds_*` | **ad only** — looks global, is not |

Build every error/latency tool on span metrics. The native HTTP/RPC histograms cover a quarter
of the fleet and will silently miss faults.

Useful labels on `traces_span_metrics_calls_total`: `service_name`, `span_name`, `span_kind`,
`status_code` (`STATUS_CODE_ERROR|OK|UNSET`), and **`service_criticality`** — a free
business-impact ranking (`critical`: checkout, frontend, frontend-proxy, payment · `high`: cart,
currency, product-catalog, shipping · `medium`: ad, email, recommendation · `low`: flagd,
flagd-ui, load-generator, quote). The other 36 labels are resource noise.

## Traps that produce confidently wrong answers

**1 · Absent ≠ zero.** Eight services (currency, email, image-provider, load-generator, quote,
shipping, telemetry-docs, flagd-ui) return **no series at all** for an error-rate query, because
they have never emitted an ERROR span in the lookback. A naive `errors/total` ratio drops them
silently. Always:

```promql
sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m]))
  or (sum by (service_name) (rate(traces_span_metrics_calls_total[5m])) * 0)
```

**2 · Ratio and rate disagree, and both are needed.** During injected faults `payment` reached
error **ratio 1.0** at an absolute rate of only `0.0062/s` — invisible to any rate-based view.
Meanwhile `frontend` hit `7.1/s` at ratio `0.41`. Low-QPS services need ratio; high-QPS need
rate. Collect both.

**3 · The idle noise floor is one specific span.** Residual errors at idle come almost entirely
from `flagd.evaluation.v2.Service/EventStream` and `flagSync` — gRPC long-poll streams hitting a
600s server-side deadline, benign by design. With those excluded the floor is *exactly* zero.
**We do not filter them in code** (see "Why no filter constant" below).

**4 · Six services have no logs at all** — frontend, frontend-web, flagd, flagd-ui,
image-provider, telemetry-docs. Log silence is not evidence of health for these.

**5 · `frontend-proxy` carries no `level` label** and is 62% of all log volume (29,746 lines/h).
`{level="ERROR"}` will never match Envoy access logs. Match the body instead:
`{service_name="opentelemetry-demo/frontend-proxy"} |= "HTTP/1.1\" 5"`.

**6 · Span IDs are encoded differently per endpoint.** `GET /api/traces/<id>` returns
protobuf-JSON with **base64** `spanId`/`traceId`; TraceQL `/api/search` returns **hex**. Never
compare across the two without decoding.

**7 · Tempo's TraceQL metrics endpoints are dead.** `/api/metrics/query_range` and
`/api/metrics/query` return `200` with `{"series":[]}` every time — metrics-generator local
blocks are not enabled. Do not build on them.

**8 · No Kafka exists.** No `kafka_*`, no `messaging_*`, no consumer lag, no
`SPAN_KIND_PRODUCER`/`CONSUMER`. The `kafkaQueueProblems` flag cannot manifest as queue-lag
metrics here.

**9 · Two semconv generations coexist.** `http.status_code` *and* `http.response.status_code`;
`http.method` *and* `http.request.method`; `db.system` *and* `db.system.name`. Query both.

**10 · Loki label mismatch.** Loki `service_name` is `opentelemetry-demo/<svc>`; Mimir and Tempo
use bare `<svc>`. `src/lgtm/client.js` handles this via `normalizeService()` / `lokiService()`.

## Where the root-cause signal actually lives

Trace span events carry the sharpest evidence — verified real values from this stack:

| Carrier | Real observed value |
|---|---|
| `event.exception.message` | `"default variant: 'on' isn't a valid variant of flag: 'cartFailure'"` |
| `span.response_flags` | `"UC"` — Envoy upstream connection termination, the sharpest proxy code |
| `span.upstream_cluster` | `"frontend"` — names the failing downstream directly |
| `span:statusMessage` | `"4 DEADLINE_EXCEEDED: Deadline exceeded after 599.999s"` |
| `span.error.reason` | `"connection termination"` |

Note the first row: a fault-injection flag **names itself in the exception text**. That is
legitimate telemetry the agent reads from traces — it is not the flag control API, and using it
is diagnosis, not cheating.

## Verified query vocabulary

```promql
# error rate per service (absent-safe)
sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m]))
  or (sum by (service_name) (rate(traces_span_metrics_calls_total[5m])) * 0)

# error ratio — the right detector for low-QPS services
sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m]))
/ sum by (service_name) (rate(traces_span_metrics_calls_total[5m]))

# which endpoint is failing
topk(10, sum by (service_name, span_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])))

# latency p95, SERVER spans only (milliseconds)
histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket{span_kind="SPAN_KIND_SERVER"}[5m])))

# baseline comparison — now vs 1h ago
sum by (service_name)(rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m]))
  - sum by (service_name)(rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m] offset 1h))
```

```logql
{service_name="opentelemetry-demo/<svc>", level="ERROR"}
{service_name="opentelemetry-demo/frontend-proxy"} |= "HTTP/1.1\" 5"
{service_name="opentelemetry-demo/<svc>"} | json | traceid="<hex>"    # lowercase 'traceid'
```

```traceql
{status=error}
{status=error && resource.service.name="<svc>"}
{status=error} | select(span:statusMessage, span.http.response.status_code, span.response_flags, span.error.reason, resource.service.name)
{event.exception.message != ""} | select(event.exception.message, event.exception.type, resource.service.name, name)
{resource.service.criticality="critical" && status=error}
```

Runtime saturation is per-language: `jvm_*` (ad) · `go_memory_*` (checkout, product-catalog) ·
`nodejs_eventloop_*` + `v8js_*` (frontend, payment) · `dotnet_*` (cart) ·
`process_runtime_cpython_*` (recommendation). Container metrics have **no `service_name`** — they
key on `container_name`, and infra names differ (`otel-collector`, `astronomy-db`, `valkey-cart`).

## Why no filter constant

Reconnaissance suggested hardcoding "ignore EventStream/flagSync, then alert above 0.01 err/s".
We deliberately do not, on both counts.

The numeric threshold is out by the project's core rule. The span-name exclusion is subtler but
worse: it bakes a human's "this is benign" verdict into code, which is exactly the judgement the
model is supposed to make from evidence. Instead the frame carries the per-span breakdown, and
the model concludes for itself that a 600s long-poll deadline is benign — reasoning it can
explain, cite, and revise if the streams ever start failing for a real reason. A hardcoded
filter would hide that failure permanently.
