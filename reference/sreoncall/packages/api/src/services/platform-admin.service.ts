import { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Tenant, TenantDocument } from '../models/tenant.model';
import { User, UserDocument } from '../models/user.model';
import { AuditLog, AuditLogDocument } from '../models/audit-log.model';
import { Ticket } from '../models/ticket.model';
import { Incident } from '../models/incident.model';
import { isDatabaseConnected } from '../config/database';
import { getRedis } from '../config/redis';
import { getConfig } from '../config/index';
import { AppError } from '../middleware/errorHandler.middleware';
import { initializeTenant } from './tenant-init.service';
import { getPlanLimitsFromDB } from './billing.service';
import { publishTenantProvisioningEvent } from './tenant-provisioning.service';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { logger } from '../utils/logger';

// ─── Overview ────────────────────────────────────────────────────────

export interface PlatformOverview {
  total_tenants: number;
  active_tenants: number;
  suspended_tenants: number;
  total_users: number;
  active_users: number;
  total_tickets: number;
  total_incidents: number;
  active_incidents: number;
  tenants_by_plan: Record<string, number>;
  recent_signups: Array<{
    id: string;
    slug: string;
    name: string;
    plan: string;
    status: string;
    created_at: string;
  }>;
}

export async function getOverview(): Promise<PlatformOverview> {
  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    totalUsers,
    activeUsers,
    totalTickets,
    totalIncidents,
    activeIncidents,
    planAgg,
    recentTenants,
  ] = await Promise.all([
    Tenant.countDocuments({ deleted_at: null }),
    Tenant.countDocuments({ status: 'active', deleted_at: null }),
    Tenant.countDocuments({ status: 'suspended', deleted_at: null }),
    User.countDocuments({ deleted_at: null }),
    User.countDocuments({ status: 'active', deleted_at: null }),
    Ticket.countDocuments({}),
    Incident.countDocuments({}),
    Incident.countDocuments({ status: { $in: ['triggered', 'acknowledged'] } }),
    Tenant.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
    Tenant.find({ deleted_at: null })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const tenants_by_plan: Record<string, number> = {};
  for (const entry of planAgg) {
    tenants_by_plan[entry._id] = entry.count;
  }

  return {
    total_tenants: totalTenants,
    active_tenants: activeTenants,
    suspended_tenants: suspendedTenants,
    total_users: totalUsers,
    active_users: activeUsers,
    total_tickets: totalTickets,
    total_incidents: totalIncidents,
    active_incidents: activeIncidents,
    tenants_by_plan,
    recent_signups: recentTenants.map((t: any) => ({
      id: t._id.toString(),
      slug: t.slug,
      name: t.name,
      plan: t.plan,
      status: t.status,
      created_at: t.createdAt?.toISOString() || new Date().toISOString(),
    })),
  };
}

// ─── Tenants ─────────────────────────────────────────────────────────

export async function listTenants(
  pagination: PaginationParams,
  filters?: { status?: string; plan?: string; search?: string }
): Promise<PaginatedResult<TenantDocument>> {
  const baseFilter: Record<string, any> = { deleted_at: null };

  if (filters?.status) {
    baseFilter.status = filters.status;
  }
  if (filters?.plan) {
    baseFilter.plan = filters.plan;
  }
  if (filters?.search) {
    baseFilter.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { slug: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const paginationWithDefaults: PaginationParams = {
    ...pagination,
    sort_by: pagination.sort_by || 'createdAt',
    sort_order: pagination.sort_order || 'desc',
  };

  const { filter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await Tenant.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await Tenant.countDocuments(baseFilter);

  return paginateResults(results, paginationWithDefaults, total);
}

export async function getTenant(tenantId: string): Promise<TenantDocument> {
  const tenant = await Tenant.findOne({
    _id: tenantId,
    deleted_at: null,
  });

  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  return tenant;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  plan?: string;
  status?: string;
}

export async function createTenant(input: CreateTenantInput): Promise<TenantDocument> {
  // Check including soft-deleted tenants (bypass the pre-find hook)
  const existing = await Tenant.findOne({ slug: input.slug }).where('status').exists(true);
  if (existing) {
    const detail = existing.deleted_at
      ? 'Tenant slug is taken by a soft-deleted tenant. Use hard delete to free the slug.'
      : 'Tenant slug already taken.';
    throw AppError.conflict(detail);
  }

  const tenant = await Tenant.create({
    slug: input.slug,
    name: input.name,
    plan: input.plan || 'free',
    status: input.status || 'active',
  });

  // Seed default resources (e.g. Default project)
  await initializeTenant(tenant._id);

  // Kick off async DNS + TLS provisioning for the tenant subdomain so the
  // invite link (<slug>.<base-domain>) resolves with a valid cert. This is
  // best-effort: the publish helper swallows its own errors so a NATS hiccup
  // never blocks tenant creation, and the worker no-ops when
  // TENANT_PROVISIONING_ENABLED is unset.
  await publishTenantProvisioningEvent({
    tenant_id: tenant._id.toString(),
    slug: tenant.slug,
    action: 'create',
    timestamp: new Date().toISOString(),
  });

  return tenant;
}

export interface UpdateTenantInput {
  name?: string;
  plan?: string;
  status?: string;
}

export async function updateTenant(
  tenantId: string,
  input: UpdateTenantInput
): Promise<TenantDocument> {
  const tenant = await Tenant.findOne({ _id: tenantId, deleted_at: null });
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  if (input.name !== undefined) tenant.name = input.name;
  if (input.plan !== undefined) {
    const previousPlan = (tenant as any).plan;
    (tenant as any).plan = input.plan;
    if (input.plan !== previousPlan) {
      const planLimits = await getPlanLimitsFromDB(input.plan);
      (tenant as any).plan_limits = planLimits;
      tenant.markModified('plan_limits');
      (tenant as any).pending_plan_change = {
        previous_plan: previousPlan,
        new_plan: input.plan,
        changed_at: new Date(),
        changed_by: 'admin',
        acknowledged: false,
      };
    }
  }
  if (input.status !== undefined) (tenant as any).status = input.status;

  await tenant.save();

  const redis = getRedis();
  const cacheKeys = [`tenant:slug:${tenant.slug}`, ...((tenant.custom_domains ?? []).map((d: string) => `tenant:domain:${d}`))];
  await Promise.all(cacheKeys.map((k: string) => redis.del(k)));

  return tenant;
}

export async function suspendTenant(tenantId: string): Promise<TenantDocument> {
  const tenant = await Tenant.findOne({ _id: tenantId, deleted_at: null });
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  if (tenant.is_platform_tenant) {
    throw AppError.badRequest('Cannot suspend the platform tenant.');
  }

  (tenant as any).status = 'suspended';
  await tenant.save();
  return tenant;
}

export async function deleteTenant(tenantId: string): Promise<TenantDocument> {
  const tenant = await Tenant.findOne({ _id: tenantId, deleted_at: null });
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  if (tenant.is_platform_tenant) {
    throw AppError.badRequest('Cannot delete the platform tenant.');
  }

  // Soft delete
  (tenant as any).status = 'deleted';
  tenant.deleted_at = new Date();
  await tenant.save();
  return tenant;
}

export async function listDeletedTenants(
  pagination: PaginationParams,
  filters?: { search?: string }
): Promise<PaginatedResult<TenantDocument>> {
  const baseFilter: Record<string, any> = { status: 'deleted', deleted_at: { $ne: null } };

  if (filters?.search) {
    baseFilter.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { slug: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const paginationWithDefaults: PaginationParams = {
    ...pagination,
    sort_by: pagination.sort_by || 'deleted_at',
    sort_order: pagination.sort_order || 'desc',
  };

  const { filter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await Tenant.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await Tenant.countDocuments(baseFilter);

  return paginateResults(results, paginationWithDefaults, total);
}

export async function restoreTenant(tenantId: string): Promise<TenantDocument> {
  const tenant = await Tenant.findOne({ _id: tenantId, status: 'deleted', deleted_at: { $ne: null } });
  if (!tenant) {
    throw AppError.notFound('Deleted tenant');
  }

  (tenant as any).status = 'active';
  tenant.deleted_at = undefined as any;
  await tenant.save();
  return tenant;
}

// ─── Hard / Cascade Delete ──────────────────────────────────────────

export interface CascadeDeleteStep {
  collection: string;
  label: string;
  deleted_count: number;
  status: 'success' | 'error';
  error?: string;
}

export interface CascadeDeleteResult {
  tenant_id: string;
  tenant_slug: string;
  steps: CascadeDeleteStep[];
  lgtm_cleanup: {
    attempted: boolean;
    results: Array<{ service: string; status: string; detail?: string }>;
  };
  total_documents_deleted: number;
  completed_at: string;
}

export async function hardDeleteTenant(tenantId: string): Promise<CascadeDeleteResult> {
  // Allow deleting both active and soft-deleted tenants
  const tenant = await Tenant.findOne({ _id: tenantId }).where('status').ne('__permanent__');
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  if (tenant.is_platform_tenant) {
    throw AppError.badRequest('Cannot delete the platform tenant.');
  }

  const tid = tenant._id;
  const steps: CascadeDeleteStep[] = [];

  // All tenant-scoped collections to cascade delete
  const collections: Array<{ model: string; label: string }> = [
    { model: 'user', label: 'Users' },
    { model: 'ticket', label: 'Tickets' },
    { model: 'ticket-comment', label: 'Ticket Comments' },
    { model: 'ticket-bridge', label: 'Ticket Bridges' },
    { model: 'ticket-workflow', label: 'Ticket Workflows' },
    { model: 'incident', label: 'Incidents' },
    { model: 'incident-bridge', label: 'Incident Bridges' },
    { model: 'change-request', label: 'Change Requests' },
    { model: 'change-request-bridge', label: 'Change Request Bridges' },
    { model: 'alert-rule', label: 'Alert Rules' },
    { model: 'dashboard', label: 'Dashboards' },
    { model: 'service', label: 'Services' },
    { model: 'oncall-schedule', label: 'On-Call Schedules' },
    { model: 'escalation-policy', label: 'Escalation Policies' },
    { model: 'postmortem', label: 'Postmortems' },
    { model: 'runbook', label: 'Runbooks' },
    { model: 'runbook-execution', label: 'Runbook Executions' },
    { model: 'synthetic-check', label: 'Synthetic Checks' },
    { model: 'synthetic-check-result', label: 'Synthetic Check Results' },
    { model: 'status-page', label: 'Status Pages' },
    { model: 'status-update', label: 'Status Updates' },
    { model: 'status-page-subscriber', label: 'Status Page Subscribers' },
    { model: 'project', label: 'Projects' },
    { model: 'team', label: 'Teams' },
    { model: 'channel', label: 'Channels' },
    { model: 'communication-channel', label: 'Communication Channels' },
    { model: 'communication-thread', label: 'Communication Threads' },
    { model: 'communication-message', label: 'Communication Messages' },
    { model: 'webhook', label: 'Webhooks' },
    { model: 'webhook-delivery', label: 'Webhook Deliveries' },
    { model: 'notification', label: 'Notifications' },
    { model: 'api-key', label: 'API Keys' },
    { model: 'scim-token', label: 'SCIM Tokens' },
    { model: 'ingestion-token', label: 'Ingestion Tokens' },
    { model: 'monitoring-integration', label: 'Monitoring Integrations' },
    { model: 'observability-connection', label: 'Observability Connections' },
    { model: 'tenant-integration', label: 'Tenant Integrations' },
    { model: 'slack-installation', label: 'Slack Installations' },
    { model: 'agent-installation', label: 'Agent Installations' },
    { model: 'agent-execution', label: 'Agent Executions' },
    { model: 'agent-approval', label: 'Agent Approvals' },
    { model: 'agent-usage', label: 'Agent Usage Records' },
    { model: 'ai-conversation', label: 'AI Conversations' },
    { model: 'sla-config', label: 'SLA Configs' },
    { model: 'slo-definition', label: 'SLO Definitions' },
    { model: 'asset', label: 'Assets' },
    { model: 'file-attachment', label: 'File Attachments' },
    { model: 'work-log', label: 'Work Logs' },
    { model: 'billing', label: 'Billing Records' },
    { model: 'audit-log', label: 'Audit Logs' },
    { model: 'counter', label: 'Counters' },
    { model: 'provider-consumer-link', label: 'Provider Links' },
    { model: 'feature-flag', label: 'Feature Flags' },
  ];

  // Use the raw mongoose connection to delete from each collection
  const mongoose = require('mongoose');
  const db = mongoose.connection.db;

  for (const col of collections) {
    try {
      // Mongoose model names use PascalCase, but we use the raw collection
      // MongoDB collection names are typically the plural lowercase form
      const collectionName = col.model.replace(/-/g, '') + 's';
      const result = await db.collection(collectionName).deleteMany({ tenant_id: tid });
      steps.push({
        collection: col.model,
        label: col.label,
        deleted_count: result.deletedCount,
        status: 'success',
      });
    } catch (err: any) {
      steps.push({
        collection: col.model,
        label: col.label,
        deleted_count: 0,
        status: 'error',
        error: err.message,
      });
    }
  }

  // LGTM stack cleanup
  const lgtmResults: CascadeDeleteResult['lgtm_cleanup']['results'] = [];
  const lgtmHost = process.env.LGTM_HOST || '10.10.1.21';

  // Mimir — delete tenant data via admin API
  try {
    const res = await fetch(`http://${lgtmHost}:9009/api/v1/admin/tsdb/delete_series`, {
      method: 'POST',
      headers: { 'X-Scope-OrgID': tenantId, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'match[]={__name__=~".+"}',
    });
    lgtmResults.push({
      service: 'Mimir (metrics)',
      status: res.ok ? 'purged' : 'failed',
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    });
  } catch (err: any) {
    lgtmResults.push({ service: 'Mimir (metrics)', status: 'skipped', detail: err.message });
  }

  // Loki — delete tenant logs via compactor/delete API
  try {
    const params = new URLSearchParams({
      query: '{__name__=~".+"}',
      start: '1970-01-01T00:00:00Z',
      end: new Date().toISOString(),
    });
    const res = await fetch(`http://${lgtmHost}:3100/loki/api/v1/delete?${params}`, {
      method: 'POST',
      headers: { 'X-Scope-OrgID': tenantId },
    });
    lgtmResults.push({
      service: 'Loki (logs)',
      status: res.ok ? 'purged' : 'failed',
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    });
  } catch (err: any) {
    lgtmResults.push({ service: 'Loki (logs)', status: 'skipped', detail: err.message });
  }

  // Tempo — no per-tenant purge API; data expires via retention
  lgtmResults.push({
    service: 'Tempo (traces)',
    status: 'retention-based',
    detail: 'Traces will expire per retention policy (7 days)',
  });

  // Delete the tenant document itself (hard delete)
  await Tenant.deleteOne({ _id: tid });
  steps.push({
    collection: 'tenant',
    label: 'Tenant Record',
    deleted_count: 1,
    status: 'success',
  });

  // Clear any cached data in Redis
  try {
    const redis = getRedis();
    const keys = await redis.keys(`*${tenantId}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Non-critical
  }

  const totalDeleted = steps.reduce((sum, s) => sum + s.deleted_count, 0);

  logger.info('Hard-deleted tenant', {
    tenant_id: tenantId,
    tenant_slug: tenant.slug,
    total_documents_deleted: totalDeleted,
    steps: steps.length,
  });

  return {
    tenant_id: tenantId,
    tenant_slug: tenant.slug,
    steps,
    lgtm_cleanup: { attempted: true, results: lgtmResults },
    total_documents_deleted: totalDeleted,
    completed_at: new Date().toISOString(),
  };
}

// ─── Impersonation ───────────────────────────────────────────────────

export interface ImpersonationResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  tenant_slug: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
}

export async function impersonateTenant(
  tenantId: string,
  adminUserId: string
): Promise<ImpersonationResult> {
  const tenant = await Tenant.findOne({ _id: tenantId, deleted_at: null });
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  // Find the first admin user in the target tenant
  const targetUser = await User.findOne({
    tenant_id: tenant._id,
    status: 'active',
    roles: { $in: ['tenant_admin'] },
  });

  if (!targetUser) {
    throw AppError.badRequest('No active admin user found in the target tenant.');
  }

  const config = getConfig();
  const jti = uuidv4();

  const payload = {
    sub: targetUser._id.toString(),
    tenant_id: tenant._id.toString(),
    email: targetUser.email,
    roles: targetUser.roles,
    jti,
    impersonated_by: adminUserId,
  };

  const access_token = jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h', // Impersonation tokens expire faster
  });

  // Store session in Redis
  const redis = getRedis();
  const sessionKey = `session:${targetUser._id}:${jti}`;
  const sessionData = JSON.stringify({
    jti,
    user_id: targetUser._id.toString(),
    tenant_id: tenant._id.toString(),
    created_at: new Date().toISOString(),
    impersonated_by: adminUserId,
    ip: 'impersonation',
  });

  redis.setex(sessionKey, 3600, sessionData).catch((err) => {
    logger.error('Failed to store impersonation session', { error: err.message });
  });

  return {
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
    tenant_slug: tenant.slug,
    user: {
      id: targetUser._id.toString(),
      email: targetUser.email,
      name: targetUser.name,
      roles: targetUser.roles,
    },
  };
}

// ─── Users ───────────────────────────────────────────────────────────

export async function listAllUsers(
  pagination: PaginationParams,
  filters?: { status?: string; role?: string; tenant_id?: string; search?: string }
): Promise<PaginatedResult<UserDocument>> {
  const baseFilter: Record<string, any> = { deleted_at: null };

  if (filters?.status) {
    baseFilter.status = filters.status;
  }
  if (filters?.role) {
    baseFilter.roles = { $in: [filters.role] };
  }
  if (filters?.tenant_id) {
    baseFilter.tenant_id = new Types.ObjectId(filters.tenant_id);
  }
  if (filters?.search) {
    baseFilter.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const paginationWithDefaults: PaginationParams = {
    ...pagination,
    sort_by: pagination.sort_by || 'createdAt',
    sort_order: pagination.sort_order || 'desc',
  };

  const { filter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await User.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await User.countDocuments(baseFilter);

  return paginateResults(results, paginationWithDefaults, total);
}

export async function getUser(userId: string): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, deleted_at: null });
  if (!user) {
    throw AppError.notFound('User');
  }
  return user;
}

export interface UpdateUserInput {
  name?: string;
  roles?: string[];
  status?: string;
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, deleted_at: null });
  if (!user) {
    throw AppError.notFound('User');
  }

  if (input.name !== undefined) user.name = input.name;
  if (input.roles !== undefined) user.roles = input.roles;
  if (input.status !== undefined) (user as any).status = input.status;

  await user.save();
  return user;
}

export async function resetUserPassword(
  userId: string,
  newPassword: string
): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, deleted_at: null }).select('+password_hash');
  if (!user) throw AppError.notFound('User');

  user.password_hash = await bcrypt.hash(newPassword, 12);
  user.force_password_change = true;
  user.failed_login_attempts = 0;
  user.locked_until = undefined;
  await user.save();
  return user;
}

export interface CreateUserForTenantInput {
  email: string;
  name: string;
  password: string;
  roles: string[];
}

export async function createUserForTenant(
  tenantId: string,
  input: CreateUserForTenantInput
): Promise<UserDocument> {
  const tenant = await Tenant.findOne({ _id: tenantId, deleted_at: null });
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  if (tenant.status !== 'active') {
    throw AppError.badRequest('Cannot create users for a non-active tenant.');
  }

  const existingUser = await User.findOne({
    tenant_id: tenant._id,
    email: input.email.toLowerCase(),
  });

  if (existingUser) {
    if (existingUser.status === 'deleted') {
      // Reactivate the soft-deleted user
      const password_hash = await bcrypt.hash(input.password, 12);
      existingUser.name = input.name;
      existingUser.password_hash = password_hash;
      existingUser.roles = input.roles;
      existingUser.status = 'active';
      existingUser.source = 'local';
      existingUser.email_verified = true;
      existingUser.force_password_change = true;
      existingUser.deleted_at = undefined;
      existingUser.invite_token = undefined;
      existingUser.failed_login_attempts = 0;
      existingUser.locked_until = undefined;
      await existingUser.save();
      return existingUser;
    }
    throw AppError.conflict('A user with this email already exists in this tenant.');
  }

  const password_hash = await bcrypt.hash(input.password, 12);

  const user = await User.create({
    tenant_id: tenant._id,
    email: input.email.toLowerCase(),
    name: input.name,
    password_hash,
    roles: input.roles,
    source: 'local',
    status: 'active',
    email_verified: true,
    force_password_change: true,
  });

  return user;
}

export async function disableUser(userId: string): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, deleted_at: null });
  if (!user) throw AppError.notFound('User');

  if (user.roles.includes('platform_admin')) {
    throw AppError.badRequest('Cannot disable a platform admin user.');
  }

  user.status = 'disabled';
  await user.save();
  return user;
}

// ─── System Health ───────────────────────────────────────────────────

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    name: string;
    status: 'up' | 'down' | 'degraded';
    latency_ms?: number;
    details?: string;
  }[];
  timestamp: string;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const services: SystemHealth['services'] = [];

  // MongoDB
  const mongoStart = Date.now();
  try {
    const isConnected = isDatabaseConnected();
    services.push({
      name: 'mongodb',
      status: isConnected ? 'up' : 'down',
      latency_ms: Date.now() - mongoStart,
    });
  } catch {
    services.push({ name: 'mongodb', status: 'down', latency_ms: Date.now() - mongoStart });
  }

  // Redis
  const redisStart = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    services.push({
      name: 'redis',
      status: 'up',
      latency_ms: Date.now() - redisStart,
    });
  } catch {
    services.push({ name: 'redis', status: 'down', latency_ms: Date.now() - redisStart });
  }

  // NATS
  try {
    const { getNatsConnection } = require('../config/nats');
    const nc = getNatsConnection();
    services.push({
      name: 'nats',
      status: nc ? 'up' : 'down',
    });
  } catch {
    services.push({ name: 'nats', status: 'down' });
  }

  // Meilisearch
  const meiliStart = Date.now();
  try {
    const { getMeiliClient } = require('../config/meilisearch');
    const client = getMeiliClient();
    await client.health();
    services.push({
      name: 'meilisearch',
      status: 'up',
      latency_ms: Date.now() - meiliStart,
    });
  } catch {
    services.push({ name: 'meilisearch', status: 'down', latency_ms: Date.now() - meiliStart });
  }

  const downCount = services.filter((s) => s.status === 'down').length;
  const overallStatus: SystemHealth['status'] =
    downCount === 0 ? 'healthy' : downCount >= 2 ? 'unhealthy' : 'degraded';

  return {
    status: overallStatus,
    services,
    timestamp: new Date().toISOString(),
  };
}

// ─── Audit Logs (cross-tenant) ───────────────────────────────────────

export async function getAuditLogs(
  pagination: PaginationParams,
  filters?: { tenant_id?: string; action?: string; resource_type?: string; actor_email?: string }
): Promise<PaginatedResult<AuditLogDocument>> {
  const baseFilter: Record<string, any> = {};

  if (filters?.tenant_id) {
    baseFilter.tenant_id = new Types.ObjectId(filters.tenant_id);
  }
  if (filters?.action) {
    baseFilter.action = { $regex: filters.action, $options: 'i' };
  }
  if (filters?.resource_type) {
    baseFilter.resource_type = filters.resource_type;
  }
  if (filters?.actor_email) {
    baseFilter['actor.email'] = { $regex: filters.actor_email, $options: 'i' };
  }

  const paginationWithDefaults: PaginationParams = {
    ...pagination,
    sort_by: pagination.sort_by || 'timestamp',
    sort_order: pagination.sort_order || 'desc',
  };

  const { filter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await AuditLog.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await AuditLog.countDocuments(baseFilter);

  return paginateResults(results, paginationWithDefaults, total);
}

// ─── Platform Settings ───────────────────────────────────────────────

export interface PlatformSettings {
  maintenance_mode: boolean;
  signup_enabled: boolean;
  default_plan: string;
  max_tenants: number;
}

const SETTINGS_KEY = 'platform:settings';

const DEFAULT_SETTINGS: PlatformSettings = {
  maintenance_mode: false,
  signup_enabled: true,
  default_plan: 'free',
  max_tenants: 1000,
};

export async function getSettings(): Promise<PlatformSettings> {
  try {
    const redis = getRedis();
    const data = await redis.get(SETTINGS_KEY);
    if (data) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export async function updateSettings(
  updates: Partial<PlatformSettings>
): Promise<PlatformSettings> {
  const current = await getSettings();
  const merged = { ...current, ...updates };

  const redis = getRedis();
  await redis.set(SETTINGS_KEY, JSON.stringify(merged));

  return merged;
}
