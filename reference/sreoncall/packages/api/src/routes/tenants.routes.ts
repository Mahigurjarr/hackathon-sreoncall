import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as tenantService from '../services/tenant.service';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';

const router = Router();

const updateTenantSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  branding: z
    .object({
      logo_url: z.string().url().optional(),
      favicon_url: z.string().url().optional(),
      primary_color: z.string().optional(),
      accent_color: z.string().optional(),
    })
    .optional(),
  auth_settings: z
    .object({
      password_policy: z
        .object({
          min_length: z.number().int().min(6).max(128).optional(),
          require_uppercase: z.boolean().optional(),
          require_lowercase: z.boolean().optional(),
          require_numbers: z.boolean().optional(),
          require_special: z.boolean().optional(),
          max_age_days: z.number().int().min(0).optional(),
          history_count: z.number().int().min(0).max(24).optional(),
        })
        .optional(),
      session_policy: z
        .object({
          max_sessions: z.number().int().min(1).max(100).optional(),
          session_timeout_minutes: z.number().int().min(5).optional(),
          idle_timeout_minutes: z.number().int().min(5).optional(),
        })
        .optional(),
      mfa_required: z.boolean().optional(),
    })
    .optional(),
  voice_call_settings: z
    .object({
      greeting: z.string().max(500).optional(),
    })
    .optional(),
  custom_domains: z.array(z.string()).optional(),
  website: z.string().max(2048).nullable().optional(),
});

function serializeTenant(tenant: any) {
  const obj = tenant.toObject ? tenant.toObject() : { ...tenant };
  obj.id = obj._id?.toString() || obj.id;
  return obj;
}

// GET /api/v1/tenants/current
router.get('/current', rbac('tenants:read'), async (req: Request, res: Response) => {
  const tenant = await tenantService.getTenantById(req.tenantId);
  res.json(serializeTenant(tenant));
});

// PATCH /api/v1/tenants/current
router.patch(
  '/current',
  rbac('tenants:update'),
  auditMiddleware({ action: 'tenant.update', resourceType: 'tenant' }),
  async (req: Request, res: Response) => {
    const body = updateTenantSchema.parse(req.body);
    const tenant = await tenantService.updateTenant(req.tenantId, body);
    res.json(serializeTenant(tenant));
  }
);

// GET /api/v1/tenants/current/stats
router.get('/current/stats', rbac('tenants:read'), async (req: Request, res: Response) => {
  const stats = await tenantService.getTenantStats(req.tenantId);
  res.json(stats);
});

export default router;
