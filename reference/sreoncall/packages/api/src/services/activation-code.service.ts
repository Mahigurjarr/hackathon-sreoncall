import mongoose, { Types } from 'mongoose';
import { ActivationCode, ActivationCodeDocument } from '../models/activation-code.model';
import { Subscription } from '../models/billing.model';
import { Tenant } from '../models/tenant.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { getPlanLimitsFromDB } from './billing.service';
import { notifyPlanChange } from './plan-change-notification.service';
import { sendActivationCodeEmail } from './email.service';
import { logger } from '../utils/logger';

// Unambiguous uppercase alphanumeric — no 0, O, 1, I, L
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + months + 1, 0); // go to last day of target month
  result.setDate(Math.min(day, result.getDate()));
  return result;
}

export function generateCodeString(): string {
  const segment = () =>
    Array.from({ length: 4 }, () => CHARSET[Math.floor(Math.random() * CHARSET.length)]).join('');
  return `SREOC-${segment()}-${segment()}-${segment()}`;
}

async function uniqueCode(maxAttempts = 5): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateCodeString();
    const existing = await ActivationCode.findOne({ code: candidate });
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique activation code after 5 attempts');
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export interface GenerateCodeParams {
  tenantId: string;
  plan: string;
  durationMonths: number;
  expiresAt: Date;
  generatedBy: string;
  sendEmail: boolean;
  notes?: string;
  tenantAdminEmail?: string;
  tenantName?: string;
}

export async function generateCode(params: GenerateCodeParams): Promise<ActivationCodeDocument> {
  const code = await uniqueCode();

  const doc = await ActivationCode.create({
    code,
    tenant_id: new Types.ObjectId(params.tenantId),
    plan: params.plan,
    duration_months: params.durationMonths,
    status: 'pending',
    expires_at: params.expiresAt,
    generated_by: params.generatedBy,
    email_sent: false,
    notes: params.notes,
  });

  if (params.sendEmail && params.tenantAdminEmail) {
    sendActivationCodeEmail({
      to: params.tenantAdminEmail,
      tenantName: params.tenantName || params.tenantId,
      code,
      plan: params.plan,
      durationMonths: params.durationMonths,
      expiresAt: params.expiresAt,
    })
      .then(async () => {
        await ActivationCode.findByIdAndUpdate(doc._id, {
          email_sent: true,
          email_sent_at: new Date(),
        });
      })
      .catch((err) => logger.error('Failed to send activation code email', { err }));
  }

  return doc;
}

// ─── Redeem ───────────────────────────────────────────────────────────────────

export interface RedeemCodeParams {
  code: string;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
}

export async function redeemCode(params: RedeemCodeParams) {
  const record = await ActivationCode.findOne({ code: params.code.toUpperCase().trim() });

  if (!record) {
    throw AppError.notFound('Invalid code');
  }

  if (!record.tenant_id.equals(params.tenantId)) {
    throw new AppError(403, 'Forbidden', 'Invalid code');
  }

  if (record.status === 'redeemed') {
    throw AppError.badRequest('This code has already been used');
  }
  if (record.status === 'revoked') {
    throw AppError.badRequest('This code is no longer valid');
  }
  if (record.status === 'expired' || record.expires_at < new Date()) {
    throw AppError.badRequest('This code has expired');
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const tenant = await Tenant.findById(params.tenantId).session(session);
      if (!tenant) throw AppError.notFound('Tenant');

      const prevPlan = tenant.plan;
      const newLimits = await getPlanLimitsFromDB(record.plan);

      tenant.plan = record.plan as any;
      Object.assign(tenant.plan_limits, newLimits);

      if (prevPlan !== record.plan) {
        tenant.pending_plan_change = {
          previous_plan: prevPlan,
          new_plan: record.plan,
          changed_at: new Date(),
          changed_by: 'activation_code',
          acknowledged: false,
        };
      }

      await tenant.save({ session });

      const periodStart = new Date();
      const periodEnd = addMonths(periodStart, record.duration_months);

      await Subscription.findOneAndUpdate(
        { tenant_id: params.tenantId },
        {
          tenant_id: params.tenantId,
          stripe_customer_id: `manual:${params.tenantId.toString()}`,
          stripe_subscription_id: `manual:${params.tenantId.toString()}`,
          plan: record.plan,
          status: 'active',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
          seat_quantity: 1,
          monthly_amount_cents: 0,
        },
        { upsert: true, new: true, session }
      );

      record.status = 'redeemed';
      record.redeemed_at = new Date();
      record.redeemed_by = params.userId;
      await record.save({ session });

      if (prevPlan !== record.plan) {
        notifyPlanChange(params.tenantId, prevPlan, record.plan, 'activation_code').catch(() => {});
      }
    });
  } finally {
    await session.endSession();
  }

  return Subscription.findOne({ tenant_id: params.tenantId });
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export async function revokeCode(codeId: string): Promise<ActivationCodeDocument> {
  const record = await ActivationCode.findById(codeId);
  if (!record) throw AppError.notFound('Activation code');
  if (record.status !== 'pending') {
    throw AppError.badRequest(`Cannot revoke a code with status '${record.status}'`);
  }
  record.status = 'revoked';
  await record.save();
  return record;
}

// ─── Resend Email ─────────────────────────────────────────────────────────────

export async function resendEmail(
  codeId: string,
  tenantAdminEmail: string,
  tenantName: string
): Promise<void> {
  const record = await ActivationCode.findById(codeId);
  if (!record) throw AppError.notFound('Activation code');
  if (record.status !== 'pending') {
    throw AppError.badRequest('Can only resend email for pending codes');
  }

  await sendActivationCodeEmail({
    to: tenantAdminEmail,
    tenantName,
    code: record.code,
    plan: record.plan,
    durationMonths: record.duration_months,
    expiresAt: record.expires_at,
  });

  record.email_sent = true;
  record.email_sent_at = new Date();
  await record.save();
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ListCodesFilter {
  status?: string;
  tenant_id?: string;
  plan?: string;
}

export async function listCodes(filter: ListCodesFilter, page = 1, limit = 20) {
  const query: Record<string, any> = {};
  if (filter.status) query.status = filter.status;
  if (filter.tenant_id) query.tenant_id = new Types.ObjectId(filter.tenant_id);
  if (filter.plan) query.plan = filter.plan;

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    ActivationCode.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ActivationCode.countDocuments(query),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

// ─── Expire stale codes (cron) ────────────────────────────────────────────────

export async function expireStaleCode(): Promise<number> {
  const result = await ActivationCode.updateMany(
    { status: 'pending', expires_at: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount ?? 0;
}
