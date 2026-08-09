// packages/api/src/routes/public/leads.routes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Lead } from '../../models/lead.model';
import { anonymizeIp } from '../../utils/ip-anonymize';
import { sendLeadNotificationEmail, sendLeadAutoReply } from '../../services/lead-email.service';
import { logger } from '../../utils/logger';
import { getRedis } from '../../config/redis';

const router = Router();

export const leadSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  email: z.string().email().toLowerCase(),
  company: z.string().min(1).max(200).trim(),
  role: z.string().max(200).trim().optional(),
  company_size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
  message: z.string().max(2000).optional(),
  track: z.enum(['hero', 'demo', 'referral', 'reseller', 'msp', 'partner', 'general']).default('general'),
});

async function checkIpRateLimit(ip: string, res: Response): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `leadrl:${ip}`;
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

// POST /api/v1/public/leads
router.post('/', async (req: Request, res: Response) => {
  const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
  const ip = rawIp.replace(/^::ffff:/, '');

  const allowed = await checkIpRateLimit(ip, res);
  if (!allowed) return;

  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const data = parsed.data;
  const source_ip = anonymizeIp(ip);

  let lead;
  try {
    lead = await Lead.create({ ...data, source_ip });
  } catch (err: any) {
    logger.error('Failed to create lead', { error: err.message });
    res.status(500).json({ detail: 'Internal server error. Please try again.' });
    return;
  }

  // Fire-and-forget emails — errors logged, not thrown
  const emailData = { ...data, leadId: lead._id.toString() };
  sendLeadNotificationEmail(emailData).catch((err) =>
    logger.error('Lead notification email failed', { error: err.message, leadId: lead._id })
  );
  sendLeadAutoReply(emailData).catch((err) =>
    logger.error('Lead auto-reply email failed', { error: err.message, leadId: lead._id })
  );

  res.status(201).json({ success: true });
});

export default router;
