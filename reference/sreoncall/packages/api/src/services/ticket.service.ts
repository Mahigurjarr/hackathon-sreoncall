import { Types } from 'mongoose';
import { Ticket, TicketDocument } from '../models/ticket.model';
import { TicketWorkflow } from '../models/ticket-workflow.model';
import { getNextSequence } from '../models/counter.model';
import { getMeiliClient } from '../config/meilisearch';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { logger } from '../utils/logger';
import { parseTimeEstimate } from '../utils/time-parser';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';
import { SlaConfig } from '../models/sla-config.model';
import { computeBusinessHoursDeadline } from './sla-calculator.service';
import { TicketBridge } from '../models/ticket-bridge.model';
import { syncTicketToConsumer, syncTicketToProvider } from './ticket-bridge.service';
import { createNotification } from './notification.service';
import { User } from '../models/user.model';
import { Project } from '../models/project.model';
import { Team } from '../models/team.model';
import { BoardMember } from '../models/board-member.model';

const sc = StringCodec();

/**
 * Validate that a supplied team_id is a well-formed ObjectId belonging to the
 * given tenant. Throws AppError.badRequest (400) rather than letting a malformed
 * id surface as a 500 BSONError, and prevents dangling/cross-tenant team refs.
 */
async function assertTeamInTenant(tenantId: Types.ObjectId, teamId: string): Promise<void> {
  if (!Types.ObjectId.isValid(teamId)) {
    throw AppError.badRequest('Invalid team_id.');
  }
  const team = await Team.findOne({ _id: teamId, tenant_id: tenantId }).select('_id');
  if (!team) {
    throw AppError.badRequest('Team not found in this tenant.');
  }
}

export interface CreateTicketInput {
  tenant_id: Types.ObjectId;
  project_id: string;
  type: string;
  title: string;
  description?: string;
  priority?: string;
  assignee_id?: string;
  team_id?: string;
  reporter_id: Types.ObjectId;
  labels?: string[];
  custom_fields?: Record<string, any>;
  parent_id?: string;
  time_estimate?: string;
  time_estimate_minutes?: number | null;
  milestone_id?: string;
}

interface UpdateTicketInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee_id?: string | null;
  reporter_id?: string;
  team_id?: string | null;
  labels?: string[];
  custom_fields?: Record<string, any>;
  watcher_ids?: string[];
  time_estimate?: string;
  time_estimate_minutes?: number | null;
  milestone_id?: string | null;
  sprint_id?: string | null;
  is_backlog?: boolean;
  created_at?: string;
}

interface AddWorkLogInput {
  minutes: number;
  description?: string;
  logged_at?: string;
}

interface TicketChangeSummary {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
}

interface TicketFilter {
  tenant_id: Types.ObjectId;
  user_id?: Types.ObjectId;
  project_id?: string;
  status?: string;
  priority?: string;
  assignee_id?: string;
  reporter_id?: string;
  team_id?: string;
  type?: string;
  labels?: string[];
  parent_id?: string;
  milestone_id?: string;
  sprint_id?: string;
  is_backlog?: boolean;
  consumer_name?: string;
}

async function getInitialStatus(tenantId: Types.ObjectId, ticketType: string): Promise<string> {
  const workflow = await TicketWorkflow.findOne({ tenant_id: tenantId, ticket_type: ticketType });
  if (workflow) {
    const initial = workflow.states.find((s) => s.is_initial);
    if (initial) return initial.name;
  }
  return 'open';
}

async function validateTransition(
  tenantId: Types.ObjectId,
  ticketType: string,
  fromStatus: string,
  toStatus: string,
  userRoles: string[]
): Promise<boolean> {
  const workflow = await TicketWorkflow.findOne({ tenant_id: tenantId, ticket_type: ticketType });
  if (!workflow) {
    // No workflow defined; allow any transition
    return true;
  }

  const transition = workflow.transitions.find((t) => t.from === fromStatus && t.to === toStatus);
  if (!transition) {
    throw AppError.badRequest(`Transition from "${fromStatus}" to "${toStatus}" is not allowed.`);
  }

  if (transition.allowed_roles.length > 0) {
    const hasRole = userRoles.some((r) => transition.allowed_roles.includes(r) || r === 'platform_admin' || r === 'tenant_admin');
    if (!hasRole) {
      throw AppError.forbidden(`Your role does not allow this status transition.`);
    }
  }

  return true;
}

async function indexTicketInMeili(ticket: TicketDocument): Promise<void> {
  try {
    const client = getMeiliClient();
    const index = client.index('tickets');
    await index.addDocuments([
      {
        id: ticket._id.toString(),
        tenant_id: ticket.tenant_id.toString(),
        number: ticket.number,
        type: ticket.type,
        title: ticket.title,
        description: ticket.description || '',
        status: ticket.status,
        priority: ticket.priority,
        assignee_id: ticket.assignee_id?.toString() || null,
        team_id: ticket.team_id?.toString() || null,
        labels: ticket.labels,
        created_at: ticket.createdAt?.toISOString(),
        updated_at: ticket.updatedAt?.toISOString(),
      },
    ]);
  } catch (err: any) {
    logger.error('Failed to index ticket in Meilisearch', { ticketId: ticket._id, error: err.message });
  }
}

async function publishTicketEvent(eventType: string, ticket: TicketDocument, extra?: Record<string, any>): Promise<void> {
  try {
    const js = getJetStream();
    const payload = {
      event: eventType,
      tenant_id: ticket.tenant_id.toString(),
      ticket_id: ticket._id.toString(),
      ticket_number: ticket.number,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    await js.publish(`tickets.${eventType}`, sc.encode(JSON.stringify(payload)));
    await js.publish(
      `notifications.ticket.${eventType}`,
      sc.encode(JSON.stringify({ ...payload, event: `tickets.${eventType}` }))
    );
  } catch (err: any) {
    logger.error('Failed to publish ticket event to NATS', { eventType, error: err.message });
  }
}

function stringifyTicketValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : 'Not set';
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'Not set';
  }
  return String(value);
}

async function buildTicketChangeSummary(ticket: TicketDocument, input: UpdateTicketInput): Promise<TicketChangeSummary[]> {
  const changes: TicketChangeSummary[] = [];

  const pushChange = (field: string, label: string, oldValue: unknown, newValue: unknown) => {
    const oldText = stringifyTicketValue(oldValue);
    const newText = stringifyTicketValue(newValue);
    if (oldText === newText) return;
    changes.push({ field, label, oldValue: oldText, newValue: newText });
  };

  if (input.title !== undefined) {
    pushChange('title', 'Title', ticket.title, input.title);
  }

  if (input.description !== undefined) {
    pushChange('description', 'Description', ticket.description, input.description);
  }

  if (input.status !== undefined) {
    pushChange('status', 'Status', ticket.status?.replace(/_/g, ' '), input.status?.replace(/_/g, ' '));
  }

  if (input.priority !== undefined) {
    pushChange('priority', 'Priority', ticket.priority, input.priority);
  }

  if (input.labels !== undefined) {
    pushChange('labels', 'Labels', ticket.labels || [], input.labels);
  }

  if (input.assignee_id !== undefined) {
    const ids = [ticket.assignee_id?.toString(), input.assignee_id || undefined].filter(Boolean) as string[];
    let names = new Map<string, string>();
    if (ids.length > 0) {
      const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
      names = new Map(
        users.map((user: any) => [
          user._id.toString(),
          user.name?.trim() || user.email?.trim() || user._id.toString(),
        ])
      );
    }
    pushChange(
      'assignee',
      'Assignee',
      ticket.assignee_id ? names.get(ticket.assignee_id.toString()) || ticket.assignee_id.toString() : null,
      input.assignee_id ? names.get(input.assignee_id) || input.assignee_id : null,
    );
  }

  if (input.reporter_id !== undefined) {
    const ids = [ticket.reporter_id?.toString(), input.reporter_id].filter(Boolean) as string[];
    let names = new Map<string, string>();
    if (ids.length > 0) {
      const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
      names = new Map(
        users.map((user: any) => [
          user._id.toString(),
          user.name?.trim() || user.email?.trim() || user._id.toString(),
        ])
      );
    }
    pushChange(
      'reporter',
      'Reporter',
      ticket.reporter_id ? names.get(ticket.reporter_id.toString()) || ticket.reporter_id.toString() : null,
      names.get(input.reporter_id) || input.reporter_id,
    );
  }

  return changes;
}

// Returns project_id filter that excludes private projects the user is not a member of.
async function buildVisibilityFilter(tenantId: Types.ObjectId, userId: Types.ObjectId): Promise<Record<string, any> | null> {
  const privateProjects = await Project.find({ tenant_id: tenantId, visibility: 'private', deleted_at: null }).select('_id').lean();
  if (privateProjects.length === 0) return null;

  const privateIds = privateProjects.map((p) => p._id);
  const memberBoardIds = await BoardMember.find({ user_id: userId, tenant_id: tenantId, board_id: { $in: privateIds } }).distinct('board_id');
  const memberSet = new Set(memberBoardIds.map((id) => id.toString()));

  const excludedIds = privateIds.filter((id) => !memberSet.has(id.toString()));
  if (excludedIds.length === 0) return null;

  return { project_id: { $nin: excludedIds } };
}

export async function createTicket(input: CreateTicketInput): Promise<TicketDocument> {
  // Hierarchy validation
  if (input.parent_id) {
    await validateHierarchy(input.tenant_id, input.type, input.parent_id);
  }
  if (input.type === 'epic' && input.parent_id) {
    throw AppError.badRequest('Epics cannot have a parent ticket.');
  }

  const number = await getNextSequence(input.tenant_id, 'ticket');
  const status = await getInitialStatus(input.tenant_id, input.type);

  // Parse time estimate from raw string
  let timeEstimateRaw: string | undefined;
  let timeEstimateMinutes: number | null = input.time_estimate_minutes ?? null;
  if (input.time_estimate) {
    timeEstimateRaw = input.time_estimate;
    timeEstimateMinutes = parseTimeEstimate(input.time_estimate);
  }

  const ticketData: any = {
    tenant_id: input.tenant_id,
    project_id: input.project_id ? new Types.ObjectId(input.project_id) : undefined,
    number,
    type: input.type,
    title: input.title,
    description: input.description,
    status,
    priority: input.priority || 'medium',
    reporter_id: input.reporter_id,
    labels: input.labels || [],
    custom_fields: input.custom_fields || {},
    watcher_ids: [input.reporter_id],
    time_estimate_raw: timeEstimateRaw,
    time_estimate_minutes: timeEstimateMinutes,
    time_spent_minutes: 0,
    work_logs: [],
    linked_incident_ids: [],
    linked_change_request_ids: [],
    milestone_id: input.milestone_id ? new Types.ObjectId(input.milestone_id) : undefined,
  };

  if (input.assignee_id) {
    ticketData.assignee_id = new Types.ObjectId(input.assignee_id);
    if (!ticketData.watcher_ids.some((id: Types.ObjectId) => id.toString() === input.assignee_id)) {
      ticketData.watcher_ids.push(new Types.ObjectId(input.assignee_id));
    }
  }
  if (input.team_id) {
    await assertTeamInTenant(input.tenant_id, input.team_id);
    ticketData.team_id = new Types.ObjectId(input.team_id);
  }
  if (input.parent_id) ticketData.parent_id = new Types.ObjectId(input.parent_id);

  const ticket = await Ticket.create(ticketData);

  // Fire-and-forget: index and publish
  indexTicketInMeili(ticket).catch(() => {});
  publishTicketEvent('created', ticket).catch(() => {});

  return ticket;
}

export async function getTicketById(
  tenantId: Types.ObjectId,
  ticketId: string
): Promise<TicketDocument> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId })
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url')
    .populate('work_logs.user_id', 'name email avatar_url')
    .populate('tenant_id', 'name')
    .populate('team_id', 'name')
    .populate('project_id', 'name key color');

  if (!ticket) {
    throw AppError.notFound('Ticket');
  }

  return ticket;
}

export async function getTicketByNumber(
  tenantId: Types.ObjectId,
  number: number
): Promise<TicketDocument> {
  const ticket = await Ticket.findOne({ tenant_id: tenantId, number })
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url')
    .populate('team_id', 'name')
    .populate('project_id', 'name key color');

  if (!ticket) {
    throw AppError.notFound('Ticket');
  }

  return ticket;
}

export async function listTickets(
  filter: TicketFilter,
  pagination: PaginationParams
): Promise<PaginatedResult<TicketDocument>> {
  const baseFilter: Record<string, any> = { tenant_id: filter.tenant_id };
  if (filter.project_id) baseFilter.project_id = new Types.ObjectId(filter.project_id);
  if (filter.status) baseFilter.status = filter.status;
  if (filter.priority) baseFilter.priority = filter.priority;
  if (filter.assignee_id) baseFilter.assignee_id = new Types.ObjectId(filter.assignee_id);
  if (filter.reporter_id) baseFilter.reporter_id = new Types.ObjectId(filter.reporter_id);
  if (filter.team_id) {
    if (!Types.ObjectId.isValid(filter.team_id)) {
      throw AppError.badRequest('Invalid team_id.');
    }
    baseFilter.team_id = new Types.ObjectId(filter.team_id);
  }
  if (filter.type) baseFilter.type = filter.type;
  if (filter.labels && filter.labels.length > 0) baseFilter.labels = { $in: filter.labels };
  if (filter.parent_id) baseFilter.parent_id = new Types.ObjectId(filter.parent_id);
  if (filter.milestone_id) baseFilter.milestone_id = new Types.ObjectId(filter.milestone_id);
  if (filter.sprint_id === 'none') {
    baseFilter.sprint_id = { $in: [null, undefined] };
  } else if (filter.sprint_id) {
    baseFilter.sprint_id = new Types.ObjectId(filter.sprint_id);
  }
  if (filter.is_backlog !== undefined) baseFilter.is_backlog = filter.is_backlog;
  if (filter.consumer_name) baseFilter['custom_fields.escalated_from'] = filter.consumer_name;

  if (filter.user_id && !filter.project_id) {
    const visFilter = await buildVisibilityFilter(filter.tenant_id, filter.user_id);
    if (visFilter) Object.assign(baseFilter, visFilter);
  }

  const { filter: cursorFilter, sort } = buildCursorFilter(pagination, baseFilter);

  const results = await Ticket.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1)
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url')
    .populate('tenant_id', 'name')
    .populate('team_id', 'name')
    .populate('project_id', 'name key color');

  const total = await Ticket.countDocuments(baseFilter);

  return paginateResults(results, pagination, total);
}

export async function updateTicket(
  tenantId: Types.ObjectId,
  ticketId: string,
  input: UpdateTicketInput,
  userRoles: string[]
): Promise<TicketDocument> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId });
  if (!ticket) {
    throw AppError.notFound('Ticket');
  }

  // Validate status transition if status is changing
  if (input.status && input.status !== ticket.status) {
    await validateTransition(tenantId, ticket.type, ticket.status, input.status, userRoles);

    // Check if transitioning to a terminal state
    const workflow = await TicketWorkflow.findOne({ tenant_id: tenantId, ticket_type: ticket.type });
    if (workflow) {
      const targetState = workflow.states.find((s) => s.name === input.status);
      if (targetState?.is_terminal) {
        ticket.resolved_at = new Date();
      }
    }

  }

  const statusChanged   = !!(input.status && input.status !== ticket.status);
  const prevAssigneeId  = ticket.assignee_id?.toString() ?? null;
  const assigneeChanged = input.assignee_id !== undefined && input.assignee_id !== prevAssigneeId;
  const changes = await buildTicketChangeSummary(ticket, input);

  if (input.title !== undefined) ticket.title = input.title;
  if (input.description !== undefined) ticket.description = input.description;
  if (input.status !== undefined) ticket.status = input.status;
  if (input.priority !== undefined) ticket.priority = input.priority as 'high' | 'medium' | 'low';
  if (input.labels !== undefined) ticket.labels = input.labels;
  if (input.custom_fields !== undefined) {
    for (const [key, value] of Object.entries(input.custom_fields)) {
      ticket.custom_fields.set(key, value);
    }
  }
  if (input.assignee_id !== undefined) {
    if (input.assignee_id) {
      ticket.assignee_id = new Types.ObjectId(input.assignee_id);
    } else {
      (ticket as any).assignee_id = null;
    }
  }
  if (input.reporter_id !== undefined) {
    ticket.reporter_id = new Types.ObjectId(input.reporter_id);
  }
  if (input.team_id !== undefined) {
    if (input.team_id) {
      await assertTeamInTenant(tenantId, input.team_id);
      (ticket as any).team_id = new Types.ObjectId(input.team_id);
    } else {
      (ticket as any).team_id = null;
    }
  }
  if (input.watcher_ids !== undefined) {
    ticket.watcher_ids = input.watcher_ids.map((id) => new Types.ObjectId(id));
  }
  if (input.time_estimate !== undefined) {
    (ticket as any).time_estimate_raw = input.time_estimate;
    (ticket as any).time_estimate_minutes = parseTimeEstimate(input.time_estimate);
  } else if (input.time_estimate_minutes !== undefined) {
    (ticket as any).time_estimate_minutes = input.time_estimate_minutes;
  }
  if (input.milestone_id !== undefined) {
    (ticket as any).milestone_id = input.milestone_id ? new Types.ObjectId(input.milestone_id) : null;
  }
  if (input.sprint_id !== undefined) {
    (ticket as any).sprint_id = input.sprint_id ? new Types.ObjectId(input.sprint_id) : null;
    if (input.sprint_id) (ticket as any).is_backlog = false;
  }
  if (input.is_backlog !== undefined) {
    (ticket as any).is_backlog = input.is_backlog;
    if (input.is_backlog) (ticket as any).sprint_id = null;
  }
  await ticket.save({ validateModifiedOnly: true });

  // createdAt is immutable via Mongoose timestamps, so update it directly
  if (input.created_at) {
    await Ticket.updateOne(
      { _id: ticket._id, tenant_id: tenantId },
      { $set: { createdAt: new Date(input.created_at) } }
    );
  }

  // Fire-and-forget
  indexTicketInMeili(ticket).catch(() => {});
  publishTicketEvent('updated', ticket, changes.length > 0 ? { changes } : undefined).catch(() => {});

  // ── Notifications ────────────────────────────────────────────────────────
  (async () => {
    try {
      const ticketLabel = `TK-${String(ticket.number).padStart(4, '0')} "${ticket.title}"`;

      // 1. Assignment notification → tell the new assignee
      if (assigneeChanged && input.assignee_id) {
        await createNotification({
          tenant_id:     tenantId as any,
          user_id:       new Types.ObjectId(input.assignee_id) as any,
          type:          'ticket_assigned',
          title:         `You've been assigned a ticket`,
          body:          `${ticketLabel} has been assigned to you.`,
          resource_type: 'ticket',
          resource_id:   ticket._id.toString(),
        });
      }

      // 2. Status-change notification → tell all watchers (except the person who changed it)
      if (statusChanged) {
        const terminal = ['resolved', 'closed', 'done'];
        const isTerminal = terminal.includes(ticket.status);
        for (const watcherId of ticket.watcher_ids ?? []) {
          await createNotification({
            tenant_id:     tenantId as any,
            user_id:       watcherId as any,
            type:          'ticket_status_changed',
            title:         `Ticket ${isTerminal ? 'resolved' : 'updated'}: ${ticketLabel.split(' ')[0]}`,
            body:          `${ticketLabel} moved to "${ticket.status.replace(/_/g, ' ')}".`,
            resource_type: 'ticket',
            resource_id:   ticket._id.toString(),
          });
        }

        // 3. Resolve blocking chain — notify tickets that were blocked BY this one
        if (isTerminal && ticket.blocks_ids?.length > 0) {
          const blockedTickets = await Ticket.find({
            _id: { $in: ticket.blocks_ids },
            tenant_id: tenantId,
          }).select('_id number title reporter_id assignee_id').lean();

          for (const blocked of blockedTickets) {
            const recipients = new Set<string>();
            if (blocked.reporter_id) recipients.add(blocked.reporter_id.toString());
            if (blocked.assignee_id) recipients.add(blocked.assignee_id.toString());
            for (const uid of recipients) {
              await createNotification({
                tenant_id:     tenantId as any,
                user_id:       uid as any,
                type:          'ticket_blocker_resolved',
                title:         `Blocker resolved for TK-${String(blocked.number).padStart(4, '0')}`,
                body:          `${ticketLabel} (which was blocking your ticket) has been ${ticket.status}.`,
                resource_type: 'ticket',
                resource_id:   blocked._id.toString(),
              });
            }
          }
        }
      }
    } catch (err) {
      logger.warn('Ticket notification failed', { ticketId: ticket._id.toString(), error: (err as Error).message });
    }
  })();

  // Bridge sync: propagate status changes to the other side
  if (statusChanged) {
    (async () => {
      try {
        // Check if this ticket is the provider side of a bridge
        const providerBridge = await TicketBridge.findOne({
          provider_ticket_id: ticket._id,
          status: { $nin: ['closed'] },
        });
        if (providerBridge) {
          const action = ticket.status === 'done' ? 'resolve' : 'status_change';
          await syncTicketToConsumer(providerBridge._id.toString(), action, { status: ticket.status });
          return;
        }

        // Check if this ticket is the consumer side of a bridge
        const consumerBridge = await TicketBridge.findOne({
          consumer_ticket_id: ticket._id,
          status: { $nin: ['closed'] },
        });
        if (consumerBridge) {
          const action = ticket.status === 'done' ? 'resolve' : 'status_change';
          await syncTicketToProvider(consumerBridge._id.toString(), action, { status: ticket.status });
        }
      } catch (err) {
        logger.warn('Bridge sync failed for ticket update', { ticketId: ticket._id.toString(), error: (err as Error).message });
      }
    })();
  }

  return ticket;
}

export async function deleteTicket(tenantId: Types.ObjectId, ticketId: string): Promise<void> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId });
  if (!ticket) {
    throw AppError.notFound('Ticket');
  }

  ticket.deleted_at = new Date();
  await ticket.save({ validateModifiedOnly: true });

  // Remove from search index
  try {
    const client = getMeiliClient();
    await client.index('tickets').deleteDocument(ticketId);
  } catch (err: any) {
    logger.error('Failed to remove ticket from Meilisearch', { ticketId, error: err.message });
  }

  publishTicketEvent('deleted', ticket).catch(() => {});
}

export async function bulkUpdateTickets(
  tenantId: Types.ObjectId,
  ticketIds: string[],
  update: Partial<UpdateTicketInput>,
  userRoles: string[]
): Promise<{ updated: number; failed: string[] }> {
  let updated = 0;
  const failed: string[] = [];

  for (const ticketId of ticketIds) {
    try {
      await updateTicket(tenantId, ticketId, update, userRoles);
      updated++;
    } catch (err: any) {
      failed.push(ticketId);
      logger.warn('Bulk update failed for ticket', { ticketId, error: err.message });
    }
  }

  return { updated, failed };
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Resolve a user-supplied ticket reference to a ticket document within the tenant.
 * Accepts a raw MongoDB ObjectId, a human-readable ticket key such as "TK-0898"
 * or "PROJ-12", or a plain ticket number ("898"). Ticket numbers are unique per
 * tenant, so the project prefix is cosmetic and only the numeric part is matched.
 */
export async function resolveTicketRef(
  tenantId: Types.ObjectId,
  ref: string
): Promise<TicketDocument> {
  const trimmed = (ref || '').trim();
  if (!trimmed) throw AppError.badRequest('Target ticket is required');

  let ticket: TicketDocument | null = null;
  if (OBJECT_ID_RE.test(trimmed)) {
    ticket = await Ticket.findOne({ _id: trimmed, tenant_id: tenantId });
  } else {
    const match = trimmed.match(/(\d+)\s*$/);
    if (!match) throw AppError.badRequest(`"${ref}" is not a valid ticket ID or key`);
    const number = parseInt(match[1] as string, 10);
    if (!Number.isFinite(number)) throw AppError.badRequest(`"${ref}" is not a valid ticket ID or key`);
    ticket = await Ticket.findOne({ tenant_id: tenantId, number });
  }
  if (!ticket) throw AppError.notFound('Target ticket');
  return ticket;
}

export async function linkTickets(
  tenantId: Types.ObjectId,
  ticketId: string,
  targetRef: string,
  type: 'related' | 'blocks' | 'blocked_by' | 'parent' | 'child'
): Promise<TicketDocument> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId });
  if (!ticket) throw AppError.notFound('Ticket');

  // targetRef may be an ObjectId, a ticket key (e.g. "TK-0898"), or a number.
  const target = await resolveTicketRef(tenantId, targetRef);

  if (target._id.equals(ticket._id)) throw AppError.badRequest('Cannot link a ticket to itself');

  const targetOid = target._id;
  const ticketOid = ticket._id;

  switch (type) {
    case 'related':
      if (!ticket.related_ids.some((id) => id.equals(targetOid))) ticket.related_ids.push(targetOid);
      if (!target.related_ids.some((id) => id.equals(ticketOid))) target.related_ids.push(ticketOid);
      break;
    case 'blocks':
      if (!ticket.blocks_ids.some((id) => id.equals(targetOid))) ticket.blocks_ids.push(targetOid);
      if (!target.blocked_by_ids.some((id) => id.equals(ticketOid))) target.blocked_by_ids.push(ticketOid);
      break;
    case 'blocked_by':
      if (!ticket.blocked_by_ids.some((id) => id.equals(targetOid))) ticket.blocked_by_ids.push(targetOid);
      if (!target.blocks_ids.some((id) => id.equals(ticketOid))) target.blocks_ids.push(ticketOid);
      break;
    case 'parent':
      ticket.parent_id = targetOid;
      break;
    case 'child':
      target.parent_id = ticketOid;
      break;
  }

  await Promise.all([ticket.save({ validateModifiedOnly: true }), target.save({ validateModifiedOnly: true })]);
  logger.info('Tickets linked', { ticketId, targetId: targetOid.toString(), type });
  publishTicketEvent('updated', ticket).catch(() => {});
  return ticket;
}

export async function unlinkTickets(
  tenantId: Types.ObjectId,
  ticketId: string,
  targetId: string
): Promise<void> {
  const [ticket, target] = await Promise.all([
    Ticket.findOne({ _id: ticketId, tenant_id: tenantId }),
    Ticket.findOne({ _id: targetId, tenant_id: tenantId }),
  ]);
  if (!ticket) throw AppError.notFound('Ticket');

  const targetOid = new Types.ObjectId(targetId);
  const ticketOid = new Types.ObjectId(ticketId);

  ticket.related_ids = ticket.related_ids.filter((id) => !id.equals(targetOid));
  ticket.blocks_ids = ticket.blocks_ids.filter((id) => !id.equals(targetOid));
  ticket.blocked_by_ids = ticket.blocked_by_ids.filter((id) => !id.equals(targetOid));
  if (ticket.parent_id?.equals(targetOid)) ticket.parent_id = undefined;

  if (target) {
    target.related_ids = target.related_ids.filter((id) => !id.equals(ticketOid));
    target.blocks_ids = target.blocks_ids.filter((id) => !id.equals(ticketOid));
    target.blocked_by_ids = target.blocked_by_ids.filter((id) => !id.equals(ticketOid));
    if (target.parent_id?.equals(ticketOid)) target.parent_id = undefined;
    await target.save({ validateModifiedOnly: true });
  }

  await ticket.save({ validateModifiedOnly: true });
  logger.info('Tickets unlinked', { ticketId, targetId });
  publishTicketEvent('updated', ticket).catch(() => {});
}

export async function addWorkLog(
  tenantId: Types.ObjectId,
  ticketId: string,
  userId: Types.ObjectId,
  input: AddWorkLogInput
): Promise<TicketDocument> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId });
  if (!ticket) throw AppError.notFound('Ticket');

  const logEntry = {
    _id: new Types.ObjectId(),
    user_id: userId,
    minutes: input.minutes,
    description: input.description || '',
    logged_at: input.logged_at ? new Date(input.logged_at) : new Date(),
    created_at: new Date(),
  };

  ticket.work_logs.push(logEntry as any);
  ticket.time_spent_minutes = (ticket.time_spent_minutes || 0) + input.minutes;
  await ticket.save({ validateModifiedOnly: true });

  publishTicketEvent('work_logged', ticket, { minutes: input.minutes }).catch(() => {});
  return ticket;
}

export async function removeWorkLog(
  tenantId: Types.ObjectId,
  ticketId: string,
  logId: string
): Promise<TicketDocument> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId });
  if (!ticket) throw AppError.notFound('Ticket');

  const logIndex = ticket.work_logs.findIndex((l: any) => l._id.toString() === logId);
  if (logIndex === -1) throw AppError.notFound('Work log entry');

  const removedMinutes = (ticket.work_logs[logIndex] as any).minutes;
  ticket.work_logs.splice(logIndex, 1);
  ticket.time_spent_minutes = Math.max(0, (ticket.time_spent_minutes || 0) - removedMinutes);
  await ticket.save({ validateModifiedOnly: true });

  publishTicketEvent('work_log_removed', ticket, { logId }).catch(() => {});
  return ticket;
}

async function validateHierarchy(
  tenantId: Types.ObjectId,
  childType: string,
  parentId: string
): Promise<void> {
  const parent = await Ticket.findOne({ _id: parentId, tenant_id: tenantId });
  if (!parent) throw AppError.notFound('Parent ticket');

  const parentType = parent.type;

  switch (childType) {
    case 'epic':
      throw AppError.badRequest('Epics cannot have a parent ticket.');
    case 'user_story':
      if (parentType !== 'epic') {
        throw AppError.badRequest('A user story can only be a child of an epic.');
      }
      break;
    case 'task':
    case 'bug':
      if (parentType !== 'epic' && parentType !== 'user_story') {
        throw AppError.badRequest('A task or bug can only be a child of an epic or user story.');
      }
      break;
  }
}

export async function getChildTickets(
  tenantId: Types.ObjectId,
  ticketId: string
): Promise<TicketDocument[]> {
  return Ticket.find({ tenant_id: tenantId, parent_id: new Types.ObjectId(ticketId) })
    .sort({ createdAt: -1 })
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url')
    .populate('project_id', 'name key color');
}

export async function linkIncident(
  tenantId: Types.ObjectId,
  ticketId: string,
  incidentId: string
): Promise<void> {
  const { Incident } = await import('../models/incident.model');
  const [ticket, incident] = await Promise.all([
    Ticket.findOne({ _id: ticketId, tenant_id: tenantId }),
    Incident.findOne({ _id: incidentId, tenant_id: tenantId }),
  ]);
  if (!ticket) throw AppError.notFound('Ticket');
  if (!incident) throw AppError.notFound('Incident');

  const incidentOid = new Types.ObjectId(incidentId);
  const ticketOid = new Types.ObjectId(ticketId);

  if (!ticket.linked_incident_ids.some((id) => id.equals(incidentOid))) {
    ticket.linked_incident_ids.push(incidentOid);
  }
  if (!incident.linked_ticket_ids.some((id: Types.ObjectId) => id.equals(ticketOid))) {
    incident.linked_ticket_ids.push(ticketOid);
  }

  await Promise.all([
    ticket.save({ validateModifiedOnly: true }),
    incident.save({ validateModifiedOnly: true }),
  ]);
  logger.info('Ticket linked to incident', { ticketId, incidentId });
}

export async function unlinkIncident(
  tenantId: Types.ObjectId,
  ticketId: string,
  incidentId: string
): Promise<void> {
  const { Incident } = await import('../models/incident.model');
  const [ticket, incident] = await Promise.all([
    Ticket.findOne({ _id: ticketId, tenant_id: tenantId }),
    Incident.findOne({ _id: incidentId, tenant_id: tenantId }),
  ]);
  if (!ticket) throw AppError.notFound('Ticket');

  const incidentOid = new Types.ObjectId(incidentId);
  const ticketOid = new Types.ObjectId(ticketId);

  ticket.linked_incident_ids = ticket.linked_incident_ids.filter((id) => !id.equals(incidentOid));
  if (incident) {
    incident.linked_ticket_ids = incident.linked_ticket_ids.filter((id: Types.ObjectId) => !id.equals(ticketOid));
    await incident.save({ validateModifiedOnly: true });
  }
  await ticket.save({ validateModifiedOnly: true });
  logger.info('Ticket unlinked from incident', { ticketId, incidentId });
}

export async function linkChangeRequest(
  tenantId: Types.ObjectId,
  ticketId: string,
  changeRequestId: string
): Promise<void> {
  const { ChangeRequest } = await import('../models/change-request.model');
  const [ticket, cr] = await Promise.all([
    Ticket.findOne({ _id: ticketId, tenant_id: tenantId }),
    ChangeRequest.findOne({ _id: changeRequestId, tenant_id: tenantId }),
  ]);
  if (!ticket) throw AppError.notFound('Ticket');
  if (!cr) throw AppError.notFound('Change request');

  const crOid = new Types.ObjectId(changeRequestId);
  const ticketOid = new Types.ObjectId(ticketId);

  if (!ticket.linked_change_request_ids.some((id) => id.equals(crOid))) {
    ticket.linked_change_request_ids.push(crOid);
  }
  if (!cr.linked_ticket_ids.some((id: Types.ObjectId) => id.equals(ticketOid))) {
    cr.linked_ticket_ids.push(ticketOid);
  }

  await Promise.all([
    ticket.save({ validateModifiedOnly: true }),
    cr.save({ validateModifiedOnly: true }),
  ]);
  logger.info('Ticket linked to change request', { ticketId, changeRequestId });
}

export async function unlinkChangeRequest(
  tenantId: Types.ObjectId,
  ticketId: string,
  changeRequestId: string
): Promise<void> {
  const { ChangeRequest } = await import('../models/change-request.model');
  const [ticket, cr] = await Promise.all([
    Ticket.findOne({ _id: ticketId, tenant_id: tenantId }),
    ChangeRequest.findOne({ _id: changeRequestId, tenant_id: tenantId }),
  ]);
  if (!ticket) throw AppError.notFound('Ticket');

  const crOid = new Types.ObjectId(changeRequestId);
  const ticketOid = new Types.ObjectId(ticketId);

  ticket.linked_change_request_ids = ticket.linked_change_request_ids.filter((id) => !id.equals(crOid));
  if (cr) {
    cr.linked_ticket_ids = cr.linked_ticket_ids.filter((id: Types.ObjectId) => !id.equals(ticketOid));
    await cr.save({ validateModifiedOnly: true });
  }
  await ticket.save({ validateModifiedOnly: true });
  logger.info('Ticket unlinked from change request', { ticketId, changeRequestId });
}

export async function getBoardView(
  tenantId: Types.ObjectId,
  filters?: { type?: string; project_id?: string; status?: string; priority?: string; assignee_id?: string; reporter_id?: string; team_id?: string; search?: string; consumer_name?: string; user_id?: Types.ObjectId }
): Promise<Record<string, TicketDocument[]>> {
  const filter: Record<string, any> = { tenant_id: tenantId, deleted_at: { $eq: null } };
  if (filters?.type) filter.type = filters.type;
  if (filters?.project_id) filter.project_id = new Types.ObjectId(filters.project_id);
  if (filters?.status) filter.status = filters.status;
  if (filters?.priority) filter.priority = filters.priority;
  if (filters?.assignee_id) filter.assignee_id = filters.assignee_id;
  if (filters?.reporter_id) filter.reporter_id = filters.reporter_id;
  if (filters?.team_id) {
    if (!Types.ObjectId.isValid(filters.team_id)) {
      throw AppError.badRequest('Invalid team_id.');
    }
    filter.team_id = new Types.ObjectId(filters.team_id);
  }
  if (filters?.consumer_name) filter['custom_fields.escalated_from'] = filters.consumer_name;

  if (filters?.user_id && !filters?.project_id) {
    const visFilter = await buildVisibilityFilter(tenantId, filters.user_id);
    if (visFilter) Object.assign(filter, visFilter);
  }

  if (filters?.search) {
    filter.$or = [
      { title: { $regex: filters.search, $options: 'i' } },
      { ticket_number: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const tickets = await Ticket.find(filter)
    .sort({ priority: 1, updatedAt: -1 })
    .limit(500)
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url')
    .populate('tenant_id', 'name')
    .populate('team_id', 'name')
    .populate('project_id', 'name key color');

  const board: Record<string, TicketDocument[]> = {};
  for (const ticket of tickets) {
    if (!board[ticket.status]) {
      board[ticket.status] = [];
    }
    board[ticket.status].push(ticket);
  }

  return board;
}

// Best-effort SLA matching, run after the create response has already been
// sent so it doesn't add DB round-trips to the create request's latency.
export async function attachSlaIfMatched(tenantId: Types.ObjectId, ticketId: string): Promise<void> {
  const ticket = await Ticket.findOne({ _id: ticketId, tenant_id: tenantId });
  if (!ticket) return;

  const configs = await SlaConfig.find({ tenant_id: tenantId, enabled: true });
  const priority = ticket.priority as any;
  const match = configs.find((c) => {
    const pMatch = c.conditions.priority.length === 0 || c.conditions.priority.includes(priority);
    const tMatch = c.conditions.ticket_types.length === 0 || c.conditions.ticket_types.includes(ticket.type);
    return pMatch && tMatch;
  });
  if (!match) return;

  const now = ticket.createdAt || new Date();
  const businessHours = match.business_hours && match.business_hours.schedule.length > 0 ? match.business_hours : null;
  const responseDeadline = businessHours
    ? computeBusinessHoursDeadline(now, match.response_time_minutes, businessHours)
    : new Date(now.getTime() + match.response_time_minutes * 60000);
  const resolutionDeadline = businessHours
    ? computeBusinessHoursDeadline(now, match.resolution_time_minutes, businessHours)
    : new Date(now.getTime() + match.resolution_time_minutes * 60000);

  ticket.sla = {
    config_id: match._id,
    response_deadline: responseDeadline,
    resolution_deadline: resolutionDeadline,
    response_met: null,
    resolution_met: null,
    first_response_at: null,
    paused_at: null,
    paused_duration_ms: 0,
  } as any;
  await ticket.save({ validateModifiedOnly: true });
  await publishTicketEvent('updated', ticket);
}

export async function getBoardProjectIds(
  tenantId: Types.ObjectId,
  filters?: { assignee_id?: string; user_id?: Types.ObjectId }
): Promise<string[]> {
  const filter: Record<string, any> = { tenant_id: tenantId, deleted_at: { $eq: null } };
  if (filters?.assignee_id) filter.assignee_id = filters.assignee_id;

  if (filters?.user_id) {
    const visFilter = await buildVisibilityFilter(tenantId, filters.user_id);
    if (visFilter) Object.assign(filter, visFilter);
  }

  const projectIds = await Ticket.distinct('project_id', filter);
  return projectIds.filter(Boolean).map((id) => id.toString());
}
