import { Types } from 'mongoose';
import { logger } from '../utils/logger';

// ─── Model imports ───────────────────────────────────────────────────────────

import { Incident } from '../models/incident.model';
import { Service } from '../models/service.model';
import { AlertRule } from '../models/alert-rule.model';
import { Runbook } from '../models/runbook.model';
import { ChangeRequest } from '../models/change-request.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { Postmortem } from '../models/postmortem.model';
import { User } from '../models/user.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';

// ─── Context Builder Interface ───────────────────────────────────────────────

export interface AgentContextData {
  summary: string;
  details: Record<string, any>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

function isObjectId(value: string | undefined): boolean {
  if (!value) return false;
  return Types.ObjectId.isValid(value) && new Types.ObjectId(value).toString() === value;
}

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

const THIRTY_MINUTES = 30 * 60 * 1000;
const SEVENTY_TWO_HOURS = 72 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

// ─── Generic Context Builder ─────────────────────────────────────────────────

export async function buildAgentContext(
  agentSlug: string,
  tenantId: string,
  sourceId?: string,
  consumerTenantId?: string
): Promise<AgentContextData> {
  const builder = CONTEXT_BUILDERS[agentSlug];
  if (!builder) {
    logger.warn(`No context builder for agent "${agentSlug}", using minimal context`);
    return {
      summary: `Agent ${agentSlug} triggered for tenant ${tenantId}`,
      details: { tenant_id: tenantId, source_id: sourceId },
    };
  }

  try {
    return await builder(tenantId, sourceId, consumerTenantId);
  } catch (err: any) {
    logger.error(`Error building context for agent "${agentSlug}"`, { error: err.message });
    return {
      summary: `Context build failed for ${agentSlug}: ${err.message}`,
      details: { tenant_id: tenantId, source_id: sourceId, error: err.message },
    };
  }
}

// ─── Per-Agent Context Builders ──────────────────────────────────────────────

type ContextBuilder = (
  tenantId: string,
  sourceId?: string,
  consumerTenantId?: string
) => Promise<AgentContextData>;

// 1. Triage Context
async function buildTriageContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // Determine if sourceId is an alert rule or an incident
  let alertRule: any = null;
  let incident: any = null;
  let serviceIds: Types.ObjectId[] = [];

  try {
    if (sourceId && isObjectId(sourceId)) {
      const sid = toObjectId(sourceId);

      // Try loading as alert rule first
      alertRule = await AlertRule.findOne({ _id: sid, tenant_id: tid }).lean();
      if (alertRule) {
        serviceIds = alertRule.service_id ? [alertRule.service_id] : [];
      } else {
        // Try as incident
        incident = await Incident.findOne({ _id: sid, tenant_id: tid }).lean();
        if (incident) {
          serviceIds = incident.affected_service_ids || [];
        }
      }
    }
  } catch (err: any) {
    logger.warn('buildTriageContext: failed to load source entity', { error: err.message });
  }

  // Recent firing alerts on same services (last 30 min)
  let recentAlerts: any[] = [];
  try {
    const alertQuery: Record<string, any> = {
      tenant_id: tid,
      alert_state: 'firing',
      last_triggered_at: { $gte: ago(THIRTY_MINUTES) },
    };
    if (serviceIds.length > 0) {
      alertQuery.service_id = { $in: serviceIds };
    }
    recentAlerts = await AlertRule.find(alertQuery)
      .select('name severity service_id alert_state last_triggered_at trigger_count condition')
      .limit(20)
      .lean();
  } catch (err: any) {
    logger.warn('buildTriageContext: failed to query recent alerts', { error: err.message });
  }

  // Service metadata
  let services: any[] = [];
  try {
    if (serviceIds.length > 0) {
      services = await Service.find({ _id: { $in: serviceIds }, tenant_id: tid })
        .select('name type current_status escalation_policy_id oncall_schedule_id tags')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildTriageContext: failed to query services', { error: err.message });
  }

  // On-call schedules for affected services
  let oncallSchedules: any[] = [];
  try {
    const scheduleIds = services
      .map((s: any) => s.oncall_schedule_id)
      .filter(Boolean);
    if (scheduleIds.length > 0) {
      oncallSchedules = await OnCallSchedule.find({ _id: { $in: scheduleIds }, tenant_id: tid })
        .select('name layers overrides timezone')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildTriageContext: failed to query on-call schedules', { error: err.message });
  }

  // Recent changes on affected services (72h)
  let recentChanges: any[] = [];
  try {
    if (serviceIds.length > 0) {
      recentChanges = await ChangeRequest.find({
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        createdAt: { $gte: ago(SEVENTY_TWO_HOURS) },
      })
        .select('title type status risk implementation_window affected_service_ids createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildTriageContext: failed to query recent changes', { error: err.message });
  }

  // Past incidents on same services (30 days)
  let pastIncidents: any[] = [];
  try {
    if (serviceIds.length > 0) {
      pastIncidents = await Incident.find({
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        createdAt: { $gte: ago(THIRTY_DAYS) },
      })
        .select('title severity status affected_service_ids createdAt metrics.mttr_seconds')
        .sort({ createdAt: -1 })
        .limit(15)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildTriageContext: failed to query past incidents', { error: err.message });
  }

  const serviceNames = services.map((s: any) => s.name).join(', ') || 'unknown services';

  return {
    summary: `Triage context: ${recentAlerts.length} active alert(s) on ${serviceNames}, ${recentChanges.length} recent change(s) in 72h, ${pastIncidents.length} past incident(s) in 30d`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'triage',
      alert_rule: alertRule,
      incident: incident,
      recent_alerts: recentAlerts,
      services,
      oncall_schedules: oncallSchedules,
      recent_changes: recentChanges,
      past_incidents: pastIncidents,
    },
  };
}

// 2. Commander Context
async function buildCommanderContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // Full incident with timeline + responders
  let incident: any = null;
  try {
    if (sourceId && isObjectId(sourceId)) {
      incident = await Incident.findOne({ _id: toObjectId(sourceId), tenant_id: tid }).lean();
    }
  } catch (err: any) {
    logger.warn('buildCommanderContext: failed to load incident', { error: err.message });
  }

  const serviceIds: Types.ObjectId[] = incident?.affected_service_ids || [];

  // Affected services with their current status
  let services: any[] = [];
  try {
    if (serviceIds.length > 0) {
      services = await Service.find({ _id: { $in: serviceIds }, tenant_id: tid })
        .select('name type current_status escalation_policy_id oncall_schedule_id tags')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildCommanderContext: failed to query services', { error: err.message });
  }

  // Time elapsed since last timeline entry
  let timeSinceLastUpdateMs: number | null = null;
  if (incident?.timeline?.length > 0) {
    const lastEntry = incident.timeline[incident.timeline.length - 1];
    timeSinceLastUpdateMs = Date.now() - new Date(lastEntry.timestamp).getTime();
  }

  // Past similar incidents (same services, 30 days)
  let pastSimilarIncidents: any[] = [];
  try {
    if (serviceIds.length > 0) {
      const query: Record<string, any> = {
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        createdAt: { $gte: ago(THIRTY_DAYS) },
      };
      if (incident?._id) {
        query._id = { $ne: incident._id };
      }
      pastSimilarIncidents = await Incident.find(query)
        .select('title severity status affected_service_ids createdAt metrics ai.root_cause')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildCommanderContext: failed to query past incidents', { error: err.message });
  }

  const incTitle = incident?.title || 'unknown';
  const responderCount = incident?.responders?.length || 0;

  return {
    summary: `Commander context: incident "${incTitle}" with ${responderCount} responder(s), ${services.length} affected service(s), last update ${timeSinceLastUpdateMs !== null ? Math.round(timeSinceLastUpdateMs / 60000) + ' min ago' : 'N/A'}`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'commander',
      incident,
      affected_services: services,
      time_since_last_update_ms: timeSinceLastUpdateMs,
      past_similar_incidents: pastSimilarIncidents,
    },
  };
}

// 3. RCA Context
async function buildRCAContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // Full incident with complete timeline
  let incident: any = null;
  try {
    if (sourceId && isObjectId(sourceId)) {
      incident = await Incident.findOne({ _id: toObjectId(sourceId), tenant_id: tid }).lean();
    }
  } catch (err: any) {
    logger.warn('buildRCAContext: failed to load incident', { error: err.message });
  }

  const serviceIds: Types.ObjectId[] = incident?.affected_service_ids || [];
  const incidentCreatedAt = incident?.createdAt ? new Date(incident.createdAt) : new Date();

  // Recent changes on affected services (7 days before incident)
  let recentChanges: any[] = [];
  try {
    if (serviceIds.length > 0) {
      const sevenDaysBefore = new Date(incidentCreatedAt.getTime() - SEVEN_DAYS);
      recentChanges = await ChangeRequest.find({
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        createdAt: { $gte: sevenDaysBefore, $lte: incidentCreatedAt },
      })
        .select('title type status risk affected_service_ids implementation_window pir createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildRCAContext: failed to query recent changes', { error: err.message });
  }

  // Past incidents on same services (6 months)
  let pastIncidents: any[] = [];
  try {
    if (serviceIds.length > 0) {
      const query: Record<string, any> = {
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        createdAt: { $gte: ago(SIX_MONTHS) },
      };
      if (incident?._id) {
        query._id = { $ne: incident._id };
      }
      pastIncidents = await Incident.find(query)
        .select('title severity status affected_service_ids createdAt metrics ai.root_cause')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildRCAContext: failed to query past incidents', { error: err.message });
  }

  // Affected service metadata
  let services: any[] = [];
  try {
    if (serviceIds.length > 0) {
      services = await Service.find({ _id: { $in: serviceIds }, tenant_id: tid })
        .select('name type current_status tags')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildRCAContext: failed to query services', { error: err.message });
  }

  const incTitle = incident?.title || 'unknown';

  return {
    summary: `RCA context: incident "${incTitle}" with ${incident?.timeline?.length || 0} timeline entries, ${recentChanges.length} change(s) in 7d window, ${pastIncidents.length} historical incident(s) in 6mo`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'rca',
      incident,
      recent_changes_before_incident: recentChanges,
      past_incidents: pastIncidents,
      affected_services: services,
    },
  };
}

// 4. Alert Intelligence Context
async function buildAlertIntelContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // All currently firing alerts for the tenant
  let firingAlerts: any[] = [];
  try {
    firingAlerts = await AlertRule.find({
      tenant_id: tid,
      alert_state: 'firing',
    })
      .select('name severity service_id alert_state last_triggered_at trigger_count condition')
      .lean();
  } catch (err: any) {
    logger.warn('buildAlertIntelContext: failed to query firing alerts', { error: err.message });
  }

  // Alert firing frequency per rule (last 7 days) - rules triggered in the last 7 days
  let alertFrequency: any[] = [];
  try {
    alertFrequency = await AlertRule.find({
      tenant_id: tid,
      status: 'active',
      last_triggered_at: { $gte: ago(SEVEN_DAYS) },
    })
      .select('name severity service_id trigger_count last_triggered_at alert_state')
      .sort({ trigger_count: -1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    logger.warn('buildAlertIntelContext: failed to query alert frequency', { error: err.message });
  }

  // Active incidents for the tenant
  let activeIncidents: any[] = [];
  try {
    activeIncidents = await Incident.find({
      tenant_id: tid,
      status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
    })
      .select('title severity status affected_service_ids source source_alert_id createdAt')
      .sort({ severity: 1, createdAt: -1 })
      .limit(20)
      .lean();
  } catch (err: any) {
    logger.warn('buildAlertIntelContext: failed to query active incidents', { error: err.message });
  }

  // Service topology (services with tags for dependency info)
  let services: any[] = [];
  try {
    services = await Service.find({ tenant_id: tid, deleted_at: null })
      .select('name type current_status tags')
      .lean();
  } catch (err: any) {
    logger.warn('buildAlertIntelContext: failed to query services', { error: err.message });
  }

  return {
    summary: `Alert intelligence: ${firingAlerts.length} firing alert(s), ${activeIncidents.length} active incident(s), ${alertFrequency.length} rules triggered in 7d across ${services.length} service(s)`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'alert_intelligence',
      firing_alerts: firingAlerts,
      alert_frequency_7d: alertFrequency,
      active_incidents: activeIncidents,
      service_topology: services,
    },
  };
}

// 5. Change Risk Context
async function buildChangeRiskContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // The change request data
  let changeRequest: any = null;
  try {
    if (sourceId && isObjectId(sourceId)) {
      changeRequest = await ChangeRequest.findOne({ _id: toObjectId(sourceId), tenant_id: tid }).lean();
    }
  } catch (err: any) {
    logger.warn('buildChangeRiskContext: failed to load change request', { error: err.message });
  }

  const serviceIds: Types.ObjectId[] = changeRequest?.affected_service_ids || [];

  // Past changes on same services with their outcomes
  let pastChanges: any[] = [];
  try {
    if (serviceIds.length > 0) {
      const query: Record<string, any> = {
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        status: { $in: ['completed', 'rolled_back', 'implemented'] },
      };
      if (changeRequest?._id) {
        query._id = { $ne: changeRequest._id };
      }
      pastChanges = await ChangeRequest.find(query)
        .select('title type status risk pir affected_service_ids createdAt completed_at')
        .sort({ createdAt: -1 })
        .limit(15)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildChangeRiskContext: failed to query past changes', { error: err.message });
  }

  // Other scheduled changes overlapping the implementation window
  let overlappingChanges: any[] = [];
  try {
    if (changeRequest?.implementation_window) {
      const { start, end } = changeRequest.implementation_window;
      const query: Record<string, any> = {
        tenant_id: tid,
        status: { $in: ['approved', 'scheduled', 'in_progress'] },
        'implementation_window.start': { $lte: end },
        'implementation_window.end': { $gte: start },
      };
      if (changeRequest._id) {
        query._id = { $ne: changeRequest._id };
      }
      overlappingChanges = await ChangeRequest.find(query)
        .select('title type status risk implementation_window affected_service_ids')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildChangeRiskContext: failed to query overlapping changes', { error: err.message });
  }

  // Recent incidents on affected services
  let recentIncidents: any[] = [];
  try {
    if (serviceIds.length > 0) {
      recentIncidents = await Incident.find({
        tenant_id: tid,
        affected_service_ids: { $in: serviceIds },
        createdAt: { $gte: ago(THIRTY_DAYS) },
      })
        .select('title severity status affected_service_ids createdAt metrics.mttr_seconds')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildChangeRiskContext: failed to query recent incidents', { error: err.message });
  }

  // On-call coverage for affected services
  let oncallSchedules: any[] = [];
  try {
    if (serviceIds.length > 0) {
      const affectedServices = await Service.find({ _id: { $in: serviceIds }, tenant_id: tid })
        .select('name oncall_schedule_id')
        .lean();
      const scheduleIds = affectedServices
        .map((s: any) => s.oncall_schedule_id)
        .filter(Boolean);
      if (scheduleIds.length > 0) {
        oncallSchedules = await OnCallSchedule.find({ _id: { $in: scheduleIds }, tenant_id: tid })
          .select('name layers overrides timezone')
          .lean();
      }
    }
  } catch (err: any) {
    logger.warn('buildChangeRiskContext: failed to query on-call coverage', { error: err.message });
  }

  const crTitle = changeRequest?.title || 'unknown';
  const riskScore = changeRequest?.risk?.score || 'unknown';

  return {
    summary: `Change risk context: "${crTitle}" (risk: ${riskScore}), ${overlappingChanges.length} overlapping change(s), ${recentIncidents.length} recent incident(s) on affected services, ${pastChanges.length} past change(s) with outcomes`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'change_risk',
      change_request: changeRequest,
      past_changes_with_outcomes: pastChanges,
      overlapping_changes: overlappingChanges,
      recent_incidents: recentIncidents,
      oncall_coverage: oncallSchedules,
    },
  };
}

// 6. Runbook Context
async function buildRunbookContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // Incident data (symptoms, service)
  let incident: any = null;
  try {
    if (sourceId && isObjectId(sourceId)) {
      incident = await Incident.findOne({ _id: toObjectId(sourceId), tenant_id: tid })
        .select('title description severity status affected_service_ids source source_alert_id ai labels')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildRunbookContext: failed to load incident', { error: err.message });
  }

  const serviceIds: Types.ObjectId[] = incident?.affected_service_ids || [];

  // Published runbooks for affected services
  let serviceRunbooks: any[] = [];
  try {
    if (serviceIds.length > 0) {
      serviceRunbooks = await Runbook.find({
        tenant_id: tid,
        status: 'published',
        service_ids: { $in: serviceIds },
      })
        .select('title description category service_ids tags steps.order steps.title steps.type stats')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildRunbookContext: failed to query service runbooks', { error: err.message });
  }

  // General published runbooks (not service-specific)
  let generalRunbooks: any[] = [];
  try {
    generalRunbooks = await Runbook.find({
      tenant_id: tid,
      status: 'published',
      $or: [
        { service_ids: { $size: 0 } },
        { service_ids: { $exists: false } },
      ],
    })
      .select('title description category tags steps.order steps.title steps.type stats')
      .limit(20)
      .lean();
  } catch (err: any) {
    logger.warn('buildRunbookContext: failed to query general runbooks', { error: err.message });
  }

  const incTitle = incident?.title || 'unknown';
  const totalRunbooks = serviceRunbooks.length + generalRunbooks.length;

  return {
    summary: `Runbook context: incident "${incTitle}" with ${serviceRunbooks.length} service-specific and ${generalRunbooks.length} general runbook(s) available (${totalRunbooks} total)`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'runbook',
      incident,
      service_runbooks: serviceRunbooks,
      general_runbooks: generalRunbooks,
    },
  };
}

// 7. Comms Context
async function buildCommsContext(
  tenantId: string,
  sourceId?: string,
  consumerTenantId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // Incident state if incident-related
  let incident: any = null;
  try {
    if (sourceId && isObjectId(sourceId)) {
      incident = await Incident.findOne({ _id: toObjectId(sourceId), tenant_id: tid })
        .select('title description severity status affected_service_ids responders timeline metrics')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildCommsContext: failed to load incident', { error: err.message });
  }

  // Previous communications - filter timeline entries of type 'comms_sent'
  let previousComms: any[] = [];
  if (incident?.timeline) {
    previousComms = incident.timeline.filter(
      (entry: any) => entry.type === 'comms_sent'
    );
  }

  // Affected service names for context
  let services: any[] = [];
  try {
    const serviceIds = incident?.affected_service_ids || [];
    if (serviceIds.length > 0) {
      services = await Service.find({ _id: { $in: serviceIds }, tenant_id: tid })
        .select('name type current_status')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildCommsContext: failed to query services', { error: err.message });
  }

  const incTitle = incident?.title || sourceId || 'unknown';
  const severity = incident?.severity ? `SEV${incident.severity}` : 'N/A';

  return {
    summary: `Comms context: ${severity} incident "${incTitle}", ${previousComms.length} previous communication(s) sent, ${services.length} affected service(s)`,
    details: {
      tenant_id: tenantId,
      consumer_tenant_id: consumerTenantId,
      source_id: sourceId,
      context_type: 'communications',
      incident: incident ? {
        _id: incident._id,
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        affected_service_ids: incident.affected_service_ids,
        responders: incident.responders,
        metrics: incident.metrics,
      } : null,
      previous_comms: previousComms,
      affected_services: services,
      status_page_info: {},  // No status page model available; placeholder for future integration
    },
  };
}

// 8. SLO Context
async function buildSLOContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // All services for the tenant with their current status
  let services: any[] = [];
  try {
    services = await Service.find({ tenant_id: tid, deleted_at: null })
      .select('name type current_status tags')
      .lean();
  } catch (err: any) {
    logger.warn('buildSLOContext: failed to query services', { error: err.message });
  }

  // Recent incidents (30 days) grouped by service
  let recentIncidents: any[] = [];
  try {
    recentIncidents = await Incident.find({
      tenant_id: tid,
      createdAt: { $gte: ago(THIRTY_DAYS) },
    })
      .select('title severity status affected_service_ids createdAt metrics.mttr_seconds metrics.mtta_seconds')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
  } catch (err: any) {
    logger.warn('buildSLOContext: failed to query recent incidents', { error: err.message });
  }

  // Build a map of incidents per service
  const incidentsByService: Record<string, number> = {};
  for (const inc of recentIncidents) {
    for (const svcId of inc.affected_service_ids || []) {
      const key = svcId.toString();
      incidentsByService[key] = (incidentsByService[key] || 0) + 1;
    }
  }

  // Active changes
  let activeChanges: any[] = [];
  try {
    activeChanges = await ChangeRequest.find({
      tenant_id: tid,
      status: { $in: ['approved', 'scheduled', 'in_progress'] },
    })
      .select('title type status risk affected_service_ids implementation_window')
      .lean();
  } catch (err: any) {
    logger.warn('buildSLOContext: failed to query active changes', { error: err.message });
  }

  const degradedCount = services.filter(
    (s: any) => s.current_status !== 'operational' && s.current_status !== 'unknown'
  ).length;

  return {
    summary: `SLO guardian: ${services.length} service(s), ${degradedCount} non-operational, ${recentIncidents.length} incident(s) in 30d, ${activeChanges.length} active change(s)`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'slo_guardian',
      services,
      recent_incidents: recentIncidents,
      incidents_by_service: incidentsByService,
      active_changes: activeChanges,
    },
  };
}

// 9. On-call Wellness Context
async function buildOncallContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // All on-call schedules for the tenant
  let schedules: any[] = [];
  try {
    schedules = await OnCallSchedule.find({ tenant_id: tid })
      .select('name timezone layers overrides service_ids escalation_policy_id')
      .lean();
  } catch (err: any) {
    logger.warn('buildOncallContext: failed to query schedules', { error: err.message });
  }

  // Recent incidents per responder (30 days) for load analysis
  let recentIncidents: any[] = [];
  try {
    recentIncidents = await Incident.find({
      tenant_id: tid,
      createdAt: { $gte: ago(THIRTY_DAYS) },
    })
      .select('severity status responders createdAt metrics.mtta_seconds')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
  } catch (err: any) {
    logger.warn('buildOncallContext: failed to query recent incidents', { error: err.message });
  }

  // Build incident load per responder
  const loadPerResponder: Record<string, { count: number; sev1_2_count: number }> = {};
  for (const inc of recentIncidents) {
    for (const resp of inc.responders || []) {
      const uid = resp.user_id.toString();
      if (!loadPerResponder[uid]) {
        loadPerResponder[uid] = { count: 0, sev1_2_count: 0 };
      }
      loadPerResponder[uid].count += 1;
      if (inc.severity <= 2) {
        loadPerResponder[uid].sev1_2_count += 1;
      }
    }
  }

  // Users on the team
  let users: any[] = [];
  try {
    users = await User.find({ tenant_id: tid, status: 'active' })
      .select('name email roles')
      .lean();
  } catch (err: any) {
    logger.warn('buildOncallContext: failed to query users', { error: err.message });
  }

  return {
    summary: `On-call wellness: ${schedules.length} schedule(s), ${Object.keys(loadPerResponder).length} responder(s) active in 30d, ${recentIncidents.length} total incident(s), ${users.length} team member(s)`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'oncall_wellness',
      schedules,
      incident_load_per_responder: loadPerResponder,
      recent_incident_count: recentIncidents.length,
      users,
    },
  };
}

// 10. Knowledge Context
async function buildKnowledgeContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // If sourceId looks like an ObjectId, load that incident
  let incident: any = null;
  try {
    if (sourceId && isObjectId(sourceId)) {
      incident = await Incident.findOne({ _id: toObjectId(sourceId), tenant_id: tid })
        .select('title description severity status affected_service_ids timeline ai createdAt')
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildKnowledgeContext: failed to load incident', { error: err.message });
  }

  // Recent incidents (last 6 months, limit 50)
  let recentIncidents: any[] = [];
  try {
    recentIncidents = await Incident.find({
      tenant_id: tid,
      createdAt: { $gte: ago(SIX_MONTHS) },
    })
      .select('title severity status affected_service_ids ai.root_cause createdAt metrics.mttr_seconds')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    logger.warn('buildKnowledgeContext: failed to query recent incidents', { error: err.message });
  }

  // Published runbooks (limit 50)
  let runbooks: any[] = [];
  try {
    runbooks = await Runbook.find({
      tenant_id: tid,
      status: 'published',
    })
      .select('title description category service_ids tags')
      .sort({ updated_at: -1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    logger.warn('buildKnowledgeContext: failed to query runbooks', { error: err.message });
  }

  // Recent postmortems (limit 20)
  let postmortems: any[] = [];
  try {
    postmortems = await Postmortem.find({ tenant_id: tid })
      .select('title incident_id severity status summary root_cause contributing_factors action_items')
      .sort({ created_at: -1 })
      .limit(20)
      .lean();
  } catch (err: any) {
    logger.warn('buildKnowledgeContext: failed to query postmortems', { error: err.message });
  }

  const queryLabel = incident ? `incident "${incident.title}"` : (sourceId || 'general query');

  return {
    summary: `Knowledge context for ${queryLabel}: ${recentIncidents.length} incident(s), ${runbooks.length} runbook(s), ${postmortems.length} postmortem(s) in knowledge base`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'knowledge',
      incident,
      recent_incidents: recentIncidents,
      published_runbooks: runbooks,
      recent_postmortems: postmortems,
    },
  };
}

// 11. Provider Intelligence Context
async function buildProviderIntelContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // All linked consumers
  let consumerLinks: any[] = [];
  try {
    consumerLinks = await ProviderConsumerLink.find({
      provider_tenant_id: tid,
      status: 'active',
    }).lean();
  } catch (err: any) {
    logger.warn('buildProviderIntelContext: failed to query consumer links', { error: err.message });
  }

  const consumerTenantIds = consumerLinks.map((l: any) => l.consumer_tenant_id);

  // Active incidents across all consumer tenants
  let consumerIncidents: any[] = [];
  try {
    if (consumerTenantIds.length > 0) {
      consumerIncidents = await Incident.find({
        tenant_id: { $in: consumerTenantIds },
        status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
      })
        .select('tenant_id title severity status affected_service_ids createdAt')
        .sort({ severity: 1, createdAt: -1 })
        .limit(50)
        .lean();
    }
  } catch (err: any) {
    logger.warn('buildProviderIntelContext: failed to query consumer incidents', { error: err.message });
  }

  // Basic service counts per consumer
  let serviceCountsPerConsumer: Record<string, number> = {};
  try {
    if (consumerTenantIds.length > 0) {
      const serviceCounts = await Service.aggregate([
        { $match: { tenant_id: { $in: consumerTenantIds }, deleted_at: null } },
        { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
      ]);
      for (const entry of serviceCounts) {
        serviceCountsPerConsumer[entry._id.toString()] = entry.count;
      }
    }
  } catch (err: any) {
    logger.warn('buildProviderIntelContext: failed to count consumer services', { error: err.message });
  }

  return {
    summary: `Provider intelligence: ${consumerLinks.length} active consumer(s), ${consumerIncidents.length} active incident(s) across consumers`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'provider_intelligence',
      consumer_links: consumerLinks,
      consumer_active_incidents: consumerIncidents,
      service_counts_per_consumer: serviceCountsPerConsumer,
    },
  };
}

// 12. Compliance Context
async function buildComplianceContext(
  tenantId: string,
  sourceId?: string,
): Promise<AgentContextData> {
  const tid = toObjectId(tenantId);

  // Recent incidents lacking postmortems (SEV1/2 only)
  let incidentsMissingPostmortems: any[] = [];
  try {
    incidentsMissingPostmortems = await Incident.find({
      tenant_id: tid,
      severity: { $in: [1, 2] },
      status: { $in: ['resolved', 'closed'] },
      postmortem_id: null,
      createdAt: { $gte: ago(THIRTY_DAYS) },
    })
      .select('title severity status createdAt resolved_at metrics')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    logger.warn('buildComplianceContext: failed to query incidents without postmortems', { error: err.message });
  }

  // Recent changes without approvals (completed/implemented but approval_chain has no decisions)
  let changesWithoutApprovals: any[] = [];
  try {
    changesWithoutApprovals = await ChangeRequest.find({
      tenant_id: tid,
      status: { $in: ['completed', 'implemented', 'in_progress'] },
      createdAt: { $gte: ago(THIRTY_DAYS) },
      $or: [
        { approval_chain: { $size: 0 } },
        { approval_chain: { $exists: false } },
      ],
    })
      .select('title type status risk createdAt created_by')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    logger.warn('buildComplianceContext: failed to query changes without approvals', { error: err.message });
  }

  // Unresolved incidents older than SLA (open/acknowledged/investigating for > 24h as default SLA)
  let slaBreachIncidents: any[] = [];
  try {
    const slaThreshold = ago(24 * 60 * 60 * 1000); // 24 hours
    slaBreachIncidents = await Incident.find({
      tenant_id: tid,
      status: { $in: ['open', 'acknowledged', 'investigating'] },
      createdAt: { $lt: slaThreshold },
    })
      .select('title severity status createdAt metrics')
      .sort({ severity: 1, createdAt: 1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    logger.warn('buildComplianceContext: failed to query SLA breach incidents', { error: err.message });
  }

  return {
    summary: `Compliance: ${incidentsMissingPostmortems.length} SEV1/2 incident(s) missing postmortems, ${changesWithoutApprovals.length} change(s) without approvals, ${slaBreachIncidents.length} incident(s) past SLA`,
    details: {
      tenant_id: tenantId,
      source_id: sourceId,
      context_type: 'security_compliance',
      incidents_missing_postmortems: incidentsMissingPostmortems,
      changes_without_approvals: changesWithoutApprovals,
      sla_breach_incidents: slaBreachIncidents,
    },
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────

const CONTEXT_BUILDERS: Record<string, ContextBuilder> = {
  'incident-triage': buildTriageContext,
  'incident-commander': buildCommanderContext,
  'rca-agent': buildRCAContext,
  'alert-intelligence': buildAlertIntelContext,
  'change-risk': buildChangeRiskContext,
  'runbook-automation': buildRunbookContext,
  'comms-agent': buildCommsContext,
  'slo-guardian': buildSLOContext,
  'oncall-wellness': buildOncallContext,
  'knowledge-agent': buildKnowledgeContext,
  'provider-intel': buildProviderIntelContext,
  'security-compliance': buildComplianceContext,
};
