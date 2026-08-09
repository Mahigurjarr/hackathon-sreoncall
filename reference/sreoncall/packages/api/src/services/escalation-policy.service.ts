import { Types } from 'mongoose';
import { EscalationPolicy, EscalationPolicyDocument, IEscalationStep, NotifyChannel } from '../models/escalation-policy.model';
import { Service } from '../models/service.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Incident } from '../models/incident.model';
import * as incidentBridgeService from './incident-bridge.service';
import * as managedSupportService from './managed-support.service';
import { PaginationParams, PaginatedResult, buildCursorFilter, paginateResults } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';
import { Team } from '../models/team.model';
import { logger } from '../utils/logger';

/**
 * Validate escalation-step targets before persisting. For team-typed steps,
 * every target must be a well-formed ObjectId that resolves to a team in the
 * same tenant — rejects malformed (400) and dangling/cross-tenant refs.
 */
async function validateStepTargets(
  tenantId: Types.ObjectId,
  steps?: Array<{ target_type?: string; targets?: string[] }>
): Promise<void> {
  for (const step of steps || []) {
    if (step.target_type !== 'team') continue;
    const ids = step.targets || [];
    for (const id of ids) {
      if (!Types.ObjectId.isValid(id)) {
        throw AppError.badRequest('Invalid team target in escalation step.');
      }
    }
    if (ids.length > 0) {
      const found = await Team.countDocuments({ _id: { $in: ids }, tenant_id: tenantId });
      if (found !== new Set(ids).size) {
        throw AppError.badRequest('One or more team targets were not found in this tenant.');
      }
    }
  }
}

export async function listEscalationPolicies(
  tenantId: Types.ObjectId,
  pagination: PaginationParams,
  opts?: { status?: string }
): Promise<PaginatedResult<EscalationPolicyDocument>> {
  const baseFilter: Record<string, any> = { tenant_id: tenantId };
  if (opts?.status) baseFilter.status = opts.status;
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'created_at' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);
  const results = await EscalationPolicy.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1);
  const total = await EscalationPolicy.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function getEscalationPolicyById(
  tenantId: Types.ObjectId,
  id: string
): Promise<EscalationPolicyDocument> {
  const policy = await EscalationPolicy.findOne({ _id: id, tenant_id: tenantId });
  if (!policy) throw AppError.notFound('Escalation policy');
  return policy;
}

export async function createEscalationPolicy(input: {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  name: string;
  description?: string;
  steps?: Array<{ delay_minutes: number; targets?: string[]; target_type?: string; provider_policy_id?: string; timeout_minutes?: number; note?: string; notify_channels?: string[] }>;
  repeat_count?: number;
  repeat_interval_minutes?: number;
}): Promise<EscalationPolicyDocument> {
  await validateStepTargets(input.tenant_id, input.steps);
  const steps = (input.steps || []).map((s) => ({
    delay_minutes: s.delay_minutes,
    targets: (s.targets || []).map((t) => new Types.ObjectId(t)),
    target_type: (s.target_type as any) || 'user',
    provider_policy_id: s.provider_policy_id ? new Types.ObjectId(s.provider_policy_id) : undefined,
    timeout_minutes: s.timeout_minutes,
    note: s.note,
    notify_channels: (s.notify_channels || ['in_app', 'email']) as any,
  }));
  return EscalationPolicy.create({
    tenant_id: input.tenant_id,
    name: input.name,
    description: input.description || '',
    steps,
    repeat_count: input.repeat_count ?? 0,
    repeat_interval_minutes: input.repeat_interval_minutes ?? 30,
    created_by: input.created_by,
  });
}

export async function updateEscalationPolicy(
  tenantId: Types.ObjectId,
  id: string,
  update: Partial<{
    name: string;
    description: string;
    status: 'active' | 'disabled';
    steps: Array<{ delay_minutes: number; targets?: string[]; target_type?: string; provider_policy_id?: string; timeout_minutes?: number; note?: string; notify_channels?: string[] }>;
    repeat_count: number;
    repeat_interval_minutes: number;
  }>
): Promise<EscalationPolicyDocument> {
  const policy = await EscalationPolicy.findOne({ _id: id, tenant_id: tenantId });
  if (!policy) throw AppError.notFound('Escalation policy');

  // Guard: prevent disabling if linked to active services
  if (update.status === 'disabled' && policy.status !== 'disabled') {
    const linkedCount = await Service.countDocuments({
      escalation_policy_id: id,
      tenant_id: tenantId,
      deleted_at: null,
    });
    if (linkedCount > 0) {
      throw AppError.badRequest(`Cannot disable: linked to ${linkedCount} service(s)`);
    }
  }

  if (update.name !== undefined) policy.name = update.name;
  if (update.description !== undefined) policy.description = update.description;
  if (update.status !== undefined) policy.status = update.status;
  if (update.steps !== undefined) {
    await validateStepTargets(tenantId, update.steps);
    policy.steps = update.steps.map((s) => ({
      delay_minutes: s.delay_minutes,
      targets: (s.targets || []).map((t) => new Types.ObjectId(t)),
      target_type: (s.target_type as any) || 'user',
      provider_policy_id: s.provider_policy_id ? new Types.ObjectId(s.provider_policy_id) : undefined,
      timeout_minutes: s.timeout_minutes,
      note: s.note,
      notify_channels: (s.notify_channels || ['in_app', 'email']) as NotifyChannel[],
    })) as IEscalationStep[];
  }
  if (update.repeat_count !== undefined) policy.repeat_count = update.repeat_count;
  if (update.repeat_interval_minutes !== undefined) policy.repeat_interval_minutes = update.repeat_interval_minutes;
  await policy.save();
  return policy;
}

/**
 * Execute a provider_escalation step: creates a bridge from consumer to provider.
 * Called by the escalation engine when processing a provider_escalation step.
 */
export async function executeProviderEscalation(
  consumerTenantId: Types.ObjectId,
  incidentId: Types.ObjectId,
): Promise<void> {
  // Find the active link for this consumer
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: consumerTenantId,
    status: 'active',
  });

  if (!link) {
    logger.warn('No active provider link for consumer', { consumer_tenant_id: consumerTenantId.toString() });
    return;
  }

  if (!link.scope.includes('escalations')) {
    logger.warn('Escalations not in scope for provider link', { link_id: link._id.toString() });
    return;
  }

  // If the link has a managed_support scope, check the active support contract's
  // coverage window. Outside the window, the bridge is NOT created — the escalation
  // policy's next step (consumer's own on-call) handles the incident.
  let managedContract = null;
  if (link.scope.includes('managed_support')) {
    managedContract = await managedSupportService.resolveActiveContractInCoverage(link._id);
    if (!managedContract) {
      // Record a timeline entry on the consumer incident so the user sees *why*
      // the provider wasn't paged.
      try {
        const consumerIncident = await Incident.findOne({
          _id: incidentId,
          tenant_id: consumerTenantId,
        });
        if (consumerIncident) {
          consumerIncident.timeline.push({
            _id: new Types.ObjectId(),
            type: 'provider_escalation',
            actor_id: null,
            message: 'Provider managed support unavailable (outside coverage window)',
            metadata: { link_id: link._id.toString(), skipped: true },
            timestamp: new Date(),
          } as any);
          await consumerIncident.save();
        }
      } catch (err) {
        logger.warn('Failed to add off-coverage timeline entry', { error: (err as Error).message });
      }
      logger.info('Provider escalation skipped: outside managed-support coverage window', {
        link_id: link._id.toString(),
        consumer_tenant_id: consumerTenantId.toString(),
      });
      return;
    }
  }

  try {
    await incidentBridgeService.createBridge(
      consumerTenantId,
      incidentId,
      link.provider_tenant_id,
      managedContract ? { contract: managedContract } : undefined,
    );
    logger.info('Provider escalation bridge created', {
      consumer_tenant_id: consumerTenantId.toString(),
      incident_id: incidentId.toString(),
      provider_tenant_id: link.provider_tenant_id.toString(),
      managed_contract_id: managedContract?._id.toString() || null,
    });
  } catch (err) {
    logger.error('Failed to create provider escalation bridge', { error: (err as Error).message });
  }
}

export async function deleteEscalationPolicy(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await EscalationPolicy.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Escalation policy');
}
