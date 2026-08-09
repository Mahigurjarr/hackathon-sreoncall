import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as ticketService from '../services/ticket.service';
import * as auditService from '../services/audit.service';
import * as storageService from '../services/storage.service';
import { TicketComment } from '../models/ticket-comment.model';
import { TicketCommentReaction, ALLOWED_REACTIONS } from '../models/ticket-comment-reaction.model';
import { rbac } from '../middleware/rbac.middleware';
import { boardAccessMiddleware } from '../middleware/boardAccess.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { parsePaginationParams } from '../utils/pagination';
import { Types } from 'mongoose';
import * as ticketBridgeService from '../services/ticket-bridge.service';
import { WorkLog } from '../models/work-log.model';
import { Ticket } from '../models/ticket.model';
import { SlaConfig } from '../models/sla-config.model';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import {
  computeBusinessHoursDeadline,
  computeElapsedBusinessMinutes,
} from '../services/sla-calculator.service';
import * as workLogSettingsService from '../services/work-log-settings.service';
import { createNotification } from '../services/notification.service';
import { User } from '../models/user.model';
import { logger } from '../utils/logger';

const sc = StringCodec();

const router = Router();

const statusLabels: Record<string, string> = {
  discover: 'Discover',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  on_hold: 'On Hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

function serializeUser(user: any) {
  if (!user) return null;
  if (typeof user === 'string' || user._bsontype === 'ObjectId') return null;
  return {
    id: user._id?.toString() || user.toString(),
    name: user.name || null,
    email: user.email || null,
    avatar_url: user.avatar_url || null,
  };
}

function serializeTeam(team: any) {
  if (!team) return null;
  if (typeof team === 'string' || team._bsontype === 'ObjectId') return null;
  return {
    id: team._id?.toString() || team.toString(),
    name: team.name || null,
  };
}

function serializeTicket(ticket: any): Record<string, any> {
  // project_id may be populated (object) or a raw ObjectId depending on the query.
  const project = ticket.project_id && typeof ticket.project_id === 'object' && ticket.project_id.name !== undefined
    ? ticket.project_id
    : null;
  const projectId = project
    ? project._id?.toString()
    : ticket.project_id?.toString() ?? null;

  return {
    id: ticket._id.toString(),
    project_id: projectId,
    project_name: project?.name ?? null,
    project_key: project?.key ?? null,
    project_color: project?.color ?? null,
    number: ticket.number,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description || '',
    status: ticket.status,
    priority: ticket.priority,
    assignee_id: ticket.assignee_id?._id?.toString() || ticket.assignee_id?.toString() || null,
    assignee: serializeUser(ticket.assignee_id),
    team_id: ticket.team_id?._id?.toString() || ticket.team_id?.toString() || null,
    team: serializeTeam(ticket.team_id),
    reporter_id: ticket.reporter_id?._id?.toString() || ticket.reporter_id?.toString() || '',
    reporter: serializeUser(ticket.reporter_id) || { id: '', name: 'Unknown', email: '', avatar_url: null },
    labels: ticket.labels || [],
    related_ids: (ticket.related_ids || []).map((id: any) => id.toString()),
    blocks_ids: (ticket.blocks_ids || []).map((id: any) => id.toString()),
    blocked_by_ids: (ticket.blocked_by_ids || []).map((id: any) => id.toString()),
    linked_incident_ids: (ticket.linked_incident_ids || []).map((id: any) => id.toString()),
    linked_change_request_ids: (ticket.linked_change_request_ids || []).map((id: any) => id.toString()),
    milestone_id: ticket.milestone_id?.toString() || null,
    sprint_id: ticket.sprint_id?.toString() || null,
    is_backlog: ticket.is_backlog ?? false,
    parent_id: ticket.parent_id?.toString() || null,
    time_estimate_raw: ticket.time_estimate_raw || null,
    time_estimate_minutes: ticket.time_estimate_minutes ?? null,
    time_spent_minutes: ticket.time_spent_minutes ?? 0,
    work_logs: (ticket.work_logs || []).map((log: any) => ({
      id: log._id.toString(),
      user: serializeUser(log.user_id),
      minutes: log.minutes,
      description: log.description || '',
      logged_at: log.logged_at?.toISOString() || log.created_at?.toISOString(),
      created_at: log.created_at?.toISOString(),
    })),
    sla: ticket.sla ? {
      config_id: ticket.sla.config_id?.toString() || null,
      response_deadline: ticket.sla.response_deadline?.toISOString() || null,
      resolution_deadline: ticket.sla.resolution_deadline?.toISOString() || null,
      response_met: ticket.sla.response_met ?? null,
      resolution_met: ticket.sla.resolution_met ?? null,
      first_response_at: ticket.sla.first_response_at?.toISOString() || null,
      paused_at: ticket.sla.paused_at?.toISOString() || null,
      paused_duration_ms: ticket.sla.paused_duration_ms || 0,
    } : null,
    watcher_ids: (ticket.watcher_ids || []).map((id: any) => id?._id?.toString() ?? id?.toString()),
    custom_fields: ticket.custom_fields instanceof Map
      ? Object.fromEntries(ticket.custom_fields)
      : ticket.custom_fields || {},
    tenant_name: ticket.tenant_id?.name || null,
    created_at: ticket.createdAt?.toISOString() || ticket.created_at,
    updated_at: ticket.updatedAt?.toISOString() || ticket.updated_at,
    resolved_at: ticket.resolved_at?.toISOString() || null,
    comments: [] as any[],
    activity: [] as any[],
  };
}

const createTicketSchema = z.object({
  project_id: z.string().min(1),
  type: z.enum(['epic', 'user_story', 'task', 'bug']),
  title: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  assignee_id: z.string().optional(),
  team_id: z.string().optional(),
  labels: z.array(z.string()).optional(),
  custom_fields: z.record(z.any()).optional(),
  parent_id: z.string().optional(),
  time_estimate: z.string().optional(),
  time_estimate_minutes: z.number().int().min(1).nullable().optional(),
  milestone_id: z.string().optional(),
});

const updateTicketSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50000).optional(),
  status: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  assignee_id: z.string().nullable().optional(),
  reporter_id: z.string().optional(),
  team_id: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  custom_fields: z.record(z.any()).optional(),
  watcher_ids: z.array(z.string()).optional(),
  time_estimate: z.string().optional(),
  time_estimate_minutes: z.number().int().min(1).nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  sprint_id: z.string().nullable().optional(),
  is_backlog: z.boolean().optional(),
  created_at: z.string().datetime().optional(),
});

const bulkUpdateSchema = z.object({
  ticket_ids: z.array(z.string()).min(1).max(100),
  update: updateTicketSchema,
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(50000),
  is_internal: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        file_id: z.string(),
        filename: z.string(),
        mime_type: z.string(),
        size_bytes: z.number(),
        url: z.string(),
      })
    )
    .optional(),
});

const updateCommentSchema = z.object({
  body: z.string().min(1).max(50000),
});

const uploadRequestSchema = z.object({
  original_name: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
});

// GET /api/v1/tickets
router.get('/', rbac('tickets:read'), boardAccessMiddleware, async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);

  const filter = {
    tenant_id: req.tenantId,
    user_id: req.userId,
    project_id: req.query.project_id as string | undefined,
    status: req.query.status as string | undefined,
    priority: req.query.priority as string | undefined,
    assignee_id: req.query.assignee_id as string | undefined,
    reporter_id: req.query.reporter_id as string | undefined,
    team_id: req.query.team_id as string | undefined,
    type: req.query.type as string | undefined,
    labels: req.query.labels ? (req.query.labels as string).split(',') : undefined,
    parent_id: req.query.parent_id as string | undefined,
    milestone_id: req.query.milestone_id as string | undefined,
    sprint_id: req.query.sprint_id as string | undefined,
    is_backlog: req.query.is_backlog === 'true' ? true : req.query.is_backlog === 'false' ? false : undefined,
    consumer_name: req.query.consumer_name as string | undefined,
  };

  const result = await ticketService.listTickets(filter, pagination);

  // Serialize tickets in response while preserving pagination
  res.json({
    data: result.data.map(serializeTicket),
    pagination: result.pagination,
  });
});

// GET /api/v1/tickets/board
router.get('/board', rbac('tickets:read'), boardAccessMiddleware, async (req: Request, res: Response) => {
  const boardData = await ticketService.getBoardView(req.tenantId, {
    type: req.query.type as string | undefined,
    project_id: req.query.project_id as string | undefined,
    status: req.query.status as string | undefined,
    priority: req.query.priority as string | undefined,
    assignee_id: req.query.assignee_id as string | undefined,
    reporter_id: req.query.reporter_id as string | undefined,
    team_id: req.query.team_id as string | undefined,
    search: req.query.search as string | undefined,
    consumer_name: req.query.consumer_name as string | undefined,
    user_id: req.userId,
  });

  // Default column order
  const defaultStatuses = ['discover', 'open', 'in_progress', 'in_review', 'on_hold', 'resolved'];

  // Build columns array with proper shape
  const allStatuses = new Set([...defaultStatuses, ...Object.keys(boardData)]);
  const columns = Array.from(allStatuses).map((status) => ({
    status,
    label: statusLabels[status] || status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    tickets: (boardData[status] || []).map(serializeTicket),
  }));

  res.json({ columns });
});

// GET /api/v1/tickets/board/projects
// Lightweight lookup of distinct project ids that have tickets, for populating
// filter dropdowns without re-fetching the full (populated) board.
router.get('/board/projects', rbac('tickets:read'), boardAccessMiddleware, async (req: Request, res: Response) => {
  const projectIds = await ticketService.getBoardProjectIds(req.tenantId, {
    assignee_id: req.query.assignee_id as string | undefined,
    user_id: req.userId,
  });
  res.json({ project_ids: projectIds });
});

// --- Work Log Approvals (must be before /:id routes) ---

function serializeWorkLog(l: any) {
  return {
    id: l._id.toString(),
    entity_type: l.entity_type,
    entity_id: l.entity_id.toString(),
    user: l.user_id && typeof l.user_id === 'object' && l.user_id._id
      ? { id: l.user_id._id.toString(), name: l.user_id.name, email: l.user_id.email, avatar_url: l.user_id.avatar_url }
      : { id: l.user_id?.toString() || '', name: null, email: null, avatar_url: null },
    duration_minutes: l.duration_minutes,
    description: l.description,
    status: l.status || 'pending',
    approved_by: l.approved_by?.toString() || null,
    approved_at: l.approved_at?.toISOString() || null,
    rejection_reason: l.rejection_reason || null,
    logged_at: l.logged_at?.toISOString(),
    created_at: l.createdAt?.toISOString(),
    source: l.source || 'internal',
    source_user_name: l.source_user_name || null,
    billable: l.billable ?? true,
  };
}

// GET /api/v1/tickets/work-logs — List work logs across all tickets (admin view)
router.get(
  '/work-logs',
  rbac('tickets:read'),
  async (req: Request, res: Response) => {
    const filter: Record<string, any> = { tenant_id: req.tenantId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.entity_id) filter.entity_id = new Types.ObjectId(req.query.entity_id as string);
    if (req.query.user_id) filter.user_id = new Types.ObjectId(req.query.user_id as string);

    const logs = await WorkLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('user_id', 'name email avatar_url');

    // Batch-fetch ticket details for all work logs
    const ticketIds = [...new Set(logs.filter(l => l.entity_type === 'ticket').map(l => l.entity_id.toString()))];
    const ticketMap = new Map<string, any>();
    if (ticketIds.length > 0) {
      const tickets = await Ticket.find({ _id: { $in: ticketIds } }, 'number title status priority type').lean();
      for (const t of tickets) ticketMap.set(t._id.toString(), t);
    }

    const total = logs.reduce((sum, l) => sum + l.duration_minutes, 0);
    res.json({
      data: logs.map((l) => {
        const serialized: Record<string, any> = serializeWorkLog(l);
        const ticket = ticketMap.get(l.entity_id.toString());
        if (ticket) {
          serialized.ticket = {
            id: ticket._id.toString(),
            number: ticket.number,
            title: ticket.title,
            status: ticket.status,
            priority: ticket.priority,
            type: ticket.type,
          };
        }
        return serialized;
      }),
      total_minutes: total,
    });
  }
);

// PATCH /api/v1/tickets/work-logs/bulk-approve
const bulkApproveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

router.patch(
  '/work-logs/bulk-approve',
  rbac('work_logs:approve'),
  async (req: Request, res: Response) => {
    const { ids } = bulkApproveSchema.parse(req.body);
    const objectIds = ids.map((id) => new Types.ObjectId(id));

    const result = await WorkLog.updateMany(
      { _id: { $in: objectIds }, tenant_id: req.tenantId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          approved_by: req.userId,
          approved_at: new Date(),
        },
        $unset: { rejection_reason: '' },
      },
    );

    res.json({ approved_count: result.modifiedCount });
  },
);

// PATCH /api/v1/tickets/work-logs/:id/approve
router.patch(
  '/work-logs/:id/approve',
  rbac('work_logs:approve'),
  async (req: Request, res: Response) => {
    const log = await WorkLog.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
    if (!log) {
      res.status(404).json({ detail: 'Work log not found' });
      return;
    }
    if (log.status === 'approved') {
      res.status(400).json({ detail: 'Work log is already approved' });
      return;
    }
    log.status = 'approved';
    log.approved_by = req.userId;
    log.approved_at = new Date();
    log.rejection_reason = undefined;
    await log.save();

    // Sync approval to consumer if this is a bridged ticket
    try {
      const bridge = await import('../models/ticket-bridge.model').then(m =>
        m.TicketBridge.findOne({
          provider_ticket_id: log.entity_id,
          status: { $ne: 'closed' },
        })
      );
      if (bridge) {
        const js = getJetStream();
        await js.publish('bridges.sync.to_consumer', sc.encode(JSON.stringify({
          bridge_id: bridge._id.toString(),
          bridge_type: 'ticket',
          action: 'work_log_approved',
          event_id: `wla-${log._id.toString()}`,
          data: { work_log_id: log._id.toString() },
        })));
      }
    } catch { /* best-effort */ }

    res.json(serializeWorkLog(log));
  }
);

// PATCH /api/v1/tickets/work-logs/:id/reject
router.patch(
  '/work-logs/:id/reject',
  rbac('work_logs:approve'),
  async (req: Request, res: Response) => {
    const { reason } = z.object({ reason: z.string().max(2000).optional().default('') }).parse(req.body);
    const log = await WorkLog.findOne({ _id: req.params['id'], tenant_id: req.tenantId });
    if (!log) {
      res.status(404).json({ detail: 'Work log not found' });
      return;
    }
    if (log.status === 'rejected') {
      res.status(400).json({ detail: 'Work log is already rejected' });
      return;
    }
    log.status = 'rejected';
    log.approved_by = req.userId;
    log.approved_at = new Date();
    log.rejection_reason = reason;
    await log.save();
    res.json(serializeWorkLog(log));
  }
);

// POST /api/v1/tickets
router.post(
  '/',
  rbac('tickets:create'),
  boardAccessMiddleware,
  auditMiddleware({ action: 'ticket.create', resourceType: 'ticket' }),
  async (req: Request, res: Response) => {
    const body = createTicketSchema.parse(req.body);
    const ticket = await ticketService.createTicket({
      ...body,
      tenant_id: req.tenantId,
      reporter_id: req.userId,
    });

    // Populate the document we already have in memory instead of re-querying it.
    await ticket.populate([
      { path: 'assignee_id', select: 'name email avatar_url' },
      { path: 'reporter_id', select: 'name email avatar_url' },
      { path: 'tenant_id', select: 'name' },
      { path: 'project_id', select: 'name key color' },
    ]);
    res.status(201).json(serializeTicket(ticket));

    // SLA matching touches SlaConfig + an extra save; run after responding so
    // it doesn't add to create latency. Ticket board/detail views pick up the
    // deadlines via the 'updated' event this publishes once matched.
    ticketService.attachSlaIfMatched(req.tenantId, ticket._id.toString()).catch((err) => {
      logger.error('SLA matching failed for ticket', { ticketId: ticket._id.toString(), error: err.message });
    });
  }
);

// POST /api/v1/tickets/bulk
router.post(
  '/bulk',
  rbac('tickets:bulk'),
  auditMiddleware({ action: 'ticket.bulk_update', resourceType: 'ticket' }),
  async (req: Request, res: Response) => {
    const body = bulkUpdateSchema.parse(req.body);
    const result = await ticketService.bulkUpdateTickets(
      req.tenantId,
      body.ticket_ids,
      body.update,
      req.roles
    );
    res.json(result);
  }
);

// GET /api/v1/tickets/:id
router.get('/:id', rbac('tickets:read'), async (req: Request, res: Response) => {
  const ticket = await ticketService.getTicketById(req.tenantId, req.params.id as string);

  // Also fetch comments, reactions, and history for the detail view
  const [comments, reactions, historyResult] = await Promise.all([
    TicketComment.find({
      ticket_id: req.params.id as string,
      tenant_id: req.tenantId,
    })
      .sort({ createdAt: 1 })
      .populate('author_id', 'name email avatar_url'),
    TicketCommentReaction.find({ tenant_id: req.tenantId }).lean(),
    auditService.getAuditLogsByResource(req.tenantId, 'ticket', req.params.id as string, 50),
  ]);

  // Group reactions by comment_id
  const reactionsByComment = new Map<string, Array<{ emoji: string; user_id: string }>>();
  for (const r of reactions) {
    const cid = r.comment_id.toString();
    if (!reactionsByComment.has(cid)) reactionsByComment.set(cid, []);
    reactionsByComment.get(cid)!.push({ emoji: r.emoji, user_id: r.user_id.toString() });
  }

  const isAgent = req.roles.some((r) =>
    ['platform_admin', 'tenant_admin', 'manager', 'agent'].includes(r),
  );
  const filteredComments = isAgent ? comments : comments.filter((c) => !c.is_internal);

  const serialized = serializeTicket(ticket);
  serialized.comments = filteredComments.map((c: any) => {
    const commentReactions = reactionsByComment.get(c._id.toString()) ?? [];
    // Aggregate: { emoji -> [user_ids] }
    const reactionMap = new Map<string, string[]>();
    for (const r of commentReactions) {
      if (!reactionMap.has(r.emoji)) reactionMap.set(r.emoji, []);
      reactionMap.get(r.emoji)!.push(r.user_id);
    }
    const reactions_summary = Array.from(reactionMap.entries()).map(([emoji, user_ids]) => ({ emoji, count: user_ids.length, user_ids }));
    return {
      id: c._id.toString(),
      body: c.body,
      author: serializeUser(c.author_id) || { id: '', name: 'Unknown', email: '', avatar_url: null },
      is_internal: c.is_internal || false,
      edited_at: c.edited_at?.toISOString() || null,
      reactions: reactions_summary,
      attachments: (c.attachments || []).map((a: any) => ({
        file_id: a.file_id?.toString() || '',
        filename: a.filename,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        url: a.url,
      })),
      created_at: c.createdAt?.toISOString(),
      updated_at: c.updatedAt?.toISOString(),
    };
  });
  serialized.activity = historyResult.map((log: any) => ({
    id: log._id.toString(),
    action: log.action.split('.').pop() || log.action,
    field: log.changes?.[0]?.field || null,
    old_value: log.changes?.[0]?.old_value != null ? String(log.changes[0].old_value) : null,
    new_value: log.changes?.[0]?.new_value != null ? String(log.changes[0].new_value) : null,
    actor: {
      id: log.actor?.id || '',
      name: log.actor?.email || 'System',
      email: log.actor?.email || '',
      avatar_url: null,
    },
    created_at: log.timestamp?.toISOString(),
  }));

  // Hydrate linked ticket references so the UI can show keys and titles
  // instead of raw ObjectIds.
  const linkedIds = [
    ...(ticket.related_ids || []),
    ...(ticket.blocks_ids || []),
    ...(ticket.blocked_by_ids || []),
    ...(ticket.parent_id ? [ticket.parent_id] : []),
  ].map((x: any) => x.toString());
  const uniqueLinkedIds = [...new Set(linkedIds)];
  const linkedTickets: Record<string, any> = {};
  if (uniqueLinkedIds.length > 0) {
    const linked = await Ticket.find(
      { _id: { $in: uniqueLinkedIds }, tenant_id: req.tenantId },
      'number title status priority type project_id',
    )
      .populate('project_id', 'key')
      .lean();
    for (const lt of linked as any[]) {
      const prefix = (lt.project_id as any)?.key?.trim()
        ? (lt.project_id as any).key.trim().toUpperCase()
        : 'TK';
      linkedTickets[lt._id.toString()] = {
        id: lt._id.toString(),
        number: lt.number,
        key: `${prefix}-${String(lt.number).padStart(4, '0')}`,
        title: lt.title,
        status: lt.status,
        priority: lt.priority,
        type: lt.type,
      };
    }
  }
  serialized.linked_tickets = linkedTickets;

  res.json(serialized);
});

// PATCH /api/v1/tickets/:id
router.patch(
  '/:id',
  rbac('tickets:update'),
  auditMiddleware({
    action: 'ticket.update',
    resourceType: 'ticket',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const body = updateTicketSchema.parse(req.body);

    // Fetch pre-update state for SLA evaluation
    const priorTicket = await ticketService.getTicketById(req.tenantId, req.params.id as string);
    const priorAssignee = priorTicket.assignee_id?.toString() || null;
    const priorStatus = priorTicket.status;

    await ticketService.updateTicket(req.tenantId, req.params.id as string, body, req.roles);

    // SLA tracking on update
    const { Ticket } = await import('../models/ticket.model');
    const rawTicket = await Ticket.findOne({ _id: req.params.id, tenant_id: req.tenantId });
    if (rawTicket?.sla?.config_id) {
      const now = new Date();
      let changed = false;

      // First response: assignee set from null
      if (body.assignee_id && !priorAssignee && !rawTicket.sla.first_response_at) {
        rawTicket.sla.first_response_at = now;
        rawTicket.sla.response_met = rawTicket.sla.response_deadline
          ? now <= rawTicket.sla.response_deadline
          : null;
        changed = true;
      }

      // Resolution: status moves to resolved/closed terminal state
      if (body.status && ['resolved', 'closed'].includes(body.status) && rawTicket.sla.resolution_met === null) {
        rawTicket.sla.resolution_met = rawTicket.sla.resolution_deadline
          ? now <= rawTicket.sla.resolution_deadline
          : null;
        changed = true;
      }

      // Pause: status moves to waiting_on_customer
      if (body.status === 'waiting_on_customer' && priorStatus !== 'waiting_on_customer') {
        rawTicket.sla.paused_at = now;
        changed = true;
      }

      // Unpause: status moves FROM waiting_on_customer
      if (body.status && body.status !== 'waiting_on_customer' && priorStatus === 'waiting_on_customer' && rawTicket.sla.paused_at) {
        const pausedMs = now.getTime() - rawTicket.sla.paused_at.getTime();
        rawTicket.sla.paused_duration_ms = (rawTicket.sla.paused_duration_ms || 0) + pausedMs;
        rawTicket.sla.paused_at = null;

        // Extend deadlines: use business hours if SLA config has them
        let extensionMs = pausedMs;
        try {
          if (rawTicket.sla.config_id) {
            const slaConfig = await SlaConfig.findById(rawTicket.sla.config_id);
            if (slaConfig?.business_hours && slaConfig.business_hours.schedule.length > 0) {
              // Compute paused business minutes and convert back to calendar extension
              const pausedBizMinutes = computeElapsedBusinessMinutes(
                rawTicket.sla.paused_at || new Date(now.getTime() - pausedMs),
                now,
                slaConfig.business_hours,
              );
              // Extension = business minutes paused, applied as business hours forward from now
              // Re-compute deadlines by adding business minutes
              if (rawTicket.sla.response_deadline && rawTicket.sla.response_met === null) {
                rawTicket.sla.response_deadline = computeBusinessHoursDeadline(
                  rawTicket.sla.response_deadline,
                  pausedBizMinutes,
                  slaConfig.business_hours,
                );
              }
              if (rawTicket.sla.resolution_deadline && rawTicket.sla.resolution_met === null) {
                rawTicket.sla.resolution_deadline = computeBusinessHoursDeadline(
                  rawTicket.sla.resolution_deadline,
                  pausedBizMinutes,
                  slaConfig.business_hours,
                );
              }
              changed = true;
              // Skip the default calendar extension below
              extensionMs = 0;
            }
          }
        } catch { /* fall back to calendar extension */ }

        if (extensionMs > 0) {
          if (rawTicket.sla.response_deadline && rawTicket.sla.response_met === null) {
            rawTicket.sla.response_deadline = new Date(rawTicket.sla.response_deadline.getTime() + extensionMs);
          }
          if (rawTicket.sla.resolution_deadline && rawTicket.sla.resolution_met === null) {
            rawTicket.sla.resolution_deadline = new Date(rawTicket.sla.resolution_deadline.getTime() + extensionMs);
          }
        }
        changed = true;
      }

      if (changed) {
        await rawTicket.save({ validateModifiedOnly: true });
      }
    }

    // Re-fetch with populated fields
    const populated = await ticketService.getTicketById(req.tenantId, req.params.id as string);
    res.json(serializeTicket(populated));
  }
);

// DELETE /api/v1/tickets/:id
router.delete(
  '/:id',
  rbac('tickets:delete'),
  auditMiddleware({
    action: 'ticket.delete',
    resourceType: 'ticket',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    await ticketService.deleteTicket(req.tenantId, req.params.id as string);
    res.status(204).send();
  }
);


// --- Escalation ---

// POST /api/v1/tickets/:id/escalate
router.post(
  '/:id/escalate',
  rbac('tickets:update'),
  auditMiddleware({ action: 'ticket.escalate', resourceType: 'ticket', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const { ProviderConsumerLink } = await import('../models/provider-consumer-link.model');
    const link = await ProviderConsumerLink.findOne({ consumer_tenant_id: req.tenantId, status: 'active' });
    if (!link) {
      res.status(400).json({ detail: 'No provider relationship configured for this tenant.' });
      return;
    }

    const bridge = await ticketBridgeService.createTicketBridge(
      req.tenantId,
      new Types.ObjectId(req.params['id'] as string),
      link.provider_tenant_id,
      req.userId,
    );

    res.status(201).json({
      bridge_id: bridge._id.toString(),
      provider_ticket_id: bridge.provider_ticket_id.toString(),
      status: bridge.status,
      escalated_at: bridge.escalated_at.toISOString(),
    });
  }
);

// --- Comments ---

// GET /api/v1/tickets/:id/comments
router.get('/:id/comments', rbac('comments:read'), async (req: Request, res: Response) => {
  const comments = await TicketComment.find({
    ticket_id: req.params.id as string,
    tenant_id: req.tenantId,
  })
    .sort({ createdAt: 1 })
    .populate('author_id', 'name email avatar_url');

  // Filter internal comments for non-agents
  const isAgent = req.roles.some((r) =>
    ['platform_admin', 'tenant_admin', 'manager', 'agent'].includes(r)
  );

  const filtered = isAgent ? comments : comments.filter((c) => !c.is_internal);
  res.json({ data: filtered });
});

// POST /api/v1/tickets/:id/comments
router.post(
  '/:id/comments',
  rbac('comments:create'),
  auditMiddleware({
    action: 'comment.create',
    resourceType: 'ticket_comment',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const body = createCommentSchema.parse(req.body);

    const comment = await TicketComment.create({
      ticket_id: req.params.id as string,
      tenant_id: req.tenantId,
      author_id: req.userId,
      body: body.body,
      is_internal: body.is_internal || false,
      attachments: body.attachments || [],
    });

    // @mention notifications — parse @name or @email patterns from comment body
    (async () => {
      try {
        const mentionMatches = [...body.body.matchAll(/@([\w.+-]+)/g)].map((m) => m[1]);
        if (mentionMatches.length > 0) {
          const ticket = await Ticket.findOne({ _id: req.params.id, tenant_id: req.tenantId }).select('number title').lean();
          const author = await User.findById(req.userId).select('name').lean();
          const mentionedUsers = await User.find({
            tenant_id: req.tenantId,
            $or: [
              { name: { $in: mentionMatches.map((m) => new RegExp(`^${m}`, 'i')) } },
              { email: { $in: mentionMatches.map((m) => new RegExp(`^${m}`, 'i')) } },
            ],
          }).select('_id').lean();

          for (const u of mentionedUsers) {
            if (u._id.toString() === req.userId.toString()) continue; // don't notify self
            await createNotification({
              tenant_id:     req.tenantId as any,
              user_id:       u._id as any,
              type:          'comment_mention',
              title:         `${author?.name ?? 'Someone'} mentioned you`,
              body:          `In TK-${String(ticket?.number ?? 0).padStart(4, '0')} "${ticket?.title ?? ''}"`,
              resource_type: 'ticket',
              resource_id:   req.params.id as string,
            });
          }
        }
      } catch { /* best-effort */ }
    })();

    // Publish comment event to JetStream
    try {
      const js = getJetStream();
      const payload = {
        event: 'tickets.commented',
        tenant_id: req.tenantId.toString(),
        ticket_id: req.params.id,
        comment_id: comment._id.toString(),
        author_id: req.userId.toString(),
        is_internal: comment.is_internal,
        timestamp: new Date().toISOString(),
      };
      await js.publish('tickets.commented', sc.encode(JSON.stringify(payload)));
    } catch { /* best-effort event publishing */ }

    res.status(201).json(comment);
  }
);

// PATCH /api/v1/tickets/:ticketId/comments/:commentId
router.patch(
  '/:ticketId/comments/:commentId',
  rbac('comments:update'),
  async (req: Request, res: Response) => {
    const body = updateCommentSchema.parse(req.body);

    const comment = await TicketComment.findOne({
      _id: req.params.commentId as string,
      ticket_id: req.params.ticketId as string,
      tenant_id: req.tenantId,
    });

    if (!comment) {
      res.status(404).json({
        type: 'https://sreoncall.io/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'Comment not found.',
      });
      return;
    }

    // Only author or admin can edit
    const isAuthor = comment.author_id.toString() === req.userId.toString();
    const isAdmin = req.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r));
    if (!isAuthor && !isAdmin) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'Only the author or admin can edit this comment.',
      });
      return;
    }

    comment.body = body.body;
    comment.edited_at = new Date();
    await comment.save();

    res.json(comment);
  }
);

// DELETE /api/v1/tickets/:ticketId/comments/:commentId
router.delete(
  '/:ticketId/comments/:commentId',
  rbac('comments:delete'),
  async (req: Request, res: Response) => {
    const comment = await TicketComment.findOne({
      _id: req.params.commentId as string,
      ticket_id: req.params.ticketId as string,
      tenant_id: req.tenantId,
    });

    if (!comment) {
      res.status(404).json({
        type: 'https://sreoncall.io/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'Comment not found.',
      });
      return;
    }

    comment.deleted_at = new Date();
    await comment.save();

    res.status(204).send();
  }
);

// POST /api/v1/tickets/:ticketId/comments/:commentId/reactions
// Toggle: adds reaction if not present, removes if already reacted with same emoji
router.post(
  '/:ticketId/comments/:commentId/reactions',
  rbac('comments:create'),
  async (req: Request, res: Response) => {
    const { emoji } = req.body;
    if (!ALLOWED_REACTIONS.includes(emoji)) {
      res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: `Emoji must be one of: ${ALLOWED_REACTIONS.join(', ')}` });
      return;
    }

    const comment = await TicketComment.findOne({
      _id: req.params.commentId as string,
      ticket_id: req.params.ticketId as string,
      tenant_id: req.tenantId,
    });
    if (!comment) {
      res.status(404).json({ type: 'https://sreoncall.io/problems/not-found', title: 'Not Found', status: 404, detail: 'Comment not found.' });
      return;
    }

    const existing = await TicketCommentReaction.findOne({
      comment_id: comment._id,
      user_id:    req.userId,
      emoji,
      tenant_id:  req.tenantId,
    });

    if (existing) {
      await existing.deleteOne();
      res.json({ action: 'removed', emoji });
    } else {
      await TicketCommentReaction.create({
        tenant_id:  req.tenantId,
        comment_id: comment._id,
        user_id:    req.userId,
        emoji,
      });
      res.json({ action: 'added', emoji });
    }
  }
);

// --- History ---

// GET /api/v1/tickets/:id/history
router.get('/:id/history', rbac('tickets:read'), async (req: Request, res: Response) => {
  const logs = await auditService.getAuditLogsByResource(
    req.tenantId,
    'ticket',
    req.params.id as string,
    50
  );
  res.json({ data: logs });
});

// --- Attachments ---

// POST /api/v1/tickets/:id/attachments
router.post(
  '/:id/attachments',
  rbac('files:upload'),
  async (req: Request, res: Response) => {
    const body = uploadRequestSchema.parse(req.body);
    const result = await storageService.generateUploadUrl({
      tenant_id: req.tenantId,
      original_name: body.original_name,
      mime_type: body.mime_type,
      size_bytes: body.size_bytes,
      uploaded_by: req.userId,
      resource_type: 'ticket',
      resource_id: req.params.id as string,
    });
    res.status(201).json(result);
  }
);

// GET /api/v1/tickets/:id/attachments
router.get('/:id/attachments', rbac('files:read'), async (req: Request, res: Response) => {
  const files = await storageService.getFilesForResource(req.tenantId, 'ticket', req.params.id as string);
  res.json({ data: files });
});

// DELETE /api/v1/tickets/:id/attachments/:fileId
router.delete(
  '/:id/attachments/:fileId',
  rbac('files:upload'),
  async (req: Request, res: Response) => {
    await storageService.deleteFile(req.tenantId, req.params.fileId as string);
    res.status(204).send();
  }
);

// --- Links ---

const linkSchema = z.object({
  targetId: z.string().min(1),
  type: z.enum(['related', 'blocks', 'blocked_by', 'parent', 'child']),
});

// POST /api/v1/tickets/:id/link
router.post(
  '/:id/link',
  rbac('tickets:update'),
  auditMiddleware({ action: 'ticket.link', resourceType: 'ticket', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = linkSchema.parse(req.body);
    const ticket = await ticketService.linkTickets(
      req.tenantId,
      req.params['id'] as string,
      body.targetId,
      body.type
    );
    res.json(serializeTicket(ticket));
  }
);

// DELETE /api/v1/tickets/:id/link/:targetId
router.delete(
  '/:id/link/:targetId',
  rbac('tickets:update'),
  auditMiddleware({ action: 'ticket.unlink', resourceType: 'ticket', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    await ticketService.unlinkTickets(
      req.tenantId,
      req.params['id'] as string,
      req.params['targetId'] as string
    );
    res.status(204).send();
  }
);

// --- Work Logs ---

const workLogSchema = z.object({
  duration_minutes: z.number().int().min(1),
  description: z.string().max(5000).optional().default(''),
  logged_at: z.string().optional(),
  billable: z.boolean().optional().default(true),
});

// POST /api/v1/tickets/:id/work-logs
router.post(
  '/:id/work-logs',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    const body = workLogSchema.parse(req.body);
    const loggedAt = body.logged_at ? new Date(body.logged_at) : new Date();

    // Check auto-approve threshold
    let autoApproveStatus: 'pending' | 'approved' = 'pending';
    try {
      const wlSettings = await workLogSettingsService.getSettings(req.tenantId);
      if (wlSettings.auto_approve_threshold_minutes > 0 && body.duration_minutes <= wlSettings.auto_approve_threshold_minutes) {
        autoApproveStatus = 'approved';
      }
    } catch { /* default to pending */ }

    const log = await WorkLog.create({
      tenant_id: req.tenantId,
      entity_type: 'ticket',
      entity_id: req.params['id'],
      user_id: req.userId,
      duration_minutes: body.duration_minutes,
      description: body.description,
      logged_at: loggedAt,
      status: autoApproveStatus,
      billable: body.billable ?? true,
    });

    // Keep embedded ticket.work_logs and time_spent_minutes in sync, using the
    // same _id so the DELETE endpoint can find the entry in both stores.
    await Ticket.findOneAndUpdate(
      { _id: req.params['id'], tenant_id: req.tenantId },
      {
        $push: { work_logs: { _id: log._id, user_id: req.userId, minutes: body.duration_minutes, description: body.description, logged_at: loggedAt } },
        $inc: { time_spent_minutes: body.duration_minutes },
      }
    );

    // Bridge work log sync (best-effort, both directions)
    try {
      const { TicketBridge } = await import('../models/ticket-bridge.model');
      const js = getJetStream();
      const user = await User.findById(req.userId, 'name');
      const userName = (user as any)?.name || 'Unknown';
      const workLogPayload = {
        work_log_id: log._id.toString(),
        duration_minutes: log.duration_minutes,
        description: log.description,
        logged_at: log.logged_at.toISOString(),
        status: log.status,
        user_name: userName,
      };

      // Provider-side ticket → sync to consumer
      const bridgeAsProvider = await TicketBridge.findOne({
        provider_ticket_id: new Types.ObjectId(req.params['id'] as string),
        status: { $ne: 'closed' },
      });
      if (bridgeAsProvider) {
        await js.publish('bridges.sync.to_consumer', sc.encode(JSON.stringify({
          bridge_id: bridgeAsProvider._id.toString(),
          bridge_type: 'ticket',
          action: 'work_log_created',
          event_id: `wl-${log._id.toString()}`,
          data: workLogPayload,
        })));
      }

      // Consumer-side ticket → sync to provider
      const bridgeAsConsumer = await TicketBridge.findOne({
        consumer_ticket_id: new Types.ObjectId(req.params['id'] as string),
        status: { $ne: 'closed' },
      });
      if (bridgeAsConsumer) {
        await js.publish('bridges.sync.to_provider', sc.encode(JSON.stringify({
          bridge_id: bridgeAsConsumer._id.toString(),
          bridge_type: 'ticket',
          action: 'work_log_created',
          event_id: `wlp-${log._id.toString()}`,
          data: workLogPayload,
        })));
      }
    } catch { /* best-effort */ }

    // Notify designated work log approvers (skip if auto-approved)
    if (autoApproveStatus !== 'approved') {
      try {
        const ticket = await Ticket.findById(req.params['id'], 'number title project_id').lean();
        const approverIds = await workLogSettingsService.getApproversForTicket(req.tenantId, ticket?.project_id);
        const reporter = await User.findById(req.userId, 'name');
        const reporterName = (reporter as any)?.name || 'A team member';
        const ticketLabel = ticket ? `TKT-${String(ticket.number).padStart(4, '0')}` : 'a ticket';

        for (const approverId of approverIds) {
          if (approverId.equals(req.userId)) continue;
          await createNotification({
            tenant_id: req.tenantId,
            user_id: approverId,
            type: 'work_log.pending_approval',
            priority: 'info' as const,
            title: 'Work log pending approval',
            body: `${reporterName} logged ${body.duration_minutes} minutes on ${ticketLabel} "${ticket?.title || ''}". Review and approve it.`,
            resource_type: 'work_log_approval',
            resource_id: log._id.toString(),
          });
        }
      } catch { /* best-effort */ }
    }

    res.status(201).json({
      id: log._id.toString(),
      entity_type: log.entity_type,
      entity_id: log.entity_id.toString(),
      user_id: log.user_id.toString(),
      duration_minutes: log.duration_minutes,
      description: log.description,
      status: log.status,
      logged_at: log.logged_at.toISOString(),
      created_at: log.createdAt.toISOString(),
    });
  }
);

// GET /api/v1/tickets/:id/work-logs
router.get(
  '/:id/work-logs',
  rbac('tickets:read'),
  async (req: Request, res: Response) => {
    const logs = await WorkLog.find({
      tenant_id: req.tenantId,
      entity_type: 'ticket',
      entity_id: req.params['id'],
    })
      .sort({ logged_at: -1 })
      .populate('user_id', 'name email avatar_url');
    
    const total = logs.reduce((sum, l) => sum + l.duration_minutes, 0);
    res.json({
      data: logs.map((l: any) => ({
        id: l._id.toString(),
        user: l.user_id && typeof l.user_id === 'object' && l.user_id._id
          ? { id: l.user_id._id.toString(), name: l.user_id.name, email: l.user_id.email, avatar_url: l.user_id.avatar_url }
          : null,
        source: l.source || 'internal',
        source_user_name: l.source_user_name || null,
        duration_minutes: l.duration_minutes,
        description: l.description,
        status: l.status || 'pending',
        approved_by: l.approved_by?.toString() || null,
        approved_at: l.approved_at?.toISOString() || null,
        rejection_reason: l.rejection_reason || null,
        logged_at: l.logged_at?.toISOString(),
        created_at: l.createdAt?.toISOString(),
      })),
      total_minutes: total,
    });
  }
);

// DELETE /api/v1/tickets/:id/work-logs/:logId
router.delete(
  '/:id/work-logs/:logId',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    const log = await WorkLog.findOneAndDelete({
      _id: req.params['logId'],
      tenant_id: req.tenantId,
      entity_type: 'ticket',
      entity_id: req.params['id'],
    });
    if (!log) {
      res.status(404).json({ detail: 'Work log not found' });
      return;
    }

    // Keep embedded ticket.work_logs and time_spent_minutes in sync
    await Ticket.findOneAndUpdate(
      { _id: req.params['id'], tenant_id: req.tenantId },
      {
        $pull: { work_logs: { _id: log._id } },
        $inc: { time_spent_minutes: -log.duration_minutes },
      }
    );

    res.status(204).send();
  }
);

// PATCH /api/v1/tickets/:id/work-logs/:logId
const editWorkLogSchema = z.object({
  duration_minutes: z.number().int().min(1).optional(),
  description: z.string().max(5000).optional(),
  logged_at: z.string().datetime().optional(),
});

router.patch(
  '/:id/work-logs/:logId',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    const body = editWorkLogSchema.parse(req.body);

    const log = await WorkLog.findOne({
      _id: req.params['logId'],
      tenant_id: req.tenantId,
      entity_type: 'ticket',
      entity_id: req.params['id'],
    });
    if (!log) {
      res.status(404).json({ detail: 'Work log not found' });
      return;
    }

    const oldMinutes = log.duration_minutes;

    if (body.duration_minutes !== undefined) log.duration_minutes = body.duration_minutes;
    if (body.description !== undefined) log.description = body.description;
    if (body.logged_at !== undefined) log.logged_at = new Date(body.logged_at);
    await log.save();

    // Sync embedded work_log entry and recalculate time_spent_minutes
    const minuteDelta = log.duration_minutes - oldMinutes;
    await Ticket.findOneAndUpdate(
      { _id: req.params['id'], tenant_id: req.tenantId },
      {
        $set: { 'work_logs.$[entry].minutes': log.duration_minutes, 'work_logs.$[entry].description': log.description, 'work_logs.$[entry].logged_at': log.logged_at },
        $inc: { time_spent_minutes: minuteDelta },
      },
      { arrayFilters: [{ 'entry._id': log._id }] }
    );

    res.json({
      id: log._id.toString(),
      duration_minutes: log.duration_minutes,
      description: log.description,
      logged_at: log.logged_at.toISOString(),
      status: log.status,
    });
  }
);

// --- Children ---

// GET /api/v1/tickets/:id/children
router.get(
  '/:id/children',
  rbac('tickets:read'),
  async (req: Request, res: Response) => {
    const children = await ticketService.getChildTickets(req.tenantId, req.params['id'] as string);
    res.json({ data: children.map(serializeTicket) });
  }
);

// --- Cross-entity links ---

// POST /api/v1/tickets/:id/link-incident
router.post(
  '/:id/link-incident',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    const { incident_id } = z.object({ incident_id: z.string().min(1) }).parse(req.body);
    await ticketService.linkIncident(req.tenantId, req.params['id'] as string, incident_id);
    const ticket = await ticketService.getTicketById(req.tenantId, req.params['id'] as string);
    res.json(serializeTicket(ticket));
  }
);

// DELETE /api/v1/tickets/:id/link-incident/:incidentId
router.delete(
  '/:id/link-incident/:incidentId',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    await ticketService.unlinkIncident(
      req.tenantId,
      req.params['id'] as string,
      req.params['incidentId'] as string,
    );
    res.status(204).send();
  }
);

// POST /api/v1/tickets/:id/link-change-request
router.post(
  '/:id/link-change-request',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    const { change_request_id } = z.object({ change_request_id: z.string().min(1) }).parse(req.body);
    await ticketService.linkChangeRequest(req.tenantId, req.params['id'] as string, change_request_id);
    const ticket = await ticketService.getTicketById(req.tenantId, req.params['id'] as string);
    res.json(serializeTicket(ticket));
  }
);

// DELETE /api/v1/tickets/:id/link-change-request/:changeRequestId
router.delete(
  '/:id/link-change-request/:changeRequestId',
  rbac('tickets:update'),
  async (req: Request, res: Response) => {
    await ticketService.unlinkChangeRequest(
      req.tenantId,
      req.params['id'] as string,
      req.params['changeRequestId'] as string,
    );
    res.status(204).send();
  }
);

// ─── Analytics ────────────────────────────────────────────────────────────────

// GET /api/v1/tickets/analytics/cycle-time
router.get('/analytics/cycle-time', rbac('tickets:read'), async (req: Request, res: Response) => {
  const days       = Math.min(parseInt(req.query.days as string) || 30, 365);
  const since      = new Date(Date.now() - days * 86400000);
  const project_id = req.query.project_id as string | undefined;

  const match: Record<string, any> = {
    tenant_id: req.tenantId,
    resolved_at: { $gte: since, $ne: null },
  };
  if (project_id) match.project_id = new Types.ObjectId(project_id);

  const tickets = await Ticket.find(match, { resolved_at: 1, createdAt: 1, type: 1 }).lean();
  if (tickets.length === 0) return res.json({ avg_days: 0, median_days: 0, p75_days: 0, p95_days: 0, sample_size: 0, by_type: {}, trend: [] });

  const cycleDays = tickets.map((t) => (t.resolved_at!.getTime() - t.createdAt.getTime()) / 86400000).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)] ?? arr[arr.length - 1];
  const avg = cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length;

  const by_type: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const t of tickets) {
    const d = (t.resolved_at!.getTime() - t.createdAt.getTime()) / 86400000;
    by_type[t.type]    = (by_type[t.type]    || 0) + d;
    typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
  }
  for (const k of Object.keys(by_type)) by_type[k] = Math.round((by_type[k] / typeCounts[k]) * 10) / 10;

  const weekMap = new Map<string, number[]>();
  for (const t of tickets) {
    const d    = new Date(t.resolved_at!);
    const week = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)).padStart(2, '0')}`;
    const days2 = (t.resolved_at!.getTime() - t.createdAt.getTime()) / 86400000;
    if (!weekMap.has(week)) weekMap.set(week, []);
    weekMap.get(week)!.push(days2);
  }
  const trend = Array.from(weekMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([week, vals]) => ({
    week, avg_days: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, count: vals.length,
  }));

  res.json({ avg_days: Math.round(avg * 10) / 10, median_days: Math.round(pct(cycleDays, 50) * 10) / 10, p75_days: Math.round(pct(cycleDays, 75) * 10) / 10, p95_days: Math.round(pct(cycleDays, 95) * 10) / 10, sample_size: cycleDays.length, by_type, trend });
});

// GET /api/v1/tickets/analytics/workload — open ticket count per assignee
router.get('/analytics/workload', rbac('tickets:read'), async (req: Request, res: Response) => {
  const rows = await Ticket.aggregate([
    { $match: { tenant_id: req.tenantId, deleted_at: null, status: { $nin: ['resolved', 'closed', 'done'] }, assignee_id: { $ne: null } } },
    { $group: { _id: '$assignee_id', count: { $sum: 1 } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { assignee_id: '$_id', name: { $ifNull: ['$user.name', 'Unknown'] }, count: 1, _id: 0 } },
    { $sort: { count: -1 } },
  ]);
  res.json({ data: rows });
});

// GET /api/v1/tickets/analytics/status-distribution
router.get('/analytics/status-distribution', rbac('tickets:read'), async (req: Request, res: Response) => {
  const rows = await Ticket.aggregate([
    { $match: { tenant_id: req.tenantId, deleted_at: null } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $project: { status: '$_id', count: 1, _id: 0 } },
    { $sort: { count: -1 } },
  ]);
  res.json({ data: rows });
});

// GET /api/v1/tickets/analytics/throughput — completed tickets per week
router.get('/analytics/throughput', rbac('tickets:read'), async (req: Request, res: Response) => {
  const weeks = Math.min(parseInt(req.query.weeks as string) || 12, 52);
  const since = new Date(Date.now() - weeks * 7 * 86400000);
  const tickets = await Ticket.find({ tenant_id: req.tenantId, resolved_at: { $gte: since, $ne: null } }, { resolved_at: 1 }).lean();

  const weekMap = new Map<string, number>();
  for (const t of tickets) {
    const d    = new Date(t.resolved_at!);
    const week = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)).padStart(2, '0')}`;
    weekMap.set(week, (weekMap.get(week) || 0) + 1);
  }
  const data = Array.from(weekMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count }));
  res.json({ data, total: tickets.length });
});

// ─── Timesheet ────────────────────────────────────────────────────────────────

// GET /api/v1/tickets/work-logs/timesheet
// Returns work logs grouped by user, optionally filtered by date range and user
router.get('/work-logs/timesheet', rbac('tickets:read'), async (req: Request, res: Response) => {
  const { from, until, user_id } = req.query;
  const query: Record<string, any> = { tenant_id: req.tenantId, entity_type: 'ticket' };
  if (from)    query.logged_at = { ...query.logged_at, $gte: new Date(from as string) };
  if (until)   query.logged_at = { ...query.logged_at, $lte: new Date(until as string) };
  if (user_id) query.user_id   = new Types.ObjectId(user_id as string);

  const logs = await WorkLog.find(query)
    .sort({ logged_at: -1 })
    .populate('user_id', 'name email avatar_url')
    .lean();

  // Group by user
  const byUser = new Map<string, { user: any; total_minutes: number; billable_minutes: number; entries: any[] }>();
  for (const log of logs) {
    const uid   = log.user_id?._id?.toString() || log.user_id?.toString() || 'unknown';
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        user:             log.user_id && typeof log.user_id === 'object' && (log.user_id as any)._id
          ? { id: (log.user_id as any)._id.toString(), name: (log.user_id as any).name, email: (log.user_id as any).email, avatar_url: (log.user_id as any).avatar_url }
          : { id: uid, name: null, email: null, avatar_url: null },
        total_minutes:    0,
        billable_minutes: 0,
        entries:          [],
      });
    }
    const entry = byUser.get(uid)!;
    entry.total_minutes    += log.duration_minutes;
    entry.billable_minutes += (log as any).billable !== false ? log.duration_minutes : 0;
    entry.entries.push({
      id: log._id.toString(), entity_id: log.entity_id?.toString(), duration_minutes: log.duration_minutes,
      billable: (log as any).billable ?? true, description: log.description, logged_at: log.logged_at?.toISOString(),
    });
  }

  res.json({ data: Array.from(byUser.values()) });
});

export default router;
