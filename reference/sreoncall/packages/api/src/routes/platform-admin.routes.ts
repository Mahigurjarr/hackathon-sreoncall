import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as platformAdminService from '../services/platform-admin.service';
import * as dsarService from '../services/dsar.service';
import * as onboardingService from '../services/onboarding.service';
import { sendWelcomeCredentialsEmail } from '../services/email.service';
import { rbac } from '../middleware/rbac.middleware';
import { parsePaginationParams } from '../utils/pagination';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { Service } from '../models/service.model';

const router = Router();

// All routes require platform:admin permission (only platform_admin role has '*')
const requirePlatformAdmin = rbac('platform:admin');

// ─── Serializers ─────────────────────────────────────────────────────

function serializeTenant(doc: any, counts?: { user_count?: number; service_count?: number }) {
  return {
    id: doc._id?.toString() || doc.id,
    slug: doc.slug,
    name: doc.name,
    status: doc.status,
    plan: doc.plan,
    plan_limits: doc.plan_limits,
    is_platform_tenant: doc.is_platform_tenant || false,
    custom_domains: doc.custom_domains || [],
    created_at: doc.createdAt?.toISOString() || doc.created_at,
    updated_at: doc.updatedAt?.toISOString() || doc.updated_at,
    deleted_at: doc.deleted_at?.toISOString() || null,
    user_count: counts?.user_count ?? 0,
    service_count: counts?.service_count ?? 0,
  };
}

function serializeUser(doc: any) {
  return {
    id: doc._id?.toString() || doc.id,
    tenant_id: doc.tenant_id?.toString(),
    email: doc.email,
    name: doc.name,
    roles: doc.roles,
    status: doc.status,
    source: doc.source,
    avatar_url: doc.avatar_url || null,
    email_verified: doc.email_verified || false,
    last_login_at: doc.last_login_at?.toISOString() || null,
    created_at: doc.createdAt?.toISOString() || doc.created_at,
    updated_at: doc.updatedAt?.toISOString() || doc.updated_at,
  };
}

function serializeAuditLog(doc: any) {
  return {
    id: doc._id?.toString() || doc.id,
    tenant_id: doc.tenant_id?.toString(),
    timestamp: doc.timestamp?.toISOString(),
    actor: doc.actor,
    action: doc.action,
    resource_type: doc.resource_type,
    resource_id: doc.resource_id || null,
    changes: doc.changes || [],
    result: doc.result,
  };
}

// ─── Zod Schemas ─────────────────────────────────────────────────────

const createTenantSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(200),
  plan: z.enum(['free', 'startup', 'growth', 'enterprise']).default('free'),
  status: z.enum(['active', 'suspended', 'provisioning']).default('active'),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  plan: z.enum(['free', 'startup', 'growth', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'provisioning']).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  roles: z
    .array(z.enum(['platform_admin', 'tenant_admin', 'manager', 'agent', 'viewer']))
    .min(1)
    .optional(),
  status: z.enum(['active', 'invited', 'disabled']).optional(),
});

const createTenantUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
  roles: z
    .array(z.enum(['tenant_admin', 'manager', 'agent', 'viewer']))
    .min(1),
});

const updateSettingsSchema = z.object({
  maintenance_mode: z.boolean().optional(),
  signup_enabled: z.boolean().optional(),
  default_plan: z.enum(['free', 'starter', 'business', 'pro', 'enterprise']).optional(),
  max_tenants: z.number().int().min(1).max(100000).optional(),
});

// ─── Overview ────────────────────────────────────────────────────────

// GET /api/v1/platform-admin/overview
router.get('/overview', requirePlatformAdmin, async (_req: Request, res: Response) => {
  const overview = await platformAdminService.getOverview();
  res.json(overview);
});

// ─── Tenants ─────────────────────────────────────────────────────────

// GET /api/v1/platform-admin/tenants
router.get('/tenants', requirePlatformAdmin, async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    status: req.query.status as string | undefined,
    plan: req.query.plan as string | undefined,
    search: req.query.search as string | undefined,
  };

  const result = await platformAdminService.listTenants(pagination, filters);

  const tenantIds = result.data.map((t: any) => t._id);
  const [userCounts, serviceCounts] = await Promise.all([
    User.aggregate([
      { $match: { tenant_id: { $in: tenantIds }, status: { $ne: 'deleted' } } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]),
    Service.aggregate([
      { $match: { tenant_id: { $in: tenantIds } } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]),
  ]);

  const userCountMap: Record<string, number> = {};
  for (const row of userCounts) userCountMap[String(row._id)] = row.count;

  const serviceCountMap: Record<string, number> = {};
  for (const row of serviceCounts) serviceCountMap[String(row._id)] = row.count;

  res.json({
    data: result.data.map((t: any) => {
      const id = String(t._id);
      return serializeTenant(t, { user_count: userCountMap[id] ?? 0, service_count: serviceCountMap[id] ?? 0 });
    }),
    pagination: result.pagination,
  });
});

// POST /api/v1/platform-admin/tenants
router.post('/tenants', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = createTenantSchema.parse(req.body);
  const tenant = await platformAdminService.createTenant(body);
  res.status(201).json(serializeTenant(tenant));
});

// GET /api/v1/platform-admin/tenants/:id
router.get('/tenants/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const tenant = await platformAdminService.getTenant(req.params.id as string);
  res.json(serializeTenant(tenant));
});

// PATCH /api/v1/platform-admin/tenants/:id
router.patch('/tenants/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = updateTenantSchema.parse(req.body);
  const tenant = await platformAdminService.updateTenant(req.params.id as string, body);
  res.json(serializeTenant(tenant));
});

// DELETE /api/v1/platform-admin/tenants/:id?mode=soft|hard
router.delete('/tenants/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const mode = (req.query.mode as string) || 'soft';

  if (mode === 'hard') {
    const result = await platformAdminService.hardDeleteTenant(req.params.id as string);
    res.json(result);
  } else {
    const tenant = await platformAdminService.deleteTenant(req.params.id as string);
    res.json(serializeTenant(tenant));
  }
});

// GET /api/v1/platform-admin/tenants-deleted
router.get('/tenants-deleted', requirePlatformAdmin, async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    search: req.query.search as string | undefined,
  };

  const result = await platformAdminService.listDeletedTenants(pagination, filters);
  res.json({
    data: result.data.map((t: any) => serializeTenant(t)),
    pagination: result.pagination,
  });
});

// POST /api/v1/platform-admin/tenants/:id/restore
router.post('/tenants/:id/restore', requirePlatformAdmin, async (req: Request, res: Response) => {
  const tenant = await platformAdminService.restoreTenant(req.params.id as string);
  res.json(serializeTenant(tenant));
});

// POST /api/v1/platform-admin/tenants/:id/suspend
router.post('/tenants/:id/suspend', requirePlatformAdmin, async (req: Request, res: Response) => {
  const tenant = await platformAdminService.suspendTenant(req.params.id as string);
  res.json(serializeTenant(tenant));
});

// POST /api/v1/platform-admin/tenants/:id/impersonate
router.post('/tenants/:id/impersonate', requirePlatformAdmin, async (req: Request, res: Response) => {
  const result = await platformAdminService.impersonateTenant(
    req.params.id as string,
    req.userId.toString(),
  );
  res.json(result);
});

// POST /api/v1/platform-admin/tenants/:id/users
router.post('/tenants/:id/users', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = createTenantUserSchema.parse(req.body);
  const user = await platformAdminService.createUserForTenant(req.params.id as string, body);

  // Send welcome email with credentials (fire-and-forget)
  const tenant = await Tenant.findById(req.params.id);
  if (tenant) {
    sendWelcomeCredentialsEmail({
      to: user.email,
      name: user.name,
      orgName: tenant.name,
      orgSlug: tenant.slug,
      password: body.password,
    }).catch((err) => console.error('[platform-admin] Failed to send welcome email:', err));
  }

  res.status(201).json(serializeUser(user));
});

// ─── Users ───────────────────────────────────────────────────────────

// GET /api/v1/platform-admin/users
router.get('/users', requirePlatformAdmin, async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    status: req.query.status as string | undefined,
    role: req.query.role as string | undefined,
    tenant_id: req.query.tenant_id as string | undefined,
    search: req.query.search as string | undefined,
  };

  const result = await platformAdminService.listAllUsers(pagination, filters);
  res.json({
    data: result.data.map(serializeUser),
    pagination: result.pagination,
  });
});

// GET /api/v1/platform-admin/users/:id
router.get('/users/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const user = await platformAdminService.getUser(req.params.id as string);
  res.json(serializeUser(user));
});

// PATCH /api/v1/platform-admin/users/:id
router.patch('/users/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = updateUserSchema.parse(req.body);
  const user = await platformAdminService.updateUser(req.params.id as string, body);
  res.json(serializeUser(user));
});

// POST /api/v1/platform-admin/users/:id/reset-password
router.post('/users/:id/reset-password', requirePlatformAdmin, async (req: Request, res: Response) => {
  const { password } = z.object({ password: z.string().min(8).max(128) }).parse(req.body);
  const user = await platformAdminService.resetUserPassword(req.params.id as string, password);
  res.json({ message: 'Password reset successfully', user: serializeUser(user) });
});

// POST /api/v1/platform-admin/users/:id/disable
router.post('/users/:id/disable', requirePlatformAdmin, async (req: Request, res: Response) => {
  const user = await platformAdminService.disableUser(req.params.id as string);
  res.json(serializeUser(user));
});

// ─── System Health ───────────────────────────────────────────────────

// GET /api/v1/platform-admin/system/health
router.get('/system/health', requirePlatformAdmin, async (_req: Request, res: Response) => {
  const health = await platformAdminService.getSystemHealth();
  res.json(health);
});

// ─── Audit Logs ──────────────────────────────────────────────────────

// GET /api/v1/platform-admin/audit-logs
router.get('/audit-logs', requirePlatformAdmin, async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    tenant_id: req.query.tenant_id as string | undefined,
    action: req.query.action as string | undefined,
    resource_type: req.query.resource_type as string | undefined,
    actor_email: req.query.actor_email as string | undefined,
  };

  const result = await platformAdminService.getAuditLogs(pagination, filters);
  res.json({
    data: result.data.map(serializeAuditLog),
    pagination: result.pagination,
  });
});

// ─── Settings ────────────────────────────────────────────────────────

// GET /api/v1/platform-admin/settings
router.get('/settings', requirePlatformAdmin, async (_req: Request, res: Response) => {
  const settings = await platformAdminService.getSettings();
  res.json(settings);
});

// PATCH /api/v1/platform-admin/settings
router.patch('/settings', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = updateSettingsSchema.parse(req.body);
  const settings = await platformAdminService.updateSettings(body);
  res.json(settings);
});

// ─── DSAR Management ────────────────────────────────────────────────

// GET /api/v1/platform-admin/dsar — list all DSAR requests
router.get('/dsar', requirePlatformAdmin, async (req: Request, res: Response) => {
  const filters = {
    status: req.query.status as string | undefined,
    tenant_id: req.query.tenant_id as string | undefined,
  };

  const requests = await dsarService.listAllDsarRequests(filters);
  res.json({
    data: requests.map((r) => ({
      id: r._id,
      tenant_id: r.tenant_id,
      user_id: r.user_id,
      type: r.type,
      status: r.status,
      requested_at: r.requested_at.toISOString(),
      completed_at: r.completed_at?.toISOString() || null,
      notes: r.notes || null,
    })),
  });
});

// PATCH /api/v1/platform-admin/dsar/:id — update DSAR request status
router.patch('/dsar/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = z.object({
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    notes: z.string().max(2000).optional(),
  }).parse(req.body);

  const request = await dsarService.updateDsarStatus(req.params.id as string, body.status, {
    notes: body.notes,
  });

  if (!request) {
    res.status(404).json({ detail: 'DSAR request not found.' });
    return;
  }

  res.json({
    id: request._id,
    type: request.type,
    status: request.status,
    requested_at: request.requested_at.toISOString(),
    completed_at: request.completed_at?.toISOString() || null,
    notes: request.notes || null,
  });
});

// ─── Onboarding ─────────────────────────────────────────────────────

function serializeOnboarding(doc: any) {
  return {
    id: doc._id?.toString() || doc.id,
    tenant_name: doc.tenant_name,
    tenant_slug: doc.tenant_slug,
    contact_email: doc.contact_email,
    assignee_email: doc.assignee_email,
    status: doc.status,
    token: doc.token || null,
    token_expires_at: doc.token_expires_at?.toISOString() || null,
    form_data: doc.form_data || null,
    submitted_at: doc.submitted_at?.toISOString() || null,
    reviewed_by: doc.reviewed_by?.toString() || null,
    reviewed_at: doc.reviewed_at?.toISOString() || null,
    review_notes: doc.review_notes || null,
    tenant_id: doc.tenant_id?.toString() || null,
    created_by: doc.created_by?.toString(),
    created_at: doc.createdAt?.toISOString() || doc.created_at,
    updated_at: doc.updatedAt?.toISOString() || doc.updated_at,
  };
}

const createOnboardingSchema = z.object({
  tenant_name: z.string().min(1).max(200),
  tenant_slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens'),
  contact_email: z.string().email().max(255),
  assignee_email: z.string().email().max(255),
});

// GET /api/v1/platform-admin/onboarding
router.get('/onboarding', requirePlatformAdmin, async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    status: req.query.status as string | undefined,
    search: req.query.search as string | undefined,
  };

  const result = await onboardingService.listOnboardings(pagination, filters);
  res.json({
    data: result.data.map(serializeOnboarding),
    pagination: result.pagination,
  });
});

// POST /api/v1/platform-admin/onboarding
router.post('/onboarding', requirePlatformAdmin, async (req: Request, res: Response) => {
  const body = createOnboardingSchema.parse(req.body);
  const onboarding = await onboardingService.createOnboarding({
    ...body,
    created_by: req.userId.toString(),
  });
  res.status(201).json(serializeOnboarding(onboarding));
});

// GET /api/v1/platform-admin/onboarding/check-slug
router.get('/onboarding/check-slug', requirePlatformAdmin, async (req: Request, res: Response) => {
  const slug = req.query.slug as string;
  if (!slug) {
    res.status(400).json({ detail: 'slug query parameter is required.' });
    return;
  }
  const result = await onboardingService.checkSlugAvailability(slug);
  res.json(result);
});

// GET /api/v1/platform-admin/onboarding/:id
router.get('/onboarding/:id', requirePlatformAdmin, async (req: Request, res: Response) => {
  const onboarding = await onboardingService.getOnboardingById(req.params.id as string);
  if (!onboarding) {
    res.status(404).json({ detail: 'Onboarding not found.' });
    return;
  }
  res.json(serializeOnboarding(onboarding));
});

// PATCH /api/v1/platform-admin/onboarding/:id/approve
router.patch('/onboarding/:id/approve', requirePlatformAdmin, async (req: Request, res: Response) => {
  const { notes } = z.object({ notes: z.string().max(2000).optional() }).parse(req.body || {});
  const onboarding = await onboardingService.approveOnboarding(
    req.params.id as string,
    req.userId.toString(),
    notes,
  );
  res.json(serializeOnboarding(onboarding));
});

// PATCH /api/v1/platform-admin/onboarding/:id/reject
router.patch('/onboarding/:id/reject', requirePlatformAdmin, async (req: Request, res: Response) => {
  const { notes } = z.object({ notes: z.string().max(2000).optional() }).parse(req.body || {});
  const onboarding = await onboardingService.rejectOnboarding(
    req.params.id as string,
    req.userId.toString(),
    notes,
  );
  res.json(serializeOnboarding(onboarding));
});

export default router;
