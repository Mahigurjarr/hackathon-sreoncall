import { BusinessImpactConfig, BusinessImpactConfigDocument } from '../models/business-impact-config.model';
import { Incident } from '../models/incident.model';
import { SlaConfig } from '../models/sla-config.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { Service } from '../models/service.model';
import * as lgtm from './lgtm-query.service';

export interface CreateBusinessImpactConfigInput {
  service_id: string;
  revenue_per_request_cents?: number | null;
  avg_requests_per_minute?: number | null;
  affected_user_scope?: 'all' | 'subset' | 'internal_only';
  estimated_users_affected_percent?: number;
  total_user_count?: number | null;
  customer_tiers?: Array<{ tier: string; count: number; sla_commitment: string | null }>;
  sla_config_id?: string | null;
  support_escalation_threshold_minutes?: number | null;
  notes?: string | null;
}

export interface UpdateBusinessImpactConfigInput {
  revenue_per_request_cents?: number | null;
  avg_requests_per_minute?: number | null;
  affected_user_scope?: 'all' | 'subset' | 'internal_only';
  estimated_users_affected_percent?: number;
  total_user_count?: number | null;
  customer_tiers?: Array<{ tier: string; count: number; sla_commitment: string | null }>;
  sla_config_id?: string | null;
  support_escalation_threshold_minutes?: number | null;
  notes?: string | null;
}

export interface ListBusinessImpactConfigFilter {
  service_id?: string;
  limit?: number;
  cursor?: string;
}

export async function list(tenantId: string, filter: ListBusinessImpactConfigFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };

  if (filter.service_id) query.service_id = filter.service_id;
  if (filter.cursor) query._id = { $gt: filter.cursor };

  const docs = await BusinessImpactConfig.find(query)
    .populate('service_id', 'name type current_status')
    .populate('updated_by', 'name email')
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
      total: await BusinessImpactConfig.countDocuments({ tenant_id: tenantId }),
    },
  };
}

export async function getById(tenantId: string, id: string) {
  const doc = await BusinessImpactConfig.findOne({ _id: id, tenant_id: tenantId })
    .populate('service_id', 'name type current_status')
    .populate('updated_by', 'name email')
    .lean();
  if (!doc) throw AppError.notFound('Business impact config not found');
  return doc;
}

export async function create(tenantId: string, userId: string, input: CreateBusinessImpactConfigInput) {
  const doc = await BusinessImpactConfig.create({
    tenant_id: tenantId,
    service_id: input.service_id,
    revenue_per_request_cents: input.revenue_per_request_cents ?? null,
    avg_requests_per_minute: input.avg_requests_per_minute ?? null,
    affected_user_scope: input.affected_user_scope ?? 'all',
    estimated_users_affected_percent: input.estimated_users_affected_percent ?? 100,
    total_user_count: input.total_user_count ?? null,
    customer_tiers: input.customer_tiers ?? [],
    sla_config_id: input.sla_config_id ?? null,
    support_escalation_threshold_minutes: input.support_escalation_threshold_minutes ?? null,
    notes: input.notes ?? null,
    updated_by: userId,
  });
  return doc.toObject();
}

export async function update(tenantId: string, id: string, userId: string, input: UpdateBusinessImpactConfigInput) {
  const update: any = { updated_by: userId };

  if (input.revenue_per_request_cents !== undefined) update.revenue_per_request_cents = input.revenue_per_request_cents;
  if (input.avg_requests_per_minute !== undefined) update.avg_requests_per_minute = input.avg_requests_per_minute;
  if (input.affected_user_scope !== undefined) update.affected_user_scope = input.affected_user_scope;
  if (input.estimated_users_affected_percent !== undefined) update.estimated_users_affected_percent = input.estimated_users_affected_percent;
  if (input.total_user_count !== undefined) update.total_user_count = input.total_user_count;
  if (input.customer_tiers !== undefined) update.customer_tiers = input.customer_tiers;
  if (input.sla_config_id !== undefined) update.sla_config_id = input.sla_config_id;
  if (input.support_escalation_threshold_minutes !== undefined) update.support_escalation_threshold_minutes = input.support_escalation_threshold_minutes;
  if (input.notes !== undefined) update.notes = input.notes;

  const doc = await BusinessImpactConfig.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: update },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Business impact config not found');
  return doc;
}

export async function remove(tenantId: string, id: string) {
  const doc = await BusinessImpactConfig.findOneAndDelete({ _id: id, tenant_id: tenantId });
  if (!doc) throw AppError.notFound('Business impact config not found');
}

export async function calculateImpact(tenantId: string, incidentId: string) {
  const incident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId }).lean();
  if (!incident) throw AppError.notFound('Incident not found');

  const affectedServiceIds = ((incident as any).affected_service_ids ?? []).map((s: any) => s.toString());

  // Fetch impact configs for all affected services
  const configs = await BusinessImpactConfig.find({
    tenant_id: tenantId,
    service_id: { $in: affectedServiceIds },
  }).lean();

  if (configs.length === 0) {
    return {
      incident_id: incidentId,
      revenue_impact_per_hour_cents: null,
      users_affected: null,
      customer_tiers: [],
      sla_at_risk: [],
      calculated_at: new Date().toISOString(),
    };
  }

  // Aggregate impact across all affected services
  // Formula: revenue_impact_per_hour = (avg_requests_per_minute * 60) * revenue_per_request_cents * (error_rate / 100)
  // Query real-time error rate from LGTM; fall back to 100% during active incident
  let estimatedErrorRate = 100;
  try {
    const affectedServices = await Service.find({ _id: { $in: affectedServiceIds }, tenant_id: tenantId }).lean();
    if (affectedServices.length > 0) {
      const primarySvc = affectedServices[0] as any;
      const health = await lgtm.getServiceHealth(tenantId, primarySvc.name);
      if (health.error_rate_percent != null) {
        // Use real error rate, but floor at 1% to avoid zero-impact during active incidents
        estimatedErrorRate = Math.max(health.error_rate_percent, 1);
      }
    }
  } catch {
    // LGTM unreachable — use 100% default
  }

  let totalRevenuePerHour = 0;
  let totalUsersAffected = 0;
  const allTiers: Array<{ tier: string; count: number; sla_commitment: string | null }> = [];

  for (const config of configs) {
    if (config.revenue_per_request_cents != null && config.avg_requests_per_minute != null) {
      const hourlyRevenue = (config.avg_requests_per_minute * 60)
        * config.revenue_per_request_cents
        * (estimatedErrorRate / 100);
      totalRevenuePerHour += hourlyRevenue;
    }

    if (config.total_user_count != null) {
      const affected = config.total_user_count
        * (config.estimated_users_affected_percent / 100)
        * (estimatedErrorRate / 100);
      totalUsersAffected += Math.round(affected);
    }

    for (const tier of config.customer_tiers) {
      allTiers.push(tier);
    }
  }

  // Calculate SLA at risk using sla_config_id and incident duration
  const slaAtRisk: Array<{ customer: string; sla: string; remaining_minutes: number; breach_eta: string | null }> = [];
  try {
    const slaConfigIds = configs
      .map((c) => c.sla_config_id)
      .filter((id): id is NonNullable<typeof id> => id != null);

    if (slaConfigIds.length > 0) {
      const slaConfigs = await SlaConfig.find({
        _id: { $in: slaConfigIds },
        tenant_id: tenantId,
        enabled: true,
      }).lean();

      const incidentCreatedAt = new Date((incident as any).createdAt ?? (incident as any).created_at ?? Date.now());
      const incidentDurationMinutes = (Date.now() - incidentCreatedAt.getTime()) / 60000;

      for (const config of configs) {
        if (!config.sla_config_id) continue;
        const slaConfig = slaConfigs.find((s) => s._id.toString() === config.sla_config_id!.toString());
        if (!slaConfig) continue;

        const resolutionBudget = slaConfig.resolution_time_minutes;
        const remaining = resolutionBudget - incidentDurationMinutes;
        // Burn rate: how fast we are consuming budget (1.0 = normal, >1.0 = faster than expected)
        const burnRate = incidentDurationMinutes > 0 ? incidentDurationMinutes / resolutionBudget : 0;
        const breachEta = remaining > 0
          ? new Date(Date.now() + remaining * 60000).toISOString()
          : null; // already breached

        // Use customer tier names or service name as customer identifier
        const customerLabel = config.customer_tiers.length > 0
          ? config.customer_tiers.map((t) => `${t.tier} (${t.count})`).join(', ')
          : `Service ${config.service_id.toString()}`;

        slaAtRisk.push({
          customer: customerLabel,
          sla: `${slaConfig.name} — resolve within ${resolutionBudget}min`,
          remaining_minutes: Math.round(Math.max(remaining, 0)),
          breach_eta: breachEta,
        });
      }
    }
  } catch {
    // SLA calculation failed — return empty array gracefully
  }

  return {
    incident_id: incidentId,
    revenue_impact_per_hour_cents: totalRevenuePerHour > 0 ? Math.round(totalRevenuePerHour) : null,
    users_affected: totalUsersAffected > 0 ? totalUsersAffected : null,
    customer_tiers: allTiers,
    sla_at_risk: slaAtRisk,
    calculated_at: new Date().toISOString(),
  };
}
