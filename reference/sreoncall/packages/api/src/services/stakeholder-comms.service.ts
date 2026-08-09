import { StakeholderUpdate, StakeholderUpdateDocument } from '../models/stakeholder-update.model';
import { Incident } from '../models/incident.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import * as aiService from './ai.service';
import { StringCodec } from 'nats';
import { getJetStream } from '../config/nats';

export type Audience = 'internal_engineering' | 'internal_leadership' | 'external_customer' | 'status_page';

export interface ListStakeholderUpdatesFilter {
  audience?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateStakeholderUpdateInput {
  audience: Audience;
  content?: string;
}

export interface UpdateStakeholderUpdateInput {
  content_final?: string;
}

export async function list(tenantId: string, incidentId: string, filter: ListStakeholderUpdatesFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId, incident_id: incidentId };

  if (filter.audience) query.audience = filter.audience;
  if (filter.status) query.status = filter.status;
  if (filter.cursor) query._id = { $gt: filter.cursor };

  const docs = await StakeholderUpdate.find(query)
    .populate('created_by', 'name email avatar_url')
    .populate('sent_by', 'name email avatar_url')
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
      total: await StakeholderUpdate.countDocuments({ tenant_id: tenantId, incident_id: incidentId }),
    },
  };
}

export async function create(tenantId: string, incidentId: string, userId: string, input: CreateStakeholderUpdateInput) {
  // Verify incident exists
  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId })
    .populate('affected_service_ids', 'name type')
    .lean();
  if (!incident) throw AppError.notFound('Incident not found');

  let draft: string;
  let generatedBy: 'ai' | 'manual';

  if (input.content) {
    // Manual content provided
    draft = input.content;
    generatedBy = 'manual';
  } else {
    // Generate audience-aware draft via AI
    const audiencePrompts: Record<string, string> = {
      internal_engineering: `You are writing an incident update for the engineering team. Include:
- Current incident status and affected services
- Technical details: error rates, latency, relevant metrics
- Commands run and their results
- Next steps and who is working on what
Use precise technical language. Include metrics and timestamps.`,
      internal_leadership: `You are writing an incident update for leadership/management. Include:
- Business impact: affected users, revenue exposure, SLA risk
- Current status and ETA for resolution
- Team members engaged
- Risk level assessment
Keep it concise. Focus on business impact, not technical details.`,
      external_customer: `You are writing an incident update for external customers. Include:
- Acknowledgment of the issue
- What is affected in user-facing terms
- Current status
- Expected resolution time
Use plain English. Do NOT include internal details, server names, or technical jargon.`,
      status_page: `You are writing a status page update. Be concise (2-3 sentences max).
Format: Current status summary. What we're doing about it. Expected resolution time.
Do NOT include internal details.`,
    };

    const systemPrompt = audiencePrompts[input.audience] || audiencePrompts.internal_engineering;
    const title = incident.title || 'Untitled Incident';
    const severity = incident.severity ?? 3;
    const status = incident.status || 'triggered';
    const services = (incident.affected_service_ids ?? [])
      .filter((s: any) => s && typeof s === 'object' && s.name)
      .map((s: any) => s.name)
      .join(', ') || 'Unknown';

    const incidentContext = [
      `Incident: ${title}`,
      `Severity: SEV${severity}`,
      `Status: ${status}`,
      `Affected Services: ${services}`,
      `Description: ${(incident as any).description || 'No description'}`,
      `Duration: ${Math.round((Date.now() - new Date((incident as any).createdAt).getTime()) / 60000)} minutes`,
    ].join('\n');

    try {
      const result = await aiService.generateCompletion({
        tenantId,
        system: systemPrompt,
        userMessage: incidentContext,
      });
      draft = result.text;
      generatedBy = result.model === 'fallback' ? 'manual' : 'ai';
    } catch (err: any) {
      logger.warn('AI draft generation failed, using template fallback', { error: err.message });
      draft = generatePlaceholderDraft(incident, input.audience);
      generatedBy = 'manual';
    }
  }

  const doc = await StakeholderUpdate.create({
    tenant_id: tenantId,
    incident_id: incidentId,
    audience: input.audience,
    content: {
      draft,
      final: null,
      generated_by: generatedBy,
    },
    delivery: { channels: [] },
    status: 'draft',
    created_by: userId,
    sent_by: null,
  });

  return doc.toObject();
}

export async function update(tenantId: string, incidentId: string, updateId: string, input: UpdateStakeholderUpdateInput) {
  const doc = await StakeholderUpdate.findOne({
    _id: updateId,
    tenant_id: tenantId,
    incident_id: incidentId,
  });
  if (!doc) throw AppError.notFound('Stakeholder update not found');

  if (doc.status === 'sent') {
    throw AppError.badRequest('Cannot edit a sent update');
  }

  if (input.content_final !== undefined) {
    doc.content.final = input.content_final;
  }

  await doc.save();
  return doc.toObject();
}

export async function send(tenantId: string, incidentId: string, updateId: string, userId: string) {
  const doc = await StakeholderUpdate.findOne({
    _id: updateId,
    tenant_id: tenantId,
    incident_id: incidentId,
  });
  if (!doc) throw AppError.notFound('Stakeholder update not found');

  if (doc.status === 'sent') {
    throw AppError.badRequest('Update has already been sent');
  }

  const contentToSend = doc.content.final || doc.content.draft;

  // Dispatch delivery to configured channels via NATS
  try {
    const sc = StringCodec();
    const js = getJetStream();
    await js.publish(
      'icc.stakeholder.send',
      sc.encode(JSON.stringify({
        tenant_id: tenantId,
        incident_id: incidentId,
        update_id: updateId,
        channels: doc.delivery.channels,
        sent_by: userId,
      }))
    );
  } catch (err: any) {
    logger.warn('Failed to publish stakeholder send to NATS', { error: err.message });
  }

  doc.status = 'sent';
  doc.sent_by = userId as any;

  // Mark all delivery channels as sent
  for (const channel of doc.delivery.channels) {
    channel.delivery_status = 'sent';
    channel.sent_at = new Date();
  }

  await doc.save();

  // Add timeline entry to the incident
  await Incident.findOneAndUpdate(
    { _id: incidentId, tenant_id: tenantId },
    {
      $push: {
        timeline: {
          type: 'comms_sent',
          timestamp: new Date(),
          actor_id: userId,
          message: `Stakeholder update sent to ${doc.audience}`,
          metadata: {
            stakeholder_update_id: updateId,
            audience: doc.audience,
            content_preview: contentToSend.substring(0, 200),
          },
        },
      },
    },
  );

  return doc.toObject();
}

function generatePlaceholderDraft(incident: any, audience: Audience): string {
  const title = incident.title || 'Untitled Incident';
  const severity = incident.severity ?? 3;
  const status = incident.status || 'triggered';
  const services = (incident.affected_service_ids ?? [])
    .filter((s: any) => s && typeof s === 'object' && s.name)
    .map((s: any) => s.name)
    .join(', ') || 'Unknown';

  switch (audience) {
    case 'internal_engineering':
      return `## Incident Update: ${title}\n\n**Severity:** SEV${severity} | **Status:** ${status}\n**Affected Services:** ${services}\n\n### Current Status\nThe incident is being actively investigated.\n\n### Next Steps\n- Continue investigation\n- Monitor affected services\n\n*This is an auto-generated draft. Please review and edit before sending.*`;

    case 'internal_leadership':
      return `## Executive Incident Brief: ${title}\n\n**Severity:** SEV${severity} | **Status:** ${status}\n**Affected Services:** ${services}\n\n### Business Impact\nAssessing impact to users and revenue.\n\n### ETA\nTeam is investigating. Update in 20 minutes.\n\n*This is an auto-generated draft. Please review and edit before sending.*`;

    case 'external_customer':
      return `## Service Update\n\nWe are aware of an issue affecting some of our services. Our team is actively investigating and working to resolve the situation.\n\nWe will provide another update shortly.\n\n*This is an auto-generated draft. Please review and edit before sending.*`;

    case 'status_page':
      return `**Investigating** - We are currently investigating an issue with ${services}. We will provide updates as more information becomes available.`;

    default:
      return `Incident update for ${title}.`;
  }
}
