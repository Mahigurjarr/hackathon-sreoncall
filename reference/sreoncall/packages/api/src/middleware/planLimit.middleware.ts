/**
 * Plan Limit Middleware
 *
 * Two factory functions for enforcing plan limits on routes:
 *   requirePlanLimit  — count-based limits (max_users, max_agents, etc.)
 *   requirePlanFeature — boolean feature gates (sso_enabled, scim_enabled, etc.)
 *
 * On limit hit, returns HTTP 402 with a structured RFC-7807 body the frontend
 * can parse into an upgrade prompt (distinct from 403 returned by featureFlag middleware).
 */

import { Request, Response, NextFunction } from 'express';
import { PlanLimits } from '../models/tenant.model';
import { checkLimit } from '../services/billing.service';

function limitReachedResponse(
  res: Response,
  limitKey: string,
  current: number,
  limit: number,
  plan: string
): void {
  const isUnlimited = limit === -1;
  const detail = isUnlimited
    ? `Limit check error`
    : `Your ${plan} plan allows ${limit} ${limitKey.replace(/_/g, ' ').replace(/^max /, '')}. Upgrade to unlock more.`;

  res.status(402).json({
    type: 'https://sreoncall.io/problems/plan-limit-reached',
    title: 'Plan Limit Reached',
    status: 402,
    detail,
    limit_key: limitKey,
    current,
    limit,
    plan,
    upgrade_url: '/settings/billing',
  });
}

function featureDisabledResponse(
  res: Response,
  featureKey: string,
  plan: string
): void {
  res.status(402).json({
    type: 'https://sreoncall.io/problems/plan-limit-reached',
    title: 'Feature Not Available',
    status: 402,
    detail: `${featureKey.replace(/_/g, ' ')} is not available on the ${plan} plan. Upgrade to unlock.`,
    limit_key: featureKey,
    current: 0,
    limit: 0,
    plan,
    upgrade_url: '/settings/billing',
  });
}

/**
 * Middleware factory for count-based plan limits.
 *
 * @param limitKey - The PlanLimits field to check (e.g. 'max_on_call_schedules')
 * @param getCurrentCount - Async function that returns the current count for this tenant
 *
 * @example
 * router.post('/', requirePlanLimit('max_on_call_schedules', async (req) => {
 *   return OncallSchedule.countDocuments({ tenant_id: req.tenantId });
 * }), createScheduleHandler);
 */
export function requirePlanLimit(
  limitKey: keyof PlanLimits,
  getCurrentCount: (req: Request) => Promise<number>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenant = (req as any).tenant;
      if (!tenant) { next(); return; }

      const planLimits: PlanLimits = tenant.plan_limits;
      const plan: string = tenant.plan || 'free';
      const limit = planLimits[limitKey] as number;

      // -1 = unlimited; skip check
      if (limit === -1 || limit >= 9999) { next(); return; }

      const current = await getCurrentCount(req);
      const result = checkLimit(planLimits, plan, limitKey, current);

      if (!result.allowed) {
        limitReachedResponse(res, limitKey, current, limit, plan);
        return;
      }
      next();
    } catch (err) {
      // On unexpected error, allow the request through — don't block on limit check failure
      next();
    }
  };
}

/**
 * Middleware factory for boolean feature gates based on plan limits.
 *
 * @param featureKey - The PlanLimits boolean field (e.g. 'sso_enabled', 'scim_enabled')
 *
 * @example
 * router.use('/saml', requirePlanFeature('sso_enabled'), samlRoutes);
 */
export function requirePlanFeature(featureKey: keyof PlanLimits) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const tenant = (req as any).tenant;
      if (!tenant) { next(); return; }

      const planLimits: PlanLimits = tenant.plan_limits;
      const plan: string = tenant.plan || 'free';
      const enabled = planLimits[featureKey] as boolean;

      if (!enabled) {
        featureDisabledResponse(res, featureKey, plan);
        return;
      }
      next();
    } catch {
      next();
    }
  };
}
