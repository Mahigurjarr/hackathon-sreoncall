import { Types } from 'mongoose';
import { Tenant } from '../models/tenant.model';
import { UsageRecord } from '../models/billing.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Estimate tokens from a text string. Uses ~4 chars/token heuristic + 2000 overhead.
 * Used for pre-flight budget checks before the actual API call.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4) + 2000;
}

/**
 * Pre-flight check: throws HTTP 402 AppError if the tenant's monthly AI token
 * budget would be exceeded by the estimated call.
 * Call this BEFORE making the AI API call.
 */
export async function checkAiBudget(
  tenantId: Types.ObjectId,
  estimatedTokens: number
): Promise<void> {
  try {
    const tenant = await Tenant.findById(tenantId).select('plan_limits').lean();
    if (!tenant) return; // allow if tenant not found

    // Treat missing/undefined as a sensible default so tenants without an
    // explicit limit aren't blocked from AI features. Only an explicit 0
    // disables AI; -1 means unlimited.
    const rawLimit = (tenant.plan_limits as any)?.max_ai_tokens_per_month;
    const limit: number = rawLimit === undefined || rawLimit === null ? 1_000_000 : rawLimit;
    if (limit === -1) return; // unlimited
    if (limit === 0) {
      throw AppError.paymentRequired(
        'AI features are not available on your current plan. Upgrade to Growth or Enterprise.'
      );
    }

    const period = currentPeriod();
    const record = await UsageRecord.findOne({ tenant_id: tenantId, period })
      .select('ai_tokens_used')
      .lean();
    const used = (record as any)?.ai_tokens_used || 0;

    if (used + estimatedTokens > limit) {
      throw AppError.paymentRequired(
        `AI token budget exhausted for this month (${used.toLocaleString()} / ${limit.toLocaleString()} tokens used). Upgrade or wait for next month.`
      );
    }
  } catch (err: any) {
    // Re-throw AppErrors; swallow unexpected errors to avoid blocking on budget check failure
    if (err instanceof AppError && err.status === 402) throw err;
    logger.error('ai-budget check failed, allowing through', { error: err.message });
  }
}

/**
 * Consume tokens after a successful AI API call.
 * Call this AFTER the API call with actual token counts from the response.
 * Fire-and-forget safe — errors are swallowed to never block the response.
 */
export async function consumeAiTokens(
  tenantId: Types.ObjectId,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  try {
    const total = inputTokens + outputTokens;
    if (total <= 0) return;
    const period = currentPeriod();
    await UsageRecord.findOneAndUpdate(
      { tenant_id: tenantId, period },
      { $inc: { ai_tokens_used: total, agent_tokens_used: total } },
      { upsert: true }
    );
  } catch (err: any) {
    logger.error('Failed to record AI token consumption', { error: err.message, tenantId });
  }
}
