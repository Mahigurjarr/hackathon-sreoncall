import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { Types } from 'mongoose';
import { User, UserDocument } from '../models/user.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { sendInviteEmail } from './email.service';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';

const BCRYPT_ROUNDS = 12;

interface CreateUserInput {
  tenant_id: Types.ObjectId;
  email: string;
  name: string;
  password?: string;
  roles?: string[];
}

interface InviteUserInput {
  tenant_id: Types.ObjectId;
  email: string;
  name: string;
  roles?: string[];
  inviter_name?: string;
  org_name?: string;
  org_slug?: string;
}

interface UpdateUserInput {
  name?: string;
  avatar_url?: string | null;
  /**
   * `roles` is deprecated here — use `setUserRoles()` for role changes.
   * Left in the type so existing callers (invite/accept) can still set the
   * initial role set via the service, but the public HTTP handler no longer
   * passes this through (F-01 security fix 2026-04-21).
   */
  roles?: string[];
  status?: 'active' | 'disabled';
  timezone?: string;
  phone_number?: string;
  notification_preferences?: Partial<{
    email: boolean;
    in_app: boolean;
    sms: boolean;
    slack: boolean;
    voice: boolean;
    whatsapp: boolean;
    ticket_assigned: boolean;
    ticket_updated: boolean;
    ticket_commented: boolean;
    mention: boolean;
    sla_breach: boolean;
    channels: Partial<{
      incident: boolean;
      ticket: boolean;
      oncall: boolean;
      system: boolean;
    }>;
    quiet_hours: Partial<{
      enabled: boolean;
      start: string;
      end: string;
      timezone: string;
    }>;
  }>;
}

export async function getUserById(
  tenantId: Types.ObjectId,
  userId: string
): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId, status: { $ne: 'deleted' } });
  if (!user) {
    throw AppError.notFound('User');
  }
  return user;
}

export async function listUsers(
  tenantId: Types.ObjectId,
  pagination: PaginationParams,
  filters?: { status?: string; role?: string; search?: string }
): Promise<PaginatedResult<UserDocument>> {
  const baseFilter: Record<string, any> = {
    tenant_id: tenantId,
    status: { $ne: 'deleted' },
  };

  if (filters?.status) {
    const statuses = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
    baseFilter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  if (filters?.role) baseFilter.roles = filters.role;
  if (filters?.search) {
    baseFilter.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const { filter, sort } = buildCursorFilter(pagination, baseFilter);

  const results = await User.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await User.countDocuments(baseFilter);

  return paginateResults(results, pagination, total);
}

export async function createUser(input: CreateUserInput): Promise<UserDocument> {
  const existing = await User.findOne({
    tenant_id: input.tenant_id,
    email: input.email.toLowerCase(),
  });

  if (existing) {
    if (existing.status === 'deleted') {
      // Reactivate the soft-deleted user
      existing.name = input.name;
      existing.roles = input.roles || ['agent'];
      existing.status = 'active';
      existing.source = 'local';
      existing.deleted_at = undefined;
      existing.invite_token = undefined;
      existing.failed_login_attempts = 0;
      existing.locked_until = undefined;
      if (input.password) {
        existing.password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      } else {
        existing.password_hash = undefined;
      }
      await existing.save();
      return existing;
    }
    throw AppError.conflict('User with this email already exists in this tenant.');
  }

  const userData: any = {
    tenant_id: input.tenant_id,
    email: input.email.toLowerCase(),
    name: input.name,
    roles: input.roles || ['agent'],
    status: 'active',
    source: 'local',
  };

  if (input.password) {
    userData.password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  }

  return User.create(userData);
}

export async function inviteUser(input: InviteUserInput): Promise<{ user: UserDocument; invite_token: string }> {
  const existing = await User.findOne({
    tenant_id: input.tenant_id,
    email: input.email.toLowerCase(),
  });

  let user: UserDocument;
  let invite_token: string;

  if (existing) {
    // Allow re-inviting a soft-deleted or previously invited user
    if (existing.status === 'deleted' || existing.status === 'invited') {
      invite_token = uuidv4();
      existing.name = input.name;
      existing.roles = input.roles || ['agent'];
      existing.status = 'invited';
      existing.invite_token = invite_token;
      existing.deleted_at = undefined;
      existing.password_hash = undefined;
      await existing.save();
      user = existing;
    } else {
      throw AppError.conflict('User with this email already exists in this tenant.');
    }
  } else {
    invite_token = uuidv4();
    user = await User.create({
      tenant_id: input.tenant_id,
      email: input.email.toLowerCase(),
      name: input.name,
      roles: input.roles || ['agent'],
      status: 'invited',
      source: 'local',
      invite_token,
    });
  }

  // Send invitation email (non-blocking — don't fail the invite if email fails)
  sendInviteEmail({
    to: input.email,
    name: input.name,
    inviterName: input.inviter_name || 'A team member',
    orgName: input.org_name || 'your organization',
    orgSlug: input.org_slug || 'platform',
    inviteToken: invite_token,
  }).catch(err => console.error('[email] Failed to send invite email:', err?.message));

  return { user, invite_token };
}

export async function acceptInvite(
  inviteToken: string,
  password: string,
  name?: string,
  phone_number?: string,
): Promise<{ user: UserDocument; org_slug: string }> {
  const user = await User.findOne({ invite_token: inviteToken, status: 'invited' });
  if (!user) {
    throw AppError.badRequest('Invalid or expired invite token.');
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  user.password_hash = password_hash;
  user.status = 'active';
  user.invite_token = undefined;
  user.email_verified = true;
  if (name) user.name = name;
  if (phone_number) user.phone_number = phone_number;

  await user.save();

  // Look up the tenant slug so the frontend can pre-fill sign-in
  const { Tenant } = await import('../models/tenant.model');
  const tenant = await Tenant.findById(user.tenant_id).lean();
  const org_slug = (tenant as any)?.slug || 'platform';

  return { user, org_slug };
}

export async function updateUser(
  tenantId: Types.ObjectId,
  userId: string,
  input: UpdateUserInput
): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId, status: { $ne: 'deleted' } });
  if (!user) {
    throw AppError.notFound('User');
  }

  if (input.name !== undefined) user.name = input.name;
  if (input.avatar_url !== undefined) user.avatar_url = input.avatar_url ?? undefined;
  if (input.roles !== undefined) user.roles = input.roles;
  if (input.status !== undefined) user.status = input.status;
  if (input.phone_number !== undefined) user.phone_number = input.phone_number || undefined;
  if (input.timezone !== undefined) user.timezone = input.timezone;

  if (input.notification_preferences) {
    const { channels, quiet_hours, ...flat } = input.notification_preferences;
    Object.assign(user.notification_preferences, flat);
    if (channels) {
      Object.assign(user.notification_preferences.channels, channels);
    }
    if (quiet_hours) {
      Object.assign(user.notification_preferences.quiet_hours, quiet_hours);
    }
    user.markModified('notification_preferences');
  }

  await user.save();
  return user;
}

/**
 * Set a user's roles. Separate from `updateUser` so the two responsibilities
 * (profile edit vs. role change) can have different authorization checks at
 * the route layer. Assumes the caller has already validated the roles list
 * against the tenant-assignable allowlist.
 */
export async function setUserRoles(
  tenantId: Types.ObjectId,
  userId: string,
  roles: string[],
): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId, status: { $ne: 'deleted' } });
  if (!user) {
    throw AppError.notFound('User');
  }
  user.roles = roles;
  await user.save();
  return user;
}

export async function deleteUser(tenantId: Types.ObjectId, userId: string): Promise<void> {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId });
  if (!user) {
    throw AppError.notFound('User');
  }

  user.status = 'deleted';
  user.deleted_at = new Date();
  await user.save();
}
