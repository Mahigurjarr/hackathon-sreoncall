import crypto from 'crypto';
import { Types } from 'mongoose';
import { BoardInvite, BoardInviteDocument } from '../models/board-invite.model';
import { BoardMember, BoardMemberDocument, BoardMemberRole } from '../models/board-member.model';
import { User } from '../models/user.model';
import { Project } from '../models/project.model';
import { sendInviteEmail, sendBoardAddedEmail } from './email.service';
import { AppError } from '../middleware/errorHandler.middleware';

// ─── Invite a user to a board ─────────────────────────────────────────────────

export async function inviteUserToBoard(opts: {
  boardId: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  role: BoardMemberRole;
  invitedBy: Types.ObjectId;
  orgName: string;
  orgSlug: string;
}): Promise<BoardInviteDocument | BoardMemberDocument> {
  const { boardId, tenantId, email, role, invitedBy, orgName, orgSlug } = opts;
  const normalizedEmail = email.toLowerCase().trim();

  // Check if the user already has an account in this tenant
  const existingUser = await User.findOne({ tenant_id: tenantId, email: normalizedEmail })
    .select('_id')
    .lean();

  if (existingUser) {
    const existingMember = await BoardMember.findOne({
      board_id: boardId,
      user_id: existingUser._id,
    })
      .select('_id')
      .lean();

    if (existingMember) {
      throw new AppError(409, 'Conflict', 'User is already a member of this board');
    }

    // User exists — add them directly without requiring invite acceptance
    const [inviter, board] = await Promise.all([
      User.findById(invitedBy).select('name').lean(),
      Project.findById(boardId).select('name').lean(),
    ]);
    const inviterName = (inviter as any)?.name ?? 'A teammate';
    const boardName = (board as any)?.name ?? 'the project';

    const member = await BoardMember.create({
      tenant_id: tenantId,
      board_id: boardId,
      user_id: existingUser._id,
      role,
      invited_by: invitedBy,
      joined_at: new Date(),
    });

    sendBoardAddedEmail({
      to: normalizedEmail,
      inviterName,
      orgName,
      orgSlug,
      boardName,
    }).catch((err) => {
      console.error('[board-invite] failed to send notification email to', normalizedEmail, err?.message ?? err);
    });

    return member;
  }

  // User has no account — send token-based invite so they can sign up and join
  const pendingInvite = await BoardInvite.findOne({
    board_id: boardId,
    email: normalizedEmail,
    status: 'pending',
  })
    .select('_id')
    .lean();

  if (pendingInvite) {
    throw new AppError(409, 'Conflict', 'A pending invite already exists for this email');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await BoardInvite.create({
    tenant_id: tenantId,
    board_id: boardId,
    email: normalizedEmail,
    role,
    token,
    expires_at: expiresAt,
    invited_by: invitedBy,
    status: 'pending',
  });

  const inviter = await User.findById(invitedBy).select('name').lean();
  const inviterName = (inviter as any)?.name ?? 'A teammate';

  sendInviteEmail({
    to: normalizedEmail,
    name: normalizedEmail,
    inviterName,
    orgName,
    orgSlug,
    inviteToken: token,
    boardInvite: true,
  }).catch((err) => {
    console.error('[board-invite] failed to send invite email to', normalizedEmail, err?.message ?? err);
  });

  return invite;
}

// ─── Accept a board invite ────────────────────────────────────────────────────

export async function acceptBoardInvite(opts: {
  token: string;
  userId: Types.ObjectId;
  tenantId: Types.ObjectId;
}): Promise<BoardMemberDocument> {
  const { token, userId, tenantId } = opts;

  // Find the invite by token (any status)
  const invite = await BoardInvite.findOne({ token });

  if (!invite) {
    throw new AppError(404, 'Not Found', 'Invite not found or already used');
  }

  // Idempotent: if already accepted and user is already a member, return the member record
  if (invite.status === 'accepted') {
    const existingMember = await BoardMember.findOne({
      board_id: invite.board_id,
      user_id: userId,
    });
    if (existingMember) return existingMember;
    throw new AppError(409, 'Conflict', 'Invite already used');
  }

  if (invite.status !== 'pending') {
    throw new AppError(410, 'Gone', 'Invite has expired or been revoked');
  }

  // Check expiry
  if (invite.expires_at <= new Date()) {
    await BoardInvite.updateOne({ _id: invite._id }, { status: 'expired' });
    throw new AppError(410, 'Gone', 'Invite has expired');
  }

  // Tenant isolation check
  if (!invite.tenant_id.equals(tenantId)) {
    throw new AppError(403, 'Forbidden', 'This invite does not belong to your organization');
  }

  // Check if the user is already a member
  const existingMember = await BoardMember.findOne({
    board_id: invite.board_id,
    user_id: userId,
  });

  if (existingMember) {
    // Mark invite accepted even though they're already a member, then return existing record
    await BoardInvite.updateOne(
      { _id: invite._id },
      { status: 'accepted', accepted_at: new Date() }
    );
    return existingMember;
  }

  const claimed = await BoardInvite.findOneAndUpdate(
    { _id: invite._id, status: 'pending' },
    { $set: { status: 'accepted', accepted_at: new Date() } },
    { new: true }
  );
  if (!claimed) throw new AppError(409, 'Conflict', 'Invite already being processed');

  // Create the board member record
  const member = await BoardMember.create({
    tenant_id: invite.tenant_id,
    board_id: invite.board_id,
    user_id: userId,
    role: invite.role,
    invited_by: invite.invited_by,
    joined_at: new Date(),
  });

  return member;
}

// ─── Revoke a pending invite ──────────────────────────────────────────────────

export async function revokeBoardInvite(opts: {
  inviteId: Types.ObjectId;
  boardId: Types.ObjectId;
  actorId: Types.ObjectId;
}): Promise<void> {
  const { inviteId, boardId } = opts;

  const invite = await BoardInvite.findOne({
    _id: inviteId,
    board_id: boardId,
    status: 'pending',
  })
    .select('_id status')
    .lean();

  if (!invite) {
    throw new AppError(404, 'Not Found', 'Invite not found or not pending');
  }

  await BoardInvite.updateOne(
    { _id: inviteId },
    { status: 'revoked', revoked_at: new Date() }
  );
}

// ─── List all invites for a board ─────────────────────────────────────────────

export async function listBoardInvites(boardId: Types.ObjectId): Promise<BoardInviteDocument[]> {
  return BoardInvite.find({
    board_id: boardId,
    status: { $ne: 'expired' },
  })
    .sort({ created_at: -1 })
    .lean() as unknown as BoardInviteDocument[];
}

// ─── List all members of a board ──────────────────────────────────────────────

export async function listBoardMembers(boardId: Types.ObjectId): Promise<BoardMemberDocument[]> {
  return BoardMember.find({ board_id: boardId })
    .populate('user_id', 'name email')
    .lean() as unknown as BoardMemberDocument[];
}

// ─── Remove a member from a board ─────────────────────────────────────────────

export async function removeBoardMember(opts: {
  boardId: Types.ObjectId;
  userId: Types.ObjectId;
  actorId: Types.ObjectId;
}): Promise<void> {
  const { boardId, userId } = opts;

  const result = await BoardMember.findOneAndDelete({
    board_id: boardId,
    user_id: userId,
  });

  if (!result) {
    throw new AppError(404, 'Not Found', 'Member not found');
  }
}
