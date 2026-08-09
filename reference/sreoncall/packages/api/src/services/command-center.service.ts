import { Types } from 'mongoose';
import { Incident, IncidentDocument } from '../models/incident.model';
import { Service } from '../models/service.model';
import { ServiceDependency } from '../models/service-dependency.model';
import { ResolutionPlan } from '../models/resolution-plan.model';
import { IncidentCorrelation } from '../models/incident-correlation.model';
import { BusinessImpactConfig } from '../models/business-impact-config.model';
import { StakeholderUpdate } from '../models/stakeholder-update.model';
import { EmergingRisk } from '../models/emerging-risk.model';
import { AuditLog } from '../models/audit-log.model';
import { Team } from '../models/team.model';
import { AlertRule } from '../models/alert-rule.model';
import { SlaConfig } from '../models/sla-config.model';
import { Ticket } from '../models/ticket.model';
import { User } from '../models/user.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { IncidentComplianceState, type ComplianceActionKey } from '../models/incident-compliance-state.model';
import {
  detectComplianceRegulation,
  ensureComplianceRecord,
  generateIncidentRegulatoryReport,
} from './incident-compliance.service';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Tenant } from '../models/tenant.model';
import { IccVisibilityConfig } from '../models/icc-visibility-config.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';
import * as oncallService from './oncall.service';
import * as lgtm from './lgtm-query.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ICCPersona =
  | 'sre_engineer'
  | 'sre_manager'
  | 'platform_engineer'
  | 'tenant_admin'
  | 'msp_provider'
  | 'consumer'
  | 'platform_admin';

interface TopologyNode {
  service_id: string;
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  is_root_cause: boolean;
  is_affected: boolean;
  health: {
    error_rate_percent: number | null;
    latency_p99_ms: number | null;
    cpu_percent: number | null;
    memory_percent: number | null;
    last_updated_at: string | null;
  };
  owner_team: { _id: string; name: string } | null;
  oncall_user: { _id: string; name: string; email: string } | null;
}

interface TopologyEdge {
  source_service_id: string;
  target_service_id: string;
  dependency_type: string;
  criticality: string;
  traffic: {
    requests_per_minute: number | null;
    error_rate_percent: number | null;
    latency_ms: number | null;
  };
}

interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

interface ContextBrief {
  service_name: string;
  service_description: string | null;
  owner_team: string | null;
  oncall_engineer: string | null;
  last_deploy: {
    version: string | null;
    deployed_by: string | null;
    deployed_at: string | null;
    commit_message: string | null;
  } | null;
  recent_incidents: Array<{
    _id: string;
    number: number;
    title: string;
    severity: number;
    resolved_at: string | null;
    mttr_seconds: number | null;
    root_cause: string | null;
  }>;
  known_quirks: string[];
  current_state: {
    error_rate: string;
    latency_p99: string;
    uptime_24h: string | null;
    active_alerts: number;
  };
}

interface ChangeCorrelation {
  recent_deploys: Array<{
    service_name: string;
    version: string;
    deployed_by: string;
    deployed_at: string;
    commit_message: string | null;
    time_before_incident_minutes: number;
  }>;
  recent_config_changes: Array<{
    type: string;
    description: string;
    changed_by: string | null;
    changed_at: string;
    time_before_incident_minutes: number;
  }>;
  recent_alerts: Array<{
    alert_name: string;
    service_name: string;
    fired_at: string;
    severity: string;
  }>;
}

interface AffectedService {
  id: string;
  name: string;
  type: string;
}

interface BlastRadius {
  directly_affected_services: AffectedService[];
  indirectly_affected_services: AffectedService[];
  sla_at_risk: Array<{
    sla_name: string;
    tenant_name: string | null;
    commitment: string;
    remaining_error_budget_minutes: number;
    breach_eta: string | null;
  }>;
  estimated_users_affected: number | null;
  estimated_revenue_impact_per_hour: number | null;
}

interface BusinessImpact {
  revenue_impact_per_hour_cents: number | null;
  users_affected: number | null;
  customer_tiers: Array<{
    tier: string;
    count: number;
  }>;
  sla_at_risk: Array<{
    customer: string;
    sla: string;
    remaining_minutes: number;
    breach_eta: string | null;
  }>;
  support_ticket_surge_percent: number | null;
}

interface CorrelatedIncidentEntry {
  _id: string;
  correlation_id: string;
  incidents: Array<{
    _id: string;
    number: number;
    title: string;
    severity: number;
    status: string;
    service_name: string;
  }>;
  correlation_type: string;
  confidence_percent: number;
  evidence: Array<{
    type: string;
    description: string;
  }>;
  status: 'proposed' | 'confirmed' | 'rejected';
}

interface ComplianceInfo {
  regulatory_clock_active: boolean;
  regulation: string | null;
  deadline: string | null;
  time_remaining: string | null;
  required_actions: Array<{
    key: string;
    action: string;
    status: 'pending' | 'completed';
    completed_at: string | null;
  }>;
  breach_report_id: string | null;
  evidence_captured: boolean;
}

interface ICCPermissions {
  can_resolve_steps: boolean;
  can_add_timeline_notes: boolean;
  can_trigger_validation: boolean;
  can_send_comms: boolean;
  can_merge_correlations: boolean;
  can_manage_compliance: boolean;
}

interface CommandCenterData {
  incident: any;
  topology: Topology;
  context_brief: ContextBrief;
  change_correlation: ChangeCorrelation;
  blast_radius: BlastRadius;
  business_impact: BusinessImpact | null;
  correlated_incidents: CorrelatedIncidentEntry[] | { count: number };
  resolution_plan: any | null;
  compliance: ComplianceInfo | null;
  _permissions: ICCPermissions;
}

// ─── Visibility Matrix ────────────────────────────────────────────────────────

export type VisibilityLevel = 'full' | 'view' | 'summary' | 'own' | 'hidden';

export interface PersonaVisibility {
  topology: VisibilityLevel;
  context_brief: VisibilityLevel;
  change_correlation: VisibilityLevel;
  telemetry_metrics: VisibilityLevel;
  telemetry_traces: VisibilityLevel;
  telemetry_logs: VisibilityLevel;
  resolve_panel: VisibilityLevel;
  business_impact: VisibilityLevel;
  correlated_incidents: VisibilityLevel;
  stakeholder_comms: VisibilityLevel;
  compliance: VisibilityLevel;
  emerging_risks: VisibilityLevel;
  alert_quality: VisibilityLevel;
  toil: VisibilityLevel;
  timeline: VisibilityLevel;
}

const ICC_VISIBILITY_MATRIX: Record<ICCPersona, PersonaVisibility> = {
  sre_engineer: {
    topology: 'full', context_brief: 'full', change_correlation: 'full',
    telemetry_metrics: 'full', telemetry_traces: 'full', telemetry_logs: 'full',
    resolve_panel: 'full', business_impact: 'hidden', correlated_incidents: 'full',
    stakeholder_comms: 'own', compliance: 'view', emerging_risks: 'own',
    alert_quality: 'own', toil: 'own', timeline: 'full',
  },
  sre_manager: {
    topology: 'view', context_brief: 'summary', change_correlation: 'summary',
    telemetry_metrics: 'view', telemetry_traces: 'hidden', telemetry_logs: 'hidden',
    resolve_panel: 'view', business_impact: 'full', correlated_incidents: 'full',
    stakeholder_comms: 'full', compliance: 'full', emerging_risks: 'full',
    alert_quality: 'full', toil: 'full', timeline: 'view',
  },
  platform_engineer: {
    topology: 'full', context_brief: 'full', change_correlation: 'full',
    telemetry_metrics: 'full', telemetry_traces: 'full', telemetry_logs: 'full',
    resolve_panel: 'full', business_impact: 'hidden', correlated_incidents: 'full',
    stakeholder_comms: 'hidden', compliance: 'view', emerging_risks: 'full',
    alert_quality: 'full', toil: 'full', timeline: 'full',
  },
  tenant_admin: {
    topology: 'view', context_brief: 'summary', change_correlation: 'summary',
    telemetry_metrics: 'hidden', telemetry_traces: 'hidden', telemetry_logs: 'hidden',
    resolve_panel: 'hidden', business_impact: 'full', correlated_incidents: 'summary',
    stakeholder_comms: 'own', compliance: 'full', emerging_risks: 'hidden',
    alert_quality: 'hidden', toil: 'hidden', timeline: 'summary',
  },
  msp_provider: {
    topology: 'full', context_brief: 'summary', change_correlation: 'summary',
    telemetry_metrics: 'view', telemetry_traces: 'hidden', telemetry_logs: 'hidden',
    resolve_panel: 'view', business_impact: 'full', correlated_incidents: 'full',
    stakeholder_comms: 'full', compliance: 'full', emerging_risks: 'full',
    alert_quality: 'full', toil: 'full', timeline: 'summary',
  },
  consumer: {
    topology: 'own', context_brief: 'own', change_correlation: 'own',
    telemetry_metrics: 'view', telemetry_traces: 'hidden', telemetry_logs: 'hidden',
    resolve_panel: 'hidden', business_impact: 'own', correlated_incidents: 'own',
    stakeholder_comms: 'hidden', compliance: 'hidden', emerging_risks: 'own',
    alert_quality: 'hidden', toil: 'hidden', timeline: 'summary',
  },
  platform_admin: {
    topology: 'full', context_brief: 'full', change_correlation: 'full',
    telemetry_metrics: 'full', telemetry_traces: 'full', telemetry_logs: 'full',
    resolve_panel: 'full', business_impact: 'full', correlated_incidents: 'full',
    stakeholder_comms: 'full', compliance: 'full', emerging_risks: 'full',
    alert_quality: 'full', toil: 'full', timeline: 'full',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapServiceStatus(status: string): 'healthy' | 'degraded' | 'down' | 'unknown' {
  switch (status) {
    case 'operational': return 'healthy';
    case 'degraded': return 'degraded';
    case 'partial_outage':
    case 'major_outage': return 'down';
    default: return 'unknown';
  }
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 60000);
}

async function fetchIncident(tenantId: Types.ObjectId, incidentId: string): Promise<IncidentDocument> {
  const inc = await Incident.findOne({ _id: incidentId, tenant_id: tenantId })
    .populate('commander_id', 'name email avatar_url')
    .populate('comms_lead_id', 'name email avatar_url')
    .populate('operations_lead_id', 'name email avatar_url')
    .populate('responders.user_id', 'name email avatar_url')
    .populate('created_by', 'name email avatar_url')
    .populate('affected_service_ids', 'name type current_status description owner_id oncall_schedule_id');
  if (!inc) throw AppError.notFound('Incident');
  return inc;
}

// ─── Topology ─────────────────────────────────────────────────────────────────

// Maximum graph distance from affected services to include in the topology view.
// 2 hops covers: affected service → its direct dependencies → their dependencies.
const TOPOLOGY_HOPS = 2;

async function buildTopology(tenantId: Types.ObjectId, incident: IncidentDocument): Promise<Topology> {
  let affectedServiceIds = (incident.affected_service_ids || []).map((s: any) =>
    s && typeof s === 'object' && s._id ? s._id.toString() : s.toString()
  ).filter((id: string) => id && id !== 'undefined');

  // If no affected services, try to infer from the alert rule's service_id
  if (affectedServiceIds.length === 0 && incident.source_alert_id) {
    try {
      const alertRuleId = typeof incident.source_alert_id === 'object' && (incident.source_alert_id as any)._id
        ? (incident.source_alert_id as any)._id
        : incident.source_alert_id;
      const alertRule = await AlertRule.findById(alertRuleId).lean();
      if (alertRule?.service_id) {
        affectedServiceIds = [alertRule.service_id.toString()];
        logger.info('ICC: inferred affected service from alert rule', {
          incidentId: incident._id.toString(),
          alertRuleId: alertRuleId.toString(),
          serviceId: alertRule.service_id.toString(),
        });
      }
    } catch (err: any) {
      logger.debug('ICC: failed to infer service from alert rule', { error: err.message });
    }
  }

  // No seed nodes — return an empty topology rather than dumping the full tenant graph.
  if (affectedServiceIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // BFS over the dependency graph bounded to TOPOLOGY_HOPS hops from the affected
  // services. Issues at most TOPOLOGY_HOPS targeted queries instead of one query
  // that loads every edge in the tenant.
  const relevantServiceIds = new Set<string>(affectedServiceIds);
  const relevantEdgeMap = new Map<string, any>(); // keyed by "srcId→tgtId" to deduplicate
  let frontier = new Set<string>(affectedServiceIds);

  for (let hop = 0; hop < TOPOLOGY_HOPS; hop++) {
    if (frontier.size === 0) break;

    const hopDeps = await ServiceDependency.find({
      tenant_id: tenantId,
      status: 'approved',
      $or: [
        { source_service_id: { $in: [...frontier] } },
        { target_service_id: { $in: [...frontier] } },
      ],
    }).lean();

    const nextFrontier = new Set<string>();
    for (const dep of hopDeps) {
      const src = dep.source_service_id.toString();
      const tgt = dep.target_service_id.toString();
      const key = `${src}→${tgt}`;
      if (!relevantEdgeMap.has(key)) {
        relevantEdgeMap.set(key, dep);
      }
      for (const id of [src, tgt]) {
        if (!relevantServiceIds.has(id)) {
          relevantServiceIds.add(id);
          nextFrontier.add(id);
        }
      }
    }
    frontier = nextFrontier;
  }

  const dependencies = [...relevantEdgeMap.values()];

  // Fetch only the services in the relevant subgraph (not the full tenant catalogue).
  const services = await Service.find({
    _id: { $in: [...relevantServiceIds] },
    tenant_id: tenantId,
  }).lean();

  // Fetch teams for owner lookup
  const ownerIds = services.filter((s) => s.owner_id).map((s) => s.owner_id);
  const teams = await Team.find({
    _id: { $in: ownerIds },
    tenant_id: tenantId,
  }).lean();
  const teamMap = new Map(teams.map((t) => [t._id.toString(), t]));

  // Fetch health for all services in 4 batched Prometheus queries instead of N×4 sequential calls.
  const serviceNames = services.map((s) => s.name);

  // Collect unique schedule IDs so on-call resolution can be batched too.
  const scheduleIds = services
    .filter((s) => s.oncall_schedule_id)
    .map((s) => new Types.ObjectId(s.oncall_schedule_id!.toString()));
  const uniqueScheduleIds = [...new Map(scheduleIds.map((id) => [id.toString(), id])).values()];

  // Run health fetch and schedule resolution in parallel — both are independent.
  const [bulkHealth, scheduleOnCallMap] = await Promise.all([
    lgtm.getBulkServiceHealth(tenantId.toString(), serviceNames),
    oncallService.resolveScheduleOnCallMap(uniqueScheduleIds, tenantId),
  ]);

  // Collect all on-call user IDs across all schedules, then fetch in one query.
  const allOnCallUserIds = [...new Set(
    [...scheduleOnCallMap.values()].flat().map((id) => id.toString()),
  )];
  const onCallUsers = await User.find(
    { _id: { $in: allOnCallUserIds } },
    { name: 1, email: 1 },
  ).lean();
  const userMap = new Map(onCallUsers.map((u) => [u._id.toString(), u]));

  // Build nodes
  const nodes: TopologyNode[] = [];
  for (const svc of services) {
    const svcId = svc._id.toString();
    const ownerTeam = svc.owner_id ? teamMap.get(svc.owner_id.toString()) : null;

    const serviceHealth = bulkHealth.get(svc.name) ?? {
      error_rate_percent: null,
      latency_p99_ms: null,
      cpu_percent: null,
      memory_percent: null,
      last_updated_at: null,
    };
    const health = {
      error_rate_percent: serviceHealth.error_rate_percent,
      latency_p99_ms: serviceHealth.latency_p99_ms,
      cpu_percent: serviceHealth.cpu_percent,
      memory_percent: serviceHealth.memory_percent,
      last_updated_at: serviceHealth.last_updated_at,
    };

    // Resolve on-call user from pre-fetched maps — no DB calls inside the loop.
    let oncallUser: TopologyNode['oncall_user'] = null;
    if (svc.oncall_schedule_id) {
      const onCallIds = scheduleOnCallMap.get(svc.oncall_schedule_id.toString()) ?? [];
      const firstUserId = onCallIds[0]?.toString();
      if (firstUserId) {
        const user = userMap.get(firstUserId);
        if (user) {
          oncallUser = { _id: user._id.toString(), name: (user as any).name, email: (user as any).email };
        }
      }
    }

    nodes.push({
      service_id: svcId,
      name: svc.name,
      type: svc.type,
      status: mapServiceStatus(svc.current_status),
      is_root_cause: affectedServiceIds.includes(svcId) && affectedServiceIds.indexOf(svcId) === 0,
      is_affected: affectedServiceIds.includes(svcId),
      health,
      owner_team: ownerTeam ? { _id: ownerTeam._id.toString(), name: ownerTeam.name } : null,
      oncall_user: oncallUser,
    });
  }

  // Build edges
  const edges: TopologyEdge[] = dependencies.map((dep) => ({
    source_service_id: dep.source_service_id.toString(),
    target_service_id: dep.target_service_id.toString(),
    dependency_type: dep.dependency_type,
    criticality: dep.criticality,
    traffic: {
      requests_per_minute: dep.traffic_metadata?.avg_requests_per_minute ?? null,
      error_rate_percent: dep.traffic_metadata?.error_rate_percent ?? null,
      latency_ms: dep.traffic_metadata?.avg_latency_ms ?? null,
    },
  }));

  return { nodes, edges };
}

// ─── Context Brief ────────────────────────────────────────────────────────────

const CONTEXT_RECENT_INCIDENTS_LIMIT = 3;

async function buildContextBrief(tenantId: Types.ObjectId, incident: IncidentDocument): Promise<ContextBrief> {
  // Use first affected service as primary context
  const primaryService = (incident.affected_service_ids || []).find(
    (s: any) => s && typeof s === 'object' && s.name
  ) as any;

  const serviceName = primaryService?.name || 'Unknown Service';
  const serviceDescription = primaryService?.description || null;

  // Resolve owner_team name from Team model
  let ownerTeam: string | null = null;
  try {
    if (primaryService?.owner_id) {
      const team = await Team.findOne({ _id: primaryService.owner_id, tenant_id: tenantId }).lean();
      if (team) {
        ownerTeam = team.name;
      }
    }
  } catch (err: any) {
    logger.warn('Failed to resolve owner team name', { error: err.message });
  }

  // Resolve on-call engineer name from on-call schedule
  let oncallEngineer: string | null = null;
  try {
    if (primaryService?.oncall_schedule_id) {
      const oncallUserIds = await oncallService.getOnCallUsersForSchedule(
        primaryService.oncall_schedule_id as Types.ObjectId,
        tenantId,
      );
      if (oncallUserIds.length > 0) {
        const user = await User.findById(oncallUserIds[0]).select('name').lean();
        if (user) {
          oncallEngineer = (user as any).name || null;
        }
      }
    }
  } catch (err: any) {
    logger.warn('Failed to resolve on-call engineer', { error: err.message });
  }

  // Fetch last deploy from audit logs
  let lastDeploy = null as ContextBrief['last_deploy'];

  if (primaryService?._id) {
    const deployLog = await AuditLog.findOne({
      tenant_id: tenantId,
      action: { $in: ['service.deploy', 'deployment.create', 'deployment.completed'] },
      'metadata.service_id': primaryService._id.toString(),
    })
      .sort({ createdAt: -1 })
      .lean();

    if (deployLog) {
      lastDeploy = {
        version: (deployLog as any).metadata?.version || null,
        deployed_by: (deployLog as any).metadata?.deployed_by || null,
        deployed_at: (deployLog as any).createdAt?.toISOString() || null,
        commit_message: (deployLog as any).metadata?.commit_message || null,
      };
    }
  }

  const recentIncidents = primaryService?._id
    ? await Incident.find({
        tenant_id: tenantId,
        affected_service_ids: primaryService._id,
        _id: { $ne: incident._id },
      })
        .sort({ createdAt: -1 })
        .limit(CONTEXT_RECENT_INCIDENTS_LIMIT)
        .lean()
    : [];

  const recentIncidentsList = recentIncidents.map((inc: any) => ({
    _id: inc._id.toString(),
    number: inc.number,
    title: inc.title,
    severity: inc.severity,
    resolved_at: inc.metrics?.resolved_at?.toISOString() || null,
    mttr_seconds: inc.metrics?.mttr_seconds ?? null,
    root_cause: inc.ai?.root_cause || null,
  }));

  // Known quirks: read from service.notes (split by newline into individual bullets).
  // Falls back to tags when notes is empty — tags like "memory-leak-prone" or
  // "requires-restart" are operationally useful as quirk items.
  // service.description is excluded here as it's already shown in service_description.
  let knownQuirks: string[] = [];
  if (primaryService) {
    if (primaryService.notes) {
      knownQuirks = (primaryService.notes as string)
        .split('\n')
        .map((line: string) => line.replace(/^[-*•]\s*/, '').trim())
        .filter((line: string) => line.length > 0);
    } else if ((primaryService.tags as string[] | undefined)?.length) {
      knownQuirks = primaryService.tags as string[];
    }
  }

  // Availability over the last 24h: average of per-5m-window success fractions.
  // avg_over_time([24h:5m]) evaluates the inner expression at 5m resolution across
  // 24h and returns the mean — gives a stable uptime % unaffected by a single spike.
  const uptimePromql = primaryService?._id
    ? `100 * avg_over_time((1 - clamp_max(` +
      `rate(http_server_request_duration_seconds_count{service_name="${serviceName}",http_response_status_code=~"5.."}[5m])` +
      ` / clamp_min(rate(http_server_request_duration_seconds_count{service_name="${serviceName}"}[5m]), 1)` +
      `, 1))[24h:5m])`
    : null;

  // Run LGTM health, firing alert count, and uptime query in parallel.
  const [currentHealth, activeAlerts, uptime24hRaw] = await Promise.all([
    primaryService?._id
      ? lgtm.getServiceHealth(tenantId.toString(), serviceName)
      : Promise.resolve(null),
    primaryService?._id
      ? AlertRule.countDocuments({
          tenant_id: tenantId,
          service_id: primaryService._id,
          alert_state: 'firing',
        })
      : Promise.resolve(0),
    uptimePromql
      ? lgtm.queryMetricInstant(tenantId.toString(), uptimePromql)
      : Promise.resolve(null),
  ]);

  const currentState = {
    error_rate: currentHealth?.error_rate_percent != null
      ? `${currentHealth.error_rate_percent.toFixed(2)}%`
      : 'N/A',
    latency_p99: currentHealth?.latency_p99_ms != null
      ? `${currentHealth.latency_p99_ms.toFixed(0)}ms`
      : 'N/A',
    uptime_24h: uptime24hRaw != null ? `${uptime24hRaw.toFixed(2)}%` : null,
    active_alerts: activeAlerts,
  };

  return {
    service_name: serviceName,
    service_description: serviceDescription,
    owner_team: ownerTeam,
    oncall_engineer: oncallEngineer,
    last_deploy: lastDeploy,
    recent_incidents: recentIncidentsList,
    known_quirks: knownQuirks,  // string[] — each line of service.notes becomes one bullet
    current_state: currentState,
  };
}

// ─── Change Correlation ───────────────────────────────────────────────────────

async function buildChangeCorrelation(
  tenantId: Types.ObjectId,
  incident: IncidentDocument
): Promise<ChangeCorrelation> {
  const incidentCreatedAt = (incident as any).createdAt || new Date();
  const windowStart = new Date(incidentCreatedAt.getTime() - 2 * 60 * 60 * 1000); // 2h before incident

  // Fetch deploy-related audit logs within 2h window before incident
  const deployLogs = await AuditLog.find({
    tenant_id: tenantId,
    action: { $in: ['service.deploy', 'deployment.create', 'deployment.completed'] },
    createdAt: { $gte: windowStart, $lte: incidentCreatedAt },
  })
    .sort({ createdAt: -1 })
    .lean();

  const recentDeploys = deployLogs.map((log: any) => ({
    service_name: log.metadata?.service_name || 'Unknown',
    version: log.metadata?.version || 'Unknown',
    deployed_by: log.metadata?.deployed_by || log.actor_email || 'Unknown',
    deployed_at: log.createdAt.toISOString(),
    commit_message: log.metadata?.commit_message || null,
    time_before_incident_minutes: minutesBetween(log.createdAt, incidentCreatedAt),
  }));

  // Fetch config change audit logs within 2h window
  const configLogs = await AuditLog.find({
    tenant_id: tenantId,
    action: { $in: ['config.update', 'feature_flag.toggle', 'scaling.change', 'env_var.update'] },
    createdAt: { $gte: windowStart, $lte: incidentCreatedAt },
  })
    .sort({ createdAt: -1 })
    .lean();

  const recentConfigChanges = configLogs.map((log: any) => ({
    type: log.metadata?.type || log.action.split('.')[0] || 'unknown',
    description: log.metadata?.description || log.action,
    changed_by: log.actor_email || null,
    changed_at: log.createdAt.toISOString(),
    time_before_incident_minutes: minutesBetween(log.createdAt, incidentCreatedAt),
  }));

  // Fetch recent alerts near incident time
  let recentAlerts: ChangeCorrelation['recent_alerts'] = [];
  try {
    const alertWindow = new Date(incidentCreatedAt.getTime() - 30 * 60 * 1000); // 30 min before incident
    const firedAlerts = await AlertRule.find({
      tenant_id: tenantId,
      last_triggered_at: { $gte: alertWindow, $lte: incidentCreatedAt },
      alert_state: 'firing',
    })
      .populate('service_id', 'name')
      .sort({ last_triggered_at: -1 })
      .limit(20)
      .lean();

    recentAlerts = firedAlerts.map((alert: any) => ({
      alert_name: alert.name,
      service_name: alert.service_id && typeof alert.service_id === 'object' ? alert.service_id.name : 'Unknown',
      fired_at: alert.last_triggered_at?.toISOString() || '',
      severity: alert.severity,
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch recent alerts for change correlation', { error: err.message });
  }

  return {
    recent_deploys: recentDeploys,
    recent_config_changes: recentConfigChanges,
    recent_alerts: recentAlerts,
  };
}

// ─── SLA at-risk (shared between blast-radius and business-impact) ────────────

interface SlaAtRiskEntry {
  sla_name: string;
  resolution_time_minutes: number;
  remaining_minutes: number; // clamped to 0 when already breached
  breach_eta: string;        // ISO timestamp, or 'Breached'
}

async function computeSlaAtRisk(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
  consumerTenantId?: Types.ObjectId,
): Promise<SlaAtRiskEntry[]> {
  // When scoped to a consumer, use their SLA configs so countdown timers reflect
  // the consumer's own commitments, not the provider's internal SLAs.
  const slaConfigs = await SlaConfig.find({
    tenant_id: consumerTenantId ?? tenantId,
    enabled: true,
  }).lean();
  const incidentCreatedAt = (incident as any).createdAt || new Date();
  const now = new Date();
  const elapsedMinutes = Math.round((now.getTime() - incidentCreatedAt.getTime()) / 60000);

  const atRisk: SlaAtRiskEntry[] = [];
  for (const sla of slaConfigs) {
    const remaining = sla.resolution_time_minutes - elapsedMinutes;
    if (remaining <= 30) {
      atRisk.push({
        sla_name: sla.name,
        resolution_time_minutes: sla.resolution_time_minutes,
        remaining_minutes: Math.max(0, remaining),
        breach_eta: remaining > 0
          ? new Date(now.getTime() + remaining * 60 * 1000).toISOString()
          : 'Breached',
      });
    }
  }
  return atRisk;
}

// ─── Blast Radius ─────────────────────────────────────────────────────────────

async function buildBlastRadius(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
  slaAtRiskEntries?: SlaAtRiskEntry[],
): Promise<BlastRadius> {
  const affectedServiceIds = (incident.affected_service_ids || []).map((s: any) =>
    s && typeof s === 'object' && s._id ? s._id.toString() : s.toString()
  );

  // Fetch all approved dependencies
  const dependencies = await ServiceDependency.find({
    tenant_id: tenantId,
    status: 'approved',
  }).lean();

  // Build adjacency list (source → targets that depend on source)
  const dependentsMap = new Map<string, string[]>();
  for (const dep of dependencies) {
    const targetId = dep.target_service_id.toString();
    const sourceId = dep.source_service_id.toString();
    // sourceId depends on targetId, so if targetId is affected, sourceId is indirectly affected
    if (!dependentsMap.has(targetId)) dependentsMap.set(targetId, []);
    dependentsMap.get(targetId)!.push(sourceId);
  }

  // BFS to find indirectly affected services (downstream of directly affected)
  const indirectlyAffected = new Set<string>();
  const queue = [...affectedServiceIds];
  const visited = new Set<string>(affectedServiceIds);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = dependentsMap.get(current) || [];
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        indirectlyAffected.add(dep);
        queue.push(dep);
      }
    }
  }

  // Resolve service names and fetch impact configs in parallel.
  const allAffectedIds = [...affectedServiceIds, ...Array.from(indirectlyAffected)];
  const [impactConfigs, affectedServiceDocs] = await Promise.all([
    BusinessImpactConfig.find({
      tenant_id: tenantId,
      service_id: { $in: allAffectedIds },
    }).lean(),
    Service.find({
      _id: { $in: allAffectedIds },
      tenant_id: tenantId,
    }).select('name type').lean(),
  ]);

  const serviceNameMap = new Map(affectedServiceDocs.map((s) => [
    s._id.toString(),
    { name: s.name, type: s.type },
  ]));

  let estimatedUsersAffected: number | null = null;
  let estimatedRevenue: number | null = null;

  for (const config of impactConfigs) {
    if (config.total_user_count != null && config.estimated_users_affected_percent != null) {
      const users = Math.round(config.total_user_count * (config.estimated_users_affected_percent / 100));
      estimatedUsersAffected = (estimatedUsersAffected ?? 0) + users;
    }
    if (config.revenue_per_request_cents != null && config.avg_requests_per_minute != null) {
      const revenuePerHour = config.revenue_per_request_cents * config.avg_requests_per_minute * 60;
      estimatedRevenue = (estimatedRevenue ?? 0) + revenuePerHour;
    }
  }

  const entries = slaAtRiskEntries ?? await computeSlaAtRisk(tenantId, incident);
  const slaAtRisk: BlastRadius['sla_at_risk'] = entries.map((e) => ({
    sla_name: e.sla_name,
    tenant_name: null,
    commitment: `Resolve within ${e.resolution_time_minutes}min`,
    remaining_error_budget_minutes: e.remaining_minutes,
    breach_eta: e.breach_eta,
  }));

  const toAffectedService = (id: string): AffectedService => ({
    id,
    name: serviceNameMap.get(id)?.name ?? id,
    type: serviceNameMap.get(id)?.type ?? 'unknown',
  });

  return {
    directly_affected_services: affectedServiceIds.map(toAffectedService),
    indirectly_affected_services: Array.from(indirectlyAffected).map(toAffectedService),
    sla_at_risk: slaAtRisk,
    estimated_users_affected: estimatedUsersAffected,
    estimated_revenue_impact_per_hour: estimatedRevenue,
  };
}

// ─── Business Impact ──────────────────────────────────────────────────────────

async function buildBusinessImpact(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
  slaAtRiskEntries?: SlaAtRiskEntry[],
  consumerTenantId?: Types.ObjectId,
): Promise<BusinessImpact> {
  const affectedServiceIds = (incident.affected_service_ids || []).map((s: any) =>
    s && typeof s === 'object' && s._id ? s._id.toString() : s.toString()
  );

  // When scoped to a consumer, pull ALL of their impact configs — their services
  // live in their own tenant, not in the provider's. Otherwise scope to the
  // provider's affected services only.
  const impactConfigs = await BusinessImpactConfig.find(
    consumerTenantId
      ? { tenant_id: consumerTenantId }
      : { tenant_id: tenantId, service_id: { $in: affectedServiceIds } },
  ).lean();

  let revenuePerHour: number | null = null;
  let usersAffected: number | null = null;
  const customerTierMap = new Map<string, number>();

  for (const config of impactConfigs) {
    if (config.revenue_per_request_cents != null && config.avg_requests_per_minute != null) {
      revenuePerHour = (revenuePerHour ?? 0) + config.revenue_per_request_cents * config.avg_requests_per_minute * 60;
    }
    if (config.total_user_count != null && config.estimated_users_affected_percent != null) {
      usersAffected = (usersAffected ?? 0) + Math.round(
        config.total_user_count * (config.estimated_users_affected_percent / 100)
      );
    }
    for (const tier of config.customer_tiers || []) {
      customerTierMap.set(tier.tier, (customerTierMap.get(tier.tier) || 0) + tier.count);
    }
  }

  const customerTiers = Array.from(customerTierMap.entries()).map(([tier, count]) => ({
    tier,
    count,
  }));

  const entries = slaAtRiskEntries ?? await computeSlaAtRisk(tenantId, incident);
  const slaAtRisk: BusinessImpact['sla_at_risk'] = entries.map((e) => ({
    customer: e.sla_name,
    sla: `Resolve within ${e.resolution_time_minutes}min`,
    remaining_minutes: e.remaining_minutes,
    breach_eta: e.breach_eta,
  }));

  // Detect support ticket surge by comparing recent vs baseline ticket volume
  let supportTicketSurge: number | null = null;
  try {
    const now = new Date();
    const recentWindow = new Date(now.getTime() - 60 * 60 * 1000); // last 1 hour
    const baselineStart = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25h ago
    const baselineEnd = new Date(now.getTime() - 1 * 60 * 60 * 1000);   // 1h ago

    const recentCount = await Ticket.countDocuments({
      tenant_id: tenantId,
      createdAt: { $gte: recentWindow },
    });
    const baselineCount = await Ticket.countDocuments({
      tenant_id: tenantId,
      createdAt: { $gte: baselineStart, $lt: baselineEnd },
    });

    // baseline average per hour over 24h
    const baselineAvgPerHour = baselineCount / 24;
    if (baselineAvgPerHour > 0) {
      supportTicketSurge = Math.round(((recentCount - baselineAvgPerHour) / baselineAvgPerHour) * 100);
    }
  } catch (err: any) {
    logger.warn('Failed to calculate support ticket surge', { error: err.message });
  }

  return {
    revenue_impact_per_hour_cents: revenuePerHour,
    users_affected: usersAffected,
    customer_tiers: customerTiers,
    sla_at_risk: slaAtRisk,
    support_ticket_surge_percent: supportTicketSurge,
  };
}

// ─── Correlated Incidents ─────────────────────────────────────────────────────

async function buildCorrelations(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<CorrelatedIncidentEntry[]> {
  const correlations = await IncidentCorrelation.find({
    tenant_id: tenantId,
    $or: [
      { parent_incident_id: incidentId },
      { correlated_incident_ids: incidentId },
    ],
  }).lean();

  const result: CorrelatedIncidentEntry[] = [];

  for (const corr of correlations) {
    // Collect all incident IDs in this correlation
    const allIncidentIds = [
      ...(corr.parent_incident_id ? [corr.parent_incident_id] : []),
      ...corr.correlated_incident_ids,
    ];

    const incidents = await Incident.find({
      _id: { $in: allIncidentIds },
      tenant_id: tenantId,
    })
      .populate('affected_service_ids', 'name')
      .lean();

    const incidentEntries = incidents.map((inc: any) => {
      const firstService = (inc.affected_service_ids || [])[0];
      return {
        _id: inc._id.toString(),
        number: inc.number,
        title: inc.title,
        severity: inc.severity,
        status: inc.status,
        service_name: firstService && typeof firstService === 'object' ? firstService.name : 'Unknown',
      };
    });

    result.push({
      _id: corr._id.toString(),
      correlation_id: corr._id.toString(),
      incidents: incidentEntries,
      correlation_type: corr.correlation_type,
      confidence_percent: corr.confidence_percent,
      evidence: corr.evidence.map((e) => ({
        type: e.type,
        description: e.description,
      })),
      status: corr.status,
    });
  }

  return result;
}

// ─── Compliance ───────────────────────────────────────────────────────────────

// Regulation-specific action text. Keys are shared with IncidentComplianceState
// so stored completions remain valid if labels change.
const COMPLIANCE_ACTIONS: Record<string, Array<{ key: ComplianceActionKey; action: string }>> = {
  'GDPR Art 33': [
    { key: 'notify_authority', action: 'Notify supervisory authority (EU DPA) within 72h' },
    { key: 'document_breach',  action: 'Document breach details and scope' },
    { key: 'assess_risk',      action: 'Assess risk to data subjects' },
  ],
  'DPDP Act S25': [
    { key: 'notify_authority', action: 'Notify Data Protection Board of India (DPBI) within 72h' },
    { key: 'document_breach',  action: 'Document breach details and scope' },
    { key: 'assess_risk',      action: 'Assess risk to data principals' },
  ],
};

async function buildCompliance(
  tenantId: Types.ObjectId,
  incidentId: string,
  incident: IncidentDocument,
): Promise<ComplianceInfo | null> {
  const regulation = detectComplianceRegulation((incident as any).labels);
  if (!regulation) {
    return null;
  }

  // Idempotent — first call creates the linked BreachReport + evidence
  // snapshot; subsequent calls are a cheap read.
  const { breachReportId, evidenceCaptured } = await ensureComplianceRecord(tenantId, incident, regulation);

  const incidentCreatedAt = (incident as any).createdAt || new Date();
  const deadline = new Date(incidentCreatedAt.getTime() + 72 * 60 * 60 * 1000);
  const now = new Date();
  const remainingMs = deadline.getTime() - now.getTime();
  const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
  const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / 60000);

  // Load stored action completions for this incident
  const stored = await IncidentComplianceState.findOne({
    tenant_id: tenantId,
    incident_id: incidentId,
  }).lean();

  const storedMap = new Map(
    (stored?.actions ?? []).map((a) => [a.key, a]),
  );

  const regulationActions = COMPLIANCE_ACTIONS[regulation] ?? COMPLIANCE_ACTIONS['GDPR Art 33'];
  const required_actions = regulationActions.map(({ key, action }) => {
    const entry = storedMap.get(key);
    return {
      key,
      action,
      status: (entry?.status ?? 'pending') as 'pending' | 'completed',
      completed_at: entry?.completed_at?.toISOString() ?? null,
    };
  });

  return {
    regulatory_clock_active: remainingMs > 0,
    regulation,
    deadline: deadline.toISOString(),
    time_remaining: remainingMs > 0 ? `${remainingHours}h ${remainingMinutes}m` : 'Expired',
    required_actions,
    breach_report_id: breachReportId?.toString() ?? null,
    evidence_captured: evidenceCaptured,
  };
}

// ─── Persona Filtering ───────────────────────────────────────────────────────

function buildPermissions(visibility: PersonaVisibility): ICCPermissions {
  return {
    can_resolve_steps: visibility.resolve_panel === 'full',
    can_add_timeline_notes: visibility.timeline === 'full',
    can_trigger_validation: visibility.resolve_panel === 'full',
    can_send_comms: ['full', 'own'].includes(visibility.stakeholder_comms),
    can_merge_correlations: visibility.correlated_incidents === 'full',
    can_manage_compliance: visibility.compliance === 'full',
  };
}

/**
 * Resolves a persona's effective visibility matrix: platform defaults plus
 * any tenant-level overrides from icc_visibility_configs. Exported so routes
 * outside the main command-center aggregation (telemetry query, standalone
 * correlations, and other ICC sub-feature endpoints) can enforce the same
 * visibility rules the aggregated payload uses — the backend must enforce
 * this, not just hide tabs in the frontend (FRD §17.1).
 */
export async function getEffectiveVisibility(
  tenantId: Types.ObjectId,
  persona: ICCPersona,
): Promise<PersonaVisibility> {
  const visibility: PersonaVisibility = { ...ICC_VISIBILITY_MATRIX[persona] };

  try {
    const config = await IccVisibilityConfig.findOne({ tenant_id: tenantId, persona }).lean();
    if (config?.overrides) {
      const overrides = config.overrides instanceof Map
        ? Object.fromEntries(config.overrides)
        : config.overrides as Record<string, string>;
      for (const [key, val] of Object.entries(overrides)) {
        const v = String(val);
        if (key in visibility && (['full', 'view', 'summary', 'own', 'hidden'] as string[]).includes(v)) {
          (visibility as any)[key] = v as VisibilityLevel;
        }
      }
    }
  } catch (err: any) {
    logger.warn('Failed to load ICC visibility overrides', { tenantId: tenantId.toString(), persona, error: err.message });
  }

  return visibility;
}

async function filterByPersona(
  data: CommandCenterData,
  persona: ICCPersona,
  tenantId: Types.ObjectId,
): Promise<CommandCenterData> {
  const visibility = await getEffectiveVisibility(tenantId, persona);

  const filtered = { ...data };

  // Remove hidden components entirely
  if (visibility.resolve_panel === 'hidden') {
    filtered.resolution_plan = null;
  }
  if (visibility.business_impact === 'hidden') {
    filtered.business_impact = null;
  }
  if (visibility.compliance === 'hidden') {
    filtered.compliance = null;
  }

  // Scope "own" topology to affected services only
  if (visibility.topology === 'own') {
    const affectedIds = new Set(
      filtered.topology.nodes.filter((n) => n.is_affected).map((n) => n.service_id)
    );
    filtered.topology = {
      nodes: filtered.topology.nodes.filter((n) => affectedIds.has(n.service_id)),
      edges: filtered.topology.edges.filter(
        (e) => affectedIds.has(e.source_service_id) || affectedIds.has(e.target_service_id)
      ),
    };
  }

  // Condense "summary" context brief
  if (visibility.context_brief === 'summary') {
    filtered.context_brief = {
      ...filtered.context_brief,
      known_quirks: [],
      last_deploy: filtered.context_brief.last_deploy
        ? { ...filtered.context_brief.last_deploy, commit_message: null }
        : null,
    };
  }

  // Condense "summary" change correlation — most recent deploy/config only,
  // commit messages and alerts stripped (too technical for manager/admin views)
  if (visibility.change_correlation === 'summary') {
    filtered.change_correlation = {
      recent_deploys: filtered.change_correlation.recent_deploys
        .slice(0, 1)
        .map((d) => ({ ...d, commit_message: null })),
      recent_config_changes: filtered.change_correlation.recent_config_changes.slice(0, 1),
      recent_alerts: [],
    };
  }

  // Condense "summary" timeline — keep only structural lifecycle events so
  // manager/admin/consumer personas aren't flooded with technical step detail.
  // Covers: sre_manager, tenant_admin, consumer, msp_provider.
  if (visibility.timeline === 'summary') {
    const SUMMARY_TYPES = new Set([
      'declaration', 'acknowledgment', 'resolution', 'status_change',
    ]);
    const inc = filtered.incident as any;
    filtered.incident = {
      ...inc,
      timeline: (inc?.timeline ?? []).filter((e: any) => e && SUMMARY_TYPES.has(e.type)),
    };
  }

  // Condense "summary" correlated incidents to a count only (e.g. tenant_admin
  // shouldn't see the full cross-incident correlation detail, just that
  // related incidents exist).
  if (visibility.correlated_incidents === 'summary' && Array.isArray(filtered.correlated_incidents)) {
    filtered.correlated_incidents = { count: filtered.correlated_incidents.length };
  } else if (visibility.correlated_incidents === 'hidden') {
    filtered.correlated_incidents = { count: 0 };
  }

  // Apply permissions
  filtered._permissions = buildPermissions(visibility);

  return filtered;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const ICC_FULL_TTL     = 30; // seconds — full aggregated payload
const ICC_TOPOLOGY_TTL = 10; // seconds — topology only (matches frontend refetch interval)

const ALL_PERSONAS: ICCPersona[] = [
  'sre_engineer', 'sre_manager', 'platform_engineer',
  'tenant_admin', 'msp_provider', 'consumer', 'platform_admin',
];

function iccFullKey(tenantId: string, incidentId: string, persona: ICCPersona, consumerTenantId?: string): string {
  return `icc:full:${tenantId}:${incidentId}:${persona}${consumerTenantId ? `:${consumerTenantId}` : ''}`;
}

function iccTopologyKey(tenantId: string, incidentId: string): string {
  return `icc:topology:${tenantId}:${incidentId}`;
}

/**
 * Drop all cached ICC payloads for an incident across every persona.
 * Called by incident.service.ts on every state-changing mutation so stale
 * data is never served longer than one cache TTL after a change.
 */
export async function invalidateIccCache(tenantId: string, incidentId: string): Promise<void> {
  try {
    const keys = [
      ...ALL_PERSONAS.map((p) => iccFullKey(tenantId, incidentId, p)),
      iccTopologyKey(tenantId, incidentId),
    ];
    await getRedis().del(...keys);
  } catch (err: any) {
    logger.warn('ICC cache invalidation failed', { tenantId, incidentId, error: err.message });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getCommandCenterData(
  tenantId: Types.ObjectId,
  incidentId: string,
  persona?: ICCPersona,
  consumerTenantId?: string,
): Promise<CommandCenterData> {
  const effectivePersona: ICCPersona = persona || 'sre_engineer';

  // Only honour consumer scoping for the msp_provider persona.
  const consumerOId = (effectivePersona === 'msp_provider' && consumerTenantId)
    ? new Types.ObjectId(consumerTenantId)
    : undefined;

  const redis = getRedis();
  const cacheKey = iccFullKey(tenantId.toString(), incidentId, effectivePersona, consumerOId?.toString());

  // Serve from cache when available — avoids all downstream DB + LGTM work.
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CommandCenterData;
  } catch (err: any) {
    logger.warn('ICC full cache read failed', { incidentId, error: err.message });
  }

  // Distributed lock — prevents stampede when many responders open the ICC
  // simultaneously on a cold cache (e.g. 10 engineers joining a SEV1 war room).
  // One request acquires the lock and computes; the rest poll for the warm cache.
  const lockKey = `${cacheKey}:lock`;
  const LOCK_TTL   = 5;   // seconds — max time a computation should take
  const POLL_MS    = 100; // milliseconds between poll attempts
  const POLL_MAX   = 20;  // 20 × 100ms = 2s max wait

  let lockAcquired = false;
  try {
    const res = await redis.set(lockKey, '1', 'EX', LOCK_TTL, 'NX');
    lockAcquired = res === 'OK';
  } catch {
    // Redis unavailable — skip locking and compute directly
    lockAcquired = true;
  }

  if (!lockAcquired) {
    // Another request holds the lock — poll until cache is warm or timeout
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as CommandCenterData;
      } catch {
        // ignore transient redis error — keep polling
      }
    }
    // Safety valve: timed out waiting — compute directly rather than failing
    logger.warn('ICC cache lock wait timed out, computing directly', { incidentId });
  }

  // We hold the lock (or fell through after timeout) — compute the full payload.
  try {
    const incident = await fetchIncident(tenantId, incidentId);

    // Validate the provider-consumer link before using consumer-scoped data.
    // Prevents a provider from querying arbitrary tenants by guessing ObjectIds.
    if (consumerOId) {
      const link = await ProviderConsumerLink.findOne({
        provider_tenant_id: tenantId,
        consumer_tenant_id: consumerOId,
      }).lean();
      if (!link) {
        throw AppError.forbidden('No active provider-consumer link for this consumer tenant');
      }
    }

    // Compute once — shared by buildBlastRadius and buildBusinessImpact.
    // Pass consumerOId so SLA at-risk reflects the consumer's own commitments.
    const slaAtRiskEntries = await computeSlaAtRisk(tenantId, incident, consumerOId);

    const [topology, contextBrief, changeCorrelation, blastRadius, businessImpact, correlations, resolutionPlan, compliance] =
      await Promise.all([
        getOrBuildTopology(tenantId, incidentId, incident),
        buildContextBrief(tenantId, incident),
        buildChangeCorrelation(tenantId, incident),
        buildBlastRadius(tenantId, incident, slaAtRiskEntries),
        buildBusinessImpact(tenantId, incident, slaAtRiskEntries, consumerOId),
        buildCorrelations(tenantId, incidentId),
        ResolutionPlan.findOne({ tenant_id: tenantId, incident_id: incidentId })
          .sort({ createdAt: -1 })
          .lean(),
        buildCompliance(tenantId, incidentId, incident),
      ]);

    const visibility = ICC_VISIBILITY_MATRIX[effectivePersona];

    const data: CommandCenterData = {
      incident,
      topology,
      context_brief: contextBrief,
      change_correlation: changeCorrelation,
      blast_radius: blastRadius,
      business_impact: businessImpact,
      correlated_incidents: correlations,
      resolution_plan: resolutionPlan,
      compliance,
      _permissions: buildPermissions(visibility),
    };

    const filtered = await filterByPersona(data, effectivePersona, tenantId);

    // Await the cache write before releasing the lock so poll waiters always
    // find the entry populated — a fire-and-forget write here would create a
    // window where the lock is released before the cache key exists.
    try {
      await redis.setex(cacheKey, ICC_FULL_TTL, JSON.stringify(filtered));
    } catch (err: any) {
      logger.warn('ICC full cache write failed', { incidentId, error: err.message });
    }

    return filtered;
  } finally {
    // Always release the lock so waiters aren't stuck until TTL expires
    if (lockAcquired) {
      redis.del(lockKey).catch(() => {});
    }
  }
}

/**
 * Shared topology cache layer used by both getTopology() and getCommandCenterData().
 * Reads from icc:topology:{tenantId}:{incidentId}, calls buildTopology() on miss,
 * and writes back — so the standalone /topology endpoint and the full /command-center
 * endpoint share one cache entry and one computation per ICC_TOPOLOGY_TTL window.
 */
async function getOrBuildTopology(
  tenantId: Types.ObjectId,
  incidentId: string,
  incident: IncidentDocument,
): Promise<Topology> {
  const redis = getRedis();
  const cacheKey = iccTopologyKey(tenantId.toString(), incidentId);

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Topology;
  } catch (err: any) {
    logger.warn('ICC topology cache read failed', { incidentId, error: err.message });
  }

  const topology = await buildTopology(tenantId, incident);

  redis.setex(cacheKey, ICC_TOPOLOGY_TTL, JSON.stringify(topology)).catch((err: any) => {
    logger.warn('ICC topology cache write failed', { incidentId, error: err.message });
  });

  return topology;
}

export async function getTopology(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<Topology> {
  const incident = await fetchIncident(tenantId, incidentId);
  return getOrBuildTopology(tenantId, incidentId, incident);
}

export async function getChanges(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<ChangeCorrelation> {
  const incident = await fetchIncident(tenantId, incidentId);
  return buildChangeCorrelation(tenantId, incident);
}

export async function getBlastRadius(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<BlastRadius> {
  const incident = await fetchIncident(tenantId, incidentId);
  return buildBlastRadius(tenantId, incident);
}

export async function getComplianceReport(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<Record<string, unknown>> {
  const incident = await fetchIncident(tenantId, incidentId);
  return generateIncidentRegulatoryReport(tenantId, incident);
}

export async function getBusinessImpact(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<BusinessImpact> {
  const incident = await fetchIncident(tenantId, incidentId);
  return buildBusinessImpact(tenantId, incident);
}

export async function getCorrelations(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<CorrelatedIncidentEntry[]> {
  return buildCorrelations(tenantId, incidentId);
}

export interface ConsumerImpactEntry {
  consumer: { id: string; name: string; slug: string };
  business_impact: BusinessImpact;
  sla_at_risk_count: number;
}

/**
 * Returns per-consumer business impact for all active consumer tenants linked
 * to this provider. Used by the MSP "All consumers" aggregate view.
 */
export async function getConsumerImpacts(
  tenantId: Types.ObjectId,
  incidentId: string,
): Promise<ConsumerImpactEntry[]> {
  const incident = await fetchIncident(tenantId, incidentId);

  // Fetch all active consumer links for this provider
  const links = await ProviderConsumerLink.find({
    provider_tenant_id: tenantId,
    status: 'active',
  }).lean();

  if (links.length === 0) return [];

  // Resolve consumer tenant names in one query
  const consumerIds = links.map((l) => l.consumer_tenant_id);
  const tenants = await Tenant.find({ _id: { $in: consumerIds } }).select('name slug').lean();
  const tenantMap = new Map(tenants.map((t) => [t._id.toString(), t]));

  // Skip links whose referenced tenant no longer exists (deleted tenants produce
  // "Unknown" entries that add noise without actionable data).
  const resolvedLinks = links.filter((l) => tenantMap.has(l.consumer_tenant_id.toString()));

  if (resolvedLinks.length === 0) return [];

  // Compute each consumer's impact in parallel
  const entries = await Promise.all(
    resolvedLinks.map(async (link) => {
      const consumerOId = new Types.ObjectId(link.consumer_tenant_id.toString());
      const tenant = tenantMap.get(link.consumer_tenant_id.toString())!;

      const [businessImpact, slaEntries] = await Promise.all([
        buildBusinessImpact(tenantId, incident, undefined, consumerOId),
        computeSlaAtRisk(tenantId, incident, consumerOId),
      ]);

      return {
        consumer: {
          id: link.consumer_tenant_id.toString(),
          name: tenant.name,
          slug: (tenant as any).slug ?? '',
        },
        business_impact: businessImpact,
        sla_at_risk_count: slaEntries.length,
      };
    }),
  );

  // Sort by revenue impact descending so highest-impact consumer appears first
  return entries.sort(
    (a, b) => (b.business_impact.revenue_impact_per_hour_cents ?? 0) - (a.business_impact.revenue_impact_per_hour_cents ?? 0),
  );
}

export async function markComplianceAction(
  tenantId: Types.ObjectId,
  incidentId: string,
  actionKey: string,
  userId: Types.ObjectId,
): Promise<void> {
  const validKeys: ComplianceActionKey[] = ['notify_authority', 'document_breach', 'assess_risk'];
  if (!validKeys.includes(actionKey as ComplianceActionKey)) {
    throw AppError.badRequest(`Invalid compliance action key: ${actionKey}`);
  }

  const key = actionKey as ComplianceActionKey;
  const now = new Date();

  // Step 1 — ensure the document exists with all actions initialised as pending.
  // $setOnInsert only fires on INSERT so this is a no-op when the doc already
  // exists. MongoDB serialises concurrent upserts at the storage layer, so two
  // simultaneous "first mark" requests can never both trigger a create — one
  // wins the insert and the other retries as a matching update (no-op).
  await IncidentComplianceState.findOneAndUpdate(
    { tenant_id: tenantId, incident_id: incidentId },
    {
      $setOnInsert: {
        tenant_id: tenantId,
        incident_id: incidentId,
        actions: validKeys.map((k) => ({
          key: k,
          status: 'pending' as const,
          completed_at: null,
          completed_by: null,
        })),
      },
    },
    { upsert: true },
  );

  // Step 2 — update the target action in the now-guaranteed-to-exist document.
  await IncidentComplianceState.findOneAndUpdate(
    { tenant_id: tenantId, incident_id: incidentId },
    {
      $set: {
        'actions.$[elem].status': 'completed',
        'actions.$[elem].completed_at': now,
        'actions.$[elem].completed_by': userId,
      },
    },
    { arrayFilters: [{ 'elem.key': key }] },
  );
}
