import { Types } from 'mongoose';
import {
  SupportContract,
  SupportContractDocument,
  ICoverageWindow,
  ISupportTier,
  ISupportSlaTarget,
  ISupportPricing,
  SupportContractStatus,
} from '../models/support-contract.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { BusinessHours } from '../models/sla-config.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { getRedis } from '../config/redis';

export interface ContractTierInput {
  level: 1 | 2 | 3;
  name: string;
  schedule_id?: string | null;
  schedule_ids?: string[];
  escalation_timeout_minutes: number | null;
  notify_channels?: string[];
}

export interface CreateContractInput {
  consumer_tenant_id: string;
  name: string;
  coverage_window: ICoverageWindow;
  tiers: ContractTierInput[];
  sla_targets: ISupportSlaTarget[];
  pricing: ISupportPricing;
  effective_from?: Date;
  effective_until?: Date | null;
}

export interface UpdateContractInput {
  name?: string;
  coverage_window?: ICoverageWindow;
  tiers?: CreateContractInput['tiers'];
  sla_targets?: ISupportSlaTarget[];
  pricing?: ISupportPricing;
  effective_until?: Date | null;
}

/**
 * 24x7 coverage has an empty schedule because every minute is covered.
 * 8x5 defaults to Mon-Fri 09:00-17:00 (provider timezone).
 * `custom` requires the caller to supply a schedule.
 */
export function expandCoverageSchedule(window: ICoverageWindow): ICoverageWindow {
  if (window.type === '24x7') {
    const schedule = Array.from({ length: 7 }, (_, day) => ({
      day,
      start: '00:00',
      end: '23:59',
    }));
    return { ...window, schedule };
  }
  if (window.type === '8x5') {
    const schedule = [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: '09:00',
      end: '17:00',
    }));
    return { ...window, schedule };
  }
  if (!window.schedule || window.schedule.length === 0) {
    throw AppError.badRequest('Custom coverage window requires a schedule');
  }
  return window;
}

/**
 * Normalize coverage window into the BusinessHours shape the SLA calculator
 * expects. Support contracts do not yet model holidays separately.
 */
export function coverageToBusinessHours(window: ICoverageWindow): BusinessHours {
  const expanded = expandCoverageSchedule(window);
  return {
    timezone: expanded.timezone || 'UTC',
    schedule: expanded.schedule,
    holidays: [],
  };
}

function validateSlaTargets(targets: ISupportSlaTarget[]): void {
  if (!targets || targets.length === 0) {
    throw AppError.badRequest('At least one SLA target is required');
  }
  const seen = new Set<number>();
  for (const t of targets) {
    if (seen.has(t.severity)) {
      throw AppError.badRequest(`Duplicate SLA target for severity ${t.severity}`);
    }
    seen.add(t.severity);
    if (t.response_minutes >= t.resolution_minutes) {
      throw AppError.badRequest(
        `SLA for severity ${t.severity}: response_minutes must be less than resolution_minutes`,
      );
    }
  }
}

function validateTiers(tiers: CreateContractInput['tiers']): void {
  if (!tiers || tiers.length === 0) {
    throw AppError.badRequest('At least one support tier is required');
  }
  if (tiers.length > 3) {
    throw AppError.badRequest('Support tiers are limited to L1, L2, L3');
  }
  const expectedLevels = tiers.map((_, i) => i + 1);
  const actualLevels = tiers.map((t) => t.level).sort((a, b) => a - b);
  if (expectedLevels.join(',') !== actualLevels.join(',')) {
    throw AppError.badRequest('Tier levels must be contiguous starting at 1 (e.g. [1], [1,2], [1,2,3])');
  }
  for (let i = 0; i < tiers.length - 1; i++) {
    if (!tiers[i].escalation_timeout_minutes || tiers[i].escalation_timeout_minutes! < 1) {
      throw AppError.badRequest(
        `Tier L${tiers[i].level} must have escalation_timeout_minutes (last tier only may be null)`,
      );
    }
  }
}

function validatePricing(pricing: ISupportPricing): void {
  if (pricing.provider_share_pct + pricing.platform_share_pct !== 100) {
    throw AppError.badRequest('provider_share_pct + platform_share_pct must equal 100');
  }
}

export async function createContract(
  providerTenantId: Types.ObjectId,
  userId: Types.ObjectId,
  input: CreateContractInput,
): Promise<SupportContractDocument> {
  const consumerTenantId = new Types.ObjectId(input.consumer_tenant_id);

  const link = await ProviderConsumerLink.findOne({
    provider_tenant_id: providerTenantId,
    consumer_tenant_id: consumerTenantId,
    status: 'active',
  });
  if (!link) {
    throw AppError.badRequest('No active provider-consumer link with this consumer');
  }

  const schedulesById = new Map<string, boolean>();
  for (const tier of input.tiers) {
    const ids = [...(tier.schedule_ids ?? []), ...(tier.schedule_id ? [tier.schedule_id] : [])].filter(Boolean);
    for (const scheduleId of ids) {
      if (scheduleId && !schedulesById.has(scheduleId)) {
        const exists = await OnCallSchedule.exists({ _id: scheduleId, tenant_id: providerTenantId });
        if (!exists) {
          throw AppError.badRequest(`On-call schedule ${scheduleId} for tier L${tier.level} not found`);
        }
        schedulesById.set(scheduleId, true);
      }
    }
  }

  validateTiers(input.tiers);
  validateSlaTargets(input.sla_targets);
  validatePricing(input.pricing);
  const coverage = expandCoverageSchedule(input.coverage_window);

  const activeExisting = await SupportContract.findOne({
    link_id: link._id,
    status: { $in: ['active', 'draft'] },
  });
  if (activeExisting) {
    throw AppError.conflict(
      'An active or draft contract already exists for this consumer. Update or cancel it first.',
    );
  }

  const contract = await SupportContract.create({
    tenant_id: providerTenantId,
    link_id: link._id,
    consumer_tenant_id: consumerTenantId,
    name: input.name,
    status: 'draft',
    coverage_window: coverage,
    tiers: input.tiers.map((t) => ({
      level: t.level,
      name: t.name,
      schedule_id: t.schedule_id ? new Types.ObjectId(t.schedule_id) : undefined,
      schedule_ids: t.schedule_ids?.map((id) => new Types.ObjectId(id)),
      escalation_timeout_minutes: t.escalation_timeout_minutes,
      notify_channels: t.notify_channels ?? ['in_app', 'email'],
    })),
    sla_targets: input.sla_targets,
    pricing: input.pricing,
    effective_from: input.effective_from ?? new Date(),
    effective_until: input.effective_until ?? null,
    predecessor_contract_id: null,
    created_by: userId,
  });

  logger.info('Support contract created', {
    contract_id: contract._id.toString(),
    provider_tenant_id: providerTenantId.toString(),
    consumer_tenant_id: consumerTenantId.toString(),
  });

  return contract;
}

/**
 * Activating a contract is what flips the coverage gate on and triggers billing.
 * The link must also carry the `managed_support` scope.
 */
export async function activateContract(
  providerTenantId: Types.ObjectId,
  contractId: string,
): Promise<SupportContractDocument> {
  const contract = await SupportContract.findOne({
    _id: contractId,
    tenant_id: providerTenantId,
  });
  if (!contract) throw AppError.notFound('Support contract');
  if (contract.status !== 'draft') {
    throw AppError.badRequest(`Cannot activate contract with status "${contract.status}"`);
  }

  const link = await ProviderConsumerLink.findById(contract.link_id);
  if (!link) throw AppError.badRequest('Provider-consumer link no longer exists');
  if (!link.scope.includes('managed_support')) {
    link.scope.push('managed_support');
    await link.save();
  }

  contract.status = 'active';
  await contract.save();

  // Bust the per-consumer managed-support cache so the next incident
  // on this consumer tenant immediately picks up the active contract.
  try {
    await getRedis().del(`ms_link:${link.consumer_tenant_id.toString()}`);
  } catch { /* best-effort */ }

  return contract;
}

export async function getContractById(
  tenantId: Types.ObjectId,
  contractId: string,
  opts: { asProvider?: boolean; asConsumer?: boolean } = { asProvider: true },
): Promise<SupportContractDocument> {
  const filter: Record<string, any> = { _id: contractId };
  if (opts.asProvider) filter.tenant_id = tenantId;
  if (opts.asConsumer) filter.consumer_tenant_id = tenantId;

  const contract = await SupportContract.findOne(filter);
  if (!contract) throw AppError.notFound('Support contract');
  return contract;
}

export async function getActiveContractForLink(linkId: Types.ObjectId): Promise<SupportContractDocument | null> {
  return SupportContract.findOne({ link_id: linkId, status: 'active' });
}

export async function getActiveContractForConsumer(
  consumerTenantId: Types.ObjectId,
): Promise<SupportContractDocument | null> {
  return SupportContract.findOne({ consumer_tenant_id: consumerTenantId, status: 'active' });
}

export async function listContractsForProvider(
  providerTenantId: Types.ObjectId,
  opts: { status?: SupportContractStatus } = {},
): Promise<SupportContractDocument[]> {
  const filter: Record<string, any> = { tenant_id: providerTenantId };
  if (opts.status) filter.status = opts.status;
  return SupportContract.find(filter).sort({ createdAt: -1 });
}

export async function listAllContracts(
  opts: { status?: SupportContractStatus } = {},
): Promise<SupportContractDocument[]> {
  const filter: Record<string, any> = {};
  if (opts.status) filter.status = opts.status;
  return SupportContract.find(filter).sort({ createdAt: -1 });
}

/**
 * Update flow per design: expire current, create new with predecessor reference,
 * new contract starts in "amended" status.
 */
export async function amendContract(
  providerTenantId: Types.ObjectId,
  contractId: string,
  userId: Types.ObjectId,
  updates: UpdateContractInput,
): Promise<SupportContractDocument> {
  const existing = await getContractById(providerTenantId, contractId, { asProvider: true });
  if (existing.status !== 'active' && existing.status !== 'draft') {
    throw AppError.badRequest(`Cannot amend a ${existing.status} contract`);
  }

  const coverage = updates.coverage_window
    ? expandCoverageSchedule(updates.coverage_window)
    : existing.coverage_window;
  const tiers = updates.tiers
    ? updates.tiers.map((t) => ({
        level: t.level,
        name: t.name,
        schedule_id: t.schedule_id ? new Types.ObjectId(t.schedule_id) : undefined,
        schedule_ids: t.schedule_ids?.map((id) => new Types.ObjectId(id)),
        escalation_timeout_minutes: t.escalation_timeout_minutes,
        notify_channels: t.notify_channels ?? ['in_app', 'email'],
      }))
    : existing.tiers;
  const slaTargets = updates.sla_targets ?? existing.sla_targets;
  const pricing = updates.pricing ?? existing.pricing;

  if (updates.tiers) validateTiers(updates.tiers);
  if (updates.sla_targets) validateSlaTargets(updates.sla_targets);
  if (updates.pricing) validatePricing(updates.pricing);

  const wasActive = existing.status === 'active';
  existing.status = 'expired';
  existing.effective_until = new Date();
  await existing.save();

  const next = await SupportContract.create({
    tenant_id: existing.tenant_id,
    link_id: existing.link_id,
    consumer_tenant_id: existing.consumer_tenant_id,
    name: updates.name ?? existing.name,
    status: wasActive ? 'active' : 'amended',
    coverage_window: coverage,
    tiers,
    sla_targets: slaTargets,
    pricing,
    effective_from: new Date(),
    effective_until: updates.effective_until ?? null,
    predecessor_contract_id: existing._id,
    created_by: userId,
  });

  return next;
}

export async function cancelContract(
  providerTenantId: Types.ObjectId,
  contractId: string,
): Promise<SupportContractDocument> {
  const contract = await getContractById(providerTenantId, contractId, { asProvider: true });
  if (contract.status === 'canceled' || contract.status === 'expired') {
    return contract;
  }

  const link = await ProviderConsumerLink.findById(contract.link_id);

  contract.status = 'canceled';
  contract.effective_until = new Date();
  await contract.save();

  // Bust the cache so the consumer's next incident no longer auto-bridges.
  if (link) {
    try {
      await getRedis().del(`ms_link:${link.consumer_tenant_id.toString()}`);
    } catch { /* best-effort */ }
  }

  return contract;
}

export function contractAppliesAt(contract: SupportContractDocument, at: Date = new Date()): boolean {
  if (contract.status !== 'active') return false;
  if (contract.effective_from && contract.effective_from > at) return false;
  if (contract.effective_until && contract.effective_until < at) return false;
  return true;
}
