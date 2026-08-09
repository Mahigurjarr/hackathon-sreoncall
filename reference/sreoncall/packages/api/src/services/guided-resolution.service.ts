import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { ResolutionPlan, ResolutionPlanDocument, ResolutionStep, StepType, StepSource } from '../models/resolution-plan.model';
import { ValidationSuite } from '../models/validation-suite.model';
import { Incident } from '../models/incident.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { Service } from '../models/service.model';
import { ChangeRequest } from '../models/change-request.model';
import { ServiceDependency } from '../models/service-dependency.model';
import { Runbook } from '../models/runbook.model';
import { StatusPage } from '../models/status-page.model';
import { StatusUpdate } from '../models/status-update.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { getJetStream } from '../config/nats';
import * as lgtm from './lgtm-query.service';
import * as aiService from './ai.service';
import * as incidentService from './incident.service';

const sc = StringCodec();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveplan(tenantId: string, incidentId: string): Promise<ResolutionPlanDocument | null> {
  return ResolutionPlan.findOne({
    tenant_id: new Types.ObjectId(tenantId),
    incident_id: new Types.ObjectId(incidentId),
    status: { $nin: ['completed', 'abandoned'] },
  }).sort({ createdAt: -1 });
}

async function getIncidentOrThrow(tenantId: string, incidentId: string) {
  const incident = await Incident.findOne({
    _id: new Types.ObjectId(incidentId),
    tenant_id: new Types.ObjectId(tenantId),
  });
  if (!incident) throw AppError.notFound('Incident not found');
  return incident;
}

async function publishNats(subject: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(subject, sc.encode(JSON.stringify(payload)));
  } catch (err: any) {
    logger.warn(`Failed to publish to ${subject}`, { error: err.message });
  }
}

// ─── Build AI diagnosis context ───────────────────────────────────────────────

async function buildDiagnosisContext(tenantId: string, incidentId: string) {
  const incident = await getIncidentOrThrow(tenantId, incidentId);

  // Gather affected services
  const services = incident.affected_service_ids?.length
    ? await Service.find({ _id: { $in: incident.affected_service_ids }, tenant_id: new Types.ObjectId(tenantId) }).lean()
    : [];

  // Fetch correlated telemetry (error logs, metric anomalies, slow traces from incident window)
  let telemetry: { error_logs: any[]; metric_anomalies: any[]; slow_traces: any[] } = {
    error_logs: [],
    metric_anomalies: [],
    slow_traces: [],
  };
  try {
    const incCreatedAt = (incident as any).createdAt || new Date();
    const telWindowStart = Math.floor(incCreatedAt.getTime() / 1000) - 2 * 3600;
    const telWindowEnd = Math.floor(Date.now() / 1000);
    for (const svc of services) {
      const svcName = (svc as any).name;
      if (!svcName) continue;
      const [errorLogs, metricData, slowTraces] = await Promise.all([
        lgtm.queryLogs(tenantId, `{service="${svcName}"} |= "error" or "ERROR" or "panic"`, telWindowStart, telWindowEnd, 20),
        lgtm.queryMetrics(tenantId, `rate(http_requests_total{service="${svcName}",status=~"5.."}[5m])`, telWindowStart, telWindowEnd, '300s'),
        lgtm.queryTraces(tenantId, { serviceName: svcName, startTime: telWindowStart, endTime: telWindowEnd, limit: 10, minDurationMs: 1000 }),
      ]);
      telemetry.error_logs.push(...errorLogs.slice(0, 10).map((l) => ({ service: svcName, line: l.line.slice(0, 300), timestamp: l.timestamp })));
      if (metricData.length > 0) {
        telemetry.metric_anomalies.push({ service: svcName, series_count: metricData.length, sample_values: metricData[0].values.slice(-5) });
      }
      telemetry.slow_traces.push(...slowTraces.slice(0, 5).map((t) => ({ service: svcName, traceId: t.traceID, duration_ms: t.durationMs, name: t.rootTraceName })));
    }
  } catch (err: any) {
    logger.warn('Failed to fetch LGTM telemetry for diagnosis context', { error: err.message });
  }

  // Fetch recent changes (deploys, config changes within 2 hours before incident)
  let recentChanges: unknown[] = [];
  try {
    const incidentCreatedAt = (incident as any).createdAt || new Date();
    const windowStart = new Date(incidentCreatedAt.getTime() - 2 * 60 * 60 * 1000);
    const serviceIds = services.map((s: any) => s._id);
    const changes = await ChangeRequest.find({
      tenant_id: new Types.ObjectId(tenantId),
      affected_service_ids: { $in: serviceIds },
      status: { $in: ['completed', 'implemented', 'in_progress'] },
      $or: [
        { implemented_at: { $gte: windowStart, $lte: incidentCreatedAt } },
        { completed_at: { $gte: windowStart, $lte: incidentCreatedAt } },
        { createdAt: { $gte: windowStart, $lte: incidentCreatedAt } },
      ],
    }).sort({ createdAt: -1 }).limit(10).lean();
    recentChanges = changes.map((c: any) => ({
      id: c._id.toString(),
      number: c.number,
      title: c.title,
      type: c.type,
      status: c.status,
      risk_score: c.risk?.score,
      implemented_at: c.implemented_at || c.completed_at || c.createdAt,
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch recent changes for diagnosis', { error: err.message });
  }

  // Fetch service dependency graph (upstream/downstream)
  let dependencies = services.map((s: any) => ({
    service_id: s._id.toString(),
    name: s.name,
    upstream: [] as Array<{ service_id: string; name: string; dependency_type: string }>,
    downstream: [] as Array<{ service_id: string; name: string; dependency_type: string }>,
  }));
  try {
    const serviceIds = services.map((s: any) => s._id);
    const depEdges = await ServiceDependency.find({
      tenant_id: new Types.ObjectId(tenantId),
      status: 'approved',
      $or: [
        { source_service_id: { $in: serviceIds } },
        { target_service_id: { $in: serviceIds } },
      ],
    }).lean();
    // Fetch all referenced services for name lookup
    const refServiceIds = new Set<string>();
    for (const edge of depEdges) {
      refServiceIds.add(edge.source_service_id.toString());
      refServiceIds.add(edge.target_service_id.toString());
    }
    const refServices = await Service.find({
      _id: { $in: Array.from(refServiceIds) },
      tenant_id: new Types.ObjectId(tenantId),
    }).lean();
    const svcNameMap = new Map(refServices.map((s: any) => [s._id.toString(), s.name]));

    for (const dep of dependencies) {
      for (const edge of depEdges) {
        // source depends on target: if this service is the source, target is upstream
        if (edge.source_service_id.toString() === dep.service_id) {
          dep.downstream.push({
            service_id: edge.target_service_id.toString(),
            name: svcNameMap.get(edge.target_service_id.toString()) || 'Unknown',
            dependency_type: edge.dependency_type,
          });
        }
        // if this service is the target, source depends on it (downstream)
        if (edge.target_service_id.toString() === dep.service_id) {
          dep.upstream.push({
            service_id: edge.source_service_id.toString(),
            name: svcNameMap.get(edge.source_service_id.toString()) || 'Unknown',
            dependency_type: edge.dependency_type,
          });
        }
      }
    }
  } catch (err: any) {
    logger.warn('Failed to fetch service dependencies for diagnosis', { error: err.message });
  }

  // Fetch matching runbooks (by service tags, keywords)
  let matchingRunbooks: unknown[] = [];
  try {
    const serviceIds = services.map((s: any) => s._id);
    const serviceTags = services.flatMap((s: any) => s.tags || []);
    const query: any = {
      tenant_id: new Types.ObjectId(tenantId),
      status: 'published',
    };
    const orConditions: any[] = [];
    if (serviceIds.length > 0) {
      orConditions.push({ service_ids: { $in: serviceIds } });
    }
    if (serviceTags.length > 0) {
      orConditions.push({ tags: { $in: serviceTags } });
    }
    if (orConditions.length > 0) {
      query.$or = orConditions;
    }
    const runbooks = await Runbook.find(query).sort({ 'stats.executions': -1 }).limit(5).lean();
    matchingRunbooks = runbooks.map((r: any) => ({
      id: r._id.toString(),
      title: r.title,
      description: r.description,
      tags: r.tags,
      steps_count: r.steps?.length || 0,
      execution_stats: r.stats,
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch matching runbooks for diagnosis', { error: err.message });
  }

  // Fetch similar past incidents (by service + severity + root cause keywords)
  let similarIncidents: unknown[] = [];
  try {
    const similar = await incidentService.findSimilar(new Types.ObjectId(tenantId), incidentId);
    similarIncidents = similar.map((inc: any) => ({
      id: inc._id.toString(),
      number: inc.number,
      title: inc.title,
      severity: inc.severity,
      status: inc.status,
      resolved_at: inc.metrics?.resolved_at || null,
      mttr_seconds: inc.metrics?.mttr_seconds ?? null,
      root_cause: inc.ai?.root_cause || null,
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch similar incidents for diagnosis', { error: err.message });
  }

  return {
    incident: {
      id: incident._id.toString(),
      number: incident.number,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      affected_service_ids: incident.affected_service_ids?.map((id: Types.ObjectId) => id.toString()) ?? [],
      created_at: incident.createdAt,
    },
    services,
    telemetry,
    recentChanges,
    dependencies,
    matchingRunbooks,
    similarIncidents,
  };
}

// ─── Public service functions ─────────────────────────────────────────────────

/**
 * Create a new resolution plan for an incident and trigger AI diagnosis via NATS.
 */
export async function createPlan(
  tenantId: string,
  incidentId: string,
  userId: string,
): Promise<ResolutionPlanDocument> {
  // Ensure incident exists
  await getIncidentOrThrow(tenantId, incidentId);

  // Check for existing active plan
  const existing = await getActiveplan(tenantId, incidentId);
  if (existing) {
    throw AppError.badRequest('An active resolution plan already exists for this incident');
  }

  const plan = await ResolutionPlan.create({
    tenant_id:  new Types.ObjectId(tenantId),
    incident_id: new Types.ObjectId(incidentId),
    status:     'diagnosing',
    iteration:  1,
    diagnosis:  {
      root_cause:         'Diagnosing...',
      confidence_percent: 0,
      confidence_level:   'low',
      evidence:           [],
      alternative_causes: [],
      sources_used:       [],
    },
    steps:        [],
    validations:  [],
    metrics:      {
      diagnosis_time_seconds:        null,
      total_resolution_time_seconds: null,
      steps_completed:               0,
      steps_skipped:                 0,
      steps_total:                   0,
      validation_attempts:           0,
      ai_tokens_used:                { input: 0, output: 0 },
    },
    created_by:       new Types.ObjectId(userId),
    completed_at:     null,
    abandoned_at:     null,
    abandoned_reason: null,
  });

  // Build context and publish diagnosis job to NATS
  const context = await buildDiagnosisContext(tenantId, incidentId);
  await publishNats('icc.resolution.diagnose', {
    tenant_id:   tenantId,
    incident_id: incidentId,
    plan_id:     plan._id.toString(),
    iteration:   plan.iteration,
    context,
  });

  logger.info('Resolution plan created, diagnosis triggered', {
    planId: plan._id.toString(),
    incidentId,
    tenantId,
  });

  return plan;
}

/**
 * Get the current active resolution plan for an incident.
 */
export async function getPlan(
  tenantId: string,
  incidentId: string,
): Promise<ResolutionPlanDocument> {
  const plan = await ResolutionPlan.findOne({
    tenant_id:  new Types.ObjectId(tenantId),
    incident_id: new Types.ObjectId(incidentId),
  }).sort({ createdAt: -1 });

  if (!plan) throw AppError.notFound('Resolution plan not found');
  return plan;
}

/**
 * Update a resolution plan (e.g. abandon).
 */
export async function updatePlan(
  tenantId: string,
  incidentId: string,
  data: { status?: string; abandoned_reason?: string },
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  if (data.status === 'abandoned') {
    plan.status = 'abandoned';
    plan.abandoned_at = new Date();
    plan.abandoned_reason = data.abandoned_reason || null;
  } else if (data.status) {
    plan.status = data.status as any;
  }

  await plan.save();
  logger.info('Resolution plan updated', { planId: plan._id.toString(), status: plan.status });
  return plan;
}

/**
 * Add an engineer-defined step to the resolution plan.
 */
export async function addStep(
  tenantId: string,
  incidentId: string,
  step: {
    title: string;
    description?: string;
    type: StepType;
    suggested_command?: string;
    source_reference?: {
      runbook_id?: string;
      runbook_title?: string;
      incident_id?: string;
      incident_number?: number;
    };
  },
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  if (plan.status === 'completed' || plan.status === 'abandoned') {
    throw AppError.badRequest(`Cannot add steps to a ${plan.status} plan`);
  }

  const maxOrder = plan.steps.length > 0
    ? Math.max(...plan.steps.map((s) => s.order))
    : -1;

  const newStep: Partial<ResolutionStep> = {
    _id:               new Types.ObjectId(),
    order:             maxOrder + 1,
    title:             step.title,
    description:       step.description || '',
    type:              step.type,
    source:            'engineer_added',
    source_reference:  step.source_reference
      ? {
          runbook_id:      step.source_reference.runbook_id ? new Types.ObjectId(step.source_reference.runbook_id) : null,
          runbook_title:   step.source_reference.runbook_title || null,
          incident_id:     step.source_reference.incident_id ? new Types.ObjectId(step.source_reference.incident_id) : null,
          incident_number: step.source_reference.incident_number || null,
        }
      : null,
    suggested_command: step.suggested_command || null,
    status:            'pending',
    completed_by:      null,
    completed_at:      null,
    skipped_reason:    null,
    notes:             null,
    duration_seconds:  null,
    started_at:        null,
  };

  plan.steps.push(newStep as ResolutionStep);
  plan.metrics.steps_total = plan.steps.length;

  if (plan.status === 'steps_generated' || plan.status === 'diagnosing') {
    plan.status = 'in_progress';
  }

  await plan.save();
  logger.info('Step added to resolution plan', { planId: plan._id.toString(), stepTitle: step.title });
  return plan;
}

/**
 * Update a step (mark complete, skip, add notes).
 */
export async function updateStep(
  tenantId: string,
  incidentId: string,
  stepId: string,
  data: {
    status?: 'in_progress' | 'completed' | 'skipped' | 'failed';
    completed_by?: string;
    skipped_reason?: string;
    notes?: string;
  },
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  const step = plan.steps.find((s) => s._id.toString() === stepId);
  if (!step) throw AppError.notFound('Step not found');

  if (data.status === 'in_progress' && step.status === 'pending') {
    step.status = 'in_progress';
    step.started_at = new Date();
  }

  if (data.status === 'completed') {
    step.status = 'completed';
    step.completed_at = new Date();
    step.completed_by = data.completed_by ? new Types.ObjectId(data.completed_by) : null;
    step.duration_seconds = step.started_at
      ? Math.floor((Date.now() - step.started_at.getTime()) / 1000)
      : null;
    plan.metrics.steps_completed = plan.steps.filter((s) => s.status === 'completed').length;
  }

  if (data.status === 'skipped') {
    step.status = 'skipped';
    step.skipped_reason = data.skipped_reason || null;
    plan.metrics.steps_skipped = plan.steps.filter((s) => s.status === 'skipped').length;
  }

  if (data.status === 'failed') {
    step.status = 'failed';
  }

  if (data.notes !== undefined) {
    step.notes = data.notes;
  }

  // If plan is in steps_generated, move to in_progress when a step is acted on
  if (plan.status === 'steps_generated') {
    plan.status = 'in_progress';
  }

  await plan.save();
  logger.info('Resolution step updated', { planId: plan._id.toString(), stepId, status: data.status });
  return plan;
}

/**
 * Trigger validation checks for the resolution plan.
 * Gathers synthetic monitors + tenant validation suites and publishes to NATS.
 */

/**
 * Delete a manually-added (engineer_added) step. Only pending steps can be
 * deleted — completed or skipped steps are part of the audit trail.
 */
export async function deleteStep(
  tenantId: string,
  incidentId: string,
  stepId: string,
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  const step = plan.steps.find((s) => s._id.toString() === stepId);
  if (!step) throw AppError.notFound('Step not found');
  if (step.source !== 'engineer_added') throw AppError.badRequest('Only manually-added steps can be deleted');
  if (step.status !== 'pending') throw AppError.badRequest('Only pending steps can be deleted');

  await ResolutionPlan.findByIdAndUpdate(plan._id, {
    $pull: { steps: { _id: new Types.ObjectId(stepId) } },
  });

  const updated = await getActiveplan(tenantId, incidentId);
  if (!updated) throw AppError.notFound('No active resolution plan found');

  updated.metrics.steps_total = updated.steps.length;
  return updated.save();
}

export async function triggerValidation(
  tenantId: string,
  incidentId: string,
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  const incident = await getIncidentOrThrow(tenantId, incidentId);

  // Gather synthetic monitors on affected services
  const affectedServiceIds = incident.affected_service_ids || [];
  const syntheticChecks = affectedServiceIds.length
    ? await SyntheticCheck.find({
        tenant_id: new Types.ObjectId(tenantId),
        service_id: { $in: affectedServiceIds },
        enabled: true,
      }).lean()
    : [];

  // Gather tenant validation suites that match affected services
  const validationSuites = affectedServiceIds.length
    ? await ValidationSuite.find({
        tenant_id: new Types.ObjectId(tenantId),
        service_ids: { $in: affectedServiceIds },
        trigger: { $in: ['on_resolution', 'both'] },
      }).lean()
    : [];

  // Build validation checks list
  const checks: Array<{
    name: string;
    type: string;
    target_service_id: string | null;
    synthetic_check_id: string | null;
    status: string;
    details: string | null;
    executed_at: Date;
  }> = [];

  for (const sc of syntheticChecks) {
    checks.push({
      name:               `Synthetic: ${(sc as any).name}`,
      type:               'synthetic_monitor',
      target_service_id:  (sc as any).service_id?.toString() || null,
      synthetic_check_id: (sc as any)._id.toString(),
      status:             'running',
      details:            null,
      executed_at:        new Date(),
    });
  }

  for (const suite of validationSuites) {
    for (const check of (suite as any).checks || []) {
      checks.push({
        name:               `${(suite as any).name}: ${check.name}`,
        type:               'tenant_e2e',
        target_service_id:  null,
        synthetic_check_id: null,
        status:             'running',
        details:            null,
        executed_at:        new Date(),
      });
    }
  }

  // Add health endpoint checks for affected services
  for (const svcId of affectedServiceIds) {
    checks.push({
      name:               `Health check: service ${svcId.toString()}`,
      type:               'health_endpoint',
      target_service_id:  svcId.toString(),
      synthetic_check_id: null,
      status:             'running',
      details:            null,
      executed_at:        new Date(),
    });
  }

  const validationEntry = {
    _id:                        new Types.ObjectId(),
    iteration:                  plan.iteration,
    triggered_at:               new Date(),
    completed_at:               null,
    status:                     'running' as const,
    checks,
    ai_analysis_of_failure:     null,
    additional_steps_suggested: false,
  };

  plan.validations.push(validationEntry as any);
  plan.status = 'validating';
  plan.metrics.validation_attempts += 1;
  await plan.save();

  // Publish validation job to NATS worker
  await publishNats('icc.resolution.validate', {
    tenant_id:     tenantId,
    incident_id:   incidentId,
    plan_id:       plan._id.toString(),
    validation_id: validationEntry._id.toString(),
    iteration:     plan.iteration,
    checks,
  });

  logger.info('Validation triggered', {
    planId: plan._id.toString(),
    validationId: validationEntry._id.toString(),
    checksCount: checks.length,
  });

  return plan;
}

/**
 * List validation results for an incident's resolution plan.
 */
export async function getValidations(
  tenantId: string,
  incidentId: string,
) {
  const plan = await getPlan(tenantId, incidentId);
  return plan.validations;
}

/**
 * Trigger AI re-diagnosis with incremented iteration.
 */
export async function rediagnose(
  tenantId: string,
  incidentId: string,
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  plan.iteration += 1;
  plan.status = 'diagnosing';

  // Reset diagnosis for new iteration
  plan.diagnosis = {
    root_cause:         'Re-diagnosing...',
    confidence_percent: 0,
    confidence_level:   'low',
    evidence:           [],
    alternative_causes: [],
    sources_used:       [],
  } as any;

  await plan.save();

  // Build context with updated data (includes latest validation results)
  const context = await buildDiagnosisContext(tenantId, incidentId);
  await publishNats('icc.resolution.diagnose', {
    tenant_id:   tenantId,
    incident_id: incidentId,
    plan_id:     plan._id.toString(),
    iteration:   plan.iteration,
    previous_validations: plan.validations.map((v) => ({
      iteration:  v.iteration,
      status:     v.status,
      checks:     v.checks,
      ai_analysis_of_failure: v.ai_analysis_of_failure,
    })),
    context,
  });

  logger.info('Re-diagnosis triggered', {
    planId: plan._id.toString(),
    iteration: plan.iteration,
  });

  return plan;
}

/**
 * Confirm resolution — resolve incident, calculate metrics, generate post-mortem draft.
 */
export async function confirmResolution(
  tenantId: string,
  incidentId: string,
  userId: string,
): Promise<ResolutionPlanDocument> {
  const plan = await getActiveplan(tenantId, incidentId);
  if (!plan) throw AppError.notFound('No active resolution plan found');

  const incident = await getIncidentOrThrow(tenantId, incidentId);

  const now = new Date();

  // Calculate metrics
  const totalResolutionSeconds = Math.floor(
    (now.getTime() - plan.createdAt.getTime()) / 1000,
  );
  const diagnosisTimeSeconds = plan.diagnosis?.root_cause && plan.diagnosis.root_cause !== 'Diagnosing...'
    ? Math.floor(
        ((plan.steps.length > 0 ? plan.steps[0]?.started_at?.getTime() : now.getTime()) || now.getTime()) -
        plan.createdAt.getTime()
      ) / 1000
    : null;

  plan.metrics.total_resolution_time_seconds = totalResolutionSeconds;
  plan.metrics.diagnosis_time_seconds = diagnosisTimeSeconds;
  plan.metrics.steps_completed = plan.steps.filter((s) => s.status === 'completed').length;
  plan.metrics.steps_skipped = plan.steps.filter((s) => s.status === 'skipped').length;
  plan.metrics.steps_total = plan.steps.length;

  plan.status = 'completed';
  plan.completed_at = now;

  await plan.save();

  // Resolve the incident — update status and calculate MTTA/MTTR
  if (incident.status !== 'resolved' && incident.status !== 'closed') {
    incident.status = 'resolved';
    incident.resolved_at = now;
    incident.metrics.resolved_at = now;
    incident.metrics.mttr_seconds = Math.floor(
      (now.getTime() - incident.createdAt.getTime()) / 1000,
    );
    if (incident.metrics.ack_at && !incident.metrics.mtta_seconds) {
      incident.metrics.mtta_seconds = Math.floor(
        (incident.metrics.ack_at.getTime() - incident.createdAt.getTime()) / 1000,
      );
    }

    incident.timeline.push({
      _id:       new Types.ObjectId(),
      type:      'resolution',
      actor_id:  new Types.ObjectId(userId),
      message:   `Incident resolved via guided resolution (${plan.metrics.steps_completed}/${plan.metrics.steps_total} steps completed)`,
      metadata:  {
        mttr_seconds:           incident.metrics.mttr_seconds,
        resolution_plan_id:     plan._id.toString(),
        resolution_iterations:  plan.iteration,
        validation_attempts:    plan.metrics.validation_attempts,
      },
      timestamp: now,
    });

    await incident.save();
  }

  // Auto-update status page (if configured for affected services)
  try {
    const affectedServiceIds = incident.affected_service_ids || [];
    if (affectedServiceIds.length > 0) {
      const statusPages = await StatusPage.find({
        tenant_id: new Types.ObjectId(tenantId),
        'settings.display_options.selected_service_ids': { $in: affectedServiceIds },
      }).lean();

      for (const page of statusPages) {
        const affectedComponents = ((page as any).components || [])
          .filter((c: any) => c.service_id && affectedServiceIds.some(
            (sid: Types.ObjectId) => sid.toString() === c.service_id?.toString()
          ))
          .map((c: any) => ({
            component_id: c._id,
            name: c.name,
            status_before: c.status || 'major_outage',
            status_after: 'operational',
          }));

        await StatusUpdate.create({
          tenant_id: new Types.ObjectId(tenantId),
          status_page_id: page._id,
          title: `Resolved: ${incident.title}`,
          body: `The incident has been resolved via guided resolution. All affected services have been restored.`,
          status: 'resolved',
          visibility: 'public',
          affected_components: affectedComponents,
          created_by: new Types.ObjectId(userId),
          notify_subscribers: true,
          incident_id: incident._id,
        });
      }
    }
  } catch (err: any) {
    logger.warn('Failed to auto-update status page on resolution', { error: err.message });
  }

  // Generate post-mortem draft via AI
  try {
    const timelineEntries = (incident.timeline || []).map((t: any) => ({
      type: t.type,
      message: t.message,
      timestamp: t.timestamp,
    }));
    const stepsCompleted = plan.steps
      .filter((s) => s.status === 'completed')
      .map((s) => ({ title: s.title, description: s.description, notes: s.notes }));

    const postMortemPrompt = `You are an SRE post-mortem writer. Generate a structured post-mortem report in markdown format with these sections:
## Summary
## Timeline
## Root Cause Analysis
## Impact
## Resolution Steps
## Lessons Learned
## Action Items

Be specific and actionable. Use the data provided.`;

    const postMortemContext = [
      `Incident: ${incident.title} (SEV${incident.severity})`,
      `Duration: ${plan.metrics.total_resolution_time_seconds || 0} seconds`,
      `Diagnosis: ${plan.diagnosis?.root_cause || 'Unknown'}`,
      `Confidence: ${plan.diagnosis?.confidence_percent || 0}%`,
      `Alternative causes: ${(plan.diagnosis?.alternative_causes || []).join(', ') || 'None'}`,
      `Steps completed: ${plan.metrics.steps_completed}/${plan.metrics.steps_total}`,
      `Validation attempts: ${plan.metrics.validation_attempts}`,
      `\nTimeline:\n${timelineEntries.map((t: any) => `- [${t.timestamp}] ${t.type}: ${t.message}`).join('\n')}`,
      `\nResolution steps:\n${stepsCompleted.map((s: any) => `- ${s.title}: ${s.description || ''} ${s.notes ? '(Notes: ' + s.notes + ')' : ''}`).join('\n')}`,
    ].join('\n');

    const result = await aiService.generateCompletion({
      tenantId,
      system: postMortemPrompt,
      userMessage: postMortemContext,
    });

    // Save the AI-generated post-mortem draft to the plan
    await ResolutionPlan.findByIdAndUpdate(plan._id, {
      'postmortem.auto_generated': {
        content: result.text,
        generated_at: new Date(),
        model: result.model,
        tokens_used: { input: result.input_tokens, output: result.output_tokens },
      },
    });

    plan.metrics.ai_tokens_used.input += result.input_tokens;
    plan.metrics.ai_tokens_used.output += result.output_tokens;
    await plan.save();
  } catch (err: any) {
    logger.warn('Failed to generate post-mortem draft', { error: err.message });
  }

  // Publish resolution completion event to NATS for downstream processing
  await publishNats('icc.resolution.completed', {
    tenant_id:   tenantId,
    incident_id: incidentId,
    plan_id:     plan._id.toString(),
    metrics:     plan.metrics,
  });

  logger.info('Resolution confirmed', {
    planId: plan._id.toString(),
    incidentId,
    mttr_seconds: incident.metrics.mttr_seconds,
    totalResolutionSeconds,
  });

  return plan;
}
