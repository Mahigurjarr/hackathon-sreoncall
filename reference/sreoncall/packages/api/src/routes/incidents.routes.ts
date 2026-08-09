import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as incidentService from '../services/incident.service';
import * as postmortemService from '../services/postmortem.service';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit, requirePlanFeature } from '../middleware/planLimit.middleware';
import { parsePaginationParams } from '../utils/pagination';
import { UsageRecord } from '../models/billing.model';
import { Types } from 'mongoose';
import { WorkLog } from '../models/work-log.model';
import { User } from '../models/user.model';
import { Ticket } from '../models/ticket.model';
import commandCenterRoutes from './command-center.routes';
import resolutionRoutes from './resolution.routes';
import stakeholderUpdatesRoutes from './stakeholder-updates.routes';
import { publishAgentTrigger } from '../services/agent-trigger.service';

const router = Router();

// ─── Serializers ──────────────────────────────────────────────────────────────

function sevLabel(s: number) {
  return `SEV${s}`;
}

function serializeUser(u: any) {
  if (!u || typeof u === 'string' || u._bsontype === 'ObjectId') return null;
  return { id: u._id?.toString(), name: u.name || null, email: u.email || null, avatar_url: u.avatar_url || null };
}

function serializeIncident(inc: any) {
  return {
    id: inc._id.toString(),
    number: inc.number,
    title: inc.title,
    description: inc.description || '',
    severity: inc.severity,
    severity_label: sevLabel(inc.severity),
    status: inc.status,
    type: inc.type || 'other',
    source: inc.source,
    labels: inc.labels || [],
    commander: serializeUser(inc.commander_id),
    comms_lead: serializeUser(inc.comms_lead_id),
    operations_lead: serializeUser(inc.operations_lead_id),
    created_by: serializeUser(inc.created_by),
    responders: (inc.responders || []).map((r: any) => ({
      user: serializeUser(r.user_id) || { id: r.user_id?.toString(), name: null, email: null, avatar_url: null },
      role: r.role,
      joined_at: r.joined_at?.toISOString(),
      left_at: r.left_at?.toISOString() || null,
    })),
    metrics: {
      ack_at: inc.metrics?.ack_at?.toISOString() || null,
      resolved_at: inc.metrics?.resolved_at?.toISOString() || null,
      closed_at: inc.metrics?.closed_at?.toISOString() || null,
      mtta_seconds: inc.metrics?.mtta_seconds ?? null,
      mttr_seconds: inc.metrics?.mttr_seconds ?? null,
    },
    postmortem_id: inc.postmortem_id?.toString() || null,
    war_room_channel_id: inc.war_room_channel_id?.toString() || null,
    escalation_policy_id: inc.escalation_policy_id?.toString() || null,
    linked_ticket_ids: (inc.linked_ticket_ids || []).map((id: any) => id.toString()),
    affected_service_ids: (inc.affected_service_ids || []).map((s: any) =>
      s && typeof s === 'object' && s._id ? s._id.toString() : s.toString(),
    ),
    affected_services: (inc.affected_service_ids || [])
      .filter((s: any) => s && typeof s === 'object' && s.name)
      .map((s: any) => ({
        id: s._id?.toString(),
        name: s.name,
        type: s.type,
        current_status: s.current_status,
        cloud_metadata: s.cloud_metadata
          ? {
              provider: s.cloud_metadata.provider || null,
              resource_type: s.cloud_metadata.resource_type || null,
              cloud_id: s.cloud_metadata.cloud_id || null,
              region: s.cloud_metadata.region || null,
            }
          : null,
      })),
    source_alert_id: inc.source_alert_id && typeof inc.source_alert_id === 'object' && (inc.source_alert_id as any)._id
      ? (inc.source_alert_id as any)._id.toString()
      : (inc.source_alert_id?.toString?.() || null),
    source_alert: inc.source_alert_id && typeof inc.source_alert_id === 'object' && (inc.source_alert_id as any).name
      ? {
          id: (inc.source_alert_id as any)._id?.toString(),
          name: (inc.source_alert_id as any).name,
          severity: (inc.source_alert_id as any).severity,
          source_type: (inc.source_alert_id as any).source_type,
          query: (inc.source_alert_id as any).query,
          alert_state: (inc.source_alert_id as any).alert_state,
          last_firing_labels: (inc.source_alert_id as any).last_firing_labels ?? null,
        }
      : null,
    source_synthetic_check: inc.source_synthetic_check_id && typeof inc.source_synthetic_check_id === 'object' && (inc.source_synthetic_check_id as any).name
      ? {
          id: (inc.source_synthetic_check_id as any)._id?.toString(),
          name: (inc.source_synthetic_check_id as any).name,
          check_type: (inc.source_synthetic_check_id as any).check_type,
          url: (inc.source_synthetic_check_id as any).http_check?.url ?? null,
          host: (inc.source_synthetic_check_id as any).tcp_check?.host
            ?? (inc.source_synthetic_check_id as any).dns_check?.hostname
            ?? null,
          last_status: (inc.source_synthetic_check_id as any).last_status ?? null,
        }
      : null,
    resource_labels: (inc.labels || [])
      .filter((l: string) => l.includes(':') && l !== 'escalated' && l !== 'consumer-bridge')
      .map((l: string) => {
        const idx = l.indexOf(':');
        return { key: l.slice(0, idx), value: l.slice(idx + 1) };
      }),
    resolved_at: inc.resolved_at?.toISOString() || null,
    closed_at: inc.closed_at?.toISOString() || null,
    created_at: inc.createdAt?.toISOString() || null,
    updated_at: inc.updatedAt?.toISOString() || null,
    custom_fields: inc.custom_fields
      ? (inc.custom_fields instanceof Map
        ? Object.fromEntries(inc.custom_fields)
        : inc.custom_fields)
      : {},
  };
}

const SYSTEM_ACTOR_ID = '000000000000000000000000';

function serializeTimeline(entries: any[], actorMap: Map<string, any> = new Map()) {
  return entries.map((e) => {
    const actorId = e.actor_id?.toString() || null;
    let actor: { id: string; name: string | null; email: string | null; avatar_url: string | null } | null = null;
    if (actorId === SYSTEM_ACTOR_ID) {
      actor = { id: SYSTEM_ACTOR_ID, name: 'System', email: null, avatar_url: null };
    } else if (actorId) {
      const u = actorMap.get(actorId);
      actor = { id: actorId, name: u?.name ?? null, email: u?.email ?? null, avatar_url: u?.avatar_url ?? null };
    }
    return {
      id: e._id?.toString(),
      type: e.type,
      timestamp: e.timestamp?.toISOString(),
      actor,
      message: e.message,
      metadata: e.metadata || {},
    };
  });
}

// ─── Validation schemas ────────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  severity: z.number().int().min(1).max(5).optional(),
  type: z.enum(['reliability', 'performance', 'security', 'availability', 'other']).optional(),
  source: z.enum(['manual', 'alert', 'webhook', 'ai']).optional(),
  labels: z.array(z.string()).optional(),
  escalation_policy_id: z.string().optional(),
  affected_service_ids: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50000).optional(),
  labels: z.array(z.string()).optional(),
  commander_id: z.string().nullable().optional(),
  comms_lead_id: z.string().nullable().optional(),
  operations_lead_id: z.string().nullable().optional(),
  escalation_policy_id: z.string().nullable().optional(),
  affected_service_ids: z.array(z.string()).optional(),
});

const resolveSchema = z.object({ message: z.string().optional() });

const severitySchema = z.object({
  severity: z.number().int().min(1).max(5),
  reason: z.string().optional(),
});

const escalateSchema = z.object({
  reason: z.string().optional(),
  escalation_policy_id: z.string().optional(),
});

const addResponderSchema = z.object({
  user_id: z.string().min(1),
  role: z.string().optional().default('responder'),
});

const timelinePostSchema = z.object({
  message: z.string().min(1),
  type: z.enum([
    'note', 'alert', 'ai_insight', 'runbook_started', 'runbook_step',
    'escalation', 'comms_sent',
  ]).optional().default('note'),
  metadata: z.record(z.unknown()).optional(),
});

const bulkActionSchema = z.object({
  incident_ids: z.array(z.string()).min(1).max(100),
  action: z.enum(['acknowledge', 'resolve', 'close']),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/v1/incidents
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await incidentService.listIncidents(
    {
      tenant_id: req.tenantId,
      status: req.query.status as string | undefined,
      severity: req.query.severity ? Number(req.query.severity) : undefined,
      labels: req.query.labels ? (req.query.labels as string).split(',') : undefined,
      search: req.query.search as string | undefined,
      source_consumer_tenant_id: req.query.source_consumer_tenant_id as string | undefined,
    },
    pagination
  );
  res.json({ data: result.data.map(serializeIncident), pagination: result.pagination });
});

// POST /api/v1/incidents
router.post(
  '/',
  rbac('incidents:create'),
  requirePlanLimit('max_incidents_per_month', async (req) => {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rec = await UsageRecord.findOne({ tenant_id: req.tenantId, period }).lean();
    return rec?.incidents ?? 0;
  }),
  auditMiddleware({ action: 'incident.create', resourceType: 'incident' }),
  async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const inc = await incidentService.createIncident({
      ...body,
      tenant_id: req.tenantId,
      created_by: req.userId,
    });
    const populated = await incidentService.getIncidentById(req.tenantId, inc._id.toString());
    res.status(201).json(serializeIncident(populated));
  }
);

// POST /api/v1/incidents/bulk
router.post(
  '/bulk',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.bulk_action', resourceType: 'incident' }),
  async (req: Request, res: Response) => {
    const body = bulkActionSchema.parse(req.body);
    const results = await Promise.allSettled(
      body.incident_ids.map(async (id) => {
        switch (body.action) {
          case 'acknowledge':
            await incidentService.acknowledgeIncident(req.tenantId, id, req.userId);
            break;
          case 'resolve':
            await incidentService.resolveIncident(req.tenantId, id, req.userId);
            break;
          case 'close':
            await incidentService.closeIncident(req.tenantId, id, req.userId);
            break;
        }
      })
    );

    const errors: string[] = [];
    let success = 0;
    let failed = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        success++;
      } else {
        failed++;
        errors.push(`${body.incident_ids[i]}: ${r.reason?.message || 'Unknown error'}`);
      }
    }

    res.json({ success, failed, errors });
  }
);

// GET /api/v1/incidents/:id/similar — find similar past incidents
router.get('/:id/similar', rbac('incidents:read'), async (req: Request, res: Response) => {
  const similar = await incidentService.findSimilar(req.tenantId, req.params['id'] as string);
  res.json({ data: similar.map(serializeIncident) });
});

// GET /api/v1/incidents/:id
router.get('/:id', rbac('incidents:read'), async (req: Request, res: Response) => {
  const inc = await incidentService.getIncidentById(req.tenantId, req.params['id'] as string);
  const serialized = serializeIncident(inc);

  const linkedTicketDocs = (inc.linked_ticket_ids || []).length
    ? await Ticket.find({ _id: { $in: inc.linked_ticket_ids }, tenant_id: req.tenantId })
        .select('number title status priority')
        .lean()
    : [];

  res.json({
    ...serialized,
    linked_tickets: (linkedTicketDocs as any[]).map((t) => ({
      id: t._id.toString(),
      number: t.number,
      title: t.title,
      status: t.status,
      priority: t.priority,
    })),
  });
});

// PATCH /api/v1/incidents/:id
router.patch(
  '/:id',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.update', resourceType: 'incident', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);
    const inc = await incidentService.updateIncident(req.tenantId, req.params['id'] as string, body);
    res.json(serializeIncident(inc));
  }
);

// POST /api/v1/incidents/:id/acknowledge
router.post(
  '/:id/acknowledge',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.acknowledge', resourceType: 'incident', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const inc = await incidentService.acknowledgeIncident(
      req.tenantId,
      req.params['id'] as string,
      req.userId
    );
    res.json(serializeIncident(inc));
  }
);

// POST /api/v1/incidents/:id/resolve
router.post(
  '/:id/resolve',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.resolve', resourceType: 'incident', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = resolveSchema.parse(req.body);
    const inc = await incidentService.resolveIncident(
      req.tenantId,
      req.params['id'] as string,
      req.userId,
      body.message
    );
    res.json(serializeIncident(inc));
  }
);

// POST /api/v1/incidents/:id/close
router.post(
  '/:id/close',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.close', resourceType: 'incident', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const inc = await incidentService.closeIncident(
      req.tenantId,
      req.params['id'] as string,
      req.userId
    );
    res.json(serializeIncident(inc));
  }
);

// POST /api/v1/incidents/:id/severity
router.post(
  '/:id/severity',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.severity_change', resourceType: 'incident', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = severitySchema.parse(req.body);
    const inc = await incidentService.changeSeverity(
      req.tenantId,
      req.params['id'] as string,
      body.severity,
      req.userId,
      body.reason
    );
    res.json(serializeIncident(inc));
  }
);

// POST /api/v1/incidents/:id/escalate
router.post(
  '/:id/escalate',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident.escalate', resourceType: 'incident', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = escalateSchema.parse(req.body);
    const inc = await incidentService.escalateIncident(
      req.tenantId,
      req.params['id'] as string,
      req.userId,
      body.reason,
      body.escalation_policy_id
    );
    res.json(serializeIncident(inc));
  }
);

// POST /api/v1/incidents/:id/responders
router.post(
  '/:id/responders',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const body = addResponderSchema.parse(req.body);
    const inc = await incidentService.addResponder(
      req.tenantId,
      req.params['id'] as string,
      body.user_id,
      body.role,
      req.userId
    );
    res.json(serializeIncident(inc));
  }
);

// DELETE /api/v1/incidents/:id/responders/:userId
router.delete(
  '/:id/responders/:userId',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const inc = await incidentService.removeResponder(
      req.tenantId,
      req.params['id'] as string,
      req.params['userId'] as string
    );
    res.json(serializeIncident(inc));
  }
);

// GET /api/v1/incidents/:id/timeline
router.get('/:id/timeline', rbac('incidents:read'), async (req: Request, res: Response) => {
  const entries = await incidentService.getTimeline(req.tenantId, req.params['id'] as string);
  const actorIds = [...new Set(
    entries.map((e) => e.actor_id?.toString()).filter((id): id is string => !!id && id !== SYSTEM_ACTOR_ID)
  )];
  const users = actorIds.length
    ? await User.find({ _id: { $in: actorIds } }).select('name email avatar_url').lean()
    : [];
  const actorMap = new Map((users as any[]).map((u) => [u._id.toString(), u]));
  res.json({ data: serializeTimeline(entries, actorMap) });
});

// POST /api/v1/incidents/:id/timeline
router.post(
  '/:id/timeline',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const body = timelinePostSchema.parse(req.body);
    const inc = await incidentService.addTimelineEntry(
      req.tenantId,
      req.params['id'] as string,
      req.userId,
      body.message,
      body.type,
      body.metadata
    );
    const timeline = inc.timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const postActorIds = [...new Set(
      timeline.map((e) => e.actor_id?.toString()).filter((id): id is string => !!id && id !== SYSTEM_ACTOR_ID)
    )];
    const postUsers = postActorIds.length
      ? await User.find({ _id: { $in: postActorIds } }).select('name email avatar_url').lean()
      : [];
    const postActorMap = new Map((postUsers as any[]).map((u) => [u._id.toString(), u]));
    res.status(201).json({ data: serializeTimeline(timeline, postActorMap) });
  }
);

// GET /api/v1/incidents/:id/ai/analysis
router.get('/:id/ai/analysis', rbac('incidents:read'), async (req: Request, res: Response) => {
  const inc = await incidentService.getIncidentById(req.tenantId, req.params['id'] as string);
  const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
  const isStale = !inc.ai?.last_analyzed_at ||
    (Date.now() - inc.ai.last_analyzed_at.getTime()) > STALE_THRESHOLD_MS;
  res.json({
    root_cause: inc.ai?.root_cause || null,
    confidence: inc.ai?.confidence || null,
    recommended_runbook_ids: (inc.ai?.recommended_runbook_ids || []).map((id) => id.toString()),
    last_analyzed_at: inc.ai?.last_analyzed_at?.toISOString() || null,
    is_stale: isStale,
    severity_label: sevLabel(inc.severity),
    status: inc.status,
  });
});

// POST /api/v1/incidents/:id/ai/analyze — on-demand re-trigger of AI triage + RCA agents
router.post(
  '/:id/ai/analyze',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const incidentId = req.params['id'] as string;
    const inc = await incidentService.getIncidentById(req.tenantId, incidentId);
    const tenantId = req.tenantId.toString();
    const iId = inc._id.toString();

    publishAgentTrigger('incident-triage', { type: 'event', event_type: 'incident.analyze_requested', source_id: iId }, tenantId).catch(() => {});
    publishAgentTrigger('rca-agent', { type: 'event', event_type: 'incident.analyze_requested', source_id: iId }, tenantId).catch(() => {});
    publishAgentTrigger('runbook-automation', { type: 'event', event_type: 'incident.analyze_requested', source_id: iId }, tenantId).catch(() => {});

    res.json({ queued: true, incident_id: iId });
  }
);

// POST /api/v1/incidents/:id/postmortem  → create & link
router.post(
  '/:id/postmortem',
  rbac('postmortems:create'),
  async (req: Request, res: Response) => {
    const inc = await incidentService.getIncidentById(req.tenantId, req.params['id'] as string);
    if (inc.postmortem_id) {
      res.status(409).json({
        type: 'https://sreoncall.io/problems/conflict',
        title: 'Conflict',
        status: 409,
        detail: 'Postmortem already exists for this incident',
      });
      return;
    }

    const sevMap: Record<number, 'critical' | 'high' | 'medium' | 'low'> = {
      1: 'critical', 2: 'high', 3: 'medium', 4: 'low', 5: 'low',
    };
    const pm = await postmortemService.createPostmortem({
      tenant_id: req.tenantId,
      incident_id: inc._id.toString(),
      author_id: req.userId,
      title: `Post-Mortem: ${inc.title}`,
      severity: sevMap[inc.severity as number] || 'medium',
    });

    await incidentService.linkPostmortem(req.tenantId, req.params['id'] as string, pm._id.toString());

    res.status(201).json({ postmortem_id: pm._id.toString() });
  }
);

// GET /api/v1/incidents/:id/postmortem
router.get('/:id/postmortem', rbac('postmortems:read'), async (req: Request, res: Response) => {
  const inc = await incidentService.getIncidentById(req.tenantId, req.params['id'] as string);
  if (!inc.postmortem_id) {
    res.status(404).json({ type: 'https://sreoncall.io/problems/not-found', title: 'Not Found', status: 404, detail: 'No postmortem linked to this incident' });
    return;
  }
  const pm = await postmortemService.getPostmortemById(req.tenantId, inc.postmortem_id.toString());
  res.json(pm);
});

// --- Postmortem Action Item → Ticket ---

// POST /api/v1/incidents/:id/postmortem/action-items/:itemIndex/create-ticket
router.post(
  '/:id/postmortem/action-items/:itemIndex/create-ticket',
  rbac('postmortems:update'),
  auditMiddleware({ action: 'postmortem.create_ticket', resourceType: 'postmortem', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const inc = await incidentService.getIncidentById(req.tenantId, req.params['id'] as string);
    if (!inc.postmortem_id) {
      res.status(404).json({
        type: 'https://sreoncall.io/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'No postmortem linked to this incident',
      });
      return;
    }

    const itemIndex = parseInt(req.params['itemIndex'] as string, 10);
    if (isNaN(itemIndex) || itemIndex < 0) {
      res.status(400).json({
        type: 'https://sreoncall.io/problems/bad-request',
        title: 'Bad Request',
        status: 400,
        detail: 'Invalid action item index',
      });
      return;
    }

    const ticket = await postmortemService.createTicketFromActionItem(
      req.tenantId,
      inc.postmortem_id.toString(),
      itemIndex,
      req.userId
    );

    res.status(201).json({
      id: ticket._id.toString(),
      number: ticket.number,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      assignee_id: ticket.assignee_id?.toString() || null,
      labels: ticket.labels,
    });
  }
);

// POST /api/v1/incidents/:id/postmortem/create-all-tickets
router.post(
  '/:id/postmortem/create-all-tickets',
  rbac('postmortems:update'),
  auditMiddleware({ action: 'postmortem.create_all_tickets', resourceType: 'postmortem', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const inc = await incidentService.getIncidentById(req.tenantId, req.params['id'] as string);
    if (!inc.postmortem_id) {
      res.status(404).json({
        type: 'https://sreoncall.io/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'No postmortem linked to this incident',
      });
      return;
    }

    const tickets = await postmortemService.createTicketsFromAllActionItems(
      req.tenantId,
      inc.postmortem_id.toString(),
      req.userId
    );

    res.status(201).json({
      created: tickets.length,
      tickets: tickets.map((t) => ({
        id: t._id.toString(),
        number: t.number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee_id: t.assignee_id?.toString() || null,
        labels: t.labels,
      })),
    });
  }
);

// --- Work Logs ---

const workLogSchema = z.object({
  duration_minutes: z.number().int().min(1),
  description: z.string().max(5000).optional().default(''),
  logged_at: z.string().optional(),
});

// POST /api/v1/incidents/:id/work-logs
router.post(
  '/:id/work-logs',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const body = workLogSchema.parse(req.body);
    const log = await WorkLog.create({
      tenant_id: req.tenantId,
      entity_type: 'incident',
      entity_id: req.params['id'],
      user_id: req.userId,
      duration_minutes: body.duration_minutes,
      description: body.description,
      logged_at: body.logged_at ? new Date(body.logged_at) : new Date(),
    });
    res.status(201).json({
      id: log._id.toString(),
      entity_type: log.entity_type,
      entity_id: log.entity_id.toString(),
      user_id: log.user_id.toString(),
      duration_minutes: log.duration_minutes,
      description: log.description,
      logged_at: log.logged_at.toISOString(),
      created_at: log.createdAt.toISOString(),
    });
  }
);

// GET /api/v1/incidents/:id/work-logs
router.get(
  '/:id/work-logs',
  rbac('incidents:read'),
  async (req: Request, res: Response) => {
    const logs = await WorkLog.find({
      tenant_id: req.tenantId,
      entity_type: 'incident',
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
        duration_minutes: l.duration_minutes,
        description: l.description,
        logged_at: l.logged_at?.toISOString(),
        created_at: l.createdAt?.toISOString(),
      })),
      total_minutes: total,
    });
  }
);

// DELETE /api/v1/incidents/:id/work-logs/:logId
router.delete(
  '/:id/work-logs/:logId',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const log = await WorkLog.findOneAndDelete({
      _id: req.params['logId'],
      tenant_id: req.tenantId,
      entity_type: 'incident',
      entity_id: req.params['id'],
    });
    if (!log) {
      res.status(404).json({ detail: 'Work log not found' });
      return;
    }
    res.status(204).send();
  }
);

// --- Command Center (ICC) sub-routes ---
router.use('/:id/command-center', requirePlanFeature('icc_enabled'), commandCenterRoutes);
router.use('/:id/resolution', requirePlanFeature('guided_resolution_enabled'), resolutionRoutes);
router.use('/:id/stakeholder-updates', requirePlanFeature('icc_enabled'), stakeholderUpdatesRoutes);

export default router;
