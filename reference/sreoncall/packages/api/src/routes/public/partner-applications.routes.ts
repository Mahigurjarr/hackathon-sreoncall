// packages/api/src/routes/public/partner-applications.routes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Partner } from '../../models/partner.model';
import { anonymizeIp } from '../../utils/ip-anonymize';
import { sendPartnerApplicationNotification } from '../../services/partner-email.service';
import { logger } from '../../utils/logger';
import { getRedis } from '../../config/redis';

const router = Router();

const partnerApplicationSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  email: z.string().email().toLowerCase(),
  company: z.string().min(1).max(200).trim(),
  partnerType: z.enum(['referral', 'reseller', 'msp']),
  message: z.string().max(2000).optional(),
});

async function checkIpRateLimit(ip: string, res: Response): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `partnerapprl:${ip}`;
    // Atomic increment + set expiry only if no TTL exists — prevents race where INCR succeeds but EXPIRE is never called
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, 3600, 'NX'); // NX flag: only set TTL if key has no current expiry (Redis 7+)
    const results = await pipeline.exec();
    const count = (results?.[0]?.[1] as number) ?? 0;
    if (count > 5) {
      res.status(429).json({ detail: 'Too many submissions. Please try again in an hour.' });
      return false;
    }
  } catch {
    // Redis failure — allow through (fail open to not block legitimate users)
  }
  return true;
}

// POST /api/v1/public/partner-applications
router.post('/', async (req: Request, res: Response) => {
  const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
  const ip = rawIp.replace(/^::ffff:/, '');

  const allowed = await checkIpRateLimit(ip, res);
  if (!allowed) return;

  const parsed = partnerApplicationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const data = parsed.data;
  const source_ip = anonymizeIp(ip);

  try {
    await Partner.create({ ...data, status: 'pending', source_ip });
  } catch (err: any) {
    logger.error('Failed to create partner application', { error: err.message });
    res.status(500).json({ detail: 'Internal server error. Please try again.' });
    return;
  }

  // Fire-and-forget notification email — errors logged, not thrown
  sendPartnerApplicationNotification(data).catch((err) =>
    logger.error('Partner application notification email failed', { error: err.message })
  );

  res.status(201).json({ success: true });
});

export default router;
