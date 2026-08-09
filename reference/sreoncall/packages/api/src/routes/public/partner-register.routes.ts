// packages/api/src/routes/public/partner-register.routes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { Partner } from '../../models/partner.model';
import { PartnerUser } from '../../models/partner-user.model';
import { logger } from '../../utils/logger';

const router = Router();

const registerBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200).trim(),
  password: z.string().min(8).max(128),
});

// GET /api/v1/public/partner-register?token=xxx
router.get('/', async (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    res.status(422).json({ detail: 'Validation failed', errors: { token: ['token is required'] } });
    return;
  }

  try {
    const partner = await Partner.findOne({ inviteToken: token });

    if (!partner) {
      res.status(404).json({ detail: 'Invalid or expired invite token.' });
      return;
    }

    if (!partner.inviteTokenExpiresAt || partner.inviteTokenExpiresAt < new Date()) {
      res.status(410).json({ detail: 'This invite link has expired. Please contact partners@sreoncall.com.' });
      return;
    }

    if (partner.activatedAt) {
      res.status(409).json({ detail: 'This partner account is already activated.' });
      return;
    }

    res.status(200).json({ name: partner.name, email: partner.email });
  } catch (err: any) {
    logger.error('Failed to validate partner invite token', { error: err.message });
    res.status(500).json({ detail: 'Internal server error. Please try again.' });
  }
});

// POST /api/v1/public/partner-register
router.post('/', async (req: Request, res: Response) => {
  const parsed = registerBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { token, name, password } = parsed.data;

  try {
    const partner = await Partner.findOne({ inviteToken: token });

    if (!partner) {
      res.status(404).json({ detail: 'Invalid or expired invite token.' });
      return;
    }

    if (!partner.inviteTokenExpiresAt || partner.inviteTokenExpiresAt < new Date()) {
      res.status(410).json({ detail: 'This invite link has expired. Please contact partners@sreoncall.com.' });
      return;
    }

    if (partner.activatedAt) {
      res.status(409).json({ detail: 'This partner account is already activated.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await PartnerUser.create({
      partnerId: partner._id,
      name,
      email: partner.email,
      passwordHash,
      emailVerified: true,
      role: 'owner',
    });

    await Partner.updateOne(
      { _id: partner._id },
      {
        $set: { activatedAt: new Date(), status: 'active' },
        $unset: { inviteToken: '', inviteTokenExpiresAt: '' },
      }
    );

    res.status(201).json({ success: true });
  } catch (err: any) {
    logger.error('Failed to complete partner registration', { error: err.message });
    res.status(500).json({ detail: 'Internal server error. Please try again.' });
  }
});

export default router;
