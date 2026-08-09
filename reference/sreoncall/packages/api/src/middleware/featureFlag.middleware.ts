import { Request, Response, NextFunction } from 'express';
import { getEffectiveValue } from '../services/platform/feature-flag.service';
import { logger } from '../utils/logger';

/**
 * Middleware factory that gates a route behind a feature flag.
 * If the flag is disabled (globally or for the tenant), returns 403.
 *
 * Usage:
 *   router.use('/agents', requireFeatureFlag('ai_agents_enabled'), agentsRoutes);
 */
export function requireFeatureFlag(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const enabled = await getEffectiveValue(flagKey, tenantId || '');

      if (!enabled) {
        res.status(403).json({
          type: 'https://sreoncall.io/problems/feature-disabled',
          title: 'Feature Disabled',
          status: 403,
          detail: `The feature "${flagKey}" is not enabled for this tenant.`,
        });
        return;
      }

      next();
    } catch (err: any) {
      // On error, allow through (fail-open) — don't block requests if flag DB is down
      logger.warn('Feature flag check failed, allowing request', { flag: flagKey, error: err.message });
      next();
    }
  };
}
