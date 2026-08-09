# Incident Command Center (ICC) — Setup & Data Guide

**Version:** 1.0  
**Last updated:** June 2026  

---

## 1. What is the Incident Command Center?

The ICC is a **single-pane-of-glass workspace** that opens automatically when an incident is declared. It answers five questions simultaneously so responders never need to tab-hop:

| Question | Panel |
|---|---|
| **What's broken?** | Topology Map — interactive service dependency graph |
| **Why did it break?** | What Changed? — recent deploys, config changes, fired alerts |
| **What's the impact?** | Business Impact + Blast Radius — revenue, users, SLA timers |
| **How do I fix it?** | Resolve — AI-guided diagnosis + step-by-step plan with validation |
| **Who needs to know?** | Comms — per-audience stakeholder update drafts |

---

## 2. ICC Page Sections

### 2.1 Topology Map (center-top)
Shows the live service dependency graph scoped to the incident's affected services (up to 2-hop radius).

**What you'll see per node:**
- Service name, type, and health status (Healthy / Degraded / Down)
- Error rate % and P99 latency (from Prometheus/LGTM)
- Root Cause marker (the first affected service in the incident)
- Owner team and on-call engineer on hover

**What you'll see per edge:**
- Dependency type (HTTP, Database, Cache, Queue)
- Criticality level
- Traffic metadata (req/min, latency, error rate)

---

### 2.2 Context Brief (sidebar)
Quick reference for the primary affected service.

| Field | Source |
|---|---|
| Service name + description | `Service.name`, `Service.description` |
| Owner Team | `Service.owner_id` → Team name |
| On-Call | `Service.oncall_schedule_id` → current on-call user |
| Current State | Live Prometheus metrics (error rate, P99, uptime) |
| Last Deploy | AuditLog: last `service.deploy` event for this service |
| Known Quirks | `Service.notes` field (split by newline) |
| Recent Incidents | Last 3 resolved incidents on this service |

---

### 2.3 What Changed? (sidebar)
Shows events that happened in the **2-hour window before the incident was declared**.

| Sub-section | Populated by |
|---|---|
| Recent Deploys | `AuditLog` entries with action `service.deploy`, `deployment.create`, or `deployment.completed` |
| Config Changes | `AuditLog` entries with action `config.update`, `feature_flag.toggle`, `scaling.change`, or `env_var.update` |
| Fired Alerts | `AlertRule` documents with `alert_state: 'firing'` and `last_triggered_at` within 30 min before incident |

---

### 2.4 Business Impact (sidebar — SRE Manager / Org Admin / MSP Provider only)

| Field | Calculation |
|---|---|
| Revenue/hr | `revenue_per_request_cents × avg_requests_per_minute × 60` (summed across affected services) |
| Users Affected | `total_user_count × (estimated_users_affected_percent / 100)` |
| Customer Tiers | Aggregated from `customer_tiers[]` on BusinessImpactConfig |
| SLA at Risk | `SlaConfig.resolution_time_minutes - elapsed_minutes ≤ 30` |
| Support Ticket Surge | Compares last-1h ticket count vs 24h average |

---

### 2.5 Blast Radius (sidebar)
Shows which services are directly and indirectly impacted through the dependency graph.

- **Direct:** Services listed in `incident.affected_service_ids`
- **Indirect:** All services discovered by BFS traversal through approved `ServiceDependency` edges

---

### 2.6 Correlated Incidents (sidebar)
Shows other open incidents that are likely related, scored by:
- Dependency graph proximity (weight: 0.35)
- Shared recent deployments (weight: 0.25)
- Temporal proximity — fired within 10 min (weight: 0.15)
- Common error patterns (weight: 0.15)
- Historical co-occurrence (weight: 0.10)

---

### 2.7 Telemetry Tabs (center-bottom)

| Tab | Data source |
|---|---|
| Metrics | Prometheus (Mimir) — queries `http_server_request_duration_seconds_*` |
| Traces | Tempo — TraceQL search for `resource.service.name="{serviceName}"` |
| Logs | Loki — LogQL query filtered by `service_name` label |

---

### 2.8 Resolve Tab
AI-guided resolution workflow:
1. Click **Generate Resolution Plan** → backend queries LGTM for error logs + slow traces, matches runbooks, finds similar past incidents, sends to Claude AI
2. AI returns root cause diagnosis + confidence % + step-by-step plan
3. Each step shows source (AI / Runbook / Similar Incident), suggested command (copy-paste), and status
4. Trigger **Validate** → runs health checks, synthetic monitors, E2E test suites
5. Confirm resolution → auto-generates post-mortem draft + updates status page

---

### 2.9 Comms Tab
Generates audience-aware stakeholder update drafts:

| Audience | Visible to |
|---|---|
| Engineering | SRE Engineer (own channel only) |
| Engineering + Leadership + Customers + Status Page | SRE Manager, MSP Provider, Platform Admin |
| Customers + Status Page | Org Admin |

---

### 2.10 Learn Tab
Post-incident learning insights:
- **Recurrence Detection:** Found automatically from the timeline `ai_insight` entry added at incident creation when similar past incidents exist
- **Toil Tracking:** Repeated manual actions on the same service > 3 times in 30 days
- **Alert Quality:** Signal-to-noise score per alert rule (computed daily by worker)
- **Auto Post-Mortem:** Generated on resolution confirmation

---

## 3. Prerequisites — What You Must Configure

Follow these steps in order. Each section of the ICC has specific dependencies.

---

### STEP 1 — Create Services

Every ICC feature depends on services being defined.

**How:**  
Go to **Settings → Services → Add Service** or via API:

```bash
POST /api/v1/services
{
  "project_id": "<your-project-id>",
  "name": "payment-service",
  "type": "api",            # web | api | database | queue | cache | worker | storage
  "description": "Handles payment processing and billing",
  "notes": "Connection pool exhausts under high load\nRequires DB migration before deploy",
  "tags": ["pci", "critical", "revenue-critical"],
  "current_status": "operational"
}
```

**Key fields for ICC:**
- `name` — must match the `service_name` label in your Prometheus/Loki/Tempo metrics
- `description` — shown in Context Brief
- `notes` — shown as "Known Quirks" bullets (one per line)
- `tags` — used for runbook matching during AI diagnosis

---

### STEP 2 — Link On-Call Schedule to Each Service

**Required for:** Context Brief → On-Call field

**How:**  
1. Create an on-call schedule under **On-Call → Schedules → Create Schedule**
2. Link it to the service:

```bash
PATCH /api/v1/services/<service-id>
{ "oncall_schedule_id": "<schedule-id>" }
```

Or in the UI: **Services → [Service] → Edit → On-Call Schedule**

---

### STEP 3 — Link Owner Team to Each Service

**Required for:** Context Brief → Owner Team field

**How:**

```bash
PATCH /api/v1/services/<service-id>
{ "owner_id": "<team-id>" }
```

Teams are managed under **Settings → Teams**.

---

### STEP 4 — Set Up Service Dependencies (Topology Map)

**Required for:** Topology Map to show a graph (not empty state)

**Three options:**

#### Option A — Manual Definition
```bash
POST /api/v1/service-dependencies
{
  "source_service_id": "<api-gateway-id>",  # service that makes the call
  "target_service_id": "<payment-svc-id>",  # service being called
  "dependency_type": "http",               # http|grpc|tcp|database|queue|cache
  "criticality": "critical",               # critical|high|medium|low
  "status": "approved",
  "traffic_metadata": {
    "avg_requests_per_minute": 1200,
    "avg_latency_ms": 45,
    "error_rate_percent": 0.2
  }
}
```

#### Option B — Auto-Discovery via OTel Traces
Go to **Services → Topology → Discovery** → click **Trigger OTel Scan**.

The backend scans Tempo for parent-child span relationships and proposes edges. An admin then approves or rejects each proposed edge.

> **Requires:** Services instrumented with OpenTelemetry and traces flowing into your LGTM stack with `service.name` resource attribute matching your SREonCall service names.

#### Option C — Upload Architecture Diagram
Go to **Services → Topology → Upload** → upload a PNG/SVG/PDF of your architecture diagram.

AI extracts service-to-service relationships and proposes edges for approval.

---

### STEP 5 — Configure Business Impact (Required for Revenue/Users data)

**Required for:** Business Impact panel, Blast Radius revenue estimates

```bash
POST /api/v1/business-impact-configs
{
  "service_id": "<payment-service-id>",
  "revenue_per_request_cents": 850,        # $8.50 per successful transaction
  "avg_requests_per_minute": 45000,        # baseline traffic
  "total_user_count": 98000,
  "estimated_users_affected_percent": 100, # 0-100
  "affected_user_scope": "all",           # all | subset | internal_only
  "customer_tiers": [
    { "tier": "Enterprise", "count": 12, "sla_commitment": "99.95%" },
    { "tier": "Pro",        "count": 85, "sla_commitment": "99.9%" },
    { "tier": "Free",       "count": 320 }
  ]
}
```

In the UI: **Settings → Business Impact → Add Config**

> **Formula:** Revenue Impact/hr = `revenue_per_request_cents × avg_requests_per_minute × 60 ÷ 100`

---

### STEP 6 — Create SLA Configs (Required for SLA countdown timers)

**Required for:** SLA at-risk timers in Business Impact and Blast Radius

```bash
POST /api/v1/sla-configs
{
  "name": "P1 Critical SLA",
  "resolution_time_minutes": 30,
  "enabled": true,
  "conditions": [{ "field": "severity", "operator": "eq", "value": 1 }]
}
```

In the UI: **Settings → SLA → Add SLA Config**

> **How at-risk is calculated:** `remaining = sla.resolution_time_minutes - elapsed_minutes`. Shown when `remaining ≤ 30`.

---

### STEP 7 — Connect Observability Stack (LGTM)

**Required for:** Metrics/Traces/Logs tabs, health data in topology nodes, uptime_24h, AI diagnosis quality

#### Configure in SREonCall:
Go to **Settings → Observability → Add Connection**

| Field | Value |
|---|---|
| Mode | `managed` (SREonCall's own LGTM) or `byos` (Bring Your Own Stack) |
| Metrics URL | Your Mimir/Prometheus endpoint |
| Logs URL | Your Loki endpoint |
| Traces URL | Your Tempo endpoint |
| Org ID | Your tenant identifier (for `X-Scope-OrgID` header) |

#### Instrument your services:
- Use **OpenTelemetry SDK** with `service.name` resource attribute matching exactly your SREonCall service names
- Ensure metrics include: `http_server_request_duration_seconds_*`, `jvm_cpu_recent_utilization_ratio`, `jvm_memory_used_bytes`
- Ensure logs include: `service_name` label in Loki

---

### STEP 8 — Set Up Alert Rules (Required for "Fired Alerts" in What Changed)

**Required for:** What Changed → Fired Alerts row

1. Create alert rules under **Observability → Alert Rules → Create Rule**
2. Link each rule to a service:

```bash
PATCH /api/v1/alert-rules/<rule-id>
{ "service_id": "<payment-service-id>" }
```

When the Prometheus expression fires, SREonCall updates `alert_state: 'firing'` and `last_triggered_at`, which then appears in What Changed for any incident declared within 30 min.

---

### STEP 9 — Set Up CI/CD Integration (Required for "Recent Deploys" in What Changed)

**Required for:** What Changed → Recent Deploys row

Integrate your CI/CD pipeline to notify SREonCall when a deployment completes. This creates the `service.deploy` audit log entry.

**GitHub Actions example:**
```yaml
- name: Notify SREonCall of deployment
  run: |
    curl -X POST https://your-org.sreoncall.com/api/v1/services/$SERVICE_ID/deploy \
      -H "Authorization: Bearer $SREONCALL_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "version": "${{ github.sha }}",
        "deployed_by": "${{ github.actor }}",
        "commit_message": "${{ github.event.head_commit.message }}",
        "environment": "production"
      }'
```

---

### STEP 10 — Configure Runbooks (Improves Resolve tab quality)

**Optional but recommended:** The AI diagnosis uses matching runbooks to improve step generation quality.

```bash
POST /api/v1/runbooks
{
  "title": "payment-service: DB connection pool exhausted",
  "content": "# Diagnosis\n...\n# Steps\n1. Check pg_stat_activity\n2. ...",
  "service_ids": ["<payment-service-id>"],
  "tags": ["database", "payment", "pci"]
}
```

In the UI: **Operations → Runbooks → Create Runbook**

---

## 4. Creating an Incident That Shows Full ICC Data

Once steps 1–9 above are complete, declare an incident against an affected service:

```bash
POST /api/v1/incidents
{
  "title": "payment-service: elevated error rate",
  "description": "Payment service returning 503 on ~18% of requests. P99 latency 4.2s.",
  "severity": 2,
  "affected_service_ids": ["<payment-service-id>", "<api-gateway-id>"],
  "labels": ["payment", "database", "production"]
}
```

Or in the UI: **Incidents → Declare Incident**

---

## 5. Data Visibility by Persona

| Panel | SRE Engineer | SRE Manager | Platform Engineer | Org Admin | MSP Provider |
|---|---|---|---|---|---|
| Topology Map | ✅ Full | ✅ View-only | ✅ Full | ✅ Simplified | ✅ Full |
| Context Brief | ✅ Full | Summary | ✅ Full | Summary | Summary |
| What Changed | ✅ Full | Summary | ✅ Full | Summary | Summary |
| Metrics tab | ✅ | ✅ | ✅ | ❌ | ✅ |
| Traces / Logs | ✅ | ❌ | ✅ | ❌ | ❌ |
| Resolve tab | ✅ Can act | 👁 Read-only | ✅ Can act | ❌ | 👁 Read-only |
| Business Impact | ❌ Hidden | ✅ Full | ❌ Hidden | ✅ Full | ✅ Full |
| Comms tab | Engineering only | ✅ All | ❌ | Customer + Status | ✅ All |
| Compliance Clock | 👁 View | ✅ Manage | 👁 View | ✅ Manage | ✅ Manage |

---

## 6. Quick Checklist

Use this before going live to verify ICC will have full data:

```
□ Services created with name matching OTel service.name label
□ owner_id (team) linked to each service
□ oncall_schedule_id linked to each service + schedule has members
□ Service notes field populated with known operational quirks
□ ServiceDependency edges created + status: 'approved'
□ BusinessImpactConfig created for each revenue-generating service
□ SlaConfig created for each severity level
□ Observability connection configured (Mimir + Loki + Tempo)
□ OTel instrumentation deployed (correct service.name labels)
□ Alert rules created + linked to services
□ CI/CD pipeline integrated to send deployment events
□ Runbooks created for common failure modes (optional but recommended)
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Topology map shows empty state | No `ServiceDependency` records with `status: 'approved'` | Create and approve service dependency edges |
| "Unknown Service" in Context Brief | `affected_service_ids` not populated on incident | Update incident with correct service IDs |
| Owner Team / On-Call shows "—" | `owner_id` or `oncall_schedule_id` not set on service | PATCH the service with team and schedule IDs |
| Business Impact shows $0 | No `BusinessImpactConfig` for affected services | Create business impact config via Settings |
| What Changed shows empty | No matching audit log actions in 2h window before incident | Integrate CI/CD to send deploy events |
| Metrics/Traces/Logs unavailable | No observability connection or wrong `service.name` labels | Configure LGTM connection + verify OTel labels match |
| Resolve generates poor steps | No runbooks linked to service; no similar past incidents | Create service-specific runbooks |
| Compliance clock not showing | Incident not tagged with `gdpr`, `data-breach`, `dpdp`, or `personal-data` labels | Add correct label when declaring incident |
