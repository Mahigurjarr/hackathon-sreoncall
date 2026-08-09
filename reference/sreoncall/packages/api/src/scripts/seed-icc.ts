/**
 * Seed script for Incident Command Center (ICC) demo data.
 *
 * Creates a realistic service topology, active SEV-1 incident with resolution
 * plan, correlated incidents, business-impact configs, emerging risks, and an
 * alert-quality record — everything the ICC dashboard needs to look alive.
 *
 * Usage:
 *   npx tsx packages/api/src/scripts/seed-icc.ts [tenant-slug]
 *
 * Default tenant slug: platform
 */
import mongoose, { Types } from 'mongoose';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { Project } from '../models/project.model';
import { Service } from '../models/service.model';
import { ServiceDependency } from '../models/service-dependency.model';
import { Incident } from '../models/incident.model';
import { ResolutionPlan } from '../models/resolution-plan.model';
import { IncidentCorrelation } from '../models/incident-correlation.model';
import { BusinessImpactConfig } from '../models/business-impact-config.model';
import { EmergingRisk } from '../models/emerging-risk.model';
import { AlertQuality } from '../models/alert-quality.model';
import { AlertRule } from '../models/alert-rule.model';
import { getNextSequence } from '../models/counter.model';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sreoncall?replicaSet=rs0';

// ─── Service definitions ──────────────────────────────────────────────────────

const SERVICE_DEFS = [
  { name: 'api-gateway',    type: 'api'      as const, description: 'Edge API gateway — rate-limiting, routing, TLS termination', tags: ['edge', 'critical-path'] },
  { name: 'auth-service',   type: 'api'      as const, description: 'Authentication & authorization (JWT, OAuth, MFA)',            tags: ['auth', 'critical-path'] },
  { name: 'user-service',   type: 'api'      as const, description: 'User profile CRUD, preferences, RBAC',                       tags: ['core', 'backend'] },
  { name: 'payment-svc',    type: 'api'      as const, description: 'Payment processing, subscription billing, invoicing',         tags: ['billing', 'pci'] },
  { name: 'session-store',  type: 'cache'    as const, description: 'Distributed session store (Redis cluster)',                   tags: ['infra', 'stateful'] },
  { name: 'MongoDB',        type: 'database' as const, description: 'Primary data store — replica set rs0',                        tags: ['infra', 'stateful'] },
  { name: 'Redis',          type: 'cache'    as const, description: 'Caching layer and pub/sub bus',                               tags: ['infra', 'stateful'] },
] as const;

// Dependency edges: [source, target, dependency_type, criticality, port]
const DEPENDENCY_EDGES: Array<[string, string, string, string, number]> = [
  ['api-gateway',  'user-service',   'http', 'critical', 8080],
  ['api-gateway',  'auth-service',   'http', 'critical', 8081],
  ['user-service', 'MongoDB',        'tcp',  'critical', 27017],
  ['user-service', 'Redis',          'tcp',  'high',     6379],
  ['auth-service', 'payment-svc',    'grpc', 'high',     9090],
  ['auth-service', 'session-store',  'http', 'critical', 6380],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ago(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedICC(tenantSlug: string) {
  console.log(`\n=== ICC Seed — tenant "${tenantSlug}" ===\n`);

  // ── Resolve tenant, user, project ───────────────────────────────────────────

  const tenant = await Tenant.findOne({ slug: tenantSlug });
  if (!tenant) {
    console.error(`Tenant with slug "${tenantSlug}" not found. Run the main seed first.`);
    process.exit(1);
  }
  const tenantId = tenant._id as Types.ObjectId;

  const adminUser = await User.findOne({ tenant_id: tenantId, status: 'active' }).sort({ createdAt: 1 });
  if (!adminUser) {
    console.error('No active user found for this tenant.');
    process.exit(1);
  }
  const userId = adminUser._id as Types.ObjectId;

  let project = await Project.findOne({ tenant_id: tenantId });
  if (!project) {
    project = await Project.create({ tenant_id: tenantId, name: 'Default', created_by: userId });
    console.log('  Created Default project');
  }
  const projectId = project._id as Types.ObjectId;

  // ── 1. Services ─────────────────────────────────────────────────────────────

  console.log('1. Upserting services…');
  const serviceMap = new Map<string, Types.ObjectId>();

  for (const def of SERVICE_DEFS) {
    let svc = await Service.findOne({ tenant_id: tenantId, name: def.name });
    if (!svc) {
      svc = await Service.create({
        tenant_id: tenantId,
        project_id: projectId,
        name: def.name,
        description: def.description,
        type: def.type,
        current_status: def.name === 'auth-service' ? 'major_outage' : 'operational',
        tags: [...def.tags],
        enabled: true,
        created_by: userId,
      });
      console.log(`   + ${def.name}`);
    } else {
      console.log(`   = ${def.name} (exists)`);
    }
    serviceMap.set(def.name, svc._id as Types.ObjectId);
  }

  // ── 2. Service dependencies ─────────────────────────────────────────────────

  console.log('2. Upserting service dependencies…');

  for (const [src, tgt, depType, crit, port] of DEPENDENCY_EDGES) {
    const srcId = serviceMap.get(src)!;
    const tgtId = serviceMap.get(tgt)!;

    const existing = await ServiceDependency.findOne({
      tenant_id: tenantId,
      source_service_id: srcId,
      target_service_id: tgtId,
    });

    if (!existing) {
      await ServiceDependency.create({
        tenant_id: tenantId,
        source_service_id: srcId,
        target_service_id: tgtId,
        dependency_type: depType,
        criticality: crit,
        discovery_method: 'manual',
        status: 'approved',
        approved_by: userId,
        approved_at: ago(1440), // 1 day ago
        first_seen_at: ago(43200), // 30 days ago
        last_seen_at: ago(2),
        protocol_details: { port },
        traffic_metadata: {
          avg_requests_per_minute: Math.floor(Math.random() * 2000) + 200,
          avg_latency_ms: Math.floor(Math.random() * 40) + 5,
          error_rate_percent: depType === 'grpc' ? 4.2 : parseFloat((Math.random() * 0.5).toFixed(2)),
          last_updated_at: ago(2),
        },
        created_by: userId,
        version: 1,
      });
      console.log(`   + ${src} → ${tgt} (${depType})`);
    } else {
      console.log(`   = ${src} → ${tgt} (exists)`);
    }
  }

  // ── 3. Primary SEV-1 incident ───────────────────────────────────────────────

  console.log('3. Creating primary SEV-1 incident…');

  const authServiceId = serviceMap.get('auth-service')!;
  const paymentSvcId = serviceMap.get('payment-svc')!;

  const existingPrimary = await Incident.findOne({
    tenant_id: tenantId,
    title: 'auth-service high error rate — login failures across all tenants',
  });

  let primaryIncident: InstanceType<typeof Incident>;

  if (existingPrimary) {
    primaryIncident = existingPrimary;
    console.log(`   = Primary incident INC-${existingPrimary.number} exists`);
  } else {
    const incNumber = await getNextSequence(tenantId, 'incident');
    primaryIncident = await Incident.create({
      tenant_id: tenantId,
      number: incNumber,
      title: 'auth-service high error rate — login failures across all tenants',
      description:
        'auth-service error rate spiked to 34% starting 08:42 UTC. Login, token refresh, and OAuth flows are failing. ' +
        'Correlated with v2.14.0 deployment at 08:30 UTC. Multiple tenants reporting 500 errors on /auth/* endpoints.',
      severity: 1,
      status: 'acknowledged',
      type: 'availability',
      source: 'alert',
      affected_service_ids: [authServiceId],
      commander_id: userId,
      responders: [{ user_id: userId, role: 'incident_commander', joined_at: ago(38) }],
      timeline: [
        {
          timestamp: ago(42),
          type: 'alert',
          actor_id: null,
          message: 'Alert fired: auth-service error rate > 5% for 3 minutes (current: 34.2%)',
          metadata: { alert_name: 'auth-service-error-rate', threshold: 5, current_value: 34.2 },
        },
        {
          timestamp: ago(40),
          type: 'declaration',
          actor_id: userId,
          message: 'Incident declared as SEV-1 — auth-service is down',
          metadata: { severity: 1 },
        },
        {
          timestamp: ago(38),
          type: 'acknowledgment',
          actor_id: userId,
          message: 'Incident acknowledged by Platform Admin',
          metadata: {},
        },
        {
          timestamp: ago(32),
          type: 'ai_insight',
          actor_id: null,
          message: 'AI diagnosis: OOM crash in auth-service pods after v2.14.0 deploy. Memory limit 512Mi exceeded — peak usage 743Mi. Confidence: 87%.',
          metadata: {
            root_cause: 'OOM after v2.14.0 deployment',
            confidence: 87,
            memory_limit: '512Mi',
            peak_usage: '743Mi',
          },
        },
      ],
      metrics: {
        ack_at: ago(38),
        resolved_at: null,
        closed_at: null,
        mtta_seconds: 240, // 4 minutes from alert to ack
        mttr_seconds: null,
      },
      ai: {
        root_cause: 'OOM crash in auth-service pods after v2.14.0 deployment — memory limit 512Mi, peak 743Mi',
        confidence: 87,
        recommended_runbook_ids: [],
        last_analyzed_at: ago(32),
      },
      labels: ['sev1', 'auth', 'deploy-related'],
      created_by: userId,
    });
    console.log(`   + INC-${incNumber} created`);
  }

  // ── 4. Resolution plan ─────────────────────────────────────────────────────

  console.log('4. Creating resolution plan…');

  const existingPlan = await ResolutionPlan.findOne({
    tenant_id: tenantId,
    incident_id: primaryIncident._id,
  });

  if (existingPlan) {
    console.log('   = Resolution plan exists');
  } else {
    await ResolutionPlan.create({
      tenant_id: tenantId,
      incident_id: primaryIncident._id,
      status: 'in_progress',
      iteration: 1,
      diagnosis: {
        root_cause: 'OOM crash in auth-service pods after v2.14.0 deployment. The new session-caching feature allocates unbounded in-memory maps per tenant, exceeding the 512Mi container limit under production load.',
        confidence_percent: 87,
        confidence_level: 'high',
        evidence: [
          {
            type: 'recent_deploy',
            description: 'v2.14.0 deployed to auth-service at 08:30 UTC — 12 minutes before error spike',
            data: { deploy_id: 'deploy-2026-03-21-0830', version: 'v2.14.0', deployer: 'ci-pipeline' },
          },
          {
            type: 'metric_anomaly',
            description: 'Container memory usage spiked from 320Mi to 743Mi (limit: 512Mi) across all 3 pods',
            data: { metric: 'container_memory_working_set_bytes', before: '320Mi', after: '743Mi', limit: '512Mi' },
          },
          {
            type: 'log_error',
            description: 'OOMKilled events in kube-system logs for auth-service pods',
            data: { log_query: '{namespace="production", container="auth-service"} |= "OOMKilled"', count: 47 },
          },
        ],
        alternative_causes: [
          {
            description: 'Redis connection pool exhaustion causing retry storms',
            confidence_percent: 23,
            evidence: [
              { type: 'metric_anomaly', description: 'Redis connection count increased from 45 to 180' },
            ],
          },
        ],
        sources_used: [
          { type: 'ai_analysis', reference_id: null, reference_title: 'Claude analysis of logs + metrics' },
          { type: 'change_correlation', reference_id: 'deploy-2026-03-21-0830', reference_title: 'v2.14.0 deployment' },
          { type: 'dependency_graph', reference_id: null, reference_title: 'Service dependency topology' },
        ],
      },
      steps: [
        {
          order: 1,
          title: 'Rollback auth-service to v2.13.2',
          description: 'Revert the Kubernetes deployment to the last known good image tag v2.13.2',
          type: 'rollback',
          source: 'ai_suggested',
          suggested_command: 'kubectl rollout undo deployment/auth-service -n production --to-revision=42',
          status: 'completed',
          completed_by: userId,
          completed_at: ago(25),
          started_at: ago(28),
          duration_seconds: 180,
        },
        {
          order: 2,
          title: 'Verify pods are running and healthy',
          description: 'Confirm all 3 auth-service replicas are Running with Ready status',
          type: 'verification',
          source: 'ai_suggested',
          suggested_command: 'kubectl get pods -l app=auth-service -n production',
          status: 'completed',
          completed_by: userId,
          completed_at: ago(22),
          started_at: ago(24),
          duration_seconds: 120,
        },
        {
          order: 3,
          title: 'Check downstream payment-svc health',
          description: 'Verify payment-svc recovered from connection timeouts after auth-service rollback',
          type: 'verification',
          source: 'ai_suggested',
          suggested_command: 'curl -s http://payment-svc:9090/healthz | jq .',
          status: 'pending',
        },
        {
          order: 4,
          title: 'Run end-to-end login validation suite',
          description: 'Execute synthetic login flow across 3 sample tenants to confirm auth is functional',
          type: 'verification',
          source: 'ai_suggested',
          status: 'pending',
        },
      ],
      validations: [
        {
          iteration: 1,
          triggered_at: ago(20),
          completed_at: ago(18),
          status: 'partial',
          checks: [
            {
              name: 'auth-service /healthz',
              type: 'health_endpoint',
              target_service_id: authServiceId,
              status: 'passed',
              details: 'HTTP 200 in 12ms',
              executed_at: ago(20),
            },
            {
              name: 'Login error rate < 1%',
              type: 'metric_threshold',
              target_service_id: authServiceId,
              status: 'passed',
              details: 'Current error rate: 0.8% (threshold: 1%)',
              executed_at: ago(19),
            },
            {
              name: 'Token refresh latency p99 < 500ms',
              type: 'metric_threshold',
              target_service_id: authServiceId,
              status: 'passed',
              details: 'p99 latency: 340ms',
              executed_at: ago(19),
            },
            {
              name: 'Synthetic login — tenant "alyssum"',
              type: 'synthetic_monitor',
              target_service_id: authServiceId,
              status: 'passed',
              details: 'Login flow completed in 1.2s',
              executed_at: ago(18),
            },
            {
              name: 'payment-svc gRPC connectivity',
              type: 'dependency_health',
              target_service_id: paymentSvcId,
              status: 'failed',
              details: 'gRPC health check returned SERVING but latency is 2.4s (threshold: 500ms)',
              executed_at: ago(18),
            },
          ],
          ai_analysis_of_failure: 'payment-svc gRPC latency remains elevated (2.4s vs 500ms threshold). The auth-service rollback resolved login failures but payment-svc may still have stale connection pools from the outage period. Recommend restarting payment-svc pods.',
          additional_steps_suggested: true,
        },
      ],
      metrics: {
        diagnosis_time_seconds: 600, // 10 min
        total_resolution_time_seconds: null,
        steps_completed: 2,
        steps_skipped: 0,
        steps_total: 4,
        validation_attempts: 1,
        ai_tokens_used: { input: 24500, output: 3200 },
      },
      created_by: userId,
    });
    console.log('   + Resolution plan created (in_progress, 2/4 steps done, 1 validation partial)');
  }

  // ── 5. Correlated incidents ─────────────────────────────────────────────────

  console.log('5. Creating correlated incidents…');

  // 5a — payment-svc timeout
  let paymentInc = await Incident.findOne({
    tenant_id: tenantId,
    title: 'payment-svc upstream timeout — transaction processing delayed',
  });
  if (!paymentInc) {
    const payNum = await getNextSequence(tenantId, 'incident');
    paymentInc = await Incident.create({
      tenant_id: tenantId,
      number: payNum,
      title: 'payment-svc upstream timeout — transaction processing delayed',
      description: 'payment-svc gRPC calls to auth-service timing out. Transaction queue depth growing. Started ~5 min after auth-service error spike.',
      severity: 2,
      status: 'investigating',
      type: 'performance',
      source: 'alert',
      affected_service_ids: [paymentSvcId],
      commander_id: userId,
      responders: [{ user_id: userId, role: 'responder', joined_at: ago(35) }],
      timeline: [
        { timestamp: ago(37), type: 'alert', actor_id: null, message: 'Alert: payment-svc p99 latency > 2s for 5 min', metadata: {} },
        { timestamp: ago(35), type: 'acknowledgment', actor_id: userId, message: 'Acknowledged — likely caused by auth-service outage', metadata: {} },
      ],
      metrics: {
        ack_at: ago(35),
        mtta_seconds: 120,
      },
      labels: ['sev2', 'payments', 'cascading'],
      created_by: userId,
    });
    console.log(`   + INC-${payNum} (payment-svc timeout)`);
  } else {
    console.log(`   = INC-${paymentInc.number} (payment-svc timeout exists)`);
  }

  // 5b — notification-svc queue backup
  // We need a notification-svc service for this
  let notifSvc = await Service.findOne({ tenant_id: tenantId, name: 'notification-svc' });
  if (!notifSvc) {
    notifSvc = await Service.create({
      tenant_id: tenantId,
      project_id: projectId,
      name: 'notification-svc',
      description: 'Notification dispatch — email, Slack, SMS, push',
      type: 'worker',
      current_status: 'degraded',
      tags: ['notifications', 'async'],
      enabled: true,
      created_by: userId,
    });
  }
  const notifSvcId = notifSvc._id as Types.ObjectId;

  let notifInc = await Incident.findOne({
    tenant_id: tenantId,
    title: 'notification-svc queue backup — alert delivery delayed',
  });
  if (!notifInc) {
    const notifNum = await getNextSequence(tenantId, 'incident');
    notifInc = await Incident.create({
      tenant_id: tenantId,
      number: notifNum,
      title: 'notification-svc queue backup — alert delivery delayed',
      description: 'NATS JetStream consumer lag for notification-svc reached 12,400 messages. Alert and incident notifications delayed by ~8 minutes.',
      severity: 3,
      status: 'investigating',
      type: 'performance',
      source: 'alert',
      affected_service_ids: [notifSvcId],
      responders: [{ user_id: userId, role: 'responder', joined_at: ago(30) }],
      timeline: [
        { timestamp: ago(33), type: 'alert', actor_id: null, message: 'Alert: NATS consumer lag > 5000 for notification-svc', metadata: { lag: 12400 } },
        { timestamp: ago(30), type: 'acknowledgment', actor_id: userId, message: 'Acknowledged — downstream effect of auth-service incident', metadata: {} },
      ],
      metrics: {
        ack_at: ago(30),
        mtta_seconds: 180,
      },
      labels: ['sev3', 'notifications', 'cascading'],
      created_by: userId,
    });
    console.log(`   + INC-${notifNum} (notification-svc queue backup)`);
  } else {
    console.log(`   = INC-${notifInc.number} (notification-svc queue backup exists)`);
  }

  // 5c — IncidentCorrelation
  const existingCorr = await IncidentCorrelation.findOne({
    tenant_id: tenantId,
    parent_incident_id: primaryIncident._id,
  });

  if (!existingCorr) {
    await IncidentCorrelation.create({
      tenant_id: tenantId,
      parent_incident_id: primaryIncident._id,
      correlated_incident_ids: [primaryIncident._id, paymentInc._id, notifInc._id],
      status: 'confirmed',
      correlation_type: 'cascading_failure',
      confidence_percent: 87,
      evidence: [
        {
          type: 'dependency_graph',
          description: 'auth-service is upstream of payment-svc (gRPC) and notification-svc (via NATS events)',
          weight: 0.45,
        },
        {
          type: 'temporal_proximity',
          description: 'All three incidents started within a 10-minute window following the v2.14.0 deployment',
          weight: 0.30,
        },
        {
          type: 'shared_deployment',
          description: 'v2.14.0 deployment at 08:30 UTC preceded all three failure modes',
          weight: 0.25,
        },
      ],
      confirmed_by: userId,
      confirmed_at: ago(28),
    });
    console.log('   + Correlation created (cascading_failure, 87% confidence)');
  } else {
    console.log('   = Correlation exists');
  }

  // ── 6. Business impact configs ──────────────────────────────────────────────

  console.log('6. Upserting business impact configs…');

  const impactConfigs = [
    {
      service_id: authServiceId,
      // $18,400/hr ≈ roughly 30.67 cents per request at 1000 req/min
      revenue_per_request_cents: 31,
      avg_requests_per_minute: 1000,
      affected_user_scope: 'all' as const,
      estimated_users_affected_percent: 100,
      total_user_count: 4200,
      customer_tiers: [
        { tier: 'Enterprise', count: 3, sla_commitment: '99.99% uptime, 15-min response' },
        { tier: 'Pro', count: 12, sla_commitment: '99.9% uptime, 1-hr response' },
        { tier: 'Free', count: 89, sla_commitment: null },
      ],
      notes: 'Auth-service is on the critical path for every authenticated request. Full outage = full revenue impact.',
    },
    {
      service_id: paymentSvcId,
      // $12,000/hr ≈ 20 cents per request at 1000 req/min
      revenue_per_request_cents: 20,
      avg_requests_per_minute: 1000,
      affected_user_scope: 'subset' as const,
      estimated_users_affected_percent: 67,
      total_user_count: 2800,
      customer_tiers: [
        { tier: 'Enterprise', count: 3, sla_commitment: '99.99% uptime, 15-min response' },
        { tier: 'Pro', count: 8, sla_commitment: '99.9% uptime, 1-hr response' },
      ],
      notes: 'Payment processing directly impacts revenue collection. Degraded latency delays transaction settlement.',
    },
  ];

  for (const cfg of impactConfigs) {
    const existing = await BusinessImpactConfig.findOne({
      tenant_id: tenantId,
      service_id: cfg.service_id,
    });
    if (!existing) {
      await BusinessImpactConfig.create({
        tenant_id: tenantId,
        ...cfg,
        updated_by: userId,
      });
      const svcName = cfg.service_id.equals(authServiceId) ? 'auth-service' : 'payment-svc';
      console.log(`   + ${svcName} business impact`);
    } else {
      const svcName = cfg.service_id.equals(authServiceId) ? 'auth-service' : 'payment-svc';
      console.log(`   = ${svcName} business impact (exists)`);
    }
  }

  // ── 7. Emerging risks ───────────────────────────────────────────────────────

  console.log('7. Creating emerging risks…');

  const risks = [
    {
      service_id: paymentSvcId,
      risk_type: 'metric_trending' as const,
      severity: 'warning' as const,
      description: 'payment-svc memory usage trending up — projected to hit container limit within 4 hours',
      current_value: '412Mi / 512Mi (80.5%)',
      projected_value: '512Mi (100%)',
      projected_breach_at: new Date(Date.now() + 4 * 3600_000),
      recommendation: 'Increase memory limit to 768Mi or investigate memory leak in gRPC connection pool',
    },
    {
      service_id: authServiceId,
      risk_type: 'slo_burn_rate' as const,
      severity: 'warning' as const,
      description: 'auth-service SLO burn rate at 4.2x — current 30-day error budget will be exhausted in 7.1 days at this rate',
      current_value: 'Burn rate: 4.2x (budget: 0.1%, consumed: 0.42% in 24h)',
      projected_value: 'Budget exhaustion in 7.1 days',
      projected_breach_at: new Date(Date.now() + 7.1 * 86400_000),
      recommendation: 'Resolve current incident and monitor post-rollback error rate. Consider adding circuit breaker for auth → payment-svc calls.',
    },
  ];

  for (const risk of risks) {
    const existing = await EmergingRisk.findOne({
      tenant_id: tenantId,
      service_id: risk.service_id,
      risk_type: risk.risk_type,
      cleared_at: null,
    });
    if (!existing) {
      await EmergingRisk.create({ tenant_id: tenantId, ...risk });
      console.log(`   + ${risk.risk_type}: ${risk.description.slice(0, 60)}…`);
    } else {
      console.log(`   = ${risk.risk_type} (exists)`);
    }
  }

  // ── 8. Alert quality record (noisy alert example) ───────────────────────────

  console.log('8. Creating alert quality record…');

  // First ensure an AlertRule exists for the noisy alert
  let alertRule = await AlertRule.findOne({
    tenant_id: tenantId,
    name: 'auth-service-error-rate',
  });

  if (!alertRule) {
    alertRule = await AlertRule.create({
      tenant_id: tenantId,
      name: 'auth-service-error-rate',
      description: 'Fires when auth-service HTTP 5xx rate exceeds threshold',
      service_id: authServiceId,
      status: 'active',
      severity: 'critical',
      source_type: 'managed_promql',
      query: 'rate(http_requests_total{service="auth-service",code=~"5.."}[5m]) / rate(http_requests_total{service="auth-service"}[5m]) * 100 > 5',
      condition: { metric: 'http_error_rate_percent', operator: 'gt', threshold: 5, window_minutes: 5 },
      for_duration_seconds: 180,
      auto_create_incident: true,
      incident_severity: 'sev1',
      alert_state: 'firing',
      last_triggered_at: ago(42),
      last_value: 34.2,
      trigger_count: 47,
      is_predefined: false,
      created_by: userId,
    });
    console.log('   + Alert rule "auth-service-error-rate" created');
  }

  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 7);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date();
  periodEnd.setHours(23, 59, 59, 999);

  const existingAQ = await AlertQuality.findOne({
    tenant_id: tenantId,
    alert_rule_id: alertRule._id,
    period_start: periodStart,
  });

  if (!existingAQ) {
    await AlertQuality.create({
      tenant_id: tenantId,
      alert_rule_id: alertRule._id,
      period_start: periodStart,
      period_end: periodEnd,
      total_firings: 47,
      acknowledged_count: 8,
      dismissed_count: 31,
      incident_created_count: 3,
      auto_resolved_count: 5,
      avg_time_to_action_seconds: 342,
      signal_score: 23,
      noise_score: 77,
      recommendation: 'retune_threshold',
      recommendation_details:
        'This alert fired 47 times in the last 7 days but only 3 firings resulted in incidents (6.4% signal). ' +
        '31 firings were dismissed without action (66% noise). Recommend raising the threshold from 5% to 15% error rate ' +
        'and increasing the evaluation window from 5 to 10 minutes to reduce false positives.',
      suggested_threshold: 15,
      current_threshold: 5,
    });
    console.log('   + Alert quality record (noisy: 77% noise score, recommend retune)');
  } else {
    console.log('   = Alert quality record exists');
  }

  console.log('\n=== ICC seed complete ===\n');
  console.log('Summary:');
  console.log(`  Services:      ${SERVICE_DEFS.length + 1} (7 core + notification-svc)`);
  console.log(`  Dependencies:  ${DEPENDENCY_EDGES.length}`);
  console.log(`  Incidents:     3 (SEV-1 primary + SEV-2 payment + SEV-3 notification)`);
  console.log(`  Resolution:    1 plan (in_progress, 2/4 steps, 1 partial validation)`);
  console.log(`  Correlations:  1 (cascading_failure, 87% confidence)`);
  console.log(`  Biz impact:    2 configs (auth-service, payment-svc)`);
  console.log(`  Risks:         2 emerging (memory trend + SLO burn rate)`);
  console.log(`  Alert quality: 1 record (noisy alert — 77% noise score)`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const slug = process.argv[2] || 'platform';

  (async () => {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to MongoDB (${MONGODB_URI})`);

    await seedICC(slug);

    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('ICC seed failed:', err);
    process.exit(1);
  });
}

export { seedICC };
