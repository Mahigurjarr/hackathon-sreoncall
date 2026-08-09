import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { rbac } from '../middleware/rbac.middleware';
import * as bridgeService from '../services/incident-bridge.service';
import * as ticketBridgeService from '../services/ticket-bridge.service';
import * as changeBridgeService from '../services/change-bridge.service';
import * as managedSupportService from '../services/managed-support.service';
import { IncidentSLAState } from '../models/incident-sla-state.model';
import { parsePaginationParams } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';

const router = Router();

function serializeBridge(b: any) {
  return {
    _id: b._id.toString(),
    consumer_tenant_id: b.consumer_tenant_id?.toString(),
    consumer_incident_id: b.consumer_incident_id?._id?.toString() || b.consumer_incident_id?.toString(),
    consumer_incident: b.consumer_incident_id?._id ? {
      _id: b.consumer_incident_id._id.toString(),
      number: b.consumer_incident_id.number,
      title: b.consumer_incident_id.title,
      severity: b.consumer_incident_id.severity,
      status: b.consumer_incident_id.status,
    } : undefined,
    provider_tenant_id: b.provider_tenant_id?.toString(),
    provider_incident_id: b.provider_incident_id?._id?.toString() || b.provider_incident_id?.toString(),
    provider_incident: b.provider_incident_id?._id ? {
      _id: b.provider_incident_id._id.toString(),
      number: b.provider_incident_id.number,
      title: b.provider_incident_id.title,
      severity: b.provider_incident_id.severity,
      status: b.provider_incident_id.status,
    } : undefined,
    status: b.status,
    escalated_at: b.escalated_at?.toISOString?.() || b.escalated_at,
    resolved_at: b.resolved_at?.toISOString?.() || null,
    createdAt: b.createdAt?.toISOString?.() || b.createdAt,
  };
}

// GET /bridges — list bridges for current tenant
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const result = await bridgeService.listBridgesForTenant(req.tenantId, pagination);
  res.json({
    data: result.data.map(serializeBridge),
    pagination: result.pagination,
  });
});

// GET /bridges/incident/:incidentId — get bridge for a specific incident
router.get('/incident/:incidentId', rbac('incidents:read'), async (req: Request, res: Response) => {
  const incidentId = req.params['incidentId'] as string;
  let bridge = await bridgeService.getBridgeByConsumerIncident(incidentId);
  if (!bridge) {
    bridge = await bridgeService.getBridgeByProviderIncident(incidentId);
  }
  if (!bridge) {
    res.status(404).json({ detail: 'No bridge found for this incident' });
    return;
  }
  res.json(serializeBridge(bridge));
});

// GET /bridges/ticket/:ticketId — get bridge for a specific ticket
router.get('/ticket/:ticketId', rbac('tickets:read'), async (req: Request, res: Response) => {
  const ticketId = req.params['ticketId'] as string;
  let bridge = await ticketBridgeService.getBridgeByConsumerTicket(ticketId);
  if (!bridge) {
    bridge = await ticketBridgeService.getBridgeByProviderTicket(ticketId);
  }
  if (!bridge) {
    res.status(404).json({ detail: 'No bridge found for this ticket' });
    return;
  }
  res.json({
    _id: bridge._id.toString(),
    consumer_tenant_id: bridge.consumer_tenant_id?.toString(),
    consumer_ticket_id: bridge.consumer_ticket_id?.toString(),
    provider_tenant_id: bridge.provider_tenant_id?.toString(),
    provider_ticket_id: bridge.provider_ticket_id?.toString(),
    status: bridge.status,
    escalated_at: bridge.escalated_at?.toISOString?.() || bridge.escalated_at,
    resolved_at: bridge.resolved_at?.toISOString?.() || null,
    createdAt: bridge.createdAt?.toISOString?.() || bridge.createdAt,
  });
});

// GET /bridges/change/:changeId — get bridge for a specific change request
router.get('/change/:changeId', rbac('changes:read'), async (req: Request, res: Response) => {
  const changeId = req.params['changeId'] as string;
  let bridge = await changeBridgeService.getBridgeByConsumerChange(changeId);
  if (!bridge) {
    bridge = await changeBridgeService.getBridgeByProviderChange(changeId);
  }
  if (!bridge) {
    res.status(404).json({ detail: 'No bridge found for this change request' });
    return;
  }
  res.json({
    _id: bridge._id.toString(),
    consumer_tenant_id: bridge.consumer_tenant_id?.toString(),
    consumer_change_id: bridge.consumer_change_id?.toString(),
    provider_tenant_id: bridge.provider_tenant_id?.toString(),
    provider_change_id: bridge.provider_change_id?.toString(),
    status: bridge.status,
    escalated_at: bridge.escalated_at?.toISOString?.() || bridge.escalated_at,
    resolved_at: bridge.resolved_at?.toISOString?.() || null,
    createdAt: bridge.createdAt?.toISOString?.() || bridge.createdAt,
  });
});

const syncSchema = z.object({
  action: z.string().min(1),
  data: z.record(z.any()).optional(),
});

// POST /bridges/:id/sync — trigger sync (system/internal use)
router.post('/:id/sync', rbac('incidents:update'), async (req: Request, res: Response) => {
  const body = syncSchema.parse(req.body);
  const bridgeId = req.params['id'] as string;

  // Determine sync direction based on current tenant
  const bridge = await bridgeService.getBridgeByConsumerIncident(bridgeId) ||
    await bridgeService.getBridgeByProviderIncident(bridgeId);

  if (!bridge) {
    // Try by bridge ID directly
    const directBridge = await bridgeService.listBridgesForTenant(req.tenantId, { limit: 1 });
    if (!directBridge.data.length) {
      res.status(404).json({ detail: 'Bridge not found' });
      return;
    }
  }

  if (bridge && bridge.consumer_tenant_id.toString() === req.tenantId.toString()) {
    await bridgeService.syncToProvider(bridgeId, body.action, body.data);
  } else {
    await bridgeService.syncToConsumer(bridgeId, body.action, body.data);
  }

  res.json({ status: 'synced' });
});

// GET /bridges/:bridgeId/sla-state — managed-support SLA state for a bridge
router.get('/:bridgeId/sla-state', rbac('incidents:read'), async (req: Request, res: Response) => {
  const bridgeId = req.params['bridgeId'] as string;
  const state = await IncidentSLAState.findOne({ incident_bridge_id: new Types.ObjectId(bridgeId) });
  if (!state) {
    res.status(404).json({ detail: 'No SLA state for this bridge' });
    return;
  }
  // Only the two parties on the bridge may read the state.
  const tid = req.tenantId.toString();
  if (state.consumer_tenant_id.toString() !== tid && state.provider_tenant_id.toString() !== tid) {
    res.status(403).json({ detail: 'Forbidden' });
    return;
  }
  res.json({
    data: {
      id: state._id.toString(),
      bridge_id: state.incident_bridge_id.toString(),
      contract_id: state.contract_id.toString(),
      current_tier: state.current_tier,
      tier_started_at: state.tier_started_at.toISOString(),
      tier_deadline: state.tier_deadline?.toISOString() ?? null,
      response_sla: {
        target_minutes: state.response_sla.target_minutes,
        deadline_at: state.response_sla.deadline_at.toISOString(),
        met_at: state.response_sla.met_at?.toISOString() ?? null,
        breached: state.response_sla.breached,
      },
      resolution_sla: {
        target_minutes: state.resolution_sla.target_minutes,
        deadline_at: state.resolution_sla.deadline_at.toISOString(),
        met_at: state.resolution_sla.met_at?.toISOString() ?? null,
        breached: state.resolution_sla.breached,
      },
      tier_history: state.tier_history.map((h) => ({
        level: h.level,
        started_at: h.started_at.toISOString(),
        ended_at: h.ended_at?.toISOString() ?? null,
        reason: h.reason,
      })),
      status: state.status,
    },
  });
});

// POST /bridges/:bridgeId/escalate-tier — manual tier escalation (provider side)
router.post('/:bridgeId/escalate-tier', rbac('incidents:update'), async (req: Request, res: Response) => {
  const bridgeId = req.params['bridgeId'] as string;
  const state = await IncidentSLAState.findOne({ incident_bridge_id: new Types.ObjectId(bridgeId) });
  if (!state) throw AppError.notFound('SLA state');
  if (state.status !== 'active') {
    throw AppError.badRequest(`Cannot escalate a ${state.status} incident`);
  }
  // Only the provider may manually escalate tiers.
  if (state.provider_tenant_id.toString() !== req.tenantId.toString()) {
    throw AppError.forbidden('Only the provider may escalate tiers');
  }
  const { nextTierScheduleId } = await managedSupportService.escalateTier(state, 'manual_escalation');
  res.json({
    data: {
      current_tier: state.current_tier,
      tier_deadline: state.tier_deadline?.toISOString() ?? null,
      next_tier_schedule_id: nextTierScheduleId?.toString() ?? null,
      escalated: nextTierScheduleId !== null,
    },
  });
});

export default router;
