import { Types } from 'mongoose';
import { Incident } from '../models/incident.model';
import { Ticket } from '../models/ticket.model';
import { Service } from '../models/service.model';
import { ChangeRequest } from '../models/change-request.model';
import { Runbook } from '../models/runbook.model';
import { logger } from '../utils/logger';

export interface IncidentContext {
  incident: {
    id: string;
    title: string;
    description: string;
    severity: number;
    severity_label: string;
    status: string;
    source: string;
    labels: string[];
    created_at: string;
    resolved_at: string | null;
    timeline: Array<{ type: string; message: string; timestamp: string }>;
    responders: Array<{ role: string; joined_at: string }>;
    metrics: {
      mtta_seconds: number | null;
      mttr_seconds: number | null;
    };
  };
  affected_services: Array<{
    name: string;
    type: string;
    environment: string;
    current_status: string;
    description: string;
  }>;
  recent_changes: Array<{
    title: string;
    type: string;
    status: string;
    risk_score: string;
    scheduled_start: string | null;
    description: string;
  }>;
  related_runbooks: Array<{
    title: string;
    description: string;
    category: string;
    step_count: number;
  }>;
}

const SEVERITY_LABELS: Record<number, string> = {
  1: 'CRITICAL',
  2: 'HIGH',
  3: 'MEDIUM',
  4: 'LOW',
  5: 'INFO',
};

/**
 * Try to find an incident by ID — first in the Incident collection, then fall back to Ticket.
 */
async function findIncident(tenantId: Types.ObjectId, id: string) {
  // Try new Incident model first
  const incident = await Incident.findOne({ _id: id, tenant_id: tenantId })
    .populate('commander_id', 'name email')
    .populate('affected_service_ids', 'name type environment current_status description')
    .lean();

  if (incident) {
    return { source: 'incident' as const, doc: incident };
  }

  // Fall back to legacy Ticket model
  const ticket = await Ticket.findOne({ _id: id, tenant_id: tenantId, type: 'incident' })
    .populate('reporter_id', 'name email')
    .populate('assignee_id', 'name email')
    .lean();

  if (ticket) {
    return { source: 'ticket' as const, doc: ticket };
  }

  return null;
}

/**
 * Build full incident context for AI analysis.
 */
export async function buildIncidentContext(
  tenantId: Types.ObjectId,
  incidentId: string
): Promise<IncidentContext | null> {
  const result = await findIncident(tenantId, incidentId);
  if (!result) return null;

  if (result.source === 'incident') {
    return buildFromIncident(tenantId, result.doc);
  }

  return buildFromTicket(tenantId, result.doc);
}

async function buildFromIncident(tenantId: Types.ObjectId, doc: any): Promise<IncidentContext> {
  const severity = doc.severity || 3;

  // Gather related data in parallel
  const [recentChanges, relatedRunbooks] = await Promise.all([
    fetchRecentChanges(tenantId, doc.affected_service_ids?.map((s: any) => s._id || s) || []),
    fetchRelatedRunbooks(tenantId, doc.affected_service_ids?.map((s: any) => s._id || s) || []),
  ]);

  // Parse affected services from populated data
  const affectedServices = (doc.affected_service_ids || [])
    .filter((s: any) => s && typeof s === 'object' && s.name)
    .map((s: any) => ({
      name: s.name,
      type: s.type || 'unknown',
      environment: s.environment || 'unknown',
      current_status: s.current_status || 'unknown',
      description: s.description || '',
    }));

  // Parse timeline
  const timeline = (doc.timeline || []).slice(-20).map((t: any) => ({
    type: t.type,
    message: t.message,
    timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : '',
  }));

  // Parse responders
  const responders = (doc.responders || []).map((r: any) => ({
    role: r.role || 'responder',
    joined_at: r.joined_at ? new Date(r.joined_at).toISOString() : '',
  }));

  return {
    incident: {
      id: doc._id.toString(),
      title: doc.title || 'Unknown incident',
      description: (doc.description || '').slice(0, 5000),
      severity,
      severity_label: SEVERITY_LABELS[severity] || 'MEDIUM',
      status: doc.status || 'open',
      source: doc.source || 'manual',
      labels: doc.labels || [],
      created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      resolved_at: doc.resolved_at ? new Date(doc.resolved_at).toISOString() : null,
      timeline,
      responders,
      metrics: {
        mtta_seconds: doc.metrics?.mtta_seconds ?? null,
        mttr_seconds: doc.metrics?.mttr_seconds ?? null,
      },
    },
    affected_services: affectedServices,
    recent_changes: recentChanges,
    related_runbooks: relatedRunbooks,
  };
}

async function buildFromTicket(tenantId: Types.ObjectId, doc: any): Promise<IncidentContext> {
  const severity = doc.priority || 3;

  return {
    incident: {
      id: doc._id.toString(),
      title: doc.title || 'Unknown incident',
      description: (doc.description || '').slice(0, 5000),
      severity,
      severity_label: SEVERITY_LABELS[severity] || 'MEDIUM',
      status: doc.status || 'open',
      source: 'manual',
      labels: doc.labels || [],
      created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      resolved_at: doc.resolvedAt ? new Date(doc.resolvedAt).toISOString() : null,
      timeline: [],
      responders: [],
      metrics: { mtta_seconds: null, mttr_seconds: null },
    },
    affected_services: [],
    recent_changes: [],
    related_runbooks: [],
  };
}

async function fetchRecentChanges(
  tenantId: Types.ObjectId,
  serviceIds: Types.ObjectId[]
): Promise<IncidentContext['recent_changes']> {
  try {
    const filter: Record<string, unknown> = {
      tenant_id: tenantId,
      created_at: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    };
    if (serviceIds.length > 0) {
      filter.affected_service_ids = { $in: serviceIds };
    }

    const changes = await ChangeRequest.find(filter)
      .sort({ created_at: -1 })
      .limit(10)
      .lean();

    return changes.map((c: any) => ({
      title: c.title || '',
      type: c.type || 'standard',
      status: c.status || 'draft',
      risk_score: c.risk_score || 'medium',
      scheduled_start: c.implementation_window?.start
        ? new Date(c.implementation_window.start).toISOString()
        : null,
      description: (c.description || '').slice(0, 500),
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch recent changes for AI context', { error: err.message });
    return [];
  }
}

async function fetchRelatedRunbooks(
  tenantId: Types.ObjectId,
  serviceIds: Types.ObjectId[]
): Promise<IncidentContext['related_runbooks']> {
  try {
    const filter: Record<string, unknown> = {
      tenant_id: tenantId,
      status: 'published',
    };
    if (serviceIds.length > 0) {
      filter.service_ids = { $in: serviceIds };
    }

    const runbooks = await Runbook.find(filter)
      .sort({ 'stats.last_executed_at': -1 })
      .limit(5)
      .lean();

    return runbooks.map((r: any) => ({
      title: r.title || '',
      description: (r.description || '').slice(0, 300),
      category: r.category || 'general',
      step_count: r.steps?.length || 0,
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch runbooks for AI context', { error: err.message });
    return [];
  }
}

/**
 * Format context into a text block for inclusion in the AI prompt.
 */
export function formatContextForPrompt(ctx: IncidentContext): string {
  const parts: string[] = [];

  // Incident details
  parts.push(`=== INCIDENT ===`);
  parts.push(`Title: ${ctx.incident.title}`);
  parts.push(`Severity: ${ctx.incident.severity_label} (${ctx.incident.severity})`);
  parts.push(`Status: ${ctx.incident.status}`);
  parts.push(`Source: ${ctx.incident.source}`);
  parts.push(`Created: ${ctx.incident.created_at}`);
  if (ctx.incident.resolved_at) {
    parts.push(`Resolved: ${ctx.incident.resolved_at}`);
  }
  if (ctx.incident.labels.length > 0) {
    parts.push(`Labels: ${ctx.incident.labels.join(', ')}`);
  }
  if (ctx.incident.description) {
    parts.push(`\nDescription:\n${ctx.incident.description}`);
  }

  // Metrics
  if (ctx.incident.metrics.mtta_seconds || ctx.incident.metrics.mttr_seconds) {
    parts.push(`\n=== METRICS ===`);
    if (ctx.incident.metrics.mtta_seconds) {
      parts.push(`Time to Acknowledge: ${ctx.incident.metrics.mtta_seconds}s`);
    }
    if (ctx.incident.metrics.mttr_seconds) {
      parts.push(`Time to Resolve: ${ctx.incident.metrics.mttr_seconds}s`);
    }
  }

  // Timeline
  if (ctx.incident.timeline.length > 0) {
    parts.push(`\n=== TIMELINE (last ${ctx.incident.timeline.length} entries) ===`);
    for (const entry of ctx.incident.timeline) {
      parts.push(`[${entry.timestamp}] ${entry.type}: ${entry.message}`);
    }
  }

  // Responders
  if (ctx.incident.responders.length > 0) {
    parts.push(`\n=== RESPONDERS ===`);
    for (const r of ctx.incident.responders) {
      parts.push(`- ${r.role} (joined: ${r.joined_at})`);
    }
  }

  // Affected services
  if (ctx.affected_services.length > 0) {
    parts.push(`\n=== AFFECTED SERVICES ===`);
    for (const svc of ctx.affected_services) {
      parts.push(`- ${svc.name} (${svc.type}, ${svc.environment}) — status: ${svc.current_status}`);
      if (svc.description) {
        parts.push(`  ${svc.description.slice(0, 200)}`);
      }
    }
  }

  // Recent changes
  if (ctx.recent_changes.length > 0) {
    parts.push(`\n=== RECENT CHANGES (last 7 days) ===`);
    for (const ch of ctx.recent_changes) {
      parts.push(`- [${ch.status}] ${ch.title} (${ch.type}, risk: ${ch.risk_score})`);
      if (ch.scheduled_start) {
        parts.push(`  Scheduled: ${ch.scheduled_start}`);
      }
    }
  }

  // Related runbooks
  if (ctx.related_runbooks.length > 0) {
    parts.push(`\n=== AVAILABLE RUNBOOKS ===`);
    for (const rb of ctx.related_runbooks) {
      parts.push(`- ${rb.title} (${rb.category}, ${rb.step_count} steps)`);
      if (rb.description) {
        parts.push(`  ${rb.description}`);
      }
    }
  }

  return parts.join('\n');
}
