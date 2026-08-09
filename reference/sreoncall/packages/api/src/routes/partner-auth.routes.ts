import { Router, Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getConfig } from '../config';
import { getRedis } from '../config/redis';
import { partnerAuthGuard } from '../middleware/partnerAuth.middleware';
import { Partner } from '../models/partner.model';
import { PartnerUser } from '../models/partner-user.model';
import { PartnerUserInvite } from '../models/partner-user-invite.model';
import { sendPartnerPasswordResetEmail } from '../services/email.service';
import { sendPartnerInviteEmail, sendPartnerTeamInviteEmail } from '../services/partner-email.service';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const oauthExchangeSchema = z.object({
  provider: z.enum(['google', 'github']),
  providerId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
});

function issuePartnerToken(partnerUser: {
  _id: { toString(): string };
  partnerId: { toString(): string };
  email: string;
  role?: 'owner' | 'admin' | 'member';
}): string {
  const config = getConfig();
  return jwt.sign(
    {
      sub: partnerUser._id.toString(),
      partnerId: partnerUser.partnerId.toString(),
      email: partnerUser.email,
      role: partnerUser.role ?? 'member',
      type: 'partner',
    },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '24h' }
  );
}

function setPartnerTokenCookie(res: Response, token: string): void {
  res.cookie('partner_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

// POST /api/v1/partner-auth/login
router.post('/login', async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);

  const partnerUser = await PartnerUser.findOne({ email: body.email.toLowerCase() }).lean();

  if (!partnerUser || !partnerUser.passwordHash) {
    res.status(401).json({ detail: 'Invalid email or password.' });
    return;
  }

  const passwordMatch = await bcrypt.compare(body.password, partnerUser.passwordHash);
  if (!passwordMatch) {
    res.status(401).json({ detail: 'Invalid email or password.' });
    return;
  }

  const partner = await Partner.findById(partnerUser.partnerId).lean();
  if (!partner) {
    res.status(401).json({ detail: 'Partner account not found.' });
    return;
  }

  if (partner.status !== 'active') {
    res.status(403).json({ detail: 'Partner account is not active.' });
    return;
  }

  await PartnerUser.updateOne({ _id: partnerUser._id }, { lastLoginAt: new Date() });

  const token = issuePartnerToken(partnerUser);
  setPartnerTokenCookie(res, token);

  res.json({
    partnerId: partnerUser.partnerId.toString(),
    name: partnerUser.name,
    email: partnerUser.email,
  });
});

// POST /api/v1/partner-auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('partner_token');
  res.json({ success: true });
});

// GET /api/v1/partner-auth/me
router.get('/me', partnerAuthGuard, async (req: Request, res: Response) => {
  const partnerUserId = req.partnerUser!.partnerUserId;

  const partnerUser = await PartnerUser.findById(partnerUserId).lean();
  if (!partnerUser) {
    res.status(404).json({ detail: 'Partner user not found.' });
    return;
  }

  const partner = await Partner.findById(partnerUser.partnerId).lean();
  if (!partner) {
    res.status(404).json({ detail: 'Partner not found.' });
    return;
  }

  res.json({
    partnerUser: {
      _id: partnerUser._id,
      name: partnerUser.name,
      email: partnerUser.email,
      emailVerified: partnerUser.emailVerified,
      role: partnerUser.role ?? 'member',
      lastLoginAt: partnerUser.lastLoginAt ?? null,
    },
    partner: {
      _id: partner._id,
      company: partner.company,
      partnerType: partner.partnerType,
      status: partner.status,
      commissionRate: partner.commissionRate,
      onboardingCompleted: !!(partner as any).onboarding?.completedAt,
    },
  });
});

// POST /api/v1/partner-auth/oauth-exchange
router.post('/oauth-exchange', async (req: Request, res: Response) => {
  const body = oauthExchangeSchema.parse(req.body);

  const providerField = body.provider === 'google' ? 'googleId' : 'githubId';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let partnerUser: any = await PartnerUser.findOne({ [providerField]: body.providerId }).lean();

  if (!partnerUser) {
    // Try to find by email and link the OAuth provider
    const byEmail = await PartnerUser.findOne({ email: body.email.toLowerCase() });
    if (byEmail) {
      byEmail.set(providerField, body.providerId);
      await byEmail.save();
      partnerUser = byEmail.toObject();
    }
  }

  if (!partnerUser) {
    res.status(404).json({ detail: 'No partner account linked to this OAuth identity.' });
    return;
  }

  const partner = await Partner.findById(partnerUser.partnerId).lean();
  if (!partner) {
    res.status(401).json({ detail: 'Partner account not found.' });
    return;
  }

  if (partner.status !== 'active') {
    res.status(403).json({ detail: 'Partner account is not active.' });
    return;
  }

  await PartnerUser.updateOne({ _id: partnerUser._id }, { lastLoginAt: new Date() });

  const token = issuePartnerToken(partnerUser);
  setPartnerTokenCookie(res, token);

  res.json({
    partnerId: partnerUser.partnerId.toString(),
    name: partnerUser.name,
    email: partnerUser.email,
  });
});

// POST /api/v1/partner-auth/forgot-password
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

router.post('/forgot-password', async (req: Request, res: Response) => {
  const body = forgotPasswordSchema.parse(req.body);
  const email = body.email.toLowerCase();

  // Always return 200 to avoid email enumeration
  const ok = () => res.json({ success: true });

  try {
    const partnerUser = await PartnerUser.findOne({ email }).lean();

    if (partnerUser) {
      // PartnerUser exists — send password reset regardless of partner status.
      // The user has a valid account and should be able to reset their password.
      const resetToken = crypto.randomBytes(32).toString('hex');
      const redis = getRedis();
      await redis.setex(`partner_reset:${resetToken}`, 3600, partnerUser._id.toString());

      await sendPartnerPasswordResetEmail({
        to: email,
        name: partnerUser.name,
        resetToken,
      });
      return ok();
    }

    // No PartnerUser — registration was never completed.
    // Check if there is a pending Partner record and re-send the invite.
    const partner = await Partner.findOne({ email, status: 'pending' });
    if (partner) {
      partner.inviteToken = randomUUID();
      partner.inviteTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      partner.inviteSentAt = new Date();
      await partner.save();

      await sendPartnerInviteEmail({
        name: partner.name,
        email: partner.email,
        company: partner.company,
        inviteToken: partner.inviteToken,
      });
      return ok();
    }

    // Check if there is a pending team invite and re-send it.
    const pendingInvite = await PartnerUserInvite.findOne({ email, status: 'pending' });
    if (pendingInvite && pendingInvite.expiresAt > new Date()) {
      const invitePartner = await Partner.findById(pendingInvite.partnerId).select('company').lean();
      const inviter = await PartnerUser.findById(pendingInvite.invitedBy).select('name').lean();

      await sendPartnerTeamInviteEmail({
        email: pendingInvite.email,
        partnerName: invitePartner?.company ?? 'your SREonCall partner organization',
        inviterName: inviter?.name ?? 'A partner administrator',
        role: pendingInvite.role as 'admin' | 'member',
        token: pendingInvite.token,
      });
      return ok();
    }

    // If the team invite has expired, generate a new token and re-send.
    const expiredInvite = await PartnerUserInvite.findOne({ email, status: { $in: ['pending', 'expired'] } });
    if (expiredInvite) {
      const newToken = crypto.randomBytes(32).toString('hex');
      expiredInvite.token = newToken;
      expiredInvite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expiredInvite.status = 'pending';
      await expiredInvite.save();

      const invitePartner = await Partner.findById(expiredInvite.partnerId).select('company').lean();
      const inviter = await PartnerUser.findById(expiredInvite.invitedBy).select('name').lean();

      await sendPartnerTeamInviteEmail({
        email: expiredInvite.email,
        partnerName: invitePartner?.company ?? 'your SREonCall partner organization',
        inviterName: inviter?.name ?? 'A partner administrator',
        role: expiredInvite.role as 'admin' | 'member',
        token: newToken,
      });
    }
  } catch (err: any) {
    logger.error('Partner forgot-password error', { error: err.message });
  }

  return ok();
});

// POST /api/v1/partner-auth/reset-password
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const body = resetPasswordSchema.parse(req.body);

  const redis = getRedis();
  const partnerUserId = await redis.get(`partner_reset:${body.token}`);

  if (!partnerUserId) {
    res.status(400).json({ detail: 'Invalid or expired reset token.' });
    return;
  }

  const partnerUser = await PartnerUser.findById(partnerUserId);
  if (!partnerUser) {
    res.status(400).json({ detail: 'Invalid or expired reset token.' });
    return;
  }

  partnerUser.passwordHash = await bcrypt.hash(body.password, 12);
  await partnerUser.save();

  // Invalidate the token so it can't be reused
  await redis.del(`partner_reset:${body.token}`);

  res.json({ success: true });
});

export default router;
