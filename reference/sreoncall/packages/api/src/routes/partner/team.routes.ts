import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { partnerAuthGuard, requirePartnerRole } from '../../middleware/partnerAuth.middleware';
import { Partner } from '../../models/partner.model';
import { PartnerUser, PARTNER_USER_ROLES } from '../../models/partner-user.model';
import { PartnerUserInvite } from '../../models/partner-user-invite.model';
import { PartnerAuditLog } from '../../models/partner-audit-log.model';
import { sendPartnerTeamInviteEmail } from '../../services/partner-email.service';
import { logger } from '../../utils/logger';

const router = Router();

router.use(partnerAuthGuard);

// Re-check partner is active for every team route.
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const partner = await Partner.findById(req.partnerUser!.partnerId).select('status').lean();
  if (!partner || partner.status !== 'active') {
    res.status(403).json({ detail: 'Partner account is not active.' });
    return;
  }
  next();
});

const INVITE_TTL_DAYS = 7;

// Member role schema excludes 'owner' — ownership is transferred, not assigned on invite.
const invitableRoleSchema = z.enum(['admin', 'member']);

const inviteBodySchema = z.object({
  email: z.string().email().toLowerCase().max(255),
  role: invitableRoleSchema,
});

const patchMemberSchema = z.object({
  role: z.enum(PARTNER_USER_ROLES as unknown as [string, ...string[]]),
});

function publicInvite(inv: {
  _id: Types.ObjectId | string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  invitedBy: Types.ObjectId | string;
  createdAt: Date;
}) {
  return {
    _id: inv._id.toString(),
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    invitedBy: inv.invitedBy.toString(),
    createdAt: inv.createdAt,
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/partner/team/members
// ---------------------------------------------------------------------------
router.get('/members', async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;

  const members = await PartnerUser.find({ partnerId })
    .select('_id name email role lastLoginAt createdAt')
    .sort({ createdAt: 1 })
    .lean();

  res.json({
    data: members.map((m) => ({
      _id: m._id.toString(),
      name: m.name,
      email: m.email,
      role: m.role ?? 'member',
      lastLoginAt: m.lastLoginAt ?? null,
      createdAt: m.createdAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/partner/team/invites
// ---------------------------------------------------------------------------
router.get('/invites', async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;

  // Auto-expire stale pending invites on read.
  await PartnerUserInvite.updateMany(
    { partnerId, status: 'pending', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );

  const invites = await PartnerUserInvite.find({ partnerId, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean();

  res.json({ data: invites.map(publicInvite) });
});

// ---------------------------------------------------------------------------
// POST /api/v1/partner/team/invites
// ---------------------------------------------------------------------------
router.post('/invites', requirePartnerRole('owner', 'admin'), async (req: Request, res: Response) => {
  const { partnerId, partnerUserId } = req.partnerUser!;
  const body = inviteBodySchema.parse(req.body);

  // Rate-limit: hard cap 20 pending invites per partner
  const pendingCount = await PartnerUserInvite.countDocuments({ partnerId, status: 'pending' });
  if (pendingCount >= 20) {
    res.status(429).json({ detail: 'Too many pending invites. Revoke unused invites and try again.' });
    return;
  }

  // Reject if an active partner user already exists with this email
  const existingUser = await PartnerUser.findOne({ email: body.email }).select('_id partnerId').lean();
  if (existingUser) {
    if (existingUser.partnerId.toString() === partnerId) {
      res.status(409).json({ detail: 'This email already belongs to a member of your team.' });
    } else {
      res.status(409).json({ detail: 'This email is already associated with another partner account.' });
    }
    return;
  }

  // Reject duplicate pending invite
  const existingInvite = await PartnerUserInvite.findOne({
    partnerId,
    email: body.email,
    status: 'pending',
  }).lean();
  if (existingInvite) {
    res.status(409).json({ detail: 'A pending invite already exists for this email.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await PartnerUserInvite.create({
    partnerId,
    email: body.email,
    role: body.role,
    token,
    expiresAt,
    invitedBy: partnerUserId,
    status: 'pending',
  });

  await PartnerAuditLog.create({
    partnerId,
    actorUserId: partnerUserId,
    actorEmail: req.partnerUser!.email,
    action: 'team.invite.created',
    targetEmail: body.email,
    metadata: { role: body.role, inviteId: invite._id.toString() },
  });

  // Fetch partner + inviter for email
  const [partner, inviter] = await Promise.all([
    Partner.findById(partnerId).select('company email').lean(),
    PartnerUser.findById(partnerUserId).select('name email').lean(),
  ]);

  try {
    await sendPartnerTeamInviteEmail({
      email: body.email,
      partnerName: partner?.company ?? 'your SREonCall partner organization',
      inviterName: inviter?.name ?? 'A partner administrator',
      role: body.role,
      token,
    });
  } catch (err) {
    logger.error('Failed to send partner team invite email', {
      error: err instanceof Error ? err.message : String(err),
      inviteId: invite._id.toString(),
    });
    // Don't roll back — invite link is still valid; user can resend.
  }

  res.status(201).json(publicInvite(invite.toObject() as any));
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/partner/team/invites/:id  (revoke)
// ---------------------------------------------------------------------------
router.delete('/invites/:id', requirePartnerRole('owner', 'admin'), async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id as string)) {
    res.status(400).json({ detail: 'Invalid invite ID.' });
    return;
  }

  const invite = await PartnerUserInvite.findOne({ _id: id, partnerId });
  if (!invite) {
    res.status(404).json({ detail: 'Invite not found.' });
    return;
  }
  if (invite.status !== 'pending') {
    res.status(409).json({ detail: `Invite is already ${invite.status}.` });
    return;
  }

  invite.status = 'revoked';
  invite.revokedAt = new Date();
  await invite.save();

  await PartnerAuditLog.create({
    partnerId,
    actorUserId: req.partnerUser!.partnerUserId,
    actorEmail: req.partnerUser!.email,
    action: 'team.invite.revoked',
    targetEmail: invite.email,
    metadata: { inviteId: invite._id.toString() },
  });

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/partner/team/members/:id  (change role)
// ---------------------------------------------------------------------------
router.patch('/members/:id', requirePartnerRole('owner'), async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id as string)) {
    res.status(400).json({ detail: 'Invalid member ID.' });
    return;
  }

  const body = patchMemberSchema.parse(req.body);
  const newRole = body.role as 'owner' | 'admin' | 'member';

  const member = await PartnerUser.findOne({ _id: id, partnerId });
  if (!member) {
    res.status(404).json({ detail: 'Member not found.' });
    return;
  }

  // Cannot demote the last owner.
  if (member.role === 'owner' && newRole !== 'owner') {
    const ownerCount = await PartnerUser.countDocuments({ partnerId, role: 'owner' });
    if (ownerCount <= 1) {
      res.status(400).json({ detail: 'Cannot demote the last owner. Transfer ownership first.' });
      return;
    }
  }

  const prevRole = member.role;
  member.role = newRole;
  await member.save();

  await PartnerAuditLog.create({
    partnerId,
    actorUserId: req.partnerUser!.partnerUserId,
    actorEmail: req.partnerUser!.email,
    action: 'team.member.role_changed',
    targetUserId: member._id,
    targetEmail: member.email,
    metadata: { from: prevRole, to: newRole },
  });

  res.json({
    _id: member._id.toString(),
    name: member.name,
    email: member.email,
    role: member.role,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/partner/team/members/:id  (remove)
// ---------------------------------------------------------------------------
router.delete('/members/:id', requirePartnerRole('owner'), async (req: Request, res: Response) => {
  const { partnerId, partnerUserId } = req.partnerUser!;
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id as string)) {
    res.status(400).json({ detail: 'Invalid member ID.' });
    return;
  }

  // Self-removal is not allowed — use logout or transfer ownership first.
  if (id === partnerUserId) {
    res.status(400).json({ detail: 'You cannot remove yourself. Transfer ownership first.' });
    return;
  }

  const member = await PartnerUser.findOne({ _id: id, partnerId });
  if (!member) {
    res.status(404).json({ detail: 'Member not found.' });
    return;
  }

  // Cannot remove the last owner.
  if (member.role === 'owner') {
    const ownerCount = await PartnerUser.countDocuments({ partnerId, role: 'owner' });
    if (ownerCount <= 1) {
      res.status(400).json({ detail: 'Cannot remove the last owner. Transfer ownership first.' });
      return;
    }
  }

  await PartnerUser.deleteOne({ _id: id });

  await PartnerAuditLog.create({
    partnerId,
    actorUserId: partnerUserId,
    actorEmail: req.partnerUser!.email,
    action: 'team.member.removed',
    targetUserId: member._id,
    targetEmail: member.email,
    metadata: { role: member.role },
  });

  res.json({ success: true });
});

// Unused imports guard (bcrypt is re-used across codebase; kept for future hashed transitions).
void bcrypt;

export default router;
