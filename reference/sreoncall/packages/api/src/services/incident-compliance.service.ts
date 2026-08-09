import { Types } from 'mongoose';
import { IncidentDocument } from '../models/incident.model';
import { IncidentComplianceState } from '../models/incident-compliance-state.model';
import { AuditLog } from '../models/audit-log.model';
import { User } from '../models/user.model';
import { BreachReport, BreachReportDocument } from '../models/breach-report.model';
import { createBreachReport } from './breach-notification.service';
import { logger } from '../utils/logger';

export type ComplianceRegulation = 'GDPR Art 33' | 'DPDP Act S25';

const GDPR_LABEL_MATCH = /gdpr|data-breach/i;
const DPDP_LABEL_MATCH = /dpdp|personal-data/i;

/**
 * Single source of truth for "does this incident trigger a compliance
 * response" — shared by command-center.service.ts (display) and
 * resolution.worker.ts (resolution-plan step injection) so the two never
 * disagree on what counts as a compliance-triggering incident.
 */
export function detectComplianceRegulation(labels: string[] | undefined | null): ComplianceRegulation | null {
  const list = labels ?? [];
  if (list.some((l) => GDPR_LABEL_MATCH.test(l))) return 'GDPR Art 33';
  if (list.some((l) => DPDP_LABEL_MATCH.test(l))) return 'DPDP Act S25';
  return null;
}

const AUTHORITY_NAME: Record<ComplianceRegulation, string> = {
  'GDPR Art 33': 'the EU supervisory authority (DPA)',
  'DPDP Act S25': 'the Data Protection Board of India (DPBI)',
};

/**
 * Canonical compliance steps injected into a resolution plan for a
 * compliance-triggering incident (FRD §9 point 2). Shaped to match
 * ResolutionStep so they slot directly into ResolutionPlan.steps.
 */
export function buildComplianceResolutionSteps(regulation: ComplianceRegulation, startOrder: number) {
  const authority = AUTHORITY_NAME[regulation];
  const titles = [
    'Notify Data Protection Officer',
    'Preserve access logs and evidence',
    'Document breach scope',
    `File regulatory report with ${authority}`,
  ];
  const descriptions = [
    'Alert the DPO (dpo@sreoncall.com) that this incident has been flagged as a potential data breach and requires their review.',
    'Snapshot and retain audit logs, access records, and relevant metrics for this incident before they age out of retention — required evidence for the regulatory report.',
    `Document which systems, data categories, and data subjects were affected, to support the ${regulation} disclosure requirements.`,
    `Prepare and file the regulatory breach report with ${authority} within the 72-hour deadline.`,
  ];

  return titles.map((title, idx) => ({
    order: startOrder + idx + 1,
    title,
    description: descriptions[idx],
    type: 'manual' as const,
    source: 'compliance' as const,
    source_reference: null,
    suggested_command: null,
    status: 'pending' as const,
    completed_by: null,
    completed_at: null,
    skipped_reason: null,
    notes: null,
    duration_seconds: null,
    started_at: null,
  }));
}

/**
 * Compact evidence snapshot — audit log entries + incident timeline in the
 * window around the incident's creation — captured once, at first
 * compliance detection, so evidence isn't lost to later log rotation/edits.
 */
async function captureEvidenceSnapshot(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
): Promise<Record<string, unknown>> {
  const incidentCreatedAt = (incident as any).createdAt ?? new Date();
  const windowStart = new Date(incidentCreatedAt.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date();

  const auditEntries = await AuditLog.find({
    tenant_id: tenantId,
    timestamp: { $gte: windowStart, $lte: windowEnd },
  })
    .sort({ timestamp: -1 })
    .limit(200)
    .select('timestamp actor action resource_type resource_id result')
    .lean();

  return {
    captured_at: new Date().toISOString(),
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    incident_snapshot: {
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      labels: (incident as any).labels ?? [],
      affected_service_ids: (incident.affected_service_ids ?? []).map((id) => id.toString()),
    },
    timeline: ((incident as any).timeline ?? []).map((t: any) => ({
      type: t.type,
      message: t.message,
      timestamp: t.timestamp,
    })),
    audit_log_entries: auditEntries.map((a) => ({
      timestamp: a.timestamp,
      actor: a.actor,
      action: a.action,
      resource_type: a.resource_type,
      resource_id: a.resource_id,
      result: a.result,
    })),
    audit_log_entry_count: auditEntries.length,
  };
}

/**
 * Idempotently ensures a compliance record exists for this incident: creates
 * (once) a linked BreachReport scoped to this tenant and captures an
 * evidence snapshot. Safe to call on every command-center view — after the
 * first call, breach_report_id is set and this is a no-op read.
 */
export async function ensureComplianceRecord(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
  regulation: ComplianceRegulation,
): Promise<{ breachReportId: Types.ObjectId | null; evidenceCaptured: boolean }> {
  const incidentId = (incident as any)._id as Types.ObjectId;

  const existing = await IncidentComplianceState.findOne({ tenant_id: tenantId, incident_id: incidentId });
  if (existing?.breach_report_id) {
    return { breachReportId: existing.breach_report_id, evidenceCaptured: !!existing.evidence_captured_at };
  }

  let reportedBy = incident.created_by as Types.ObjectId | undefined;
  if (!reportedBy) {
    const fallbackAdmin = await User.findOne({ tenant_id: tenantId, status: 'active' }).select('_id').lean();
    reportedBy = fallbackAdmin?._id as Types.ObjectId | undefined;
  }
  if (!reportedBy) {
    logger.warn('Compliance: no user found to attribute auto-created breach report to, skipping', {
      tenantId: tenantId.toString(),
      incidentId: incidentId.toString(),
    });
    return { breachReportId: null, evidenceCaptured: false };
  }

  const evidenceSnapshot = await captureEvidenceSnapshot(tenantId, incident);

  let breachReport: BreachReportDocument;
  try {
    breachReport = await createBreachReport({
      title: `${regulation} — ${incident.title}`,
      description: incident.description || 'Compliance-triggering incident detected by SREonCall.',
      severity: incident.severity >= 4 ? 'critical' : incident.severity >= 3 ? 'high' : incident.severity >= 2 ? 'medium' : 'low',
      affected_tenants: [tenantId.toString()],
      affected_user_count: 0,
      data_categories_affected: [],
      reported_by: reportedBy,
    });
  } catch (err: any) {
    logger.error('Compliance: failed to auto-create breach report', { error: err.message, incidentId: incidentId.toString() });
    return { breachReportId: null, evidenceCaptured: false };
  }

  await IncidentComplianceState.findOneAndUpdate(
    { tenant_id: tenantId, incident_id: incidentId },
    {
      $setOnInsert: {
        tenant_id: tenantId,
        incident_id: incidentId,
        actions: [],
      },
      $set: {
        breach_report_id: breachReport._id,
        evidence_snapshot: evidenceSnapshot,
        evidence_captured_at: new Date(),
      },
    },
    { upsert: true },
  );

  return { breachReportId: breachReport._id, evidenceCaptured: true };
}

/**
 * Marks this incident's compliance state as having had its resolution-plan
 * compliance steps injected, so re-diagnosis doesn't duplicate them.
 */
export async function markResolutionStepsInjected(tenantId: Types.ObjectId, incidentId: Types.ObjectId): Promise<void> {
  await IncidentComplianceState.findOneAndUpdate(
    { tenant_id: tenantId, incident_id: incidentId },
    {
      $setOnInsert: { tenant_id: tenantId, incident_id: incidentId, actions: [] },
      $set: { resolution_steps_injected: true },
    },
    { upsert: true },
  );
}

export async function hasResolutionStepsInjected(tenantId: Types.ObjectId, incidentId: Types.ObjectId): Promise<boolean> {
  const state = await IncidentComplianceState.findOne({ tenant_id: tenantId, incident_id: incidentId })
    .select('resolution_steps_injected')
    .lean();
  return !!state?.resolution_steps_injected;
}

/**
 * Regulatory report draft for a single incident — the FRD §9 point 4
 * deliverable, scoped to one tenant's incident (not the platform-wide
 * multi-tenant report BreachReport's own generateAuthorityReport produces).
 */
export async function generateIncidentRegulatoryReport(
  tenantId: Types.ObjectId,
  incident: IncidentDocument,
): Promise<Record<string, unknown>> {
  const regulation = detectComplianceRegulation((incident as any).labels);
  if (!regulation) {
    throw new Error('This incident has no compliance trigger — no regulatory report applicable.');
  }

  const state = await IncidentComplianceState.findOne({
    tenant_id: tenantId,
    incident_id: (incident as any)._id,
  }).lean();

  const breachReport = state?.breach_report_id
    ? await BreachReport.findById(state.breach_report_id).lean()
    : null;

  const deadline = new Date(((incident as any).createdAt ?? new Date()).getTime() + 72 * 60 * 60 * 1000);

  return {
    report_type: `${regulation} — Data Breach Notification`,
    generated_at: new Date().toISOString(),
    incident: {
      id: (incident as any)._id.toString(),
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      created_at: (incident as any).createdAt?.toISOString?.() ?? null,
    },
    regulatory_clock: {
      deadline: deadline.toISOString(),
      time_remaining_hours: Math.max(0, (deadline.getTime() - Date.now()) / (1000 * 60 * 60)).toFixed(1),
    },
    required_actions: state?.actions ?? [],
    evidence: {
      captured_at: state?.evidence_captured_at?.toISOString?.() ?? null,
      audit_log_entry_count: (state?.evidence_snapshot as any)?.audit_log_entry_count ?? 0,
    },
    breach_report: breachReport
      ? {
          id: breachReport._id.toString(),
          status: breachReport.status,
          notifications_sent: breachReport.notifications_sent,
          authority_report_deadline: breachReport.authority_report_deadline.toISOString(),
        }
      : null,
    data_controller: {
      name: 'SREonCall',
      dpo_contact: 'dpo@sreoncall.com',
    },
  };
}
