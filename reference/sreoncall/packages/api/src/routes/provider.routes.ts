import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import * as providerService from '../services/provider.service';
import * as slaService from '../services/provider/sla-tracking.service';
import * as ticketService from '../services/ticket.service';
import * as ticketBridgeService from '../services/ticket-bridge.service';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Project } from '../models/project.model';
import { Tenant } from '../models/tenant.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { parsePaginationParams } from '../utils/pagination';
import { logger } from '../utils/logger';

const router = Router();

// All provider routes require tenant to be type 'provider'
router.use(requireTenantType('provider'));

// GET /provider/consumers/:consumerId/oncall-schedules — fetch consumer's schedules for L3 config
router.get('/consumers/:consumerId/oncall-schedules', rbac('tenants:read'), async (req: Request, res: Response) => {
  const link = await ProviderConsumerLink.findOne({
    provider_tenant_id: req.tenantId,
    consumer_tenant_id: req.params['consumerId'],
    status: 'active',
  });
  if (!link) {
    res.status(403).json({ detail: 'No active link with this consumer' });
    return;
  }
  const schedules = await OnCallSchedule.find(
    { tenant_id: link.consumer_tenant_id, enabled: true },
    '_id name timezone members_count'
  ).lean();
  res.json({
    data: schedules.map((s: any) => ({
      id: s._id.toString(),
      name: s.name,
      timezone: s.timezone,
    })),
  });
});

// GET /provider/consumers
router.get('/consumers', rbac('tenants:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getLinkedConsumers(req.tenantId, pagination);

  res.json({
    data: result.data.map((link: any) => ({
      _id: link._id.toString(),
      consumer: link.consumer_tenant_id?._id ? {
        _id: link.consumer_tenant_id._id.toString(),
        slug: link.consumer_tenant_id.slug,
        name: link.consumer_tenant_id.name,
        type: link.consumer_tenant_id.type,
        status: link.consumer_tenant_id.status,
        plan: link.consumer_tenant_id.plan,
      } : null,
      scope: link.scope,
      status: link.status,
      createdAt: link.createdAt?.toISOString?.() || link.createdAt,
    })),
    pagination: result.pagination,
  });
});

// GET /provider/consumers/all/incidents — all consumers
router.get('/consumers/all/incidents', rbac('incidents:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getConsumerIncidents(req.tenantId, undefined, pagination);

  res.json({
    data: result.data.map((inc: any) => ({
      _id: inc._id.toString(),
      number: inc.number,
      title: inc.title,
      severity: inc.severity,
      status: inc.status,
      tenant_id: inc.tenant_id.toString(),
      createdAt: inc.createdAt?.toISOString?.() || inc.createdAt,
    })),
    pagination: result.pagination,
  });
});

// GET /provider/consumers/all/tickets — all consumers
router.get('/consumers/all/tickets', rbac('tickets:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getConsumerTickets(req.tenantId, undefined, pagination);

  res.json({
    data: result.data.map((t: any) => ({
      _id: t._id.toString(),
      number: t.number,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      tenant_id: (t.tenant_id?._id || t.tenant_id).toString(),
      tenant_name: t.tenant_id?.name || null,
      createdAt: t.createdAt?.toISOString?.() || t.createdAt,
    })),
    pagination: result.pagination,
  });
});

// GET /provider/consumers/all/changes — all consumers
router.get('/consumers/all/changes', rbac('changes:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getConsumerChangeRequests(req.tenantId, undefined, pagination);

  res.json({
    data: result.data.map((cr: any) => ({
      _id: cr._id.toString(),
      number: cr.number,
      title: cr.title,
      type: cr.type,
      status: cr.status,
      risk_score: cr.risk?.score || null,
      tenant_id: cr.tenant_id.toString(),
      createdAt: cr.createdAt?.toISOString?.() || cr.createdAt,
    })),
    pagination: result.pagination,
  });
});

// GET /provider/consumers/:consumerId/incidents
router.get('/consumers/:consumerId/incidents', rbac('incidents:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getConsumerIncidents(
    req.tenantId,
    req.params['consumerId'] as string,
    pagination,
  );

  res.json({
    data: result.data.map((inc: any) => ({
      _id: inc._id.toString(),
      number: inc.number,
      title: inc.title,
      severity: inc.severity,
      status: inc.status,
      tenant_id: inc.tenant_id.toString(),
      createdAt: inc.createdAt?.toISOString?.() || inc.createdAt,
    })),
    pagination: result.pagination,
  });
});

// GET /provider/consumers/:consumerId/tickets
router.get('/consumers/:consumerId/tickets', rbac('tickets:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getConsumerTickets(
    req.tenantId,
    req.params['consumerId'] as string,
    pagination,
  );

  res.json({
    data: result.data.map((t: any) => ({
      _id: t._id.toString(),
      number: t.number,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      tenant_id: (t.tenant_id?._id || t.tenant_id).toString(),
      tenant_name: t.tenant_id?.name || null,
      createdAt: t.createdAt?.toISOString?.() || t.createdAt,
    })),
    pagination: result.pagination,
  });
});

// GET /provider/consumers/:consumerId/changes
router.get('/consumers/:consumerId/changes', rbac('changes:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await providerService.getConsumerChangeRequests(
    req.tenantId,
    req.params['consumerId'] as string,
    pagination,
  );

  res.json({
    data: result.data.map((cr: any) => ({
      _id: cr._id.toString(),
      number: cr.number,
      title: cr.title,
      type: cr.type,
      status: cr.status,
      risk_score: cr.risk?.score || null,
      tenant_id: cr.tenant_id.toString(),
      createdAt: cr.createdAt?.toISOString?.() || cr.createdAt,
    })),
    pagination: result.pagination,
  });
});

// POST /provider/consumers/:consumerId/tickets — create ticket on behalf of a consumer
const createConsumerTicketSchema = z.object({
  type: z.enum(['epic', 'user_story', 'task', 'bug']),
  title: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  labels: z.array(z.string()).optional(),
  time_estimate: z.string().optional(),
});

router.post(
  '/consumers/:consumerId/tickets',
  rbac('tickets:create'),
  async (req: Request, res: Response) => {
    const consumerId = req.params['consumerId'] as string;

    // 1. Validate provider-consumer link
    const link = await ProviderConsumerLink.findOne({
      provider_tenant_id: req.tenantId,
      consumer_tenant_id: consumerId,
      status: 'active',
    });
    if (!link) {
      res.status(404).json({ detail: 'No active consumer link found.' });
      return;
    }

    // 2. Check tickets scope
    if (!link.scope.includes('tickets')) {
      res.status(403).json({ detail: 'Tickets scope is not enabled for this consumer link.' });
      return;
    }

    // 3. Find consumer's default project
    const project = await Project.findOne({ tenant_id: consumerId }).sort({ createdAt: 1 });
    if (!project) {
      res.status(400).json({ detail: 'Consumer tenant has no projects configured.' });
      return;
    }

    // 4. Get provider tenant name for custom field
    const providerTenant = await Tenant.findById(req.tenantId, 'name');
    const providerName = providerTenant?.name || 'Provider';

    // 5. Parse and create ticket in consumer tenant
    const body = createConsumerTicketSchema.parse(req.body);
    const ticket = await ticketService.createTicket({
      tenant_id: new Types.ObjectId(consumerId),
      project_id: project._id.toString(),
      reporter_id: new Types.ObjectId(req.userId),
      type: body.type,
      title: body.title,
      description: body.description,
      priority: body.priority,
      labels: body.labels,
      time_estimate: body.time_estimate,
      custom_fields: { created_by_provider: providerName },
    });

    // 6. Automatically create a bridge so both tenants see the ticket
    let providerTicketId: string | null = null;
    try {
      const bridge = await ticketBridgeService.createTicketBridge(
        new Types.ObjectId(consumerId),
        ticket._id as Types.ObjectId,
        req.tenantId,
        new Types.ObjectId(req.userId),
      );
      providerTicketId = bridge.provider_ticket_id.toString();
    } catch (bridgeErr) {
      logger.warn('Failed to auto-create ticket bridge after consumer ticket creation', {
        error: (bridgeErr as Error).message,
        consumerTicketId: ticket._id.toString(),
      });
    }

    res.status(201).json({
      _id: ticket._id.toString(),
      id: ticket._id.toString(),
      provider_ticket_id: providerTicketId,
      number: ticket.number,
      title: ticket.title,
      type: ticket.type,
      status: ticket.status,
      priority: ticket.priority,
      tenant_id: consumerId,
      createdAt: ticket.createdAt?.toISOString?.() || ticket.createdAt,
    });
  }
);

// POST /provider/tickets/:ticketId/link-to-consumer — link existing provider ticket to a consumer
const linkToConsumerSchema = z.object({
  consumer_id: z.string().min(1),
});

router.post(
  '/tickets/:ticketId/link-to-consumer',
  rbac('tickets:create'),
  async (req: Request, res: Response) => {
    const ticketId = req.params['ticketId'] as string;
    const body = linkToConsumerSchema.parse(req.body);

    const bridge = await ticketBridgeService.linkProviderTicketToConsumer(
      req.tenantId,
      new Types.ObjectId(ticketId),
      new Types.ObjectId(body.consumer_id),
      new Types.ObjectId(req.userId),
    );

    res.status(201).json({
      bridge_id: bridge._id.toString(),
      consumer_ticket_id: bridge.consumer_ticket_id.toString(),
      provider_ticket_id: bridge.provider_ticket_id.toString(),
      status: bridge.status,
    });
  }
);

// PATCH /provider/consumers/:consumerId/scope — replace the full scope array for a link
const updateScopeSchema = z.object({
  scope: z.array(
    z.enum([
      'incidents', 'escalations', 'oncall', 'runbooks',
      'communications', 'tickets', 'changes', 'managed_support', 'observability',
    ]),
  ),
});

router.patch('/consumers/:consumerId/scope', rbac('tenants:update'), async (req: Request, res: Response) => {
  const { scope } = updateScopeSchema.parse(req.body);
  const link = await providerService.updateConsumerScope(
    req.tenantId,
    req.params['consumerId'] as string,
    scope,
  );

  res.json({
    _id: link._id.toString(),
    consumer_id: (link.consumer_tenant_id as any)?._id?.toString() ?? link.consumer_tenant_id.toString(),
    consumer_slug: (link.consumer_tenant_id as any)?.slug ?? null,
    consumer_name: (link.consumer_tenant_id as any)?.name ?? null,
    scope: link.scope,
    status: link.status,
  });
});

// GET /provider/consumers/sla — SLA metrics across consumers
router.get('/consumers/sla', rbac('tenants:read'), async (req: Request, res: Response) => {
  const consumerId = req.query.consumer_id as string | undefined;
  const metrics = await slaService.getSLAMetrics(req.tenantId, consumerId);
  res.json({ data: metrics });
});

export default router;
