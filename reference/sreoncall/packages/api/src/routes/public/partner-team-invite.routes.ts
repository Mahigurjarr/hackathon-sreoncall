import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { Partner } from '../../models/partner.model';
import { PartnerUser } from '../../models/partner-user.model';
import { PartnerUserInvite } from '../../models/partner-user-invite.model';
import { PartnerAuditLog } from '../../models/partner-audit-log.model';
import { logger } from '../../utils/logger';

const router = Router();

const acceptBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200).trim(),
  password: z.string().min(8).max(128),
});

// GET /api/v1/public/partner-team-invite?token=xxx
router.get('/', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    res.status(422).json({ detail: 'token is required' });
    return;
  }

  const invite = await PartnerUserInvite.findOne({ token }).lean();
  if (!invite) {
    res.status(404).json({ detail: 'Invalid invite token.' });
    return;
  }
  if (invite.status !== 'pending') {
    res.status(409).json({ detail: `This invite has already been ${invite.status}.` });
    return;
  }
  if (invite.expiresAt < new Date()) {
    res.status(410).json({ detail: 'This invite link has expired.' });
    return;
  }

  const partner = await Partner.findById(invite.partnerId).select('company').lean();
  res.json({
    email: invite.email,
    role: invite.role,
    partnerName: partner?.company ?? 'SREonCall Partner',
  });
});

// POST /api/v1/public/partner-team-invite
router.post('/', async (req: Request, res: Response) => {
  const parsed = acceptBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const { token, name, password } = parsed.data;

  try {
    const invite = await PartnerUserInvite.findOne({ token });
    if (!invite) {
      res.status(404).json({ detail: 'Invalid invite token.' });
      return;
    }
    if (invite.status !== 'pending') {
      res.status(409).json({ detail: `This invite has already been ${invite.status}.` });
      return;
    }
    if (invite.expiresAt < new Date()) {
      invite.status = 'expired';
      await invite.save();
      res.status(410).json({ detail: 'This invite link has expired.' });
      return;
    }

    const existing = await PartnerUser.findOne({ email: invite.email }).lean();
    if (existing) {
      res.status(409).json({ detail: 'A partner user with this email already exists.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = await PartnerUser.create({
      partnerId: invite.partnerId,
      name,
      email: invite.email,
      passwordHash,
      emailVerified: true,
      role: invite.role,
      invitedBy: invite.invitedBy,
    });

    invite.status = 'accepted';
    invite.acceptedAt = new Date();
    await invite.save();

    await PartnerAuditLog.create({
      partnerId: invite.partnerId,
      actorUserId: newUser._id,
      actorEmail: newUser.email,
      action: 'team.member.joined',
      targetUserId: newUser._id,
      targetEmail: newUser.email,
      metadata: { role: invite.role, inviteId: invite._id.toString() },
    });

    res.status(201).json({ success: true });
  } catch (err: any) {
    logger.error('Failed to accept partner team invite', { error: err.message });
    res.status(500).json({ detail: 'Internal server error. Please try again.' });
  }
});

export default router;
