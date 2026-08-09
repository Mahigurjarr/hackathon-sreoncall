import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import * as supportContractService from '../services/support-contract.service';
import * as managedSupportService from '../services/managed-support.service';
import { SupportContractDocument } from '../models/support-contract.model';
import { IncidentSLAState } from '../models/incident-sla-state.model';
import { Tenant } from '../models/tenant.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';

const router = Router();

// ─── Serializers ─────────────────────────────────────────────────────

export function serializeContract(c: SupportContractDocument & { __consumer_name?: string; __provider_name?: string; __schedule_names?: Map<string, string> } ) {
  const scheduleNames: Map<string, string> = (c as any).__schedule_names ?? new Map();
  return {
    id: c._id.toString(),
    name: c.name,
    status: c.status,
    provider_tenant_id: c.tenant_id.toString(),
    provider_name: (c as any).__provider_name || null,
    consumer_tenant_id: c.consumer_tenant_id.toString(),
    consumer_name: (c as any).__consumer_name || null,
    coverage_window: {
      type: c.coverage_window.type,
      timezone: c.coverage_window.timezone,
      schedule: c.coverage_window.schedule,
    },
    tiers: c.tiers.map((t) => {
      const tAny = t as any;
      const raw: unknown[] = Array.isArray(tAny.schedule_ids) && tAny.schedule_ids.length
        ? tAny.schedule_ids
        : tAny.schedule_id ? [tAny.schedule_id] : [];
      const scheduleIdList = raw.filter(Boolean).map((id) => (id as { toString(): string }).toString());
      const primaryScheduleId = scheduleIdList[0] ?? null;
      return {
        level: t.level,
        name: t.name,
        schedule_ids: scheduleIdList,
        schedule_id: primaryScheduleId,
        schedule_name: primaryScheduleId ? (scheduleNames.get(primaryScheduleId) ?? null) : null,
        escalation_timeout_minutes: t.escalation_timeout_minutes,
        notify_channels: t.notify_channels ?? ['in_app', 'email'],
      };
    }),
    sla_targets: c.sla_targets.map((t) => ({
      severity: t.severity,
      response_minutes: t.response_minutes,
      resolution_minutes: t.resolution_minutes,
    })),
    pricing: {
      amount_cents: c.pricing.amount_cents,
      currency: c.pricing.currency,
      provider_share_pct: c.pricing.provider_share_pct,
      platform_share_pct: c.pricing.platform_share_pct,
    },
    effective_from: c.effective_from?.toISOString() ?? null,
    effective_until: c.effective_until?.toISOString() ?? null,
    created_at: c.createdAt?.toISOString() ?? null,
    updated_at: c.updatedAt?.toISOString() ?? null,
  };
}

async function attachConsumerNames(contracts: SupportContractDocument[]): Promise<Array<SupportContractDocument & { __consumer_name?: string; __provider_name?: string; __schedule_names?: Map<string, string> }>> {
  const tenantIds = [...new Set([
    ...contracts.map((c) => c.consumer_tenant_id.toString()),
    ...contracts.map((c) => c.tenant_id.toString()),
  ])];
  const tenants = await Tenant.find({ _id: { $in: tenantIds } }, '_id name').lean();
  const tenantById = new Map(tenants.map((t: any) => [t._id.toString(), t.name]));

  const scheduleIds = [...new Set(contracts.flatMap((c) =>
    c.tiers.flatMap((t) => {
      const tAny = t as any;
      const fromIds: string[] = Array.isArray(tAny.schedule_ids)
        ? tAny.schedule_ids.map((id: any) => id.toString())
        : [];
      return [t.schedule_id?.toString(), ...fromIds].filter(Boolean) as string[];
    })
  ))];
  const schedules = scheduleIds.length > 0
    ? await OnCallSchedule.find({ _id: { $in: scheduleIds } }, '_id name').lean()
    : [];
  const scheduleNames = new Map(schedules.map((s: any) => [s._id.toString(), s.name]));

  return contracts.map((c) => Object.assign(c, {
    __consumer_name: tenantById.get(c.consumer_tenant_id.toString()),
    __provider_name: tenantById.get(c.tenant_id.toString()),
    __schedule_names: scheduleNames,
  }));
}

// ─── Zod schemas ──────────────────────────────────────────────────────

const coverageWindowSchema = z.object({
  type: z.enum(['8x5', '24x7', 'custom']),
  timezone: z.string().min(1).default('UTC'),
  schedule: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .default([]),
});

const tierInputSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  name: z.string().min(1).max(100),
  schedule_id: z.string().nullable().optional(),
  schedule_ids: z.array(z.string()).optional(),
  escalation_timeout_minutes: z.number().int().min(1).nullable(),
  notify_channels: z.array(z.enum(['email', 'sms', 'slack', 'voice', 'whatsapp', 'in_app'])).optional(),
});

const slaTargetSchema = z.object({
  severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  response_minutes: z.number().int().min(1),
  resolution_minutes: z.number().int().min(1),
});

const pricingSchema = z.object({
  amount_cents: z.number().int().min(0),
  currency: z.string().min(1).default('usd'),
  provider_share_pct: z.number().int().min(0).max(100).default(80),
  platform_share_pct: z.number().int().min(0).max(100).default(20),
});

const createContractSchema = z.object({
  consumer_tenant_id: z.string().min(1),
  name: z.string().min(1).max(200),
  coverage_window: coverageWindowSchema,
  tiers: z.array(tierInputSchema).min(1).max(3),
  sla_targets: z.array(slaTargetSchema).min(1),
  pricing: pricingSchema,
  effective_from: z.string().datetime().optional(),
  effective_until: z.string().datetime().nullable().optional(),
});

const updateContractSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  coverage_window: coverageWindowSchema.optional(),
  tiers: z.array(tierInputSchema).min(1).max(3).optional(),
  sla_targets: z.array(slaTargetSchema).min(1).optional(),
  pricing: pricingSchema.optional(),
  effective_until: z.string().datetime().nullable().optional(),
});

// ─── PROVIDER ROUTES ─────────────────────────────────────────────────

export const providerSupportContractsRouter = Router();
providerSupportContractsRouter.use(requireTenantType('provider'));

providerSupportContractsRouter.get('/', rbac('tenants:read'), async (req: Request, res: Response) => {
  const status = req.query.status as any;
  const contracts = await supportContractService.listContractsForProvider(req.tenantId, { status });
  const enriched = await attachConsumerNames(contracts);
  res.json({ data: enriched.map(serializeContract) });
});

providerSupportContractsRouter.get('/:id', rbac('tenants:read'), async (req: Request, res: Response) => {
  const contract = await supportContractService.getContractById(
    req.tenantId,
    req.params['id'] as string,
    { asProvider: true },
  );
  const [enriched] = await attachConsumerNames([contract]);
  res.json({ data: serializeContract(enriched) });
});

providerSupportContractsRouter.post('/', rbac('tenants:update'), async (req: Request, res: Response) => {
  const body = createContractSchema.parse(req.body);
  const contract = await supportContractService.createContract(
    req.tenantId,
    new Types.ObjectId(req.userId),
    {
      consumer_tenant_id: body.consumer_tenant_id,
      name: body.name,
      coverage_window: body.coverage_window,
      tiers: body.tiers,
      sla_targets: body.sla_targets,
      pricing: body.pricing,
      effective_from: body.effective_from ? new Date(body.effective_from) : undefined,
      effective_until: body.effective_until ? new Date(body.effective_until) : null,
    },
  );
  res.status(201).json({ data: serializeContract(contract) });
});

providerSupportContractsRouter.patch('/:id', rbac('tenants:update'), async (req: Request, res: Response) => {
  const body = updateContractSchema.parse(req.body);
  const contract = await supportContractService.amendContract(
    req.tenantId,
    req.params['id'] as string,
    new Types.ObjectId(req.userId),
    {
      name: body.name,
      coverage_window: body.coverage_window,
      tiers: body.tiers,
      sla_targets: body.sla_targets,
      pricing: body.pricing,
      effective_until: body.effective_until ? new Date(body.effective_until) : null,
    },
  );
  res.json({ data: serializeContract(contract) });
});

providerSupportContractsRouter.post('/:id/activate', rbac('tenants:update'), async (req: Request, res: Response) => {
  const contract = await supportContractService.activateContract(req.tenantId, req.params['id'] as string);
  res.json({ data: serializeContract(contract) });
});

providerSupportContractsRouter.delete('/:id', rbac('tenants:update'), async (req: Request, res: Response) => {
  const contract = await supportContractService.cancelContract(req.tenantId, req.params['id'] as string);
  res.json({ data: serializeContract(contract) });
});

providerSupportContractsRouter.get('/:id/sla-report', rbac('tenants:read'), async (req: Request, res: Response) => {
  const contract = await supportContractService.getContractById(req.tenantId, req.params['id'] as string);
  const states = await IncidentSLAState.find({ contract_id: contract._id });

  const total = states.length;
  const responseBreaches = states.filter((s) => s.response_sla.breached).length;
  const resolutionBreaches = states.filter((s) => s.resolution_sla.breached).length;
  const responseMet = states.filter((s) => !s.response_sla.breached && s.response_sla.met_at).length;

  res.json({
    data: {
      contract_id: contract._id.toString(),
      total_incidents: total,
      response_breach_count: responseBreaches,
      resolution_breach_count: resolutionBreaches,
      response_met_count: responseMet,
      response_compliance_pct: total > 0 ? Math.round(((total - responseBreaches) / total) * 100) : 100,
      resolution_compliance_pct: total > 0 ? Math.round(((total - resolutionBreaches) / total) * 100) : 100,
      active_count: states.filter((s) => s.status === 'active').length,
      resolved_count: states.filter((s) => s.status === 'resolved').length,
    },
  });
});

// ─── PROVIDER OPERATIONS DASHBOARD ───────────────────────────────────

export const providerSupportDashboardRouter = Router();
providerSupportDashboardRouter.use(requireTenantType('provider'));

providerSupportDashboardRouter.get('/', rbac('tenants:read'), async (req: Request, res: Response) => {
  const dashboard = await managedSupportService.buildProviderDashboard(req.tenantId);
  res.json({ data: dashboard });
});

// ─── CONSUMER ROUTES (read-only) ─────────────────────────────────────

export const consumerSupportContractRouter = Router();
consumerSupportContractRouter.use(requireTenantType('consumer'));

consumerSupportContractRouter.get('/', rbac('tenants:read'), async (req: Request, res: Response) => {
  const contract = await supportContractService.getActiveContractForConsumer(req.tenantId);
  if (!contract) {
    res.json({ data: null });
    return;
  }
  const providerTenant = await Tenant.findById(contract.tenant_id, 'name slug').lean();
  res.json({
    data: {
      ...serializeContract(contract),
      provider_name: (providerTenant as any)?.name || null,
      provider_slug: (providerTenant as any)?.slug || null,
    },
  });
});

consumerSupportContractRouter.get('/sla-status', rbac('incidents:read'), async (req: Request, res: Response) => {
  const contract = await supportContractService.getActiveContractForConsumer(req.tenantId);
  if (!contract) {
    res.json({ data: [] });
    return;
  }
  const states = await IncidentSLAState.find({
    contract_id: contract._id,
    consumer_tenant_id: req.tenantId,
    status: 'active',
  });
  res.json({
    data: states.map((s) => ({
      id: s._id.toString(),
      consumer_incident_id: s.consumer_incident_id.toString(),
      current_tier: s.current_tier,
      tier_started_at: s.tier_started_at.toISOString(),
      tier_deadline: s.tier_deadline?.toISOString() ?? null,
      response_deadline: s.response_sla.deadline_at.toISOString(),
      response_met_at: s.response_sla.met_at?.toISOString() ?? null,
      response_breached: s.response_sla.breached,
      resolution_deadline: s.resolution_sla.deadline_at.toISOString(),
      resolution_breached: s.resolution_sla.breached,
      tier_history: s.tier_history.map((h) => ({
        level: h.level,
        started_at: h.started_at.toISOString(),
        ended_at: h.ended_at?.toISOString() ?? null,
        reason: h.reason,
      })),
    })),
  });
});

// ─── CONSUMER MANAGED TIERS ──────────────────────────────────────────

import { ConsumerManagedTier } from '../models/consumer-managed-tier.model';

const consumerTierInputSchema = z.object({
  name: z.string().min(1).max(100),
  schedule_id: z.string().min(1),
  notify_channels: z.array(z.enum(['email', 'sms', 'slack', 'voice', 'whatsapp', 'in_app'])).min(1),
  escalation_timeout_minutes: z.number().int().min(1).nullable().optional(),
});

// GET /consumer/support-contract/tiers
consumerSupportContractRouter.get('/tiers', rbac('tenants:read'), async (req: Request, res: Response) => {
  const contract = await supportContractService.getActiveContractForConsumer(req.tenantId);
  if (!contract) { res.json({ data: [] }); return; }
  const tiers = await ConsumerManagedTier.find({ contract_id: contract._id, consumer_tenant_id: req.tenantId }).sort({ level: 1 }).lean();
  res.json({ data: tiers.map((t: any) => ({ id: t._id.toString(), level: t.level, name: t.name, schedule_id: t.schedule_id.toString(), notify_channels: t.notify_channels })) });
});

// POST /consumer/support-contract/tiers
consumerSupportContractRouter.post('/tiers', rbac('tenants:update'), async (req: Request, res: Response) => {
  const body = consumerTierInputSchema.parse(req.body);
  const contract = await supportContractService.getActiveContractForConsumer(req.tenantId);
  if (!contract) { res.status(400).json({ detail: 'No active managed support contract' }); return; }

  const scheduleExists = await OnCallSchedule.exists({ _id: body.schedule_id, tenant_id: req.tenantId });
  if (!scheduleExists) { res.status(400).json({ detail: 'Schedule not found' }); return; }

  const existing = await ConsumerManagedTier.find({ contract_id: contract._id, consumer_tenant_id: req.tenantId }).sort({ level: 1 }).lean();
  const maxProviderLevel = Math.max(...contract.tiers.map((t) => t.level), 0);
  const maxConsumerLevel = existing.length > 0 ? Math.max(...existing.map((t: any) => t.level)) : 0;
  const nextLevel = Math.max(maxProviderLevel, maxConsumerLevel) + 1;

  const tier = await ConsumerManagedTier.create({
    contract_id: contract._id,
    consumer_tenant_id: req.tenantId,
    level: nextLevel,
    name: body.name,
    schedule_id: body.schedule_id,
    notify_channels: body.notify_channels,
    escalation_timeout_minutes: body.escalation_timeout_minutes ?? null,
  });
  res.status(201).json({ id: tier._id.toString(), level: tier.level, name: tier.name, schedule_id: tier.schedule_id.toString(), notify_channels: tier.notify_channels, escalation_timeout_minutes: tier.escalation_timeout_minutes });
});

// PATCH /consumer/support-contract/tiers/:id
consumerSupportContractRouter.patch('/tiers/:id', rbac('tenants:update'), async (req: Request, res: Response) => {
  const body = consumerTierInputSchema.partial().parse(req.body);
  const tier = await ConsumerManagedTier.findOne({ _id: req.params['id'], consumer_tenant_id: req.tenantId });
  if (!tier) { res.status(404).json({ detail: 'Tier not found' }); return; }
  if (body.schedule_id) {
    const ok = await OnCallSchedule.exists({ _id: body.schedule_id, tenant_id: req.tenantId });
    if (!ok) { res.status(400).json({ detail: 'Schedule not found' }); return; }
  }
  if (body.name) tier.name = body.name;
  if (body.schedule_id) tier.schedule_id = new (require('mongoose').Types.ObjectId)(body.schedule_id);
  if (body.notify_channels) tier.notify_channels = body.notify_channels;
  if (body.escalation_timeout_minutes !== undefined) tier.escalation_timeout_minutes = body.escalation_timeout_minutes ?? null;
  await tier.save();
  res.json({ id: tier._id.toString(), level: tier.level, name: tier.name, schedule_id: tier.schedule_id.toString(), notify_channels: tier.notify_channels, escalation_timeout_minutes: tier.escalation_timeout_minutes });
});

// DELETE /consumer/support-contract/tiers/:id
consumerSupportContractRouter.delete('/tiers/:id', rbac('tenants:update'), async (req: Request, res: Response) => {
  const tier = await ConsumerManagedTier.findOneAndDelete({ _id: req.params['id'], consumer_tenant_id: req.tenantId });
  if (!tier) { res.status(404).json({ detail: 'Tier not found' }); return; }
  res.status(204).send();
});

// ─── PLATFORM ADMIN ──────────────────────────────────────────────────

export const platformAdminSupportContractsRouter = Router();
const requirePlatformAdmin = rbac('platform:admin');

platformAdminSupportContractsRouter.get('/', requirePlatformAdmin, async (req: Request, res: Response) => {
  const status = req.query.status as any;
  const contracts = await supportContractService.listAllContracts({ status });
  const enriched = await attachConsumerNames(contracts);
  // attach provider names
  const providerIds = [...new Set(enriched.map((c) => c.tenant_id.toString()))];
  const providers = await Tenant.find({ _id: { $in: providerIds } }, '_id name').lean();
  const providerById = new Map(providers.map((p: any) => [p._id.toString(), p.name]));
  res.json({
    data: enriched.map((c) => ({
      ...serializeContract(c),
      provider_name: providerById.get(c.tenant_id.toString()) || null,
    })),
  });
});

platformAdminSupportContractsRouter.get('/revenue', requirePlatformAdmin, async (_req: Request, res: Response) => {
  const active = await supportContractService.listAllContracts({ status: 'active' });
  let platformCentsMonthly = 0;
  let providerCentsMonthly = 0;
  for (const c of active) {
    const platformShare = Math.round(c.pricing.amount_cents * (c.pricing.platform_share_pct / 100));
    const providerShare = c.pricing.amount_cents - platformShare;
    platformCentsMonthly += platformShare;
    providerCentsMonthly += providerShare;
  }
  res.json({
    data: {
      active_contract_count: active.length,
      total_monthly_cents: platformCentsMonthly + providerCentsMonthly,
      platform_share_cents_monthly: platformCentsMonthly,
      provider_share_cents_monthly: providerCentsMonthly,
      currency: 'usd',
    },
  });
});

export default router;
