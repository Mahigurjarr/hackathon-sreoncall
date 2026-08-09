import { Types } from 'mongoose';
import { Tenant, TenantDocument, TenantType } from '../../models/tenant.model';
import { User } from '../../models/user.model';
import { Incident } from '../../models/incident.model';
import { Ticket } from '../../models/ticket.model';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../../utils/pagination';
import { AppError } from '../../middleware/errorHandler.middleware';
import { notifyPlanChange } from '../plan-change-notification.service';
import { getPlanLimitsFromDB } from '../billing.service';
import { getRedis } from '../../config/redis';
import { logger } from '../../utils/logger';

interface TenantAdminFilter {
  search?: string;
  type?: string;
  plan?: string;
  status?: string;
}

export async function listAllTenants(
  filter: TenantAdminFilter,
  pagination: PaginationParams,
): Promise<PaginatedResult<TenantDocument>> {
  const baseFilter: Record<string, any> = {};

  if (filter.type) baseFilter.type = filter.type;
  if (filter.plan) baseFilter.plan = filter.plan;
  if (filter.status) baseFilter.status = filter.status;
  if (filter.search) {
    baseFilter.$or = [
      { name: { $regex: filter.search, $options: 'i' } },
      { slug: { $regex: filter.search, $options: 'i' } },
    ];
  }

  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await Tenant.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1);
  const total = await Tenant.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function getTenantDetail(tenantId: string) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');

  const userCount = await User.countDocuments({ tenant_id: tenant._id, status: 'active' });
  const openIncidents = await Incident.countDocuments({ tenant_id: tenant._id, status: { $nin: ['resolved', 'closed'] } });
  const totalIncidents = await Incident.countDocuments({ tenant_id: tenant._id });
  const totalTickets = await Ticket.countDocuments({ tenant_id: tenant._id });

  return {
    tenant,
    stats: {
      user_count: userCount,
      open_incidents: openIncidents,
      total_incidents: totalIncidents,
      total_tickets: totalTickets,
    },
  };
}

const VALID_TYPE_TRANSITIONS: Record<TenantType, TenantType[]> = {
  standalone: ['provider', 'consumer'],
  provider: ['standalone'],
  consumer: ['standalone'],
  platform: [],
};

async function invalidateTenantCache(tenant: TenantDocument): Promise<void> {
  const redis = getRedis();
  const keys = [`tenant:slug:${tenant.slug}`];
  for (const domain of tenant.custom_domains || []) {
    keys.push(`tenant:domain:${domain}`);
  }
  await Promise.all(keys.map((k) => redis.del(k)));
}

export async function updateTenantType(tenantId: string, type: TenantType): Promise<TenantDocument> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');

  const allowed = VALID_TYPE_TRANSITIONS[tenant.type] || [];
  if (!allowed.includes(type)) {
    throw AppError.badRequest(`Cannot transition from '${tenant.type}' to '${type}'`);
  }

  tenant.type = type;
  await tenant.save();
  await invalidateTenantCache(tenant);
  return tenant;
}

export async function updateTenantPlan(
  tenantId: string,
  plan: string,
  planLimits?: Record<string, any>,
): Promise<TenantDocument> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');

  const previousPlan = tenant.plan;
  tenant.plan = plan as any;
  if (planLimits) {
    Object.assign(tenant.plan_limits, planLimits);
  } else if (previousPlan !== plan) {
    // Auto-refresh canonical plan limits when plan changes without an explicit override
    const canonical = await getPlanLimitsFromDB(plan);
    Object.assign(tenant.plan_limits, canonical);
  }
  // Fix 2: Object.assign on a nested Mongoose subdoc mutates the object
  // in-place without going through Mongoose setters, so the path isn't
  // marked dirty and tenant.save() silently skips it.
  tenant.markModified('plan_limits');

  // Set pending plan change if plan actually changed
  if (previousPlan !== plan) {
    tenant.pending_plan_change = {
      previous_plan: previousPlan,
      new_plan: plan,
      changed_at: new Date(),
      changed_by: 'admin',
      acknowledged: false,
    };
  }

  await tenant.save();
  await invalidateTenantCache(tenant);

  // Fix 1: Invalidate the Redis tenant cache so the customer's next request
  // picks up the new plan immediately instead of waiting up to 60s for TTL.
  try {
    const redis = getRedis();
    await redis.del(`tenant:slug:${tenant.slug}`);
  } catch (err: any) {
    logger.warn('Failed to invalidate tenant cache after plan update', {
      tenantId: tenant._id,
      slug: tenant.slug,
      error: err.message,
    });
  }

  // Send notifications (fire-and-forget)
  if (previousPlan !== plan) {
    notifyPlanChange(tenant._id, previousPlan, plan, 'admin').catch(() => {});
  }

  return tenant;
}

export async function suspendTenant(tenantId: string): Promise<TenantDocument> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');
  if (tenant.status === 'deleted') throw AppError.badRequest('Cannot suspend a deleted tenant');

  tenant.status = 'suspended';
  await tenant.save();
  await invalidateTenantCache(tenant);
  return tenant;
}

export async function reactivateTenant(tenantId: string): Promise<TenantDocument> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');
  if (tenant.status !== 'suspended') throw AppError.badRequest('Tenant is not suspended');

  tenant.status = 'active';
  await tenant.save();
  await invalidateTenantCache(tenant);
  return tenant;
}

export async function softDeleteTenant(tenantId: string): Promise<void> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');

  tenant.status = 'deleted';
  tenant.deleted_at = new Date();
  await tenant.save();
  await invalidateTenantCache(tenant);
}
