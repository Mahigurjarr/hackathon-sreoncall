import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';
import { getPlanLimits } from '../services/billing.service';

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Run rate limiting asynchronously but don't block the middleware chain type
  rateLimitCheck(req, res, next).catch((err) => {
    logger.error('Rate limit check failed', { error: err.message });
    // On Redis failure, allow the request through
    next();
  });
}

async function rateLimitCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.tenantId) {
    next();
    return;
  }

  // Source of truth: the plan's api_rate_limit from billing.service.PLAN_LIMITS.
  // The per-tenant plan_limits.api_rate_limit override still wins when set.
  const plan = req.tenant?.plan || 'free';
  const planDefault = getPlanLimits(plan).api_rate_limit;
  const maxRequests = req.tenant?.plan_limits?.api_rate_limit || planDefault;

  const redis = getRedis();
  const windowMs = 60_000; // 1 minute sliding window
  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimit:${req.tenantId}`;

  // Sliding window using Redis sorted set
  const pipeline = redis.pipeline();
  // Remove entries outside the window
  pipeline.zremrangebyscore(key, 0, windowStart);
  // Add current request
  pipeline.zadd(key, now, `${now}:${req.requestId}`);
  // Count requests in window
  pipeline.zcard(key);
  // Set TTL on key
  pipeline.pexpire(key, windowMs);

  const results = await pipeline.exec();

  if (!results) {
    next();
    return;
  }

  const requestCount = results[2]?.[1] as number;

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - requestCount));
  res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

  if (requestCount > maxRequests) {
    const retryAfter = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      type: 'https://sreoncall.io/problems/rate-limit-exceeded',
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: `Rate limit of ${maxRequests} requests per minute exceeded. Retry after ${retryAfter}s.`,
    });
    return;
  }

  next();
}
