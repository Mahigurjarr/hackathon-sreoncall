import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import * as userService from '../services/user.service';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

const inviteUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  roles: z.array(z.string()).optional(),
});

const notificationPrefsSchema = z.object({
  email: z.boolean().optional(),
  in_app: z.boolean().optional(),
  sms: z.boolean().optional(),
  slack: z.boolean().optional(),
  voice: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
  ticket_assigned: z.boolean().optional(),
  ticket_updated: z.boolean().optional(),
  ticket_commented: z.boolean().optional(),
  mention: z.boolean().optional(),
  sla_breach: z.boolean().optional(),
  channels: z.object({
    incident: z.boolean().optional(),
    ticket: z.boolean().optional(),
    oncall: z.boolean().optional(),
    system: z.boolean().optional(),
  }).optional(),
  quiet_hours: z.object({
    enabled: z.boolean().optional(),
    start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    timezone: z.string().min(1).max(100).optional(),
  }).optional(),
});

// NOTE: `roles` is intentionally NOT in this schema — role changes go through
// the dedicated PUT /:id/roles endpoint, which rejects self-updates and
// platform-level roles. Prevents mass-assignment self-escalation to
// platform_admin / super_admin (F-01 in security assessment 2026-04-21).
const updateUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  avatar_url: z.string().url().nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  notification_preferences: notificationPrefsSchema.optional(),
});

// Tenant-safe role names. Platform-level roles (platform_admin, super_admin)
// must be assigned out-of-band — never from an authenticated tenant user.
const TENANT_ASSIGNABLE_ROLES = ['viewer', 'agent', 'manager', 'tenant_admin'] as const;

// Role rank drives the "cannot assign above my own level" check. A caller
// can assign any role whose rank is ≤ their own highest role rank.
const ROLE_RANK: Record<string, number> = {
  viewer: 1,
  agent: 2,
  manager: 3,
  tenant_admin: 4,
  platform_admin: 5,
};

function highestRoleRank(roles: string[] | undefined): number {
  if (!roles || roles.length === 0) return 0;
  return Math.max(0, ...roles.map((r) => ROLE_RANK[r] ?? 0));
}

const updateRolesSchema = z.object({
  roles: z
    .array(z.enum(TENANT_ASSIGNABLE_ROLES))
    .min(1)
    .max(4),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  avatar_url: z
    .union([z.string().url(), z.string().regex(/^\/(avatars\/.+\.(svg|png)|api\/v1\/storage\/avatar\/.+)$/)])
    .nullable()
    .optional(),
  timezone: z.string().min(1).max(100).optional(),
  phone_number: z.string().max(20).optional(),
  notification_preferences: notificationPrefsSchema.optional(),
});

const acceptInviteSchema = z.object({
  invite_token: z.string().min(1),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200).optional(),
  phone_number: z.string().max(20).optional(),
});

function serializeUserResponse(user: any) {
  return {
    id: user._id?.toString() || user.id,
    name: user.name || '',
    email: user.email || '',
    role: user.roles?.[0] || 'agent',
    roles: user.roles || ['agent'],
    avatar_url: user.avatar_url || null,
    timezone: user.timezone || 'UTC',
    phone_number: user.phone_number || null,
    notification_preferences: user.notification_preferences || {},
    status: user.status || 'active',
    last_active_at: user.last_login_at?.toISOString() || null,
  };
}

// GET /api/v1/users
router.get('/', rbac('users:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filters = {
    status: req.query.status as string | undefined,
    role: req.query.role as string | undefined,
    search: req.query.search as string | undefined,
  };

  const result = await userService.listUsers(req.tenantId, pagination, filters);
  res.json({
    data: result.data.map(serializeUserResponse),
    pagination: result.pagination,
  });
});

// POST /api/v1/users/invite
router.post(
  '/invite',
  rbac('users:invite'),
  auditMiddleware({ action: 'user.invite', resourceType: 'user' }),
  async (req: Request, res: Response) => {
    const body = inviteUserSchema.parse(req.body);
    const [tenant, inviter] = await Promise.all([
      Tenant.findById(req.tenantId).lean(),
      User.findById(req.userId).lean(),
    ]);
    const { user, invite_token } = await userService.inviteUser({
      tenant_id: req.tenantId,
      email: body.email,
      name: body.name,
      roles: body.roles,
      inviter_name: (inviter as any)?.name || 'A team member',
      org_name: (tenant as any)?.name || 'your organization',
      org_slug: (tenant as any)?.slug || 'platform',
    });

    res.status(201).json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        status: user.status,
      },
      invite_token,
    });
  }
);

// POST /api/v1/users/accept-invite - Public (no auth required, but tenant needed)
router.post('/accept-invite', async (req: Request, res: Response) => {
  const body = acceptInviteSchema.parse(req.body);
  const { user, org_slug } = await userService.acceptInvite(body.invite_token, body.password, body.name, body.phone_number);

  res.json({
    id: user._id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    status: user.status,
    org_slug,
  });
});

// GET /api/v1/users/me — get current user profile
router.get('/me', async (req: Request, res: Response) => {
  const user = await userService.getUserById(req.tenantId, req.userId.toString());
  res.json(serializeUserResponse(user));
});

// PATCH /api/v1/users/me — self-update (any authenticated user)
router.patch('/me', async (req: Request, res: Response) => {
  const body = updateProfileSchema.parse(req.body);
  const user = await userService.updateUser(req.tenantId, req.userId.toString(), {
    name: body.name,
    avatar_url: body.avatar_url !== undefined ? body.avatar_url : undefined,
    timezone: body.timezone,
    phone_number: body.phone_number,
    notification_preferences: body.notification_preferences,
  });
  res.json(serializeUserResponse(user));
});

// GET /api/v1/users/:id
router.get('/:id', rbac('users:read'), async (req: Request, res: Response) => {
  const user = await userService.getUserById(req.tenantId, req.params.id as string);
  res.json(serializeUserResponse(user));
});

// PATCH /api/v1/users/:id
router.patch(
  '/:id',
  rbac('users:update'),
  auditMiddleware({
    action: 'user.update',
    resourceType: 'user',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const body = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(req.tenantId, req.params.id as string, {
      ...body,
      avatar_url: body.avatar_url ?? undefined,
    });
    res.json(serializeUserResponse(user));
  }
);

// PUT /api/v1/users/:id/roles — dedicated role-change endpoint.
// Hardened against self-escalation (F-01 in security assessment 2026-04-21):
//   - only tenant-safe roles may be assigned
//   - a user cannot change their own roles
//   - caller must possess every role they are trying to assign (no privilege
//     escalation via a lower-tier admin promoting themselves by proxy)
router.put(
  '/:id/roles',
  rbac('users:update'),
  auditMiddleware({
    action: 'user.roles_update',
    resourceType: 'user',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const { roles } = updateRolesSchema.parse(req.body);
    const targetId = req.params.id as string;

    if (targetId === req.userId.toString()) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'You cannot change your own roles.',
        instance: req.requestId,
      });
      return;
    }

    // Rank check: caller cannot assign a role higher than their own highest.
    // Prevents a `manager` from granting `tenant_admin` to anyone (including
    // themselves via a proxy account). Equal rank is allowed so a
    // tenant_admin can promote another user to tenant_admin.
    const callerRank = highestRoleRank(req.roles);
    const targetRank = highestRoleRank(roles);
    if (targetRank > callerRank) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'Cannot assign a role higher than your own.',
        instance: req.requestId,
      });
      return;
    }

    const user = await userService.setUserRoles(req.tenantId, targetId, roles);
    res.json(serializeUserResponse(user));
  }
);

// POST /api/v1/users/:id/reset-password
router.post(
  '/:id/reset-password',
  rbac('users:update'),
  auditMiddleware({
    action: 'user.reset_password',
    resourceType: 'user',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const { password } = z.object({ password: z.string().min(8).max(128) }).parse(req.body);

    const user = await User.findOne({
      _id: req.params.id,
      tenant_id: req.tenantId,
      deleted_at: null,
    }).select('+password_hash');

    if (!user) {
      res.status(404).json({
        type: 'https://sreoncall.io/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'User not found.',
        instance: req.requestId,
      });
      return;
    }

    user.password_hash = await bcrypt.hash(password, 12);
    user.force_password_change = true;
    user.failed_login_attempts = 0;
    user.locked_until = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  }
);

// DELETE /api/v1/users/:id
router.delete(
  '/:id',
  rbac('users:delete'),
  auditMiddleware({
    action: 'user.delete',
    resourceType: 'user',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    if (req.params.id === req.userId.toString()) {
      res.status(400).json({
        type: 'https://sreoncall.io/problems/bad-request',
        title: 'Bad Request',
        status: 400,
        detail: 'Cannot delete your own account.',
        instance: req.requestId,
      });
      return;
    }
    await userService.deleteUser(req.tenantId, req.params.id as string);
    res.status(204).send();
  }
);

export default router;
