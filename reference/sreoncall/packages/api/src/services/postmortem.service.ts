import { Types } from 'mongoose';
import { Postmortem, PostmortemDocument } from '../models/postmortem.model';
import { AppError } from '../middleware/errorHandler.middleware';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { Project } from '../models/project.model';
import { Incident } from '../models/incident.model';
import { TicketDocument } from '../models/ticket.model';
import * as ticketService from './ticket.service';
import { logger } from '../utils/logger';

interface PostmortemFilter {
  tenant_id: Types.ObjectId;
  status?: string;
  severity?: string;
}

export async function listPostmortems(
  filter: PostmortemFilter,
  pagination: PaginationParams
): Promise<PaginatedResult<PostmortemDocument>> {
  const baseFilter: Record<string, any> = { tenant_id: filter.tenant_id };
  if (filter.status) baseFilter.status = filter.status;
  if (filter.severity) baseFilter.severity = filter.severity;

  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'created_at' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await Postmortem.find(cursorFilter)
    .populate('author_id', 'name email')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await Postmortem.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function getPostmortemById(
  tenantId: Types.ObjectId,
  id: string
): Promise<PostmortemDocument> {
  const pm = await Postmortem.findOne({ _id: id, tenant_id: tenantId })
    .populate('author_id', 'name email')
    .populate('action_items.owner_id', 'name email');
  if (!pm) throw AppError.notFound('Post-mortem');
  return pm;
}

export async function createPostmortem(input: {
  tenant_id: Types.ObjectId;
  author_id: Types.ObjectId;
  title: string;
  severity?: string;
  summary?: string;
  incident_id?: string;
}): Promise<PostmortemDocument> {
  return Postmortem.create({
    tenant_id: input.tenant_id,
    title: input.title,
    severity: input.severity || 'medium',
    status: 'draft',
    summary: input.summary || '',
    author_id: input.author_id,
    incident_id: input.incident_id ? new Types.ObjectId(input.incident_id) : undefined,
    timeline: [],
    root_cause: '',
    contributing_factors: [],
    action_items: [],
    reviewed_by: [],
  });
}

export async function updatePostmortem(
  tenantId: Types.ObjectId,
  id: string,
  update: Record<string, any>
): Promise<PostmortemDocument> {
  const pm = await Postmortem.findOne({ _id: id, tenant_id: tenantId });
  if (!pm) throw AppError.notFound('Post-mortem');
  Object.assign(pm, update);
  await pm.save();
  return pm;
}

export async function publishPostmortem(
  tenantId: Types.ObjectId,
  id: string
): Promise<PostmortemDocument> {
  const pm = await Postmortem.findOne({ _id: id, tenant_id: tenantId });
  if (!pm) throw AppError.notFound('Post-mortem');
  pm.status = 'published';
  pm.published_at = new Date();
  await pm.save();
  return pm;
}

export async function deletePostmortem(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await Postmortem.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0)
    throw AppError.notFound('Post-mortem');
}

// ─── Action Item → Ticket helpers ──────────────────────────────────────────────

const SEVERITY_TO_PRIORITY: Record<string, 'high' | 'medium' | 'low'> = {
  critical: 'high',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

async function getDefaultProjectId(tenantId: Types.ObjectId): Promise<string> {
  const project = await Project.findOne({ tenant_id: tenantId, name: 'Default', deleted_at: null });
  if (!project) throw AppError.badRequest('Tenant has no Default project. Create a project first.');
  return project._id.toString();
}

async function getIncidentNumber(incidentId: Types.ObjectId | undefined): Promise<number | null> {
  if (!incidentId) return null;
  const incident = await Incident.findById(incidentId).select('number');
  return incident?.number ?? null;
}

export async function createTicketFromActionItem(
  tenantId: Types.ObjectId,
  postmortemId: string,
  itemIndex: number,
  reporterId: Types.ObjectId
): Promise<TicketDocument> {
  const pm = await Postmortem.findOne({ _id: postmortemId, tenant_id: tenantId });
  if (!pm) throw AppError.notFound('Post-mortem');

  const actionItem = pm.action_items[itemIndex];
  if (!actionItem) throw AppError.notFound('Action item at the specified index');

  if (actionItem.ticket_id) {
    throw AppError.badRequest('A ticket has already been created for this action item.');
  }

  const projectId = await getDefaultProjectId(tenantId);
  const incidentNumber = await getIncidentNumber(pm.incident_id);
  const incidentRef = incidentNumber ? `incident #${incidentNumber}` : 'incident';

  const ticket = await ticketService.createTicket({
    tenant_id: tenantId,
    project_id: projectId,
    type: 'task',
    title: actionItem.description,
    description: `Action item from postmortem for ${incidentRef}: ${actionItem.description}`,
    priority: SEVERITY_TO_PRIORITY[pm.severity] || 'medium',
    assignee_id: actionItem.owner_id?.toString(),
    reporter_id: reporterId,
    labels: ['postmortem-action-item'],
  });

  // Update the action item with the created ticket reference
  pm.action_items[itemIndex].ticket_id = ticket._id;
  await pm.save();

  logger.info('Created ticket from postmortem action item', {
    postmortemId,
    itemIndex,
    ticketId: ticket._id.toString(),
  });

  return ticket;
}

export async function createTicketsFromAllActionItems(
  tenantId: Types.ObjectId,
  postmortemId: string,
  reporterId: Types.ObjectId
): Promise<TicketDocument[]> {
  const pm = await Postmortem.findOne({ _id: postmortemId, tenant_id: tenantId });
  if (!pm) throw AppError.notFound('Post-mortem');

  const projectId = await getDefaultProjectId(tenantId);
  const incidentNumber = await getIncidentNumber(pm.incident_id);
  const incidentRef = incidentNumber ? `incident #${incidentNumber}` : 'incident';

  const createdTickets: TicketDocument[] = [];

  for (let i = 0; i < pm.action_items.length; i++) {
    const actionItem = pm.action_items[i];

    // Skip items that already have tickets
    if (actionItem.ticket_id) continue;

    try {
      const ticket = await ticketService.createTicket({
        tenant_id: tenantId,
        project_id: projectId,
        type: 'task',
        title: actionItem.description,
        description: `Action item from postmortem for ${incidentRef}: ${actionItem.description}`,
        priority: SEVERITY_TO_PRIORITY[pm.severity] || 'medium',
        assignee_id: actionItem.owner_id?.toString(),
        reporter_id: reporterId,
        labels: ['postmortem-action-item'],
      });

      pm.action_items[i].ticket_id = ticket._id;
      createdTickets.push(ticket);
    } catch (err: any) {
      logger.warn('Failed to create ticket for action item', {
        postmortemId,
        itemIndex: i,
        error: err.message,
      });
    }
  }

  // Save all ticket_id references in a single write
  if (createdTickets.length > 0) {
    await pm.save();
  }

  logger.info('Bulk created tickets from postmortem action items', {
    postmortemId,
    created: createdTickets.length,
    skipped: pm.action_items.length - createdTickets.length,
  });

  return createdTickets;
}
