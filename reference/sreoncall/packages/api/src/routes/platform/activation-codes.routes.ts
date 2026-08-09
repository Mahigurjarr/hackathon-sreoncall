import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import * as acService from '../../services/activation-code.service';
import { Tenant } from '../../models/tenant.model';
import { User } from '../../models/user.model';
import { ActivationCode } from '../../models/activation-code.model';
import { AppError } from '../../middleware/errorHandler.middleware';

const router = Router();

function serializeCode(c: any) {
  return {
    _id: c._id.toString(),
    code: c.code,
    tenant_id: c.tenant_id?.toString(),
    plan: c.plan,
    duration_months: c.duration_months,
    status: c.status,
    expires_at: c.expires_at,
    redeemed_at: c.redeemed_at ?? null,
    redeemed_by: c.redeemed_by?.toString() ?? null,
    generated_by: c.generated_by,
    email_sent: c.email_sent,
    email_sent_at: c.email_sent_at ?? null,
    notes: c.notes ?? null,
    createdAt: c.createdAt,
  };
}

const generateSchema = z.object({
  tenant_id: z.string().min(1),
  plan: z.string().min(1),
  duration_months: z.number().int().min(1).max(24),
  expires_at: z.string().datetime(),
  notes: z.string().max(500).optional(),
  send_email: z.boolean().default(true),
});

// GET /platform/activation-codes
router.get('/', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const rawTenantId = req.query.tenant_id as string | undefined;
  // Validate tenant_id if provided to avoid BSONError on invalid ObjectId strings
  if (rawTenantId && !Types.ObjectId.isValid(rawTenantId)) {
    res.status(400).json({ error: 'Invalid tenant_id format' });
    return;
  }

  const filter = {
    status: req.query.status as string | undefined,
    tenant_id: rawTenantId,
    plan: req.query.plan as string | undefined,
  };
  const result = await acService.listCodes(filter, page, limit);
  res.json({
    data: result.data.map(serializeCode),
    pagination: result.pagination,
  });
});

// POST /platform/activation-codes
router.post('/', async (req: Request, res: Response) => {
  const body = generateSchema.parse(req.body);

  // Look up tenant admin email for optional email delivery
  const tenant = await Tenant.findById(body.tenant_id).lean();
  if (!tenant) throw AppError.notFound('Tenant');

  let tenantAdminEmail: string | undefined;
  if (body.send_email) {
    const adminUser = await User.findOne({
      tenant_id: new Types.ObjectId(body.tenant_id),
      roles: { $in: ['tenant_admin', 'platform_admin'] },
      status: 'active',
    })
      .sort({ createdAt: 1 })
      .lean();
    tenantAdminEmail = adminUser?.email;
  }

  const generatedBy = (req as any).user?.email || 'platform-admin';

  const doc = await acService.generateCode({
    tenantId: body.tenant_id,
    plan: body.plan,
    durationMonths: body.duration_months,
    expiresAt: new Date(body.expires_at),
    generatedBy,
    sendEmail: body.send_email && !!tenantAdminEmail,
    notes: body.notes,
    tenantAdminEmail,
    tenantName: tenant.name,
  });

  res.status(201).json(serializeCode(doc));
});

// POST /platform/activation-codes/:id/revoke
router.post('/:id/revoke', async (req: Request, res: Response) => {
  const doc = await acService.revokeCode(req.params['id'] as string);
  res.json(serializeCode(doc));
});

// POST /platform/activation-codes/:id/send-email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  const codeId = req.params['id'] as string;
  const record = await ActivationCode.findById(codeId);
  if (!record) throw AppError.notFound('Activation code');

  const tenant = await Tenant.findById(record.tenant_id).lean();
  if (!tenant) throw AppError.notFound('Tenant');

  const adminUser = await User.findOne({
    tenant_id: record.tenant_id,
    roles: { $in: ['tenant_admin', 'platform_admin'] },
    status: 'active',
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!adminUser?.email) throw AppError.badRequest('No admin email found for this tenant');

  await acService.resendEmail(codeId, adminUser.email, tenant.name);
  res.json({ ok: true });
});

export default router;
