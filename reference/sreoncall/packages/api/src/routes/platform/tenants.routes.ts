import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as tenantAdminService from '../../services/platform/tenant-admin.service';
import { parsePaginationParams } from '../../utils/pagination';

const router = Router();

function serializeTenant(t: any) {
  return {
    _id: t._id.toString(),
    slug: t.slug,
    name: t.name,
    type: t.type || 'standalone',
    status: t.status,
    plan: t.plan,
    plan_limits: t.plan_limits,
    is_platform_tenant: t.is_platform_tenant,
    branding: t.branding,
    createdAt: t.createdAt?.toISOString?.() || t.createdAt,
    updatedAt: t.updatedAt?.toISOString?.() || t.updatedAt,
  };
}

// GET /platform/tenants
router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filter = {
    search: req.query.search as string | undefined,
    type: req.query.type as string | undefined,
    plan: req.query.plan as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = await tenantAdminService.listAllTenants(filter, pagination);
  res.json({
    data: result.data.map(serializeTenant),
    pagination: result.pagination,
  });
});

// GET /platform/tenants/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { tenant, stats } = await tenantAdminService.getTenantDetail(req.params['id'] as string);
  res.json({
    ...serializeTenant(tenant),
    stats,
  });
});

const updateTenantSchema = z.object({
  type: z.enum(['standalone', 'provider', 'consumer']).optional(),
  plan: z.enum(['free', 'startup', 'growth', 'enterprise']).optional(),
  plan_limits: z.record(z.any()).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  name: z.string().min(1).max(200).optional(),
});

// PATCH /platform/tenants/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const body = updateTenantSchema.parse(req.body);
  const tenantId = req.params['id'] as string;

  if (body.type) {
    await tenantAdminService.updateTenantType(tenantId, body.type);
  }
  if (body.plan || body.plan_limits) {
    // Fix 3: allow plan_limits-only override without requiring a plan change.
    // Resolve the current plan from DB if none supplied.
    const planToApply = body.plan ?? (await tenantAdminService.getTenantDetail(tenantId)).tenant.plan;
    await tenantAdminService.updateTenantPlan(tenantId, planToApply, body.plan_limits);
  }
  if (body.status === 'suspended') {
    await tenantAdminService.suspendTenant(tenantId);
  } else if (body.status === 'active') {
    await tenantAdminService.reactivateTenant(tenantId);
  }

  const { tenant } = await tenantAdminService.getTenantDetail(tenantId);
  res.json(serializeTenant(tenant));
});

// DELETE /platform/tenants/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await tenantAdminService.softDeleteTenant(req.params['id'] as string);
  res.status(204).send();
});

export default router;
