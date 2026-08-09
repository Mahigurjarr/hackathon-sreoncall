import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { Incident } from '../models/incident.model';
import { Service } from '../models/service.model';
import { Runbook } from '../models/runbook.model';
import { ServiceDependency } from '../models/service-dependency.model';
import net from 'net';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { ValidationSuite } from '../models/validation-suite.model';
import { ResolutionPlan } from '../models/resolution-plan.model';
import * as aiService from '../services/ai.service';
import * as lgtm from '../services/lgtm-query.service';
import * as syntheticCheckService from '../services/synthetic-check.service';
import {
  detectComplianceRegulation,
  buildComplianceResolutionSteps,
  hasResolutionStepsInjected,
  markResolutionStepsInjected,
} from '../services/incident-compliance.service';
import { assertUrlSafe, assertHostSafe } from '../utils/ssrf-guard';

const STREAM_NAME = 'ICC_RESOLUTION';
const CONSUMER_NAME = 'icc-resolution-processor';
let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.resolution.>'],
      retention: 'workqueue' as any,
      max_msgs: 100_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_RESOLUTION stream created');
  }
}

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_deliver: 3,
      ack_wait: 120_000_000_000, // 2 minutes (AI calls can be slow)
    });
    logger.info('Resolution worker consumer created');
  }
}

async function handleDiagnose(data: any): Promise<void> {
  const { tenant_id, incident_id, plan_id, triggered_by } = data;
  const tenantId = new Types.ObjectId(tenant_id);
  const incidentId = new Types.ObjectId(incident_id);

  logger.info('Resolution worker: starting diagnosis', { incident_id, plan_id });

  // Fetch incident
  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId });
  if (!incident) {
    throw new Error(`Incident ${incident_id} not found`);
  }

  // Fetch affected service (use first affected service as primary)
  const primaryServiceId = incident.affected_service_ids?.[0] || null;
  const service = primaryServiceId
    ? await Service.findById(primaryServiceId)
    : null;

  // Fetch dependency graph for affected service
  const dependencies = primaryServiceId
    ? await ServiceDependency.find({
        tenant_id: tenantId,
        status: 'approved',
        $or: [
          { source_service_id: primaryServiceId },
          { target_service_id: primaryServiceId },
        ],
      })
    : [];

  // Fetch matching runbooks by service tags
  const runbooks = service
    ? await Runbook.find({
        tenant_id: tenantId,
        $or: [
          { service_ids: primaryServiceId },
          { tags: { $in: incident.labels || [] } },
        ],
      }).limit(5)
    : [];

  // Find similar past incidents on the same service
  const similarIncidents = primaryServiceId
    ? await Incident.find({
        tenant_id: tenantId,
        affected_service_ids: primaryServiceId,
        status: 'resolved',
        _id: { $ne: incidentId },
      })
        .sort({ createdAt: -1 })
        .limit(5)
    : [];

  // Query LGTM stack for correlated telemetry (error logs, metric anomalies, slow traces)
  const incidentCreatedAt = new Date((incident as any).createdAt || Date.now());
  const windowStart = Math.floor(incidentCreatedAt.getTime() / 1000) - 2 * 3600; // 2h before
  const windowEnd = Math.floor(Date.now() / 1000);
  const svcName = service?.name || '';
  const tid = tenant_id;

  // Use OTel-compatible labels (service_name, not service) and flexible log matching
  const baseName = svcName.replace(/-service$/, '');
  const logQuery = `{job="docker", service_name=~"${svcName}|${baseName}|.*${baseName}.*"} |~ "(?i)error|warn|exception|fatal|panic|timeout"`;
  const metricQuery = `sum(rate(http_server_request_duration_seconds_count{service_name="${svcName}",http_response_status_code=~"5.."}[5m]))`;

  const [errorLogs, metricSamples, slowTraces] = await Promise.all([
    svcName
      ? lgtm.queryLogs(tid, logQuery, windowStart, windowEnd, 50)
      : Promise.resolve([]),
    svcName
      ? lgtm.queryMetrics(tid, metricQuery, windowStart, windowEnd, '300s')
      : Promise.resolve([]),
    svcName
      ? lgtm.queryTraces(tid, { serviceName: svcName, startTime: windowStart, endTime: windowEnd, limit: 20, minDurationMs: 500 })
      : Promise.resolve([]),
  ]);

  // Build AI context
  const contextParts = [
    `Incident: ${incident.title} (Severity: ${incident.severity})`,
    `Status: ${incident.status}`,
    `Description: ${incident.description || 'No description'}`,
    service ? `Service: ${service.name} (${service.type || 'unknown'})` : '',
    dependencies.length > 0
      ? `Dependencies: ${dependencies.map((d) => `${d.source_service_id} → ${d.target_service_id} (${d.dependency_type})`).join(', ')}`
      : '',
    runbooks.length > 0
      ? `Related runbooks: ${runbooks.map((r) => r.title).join(', ')}`
      : '',
    similarIncidents.length > 0
      ? `Similar past incidents: ${similarIncidents.map((i) => `${i.title} (root_cause: ${(i as any).root_cause || 'unknown'})`).join('; ')}`
      : '',
    errorLogs.length > 0
      ? `Recent error logs (${errorLogs.length} entries): ${errorLogs.slice(0, 10).map((l) => l.line.slice(0, 200)).join('\n')}`
      : '',
    metricSamples.length > 0
      ? `Error rate metric data available (${metricSamples.length} series over last 2h)`
      : '',
    slowTraces.length > 0
      ? `Slow traces (>1s): ${slowTraces.slice(0, 5).map((t) => `${t.rootServiceName}/${t.rootTraceName} ${t.durationMs}ms`).join(', ')}`
      : '',
  ].filter(Boolean);

  // Call AI service for diagnosis
  const diagnosisResult = await aiService.generateCompletion({
    tenantId: tid,
    system: `You are an expert SRE engineer diagnosing and resolving production incidents. Based on the incident context, telemetry data, service dependencies, and any error logs or traces provided, generate a comprehensive diagnosis and step-by-step resolution plan.

You MUST return a valid JSON object (no markdown, no code fences) with these fields:

{
  "root_cause": "Detailed root cause analysis (2-3 sentences minimum)",
  "confidence_percent": 0-100,
  "evidence": [
    {"type": "log_error|metric_anomaly|trace_latency|dependency_failure|config_change|recent_deploy|similar_incident", "description": "..."}
  ],
  "alternative_causes": [
    {"description": "...", "confidence_percent": 0-100, "evidence": [{"type": "...", "description": "..."}]}
  ],
  "steps": [
    {
      "order": 1,
      "title": "Step title",
      "description": "Detailed description of what to do and why",
      "type": "manual|command|rollback|restart|scale|config_change|verification|custom",
      "suggested_command": "shell command if applicable, or null"
    }
  ]
}

IMPORTANT: Always generate at least 4-6 resolution steps covering: investigation, mitigation, fix, verification, and prevention. Even if telemetry data is limited, use your SRE expertise to suggest common troubleshooting steps for the service type and error pattern described.`,
    userMessage: contextParts.join('\n'),
  });

  // Parse AI response
  let diagnosis: any;
  let steps: any[] = [];
  try {
    const parsed = JSON.parse(diagnosisResult.text);
    const confidencePercent = parsed.confidence_percent || 50;
    diagnosis = {
      root_cause: parsed.root_cause || 'Unable to determine root cause',
      confidence_percent: confidencePercent,
      confidence_level: confidencePercent > 70 ? 'high' : confidencePercent >= 40 ? 'medium' : 'low',
      evidence: (parsed.evidence || []).map((e: any) => ({
        type: e.type,
        description: e.description,
        data: null,
      })),
      alternative_causes: (parsed.alternative_causes || []).map((ac: any) => ({
        description: ac.description || '',
        confidence_percent: ac.confidence_percent || 0,
        evidence: Array.isArray(ac.evidence)
          ? ac.evidence.map((e: any) => ({ type: e.type || 'ai_analysis', description: e.description || String(e) }))
          : typeof ac.evidence === 'string'
            ? [{ type: 'ai_analysis', description: ac.evidence }]
            : [],
      })),
      sources_used: [
        { type: 'ai_analysis', reference_id: null, reference_title: null },
        ...runbooks.map((r) => ({
          type: 'runbook' as const,
          reference_id: r._id.toString(),
          reference_title: r.title,
        })),
        ...similarIncidents.map((i) => ({
          type: 'similar_incident' as const,
          reference_id: i._id.toString(),
          reference_title: i.title,
        })),
      ],
    };
    steps = (parsed.steps || []).map((s: any, idx: number) => ({
      order: s.order || idx + 1,
      title: s.title,
      description: s.description,
      type: s.type || 'manual',
      source: 'ai_suggested',
      source_reference: null,
      suggested_command: s.suggested_command || null,
      status: 'pending',
      completed_by: null,
      completed_at: null,
      skipped_reason: null,
      notes: null,
      duration_seconds: null,
      started_at: null,
    }));
  } catch {
    diagnosis = {
      root_cause: diagnosisResult.text || 'AI diagnosis returned unparseable response',
      confidence_percent: 20,
      confidence_level: 'low',
      evidence: [],
      alternative_causes: [],
      sources_used: [{ type: 'ai_analysis', reference_id: null, reference_title: null }],
    };
  }

  // FRD §9: inject compliance response steps for GDPR/DPDP-triggering incidents,
  // once per incident (re-diagnosis shouldn't duplicate them).
  const complianceRegulation = detectComplianceRegulation((incident as any).labels);
  if (complianceRegulation && !(await hasResolutionStepsInjected(tenantId, incidentId))) {
    steps.push(...buildComplianceResolutionSteps(complianceRegulation, steps.length));
    await markResolutionStepsInjected(tenantId, incidentId);
  }

  // Update resolution plan
  await ResolutionPlan.findByIdAndUpdate(plan_id, {
    status: 'steps_generated',
    diagnosis,
    steps,
    'metrics.diagnosis_time_seconds': Math.round(
      (Date.now() - new Date((await ResolutionPlan.findById(plan_id))?.createdAt || Date.now()).getTime()) / 1000
    ),
    'metrics.steps_total': steps.length,
    'metrics.ai_tokens_used': {
      input: diagnosisResult.input_tokens,
      output: diagnosisResult.output_tokens,
    },
    updated_at: new Date(),
  });

  logger.info('Resolution worker: diagnosis complete', {
    incident_id,
    plan_id,
    confidence: diagnosis.confidence_level,
    steps_count: steps.length,
  });
}

async function handleValidate(data: any): Promise<void> {
  const { tenant_id, incident_id, plan_id, iteration } = data;
  const tenantId = new Types.ObjectId(tenant_id);
  const incidentId = new Types.ObjectId(incident_id);

  logger.info('Resolution worker: starting validation', { incident_id, plan_id, iteration });

  const plan = await ResolutionPlan.findById(plan_id);
  if (!plan) {
    throw new Error(`Resolution plan ${plan_id} not found`);
  }

  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId });
  if (!incident) {
    throw new Error(`Incident ${incident_id} not found`);
  }

  const checks: any[] = [];
  // Collect async check promises for concurrent execution
  const asyncChecks: Array<Promise<any>> = [];

  // 1. Check health endpoints of affected services
  const primaryServiceId = incident.affected_service_ids?.[0] || null;
  if (primaryServiceId) {
    const service = await Service.findById(primaryServiceId);
    if (service) {
      // Query LGTM for service health metrics
      const svcHealth = await lgtm.getServiceHealth(tenant_id, service.name);
      const healthStatus = svcHealth.error_rate_percent != null && svcHealth.error_rate_percent < 5
        ? 'passed'
        : svcHealth.error_rate_percent != null
          ? 'failed'
          : 'skipped';
      const healthDetails = svcHealth.error_rate_percent != null
        ? `error_rate=${svcHealth.error_rate_percent.toFixed(2)}%, latency_p99=${svcHealth.latency_p99_ms?.toFixed(0) ?? 'N/A'}ms`
        : 'LGTM unreachable — skipped health check';
      checks.push({
        name: `Health check: ${service.name}`,
        type: 'health_endpoint',
        target_service_id: service._id,
        synthetic_check_id: null,
        status: healthStatus,
        details: healthDetails,
        executed_at: new Date(),
      });
    }

    // 2. Check synthetic monitors on affected services
    const syntheticChecks = await SyntheticCheck.find({
      tenant_id: tenantId,
      service_id: primaryServiceId,
      is_active: true,
    });
    for (const sc of syntheticChecks) {
      const checkPromise = syntheticCheckService.runCheck(sc as any)
        .then((result) => ({
          name: `Synthetic monitor: ${sc.name}`,
          type: 'synthetic_monitor' as const,
          target_service_id: primaryServiceId,
          synthetic_check_id: sc._id,
          status: result.status === 'up' ? 'passed' as const : 'failed' as const,
          details: result.error
            ? `${result.status} — ${result.error} (${result.response_time_ms}ms)`
            : `${result.status} — response_time=${result.response_time_ms}ms`,
          executed_at: new Date(),
        }))
        .catch((err: any) => ({
          name: `Synthetic monitor: ${sc.name}`,
          type: 'synthetic_monitor' as const,
          target_service_id: primaryServiceId,
          synthetic_check_id: sc._id,
          status: 'failed' as const,
          details: `Check execution error: ${err.message}`,
          executed_at: new Date(),
        }));
      asyncChecks.push(checkPromise);
    }

    // 3. Check downstream dependency health
    const downstreamDeps = await ServiceDependency.find({
      tenant_id: tenantId,
      source_service_id: primaryServiceId,
      status: 'approved',
    });
    for (const dep of downstreamDeps) {
      const targetService = await Service.findById(dep.target_service_id);
      if (targetService) {
        // Query LGTM for downstream dependency health
        const depHealth = await lgtm.getServiceHealth(tenant_id, targetService.name);
        const depStatus = depHealth.error_rate_percent != null && depHealth.error_rate_percent < 5
          ? 'passed'
          : depHealth.error_rate_percent != null
            ? 'failed'
            : 'skipped';
        const depDetails = depHealth.error_rate_percent != null
          ? `error_rate=${depHealth.error_rate_percent.toFixed(2)}%, latency_p99=${depHealth.latency_p99_ms?.toFixed(0) ?? 'N/A'}ms`
          : 'LGTM unreachable — skipped dependency check';
        checks.push({
          name: `Dependency health: ${targetService.name}`,
          type: 'dependency_health',
          target_service_id: targetService._id,
          synthetic_check_id: null,
          status: depStatus,
          details: depDetails,
          executed_at: new Date(),
        });
      }
    }
  }

  // 4. Run tenant E2E validation suites
  const validationSuites = await ValidationSuite.find({
    tenant_id: tenantId,
    service_ids: primaryServiceId,
    trigger: { $in: ['on_resolution', 'both'] },
  });
  for (const suite of validationSuites) {
    for (const check of (suite as any).checks || []) {
      const checkPromise = (async (): Promise<typeof checks[number]> => {
        try {
          let status: string = 'passed';
          let details: string | null = null;

          if (check.type === 'http' && check.url) {
            // HTTP check: fetch URL and verify status code
            await assertUrlSafe(check.url);
            const start = Date.now();
            const resp = await fetch(check.url, {
              method: check.method || 'GET',
              signal: AbortSignal.timeout(check.timeout_ms || 10000),
            });
            const elapsed = Date.now() - start;
            const expectedStatus = check.expected_status || 200;
            if (resp.status !== expectedStatus) {
              status = 'failed';
              details = `HTTP ${resp.status} (expected ${expectedStatus}), ${elapsed}ms`;
            } else {
              details = `HTTP ${resp.status} OK, ${elapsed}ms`;
            }
          } else if (check.type === 'tcp' && check.host) {
            // TCP check: connect to host:port
            const port = check.port || 80;
            await assertHostSafe(check.host, port);
            const timeoutMs = check.timeout_ms || 5000;
            await new Promise<void>((resolve, reject) => {
              const socket = new net.Socket();
              const timer = setTimeout(() => { socket.destroy(); reject(new Error(`TCP timeout after ${timeoutMs}ms`)); }, timeoutMs);
              socket.connect(port, check.host, () => { clearTimeout(timer); socket.destroy(); resolve(); });
              socket.on('error', (err) => { clearTimeout(timer); reject(err); });
            });
            details = `TCP ${check.host}:${port} connected`;
          } else if (check.type === 'custom_script' && check.webhook_url) {
            // Custom script: call webhook URL and check response
            await assertUrlSafe(check.webhook_url);
            const resp = await fetch(check.webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ suite_name: suite.name, check_name: check.name }),
              signal: AbortSignal.timeout(check.timeout_ms || 30000),
            });
            const body = await resp.json().catch(() => ({})) as any;
            if (!resp.ok || body.status === 'failed') {
              status = 'failed';
              details = `Custom script returned ${resp.status}: ${body.message || 'failed'}`;
            } else {
              details = `Custom script passed: ${body.message || 'OK'}`;
            }
          } else {
            status = 'skipped';
            details = `Unsupported check type: ${check.type}`;
          }

          return {
            name: `E2E: ${suite.name} - ${check.name}`,
            type: 'tenant_e2e',
            target_service_id: null,
            synthetic_check_id: null,
            status,
            details,
            executed_at: new Date(),
          };
        } catch (err: any) {
          return {
            name: `E2E: ${suite.name} - ${check.name}`,
            type: 'tenant_e2e',
            target_service_id: null,
            synthetic_check_id: null,
            status: 'failed',
            details: `Check error: ${err.message}`,
            executed_at: new Date(),
          };
        }
      })();
      asyncChecks.push(checkPromise);
    }
  }

  // Execute all async checks concurrently and collect results
  const asyncResults = await Promise.allSettled(asyncChecks);
  for (const result of asyncResults) {
    if (result.status === 'fulfilled') {
      checks.push(result.value);
    } else {
      checks.push({
        name: 'Unknown check',
        type: 'tenant_e2e',
        target_service_id: null,
        synthetic_check_id: null,
        status: 'failed',
        details: `Unexpected error: ${result.reason?.message || 'unknown'}`,
        executed_at: new Date(),
      });
    }
  }

  // Determine overall validation status
  const failedChecks = checks.filter((c) => c.status === 'failed');
  const passedChecks = checks.filter((c) => c.status === 'passed');
  let validationStatus: string;
  let aiAnalysis: string | null = null;
  let additionalStepsSuggested = false;

  if (checks.length === 0 || passedChecks.length === checks.length) {
    validationStatus = 'passed';
  } else if (failedChecks.length === checks.length) {
    validationStatus = 'failed';
  } else {
    validationStatus = 'partial';
  }

  // If partial or failed, call AI to analyze failures and suggest additional steps
  if (validationStatus === 'partial' || validationStatus === 'failed') {
    const failureDetails = failedChecks
      .map((c) => `${c.name}: ${c.details || 'failed'}`)
      .join('\n');

    const analysisResult = await aiService.generateCompletion({
      tenantId: tenant_id,
      system: 'You are an SRE expert. Analyze why validation checks failed after incident resolution and suggest what else needs to be done. Return plain text analysis.',
      userMessage: `Incident: ${incident.title}\nFailed checks:\n${failureDetails}`,
    });

    aiAnalysis = analysisResult.text;
    additionalStepsSuggested = validationStatus === 'partial';
  }

  // Create validation entry
  const validationEntry = {
    iteration: iteration || plan.iteration || 1,
    triggered_at: new Date(),
    completed_at: new Date(),
    status: validationStatus,
    checks,
    ai_analysis_of_failure: aiAnalysis,
    additional_steps_suggested: additionalStepsSuggested,
  };

  // Determine plan status based on validation
  let planStatus: string;
  if (validationStatus === 'passed') {
    planStatus = 'validated_pass';
  } else if (validationStatus === 'partial') {
    planStatus = 'validated_partial';
  } else {
    planStatus = 'validated_fail';
  }

  await ResolutionPlan.findByIdAndUpdate(plan_id, {
    status: planStatus,
    $push: { validations: validationEntry },
    $inc: { 'metrics.validation_attempts': 1 },
    updated_at: new Date(),
  });

  logger.info('Resolution worker: validation complete', {
    incident_id,
    plan_id,
    validation_status: validationStatus,
    checks_total: checks.length,
    checks_passed: passedChecks.length,
    checks_failed: failedChecks.length,
  });
}

async function handleRediagnose(data: any): Promise<void> {
  const { tenant_id, incident_id, plan_id, previous_validation_failures } = data;
  const tenantId = new Types.ObjectId(tenant_id);
  const incidentId = new Types.ObjectId(incident_id);

  logger.info('Resolution worker: starting re-diagnosis', { incident_id, plan_id });

  const plan = await ResolutionPlan.findById(plan_id);
  if (!plan) {
    throw new Error(`Resolution plan ${plan_id} not found`);
  }

  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId });
  if (!incident) {
    throw new Error(`Incident ${incident_id} not found`);
  }

  // Build context with previous diagnosis and validation failures
  const contextParts = [
    `Incident: ${incident.title} (Severity: ${incident.severity})`,
    `Previous diagnosis: ${plan.diagnosis?.root_cause || 'unknown'}`,
    `Previous confidence: ${plan.diagnosis?.confidence_percent || 0}%`,
    `Iteration: ${(plan.iteration || 1) + 1}`,
  ];

  // Include validation failure context
  const lastValidation = plan.validations?.[plan.validations.length - 1];
  if (lastValidation) {
    const failedChecks = (lastValidation as any).checks?.filter((c: any) => c.status === 'failed') || [];
    if (failedChecks.length > 0) {
      contextParts.push(`Previous validation failures:\n${failedChecks.map((c: any) => `- ${c.name}: ${c.details || 'failed'}`).join('\n')}`);
    }
    if ((lastValidation as any).ai_analysis_of_failure) {
      contextParts.push(`Previous failure analysis: ${(lastValidation as any).ai_analysis_of_failure}`);
    }
  }

  if (previous_validation_failures) {
    contextParts.push(`Additional failure context: ${previous_validation_failures}`);
  }

  // Call AI for re-diagnosis with additional context
  const rediagnosisResult = await aiService.generateCompletion({
    tenantId: tenant_id,
    system: `You are an SRE expert re-diagnosing a production incident after previous resolution steps failed validation. The previous diagnosis was incorrect or incomplete. Analyze the new evidence from validation failures and provide an updated diagnosis.
Return a JSON object with: root_cause, confidence_percent, evidence (array of {type, description}), steps (array of {order, title, description, type, suggested_command}).
Return valid JSON only.`,
    userMessage: contextParts.join('\n'),
  });

  let diagnosis: any;
  let steps: any[] = [];
  try {
    const parsed = JSON.parse(rediagnosisResult.text);
    const confidencePercent = parsed.confidence_percent || 40;
    diagnosis = {
      root_cause: parsed.root_cause || 'Unable to determine root cause on re-diagnosis',
      confidence_percent: confidencePercent,
      confidence_level: confidencePercent > 70 ? 'high' : confidencePercent >= 40 ? 'medium' : 'low',
      evidence: (parsed.evidence || []).map((e: any) => ({
        type: e.type,
        description: e.description,
        data: null,
      })),
      alternative_causes: (parsed.alternative_causes || []).map((ac: any) => ({
        description: ac.description || '',
        confidence_percent: ac.confidence_percent || 0,
        evidence: Array.isArray(ac.evidence)
          ? ac.evidence.map((e: any) => ({ type: e.type || 'ai_analysis', description: e.description || String(e) }))
          : typeof ac.evidence === 'string'
            ? [{ type: 'ai_analysis', description: ac.evidence }]
            : [],
      })),
      sources_used: [{ type: 'ai_analysis', reference_id: null, reference_title: null }],
    };
    steps = (parsed.steps || []).map((s: any, idx: number) => ({
      order: s.order || idx + 1,
      title: s.title,
      description: s.description,
      type: s.type || 'manual',
      source: 'ai_suggested',
      source_reference: null,
      suggested_command: s.suggested_command || null,
      status: 'pending',
      completed_by: null,
      completed_at: null,
      skipped_reason: null,
      notes: null,
      duration_seconds: null,
      started_at: null,
    }));
  } catch {
    diagnosis = {
      root_cause: rediagnosisResult.text || 'Re-diagnosis returned unparseable response',
      confidence_percent: 15,
      confidence_level: 'low',
      evidence: [],
      alternative_causes: [],
      sources_used: [{ type: 'ai_analysis', reference_id: null, reference_title: null }],
    };
  }

  // FRD §9: same compliance-step injection as initial diagnosis, guarded so
  // re-diagnosis doesn't duplicate steps already injected the first time.
  const complianceRegulation = detectComplianceRegulation((incident as any).labels);
  if (complianceRegulation && !(await hasResolutionStepsInjected(tenantId, incidentId))) {
    steps.push(...buildComplianceResolutionSteps(complianceRegulation, steps.length));
    await markResolutionStepsInjected(tenantId, incidentId);
  }

  await ResolutionPlan.findByIdAndUpdate(plan_id, {
    status: 'steps_generated',
    diagnosis,
    steps,
    $inc: { iteration: 1 },
    'metrics.steps_total': steps.length,
    'metrics.steps_completed': 0,
    'metrics.steps_skipped': 0,
    updated_at: new Date(),
  });

  logger.info('Resolution worker: re-diagnosis complete', {
    incident_id,
    plan_id,
    iteration: (plan.iteration || 1) + 1,
    confidence: diagnosis.confidence_level,
    new_steps_count: steps.length,
  });
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.resolution.diagnose') {
      await handleDiagnose(data);
    } else if (subject === 'icc.resolution.validate') {
      await handleValidate(data);
    } else if (subject === 'icc.resolution.rediagnose') {
      await handleRediagnose(data);
    } else {
      logger.debug('Resolution worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Resolution worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startResolutionWorker(): Promise<void> {
  if (running) return;

  await ensureStream();
  await ensureConsumer();
  const js = getJetStream();
  consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME).then((c) => c.consume());
  running = true;

  (async () => {
    if (!consumer) return;
    for await (const msg of consumer) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Resolution worker loop error', { error: err.message });
    }
  });

  logger.info('Resolution worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopResolutionWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Resolution worker stopped');
}
