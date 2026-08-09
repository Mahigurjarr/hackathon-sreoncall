import { IncidentCorrelation, IncidentCorrelationDocument, CorrelationEvidence } from '../models/incident-correlation.model';
import { Incident } from '../models/incident.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { StringCodec } from 'nats';
import { getJetStream } from '../config/nats';

function extractCorrelationGroup(labels: unknown): string | null {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    if (typeof l === 'string' && l.startsWith('correlation_group:')) {
      return l.slice('correlation_group:'.length);
    }
  }
  return null;
}

export interface ListCorrelationsFilter {
  status?: string;
  incident_id?: string;
  correlation_type?: string;
  limit?: number;
  cursor?: string;
}

export async function list(tenantId: string, filter: ListCorrelationsFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };

  if (filter.status) query.status = filter.status;
  if (filter.correlation_type) query.correlation_type = filter.correlation_type;
  if (filter.incident_id) {
    query.$or = [
      { parent_incident_id: filter.incident_id },
      { correlated_incident_ids: filter.incident_id },
    ];
  }
  if (filter.cursor) query._id = { $gt: filter.cursor };

  const docs = await IncidentCorrelation.find(query)
    .populate('parent_incident_id', 'number title severity status')
    .populate('correlated_incident_ids', 'number title severity status')
    .populate('confirmed_by', 'name email')
    .populate('rejected_by', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await IncidentCorrelation.countDocuments({ tenant_id: tenantId }),
    },
  };
}

export async function getById(tenantId: string, id: string) {
  const doc = await IncidentCorrelation.findOne({ _id: id, tenant_id: tenantId })
    .populate('parent_incident_id', 'number title severity status')
    .populate('correlated_incident_ids', 'number title severity status')
    .populate('confirmed_by', 'name email')
    .populate('rejected_by', 'name email')
    .lean();
  if (!doc) throw AppError.notFound('Incident correlation not found');
  return doc;
}

export async function confirm(tenantId: string, id: string, parentIncidentId: string, userId: string) {
  const correlation = await IncidentCorrelation.findOne({ _id: id, tenant_id: tenantId });
  if (!correlation) throw AppError.notFound('Incident correlation not found');
  if (correlation.status !== 'proposed') {
    throw AppError.badRequest(`Correlation is already ${correlation.status}`);
  }

  // Verify parent incident exists in this tenant
  const parentIncident = await Incident.findOne({ _id: parentIncidentId, tenant_id: tenantId }).lean();
  if (!parentIncident) throw AppError.notFound('Parent incident not found');

  correlation.status = 'confirmed';
  correlation.parent_incident_id = parentIncident._id;
  correlation.confirmed_by = userId as any;
  correlation.confirmed_at = new Date();
  await correlation.save();

  return getById(tenantId, id);
}

export async function reject(tenantId: string, id: string, reason: string, userId: string) {
  const correlation = await IncidentCorrelation.findOne({ _id: id, tenant_id: tenantId });
  if (!correlation) throw AppError.notFound('Incident correlation not found');
  if (correlation.status !== 'proposed') {
    throw AppError.badRequest(`Correlation is already ${correlation.status}`);
  }

  correlation.status = 'rejected';
  correlation.rejected_by = userId as any;
  correlation.rejected_reason = reason;
  await correlation.save();

  return getById(tenantId, id);
}

export async function merge(tenantId: string, id: string) {
  const correlation = await IncidentCorrelation.findOne({ _id: id, tenant_id: tenantId })
    .populate('correlated_incident_ids')
    .lean();
  if (!correlation) throw AppError.notFound('Incident correlation not found');
  if (correlation.status !== 'confirmed') {
    throw AppError.badRequest('Correlation must be confirmed before merging');
  }
  if (!correlation.parent_incident_id) {
    throw AppError.badRequest('Correlation has no parent incident set');
  }

  const parentId = correlation.parent_incident_id.toString();
  const childIds = correlation.correlated_incident_ids
    .map((inc: any) => inc._id?.toString() ?? inc.toString())
    .filter((cid: string) => cid !== parentId);

  // Merge each child incident into the parent
  for (const childId of childIds) {
    const child = await Incident.findOne({ _id: childId, tenant_id: tenantId });
    if (!child) continue;

    // Link child to parent and close it
    await Incident.findOneAndUpdate(
      { _id: childId, tenant_id: tenantId },
      {
        $set: {
          status: 'closed',
          closed_at: new Date(),
        },
        $addToSet: {
          labels: `merged_into:${parentId}`,
        },
      },
    );

    // Add child's affected services to parent
    const childServiceIds = (child as any).affected_service_ids ?? [];
    if (childServiceIds.length > 0) {
      await Incident.findOneAndUpdate(
        { _id: parentId, tenant_id: tenantId },
        { $addToSet: { affected_service_ids: { $each: childServiceIds } } },
      );
    }

    // Add merge entry to parent timeline
    await Incident.findOneAndUpdate(
      { _id: parentId, tenant_id: tenantId },
      {
        $push: {
          timeline: {
            type: 'note',
            timestamp: new Date(),
            message: `Merged incident INC-${(child as any).number} into this incident (correlation: ${id})`,
            metadata: { merged_incident_id: childId, correlation_id: id },
          },
        },
      },
    );
  }

  return { parent_incident_id: parentId, merged_incident_ids: childIds, merged_count: childIds.length };
}

export async function evaluateNewIncident(tenantId: string, incidentId: string) {
  // Publish to NATS for async full correlation processing
  try {
    const sc = StringCodec();
    const js = getJetStream();
    await js.publish(
      'icc.correlation.evaluate',
      sc.encode(JSON.stringify({
        tenant_id: tenantId,
        incident_id: incidentId,
      }))
    );
  } catch (err: any) {
    logger.warn('Failed to publish correlation evaluation to NATS', { error: err.message });
  }

  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId }).lean();
  if (!incident) throw AppError.notFound('Incident not found');

  // Find open incidents within the configurable time window (default: 10 minutes)
  const windowMinutes = 10;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const openIncidents = await Incident.find({
    tenant_id: tenantId,
    _id: { $ne: incidentId },
    status: { $in: ['triggered', 'acknowledged'] },
    createdAt: { $gte: windowStart },
  }).lean();

  const correlations: any[] = [];

  for (const other of openIncidents) {
    // Basic temporal proximity check — full weighted scoring TODO
    const evidence: CorrelationEvidence[] = [
      {
        type: 'temporal_proximity',
        description: `Both incidents occurred within ${windowMinutes} minutes`,
        weight: 0.15,
      },
    ];

    // Check shared affected services
    const incidentServices = ((incident as any).affected_service_ids ?? []).map((s: any) => s.toString());
    const otherServices = ((other as any).affected_service_ids ?? []).map((s: any) => s.toString());
    const sharedServices = incidentServices.filter((s: string) => otherServices.includes(s));

    if (sharedServices.length > 0) {
      evidence.push({
        type: 'dependency_graph',
        description: `${sharedServices.length} shared affected service(s)`,
        weight: 0.35,
      });
    }

    // Shared correlation_group label — alerts intentionally tagged as related
    // signals of the same root cause (e.g. heroku_dyno_memory groups H18+R14+R15).
    const incidentGroup = extractCorrelationGroup((incident as any).labels);
    const otherGroup = extractCorrelationGroup((other as any).labels);
    if (incidentGroup && incidentGroup === otherGroup) {
      evidence.push({
        type: 'shared_correlation_group',
        description: `Both incidents tagged correlation_group=${incidentGroup}`,
        weight: 0.50,
      });
    }

    const totalWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
    const confidencePercent = Math.round(totalWeight * 100);

    if (confidencePercent >= 60) {
      const correlation = await IncidentCorrelation.create({
        tenant_id: tenantId,
        parent_incident_id: null,
        correlated_incident_ids: [incidentId, other._id],
        status: 'proposed',
        correlation_type: incidentGroup && incidentGroup === otherGroup
          ? 'shared_root_cause'
          : sharedServices.length > 0 ? 'dependency_chain' : 'temporal',
        confidence_percent: confidencePercent,
        evidence,
      });
      correlations.push(correlation.toObject());
    }
  }

  return { evaluated_against: openIncidents.length, correlations_created: correlations.length, correlations };
}
