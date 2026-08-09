import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { getConfig } from '../config/index';
import { getRedis } from '../config/redis';
import { encryptToken, decryptToken } from '../utils/encryption';
import { anonymizeIp } from '../utils/ip-anonymize';
import { Tenant, TenantDocument } from '../models/tenant.model';
import { User, UserDocument } from '../models/user.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { initializeTenant, createWebsiteSyntheticCheck } from './tenant-init.service';
import { normalizeUrl } from '../utils/url';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '8h';
const SESSION_PREFIX = 'session:';
const MFA_CHALLENGE_PREFIX = 'mfa-challenge:';
const MFA_CHALLENGE_TTL = 300; // 5 minutes

interface TokenPayload {
  sub: string;
  tenant_id: string;
  email: string;
  roles: string[];
  jti: string;
  impersonated_by?: string;
}

interface AuthTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SignupInput {
  tenant_name: string;
  tenant_slug: string;
  email: string;
  name: string;
  password: string;
  website?: string;
}

function generateTokens(user: UserDocument, tenantId: Types.ObjectId, impersonatedBy?: string): AuthTokens {
  const config = getConfig();
  const jti = uuidv4();

  const payload: TokenPayload = {
    sub: user._id.toString(),
    tenant_id: tenantId.toString(),
    email: user.email,
    roles: user.roles,
    jti,
  };

  if (impersonatedBy) {
    payload.impersonated_by = impersonatedBy;
  }

  const access_token = jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

  // Store session in Redis
  const redis = getRedis();
  const sessionKey = `${SESSION_PREFIX}${user._id}:${jti}`;
  const sessionData = JSON.stringify({
    jti,
    user_id: user._id.toString(),
    tenant_id: tenantId.toString(),
    created_at: new Date().toISOString(),
    ip: 'unknown', // Will be updated by the caller
  });

  redis.setex(sessionKey, 8 * 60 * 60, sessionData).catch((err) => {
    logger.error('Failed to store session in Redis', { error: err.message });
  });

  return {
    access_token,
    token_type: 'Bearer',
    expires_in: 8 * 60 * 60,
  };
}

export async function login(
  tenantId: Types.ObjectId,
  email: string,
  password: string,
  ip?: string
): Promise<{ tokens: AuthTokens; user: UserDocument } | { mfa_required: true; mfa_token: string }> {
  const user = await User.findOne({ tenant_id: tenantId, email: email.toLowerCase() }).select(
    '+password_hash'
  );

  if (!user) {
    throw AppError.unauthorized('Invalid email or password.');
  }

  if (user.status !== 'active') {
    throw AppError.unauthorized('Account is not active.');
  }

  // Check account lockout
  if (user.locked_until && user.locked_until > new Date()) {
    const remainingMs = user.locked_until.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    throw AppError.unauthorized(`Account locked. Try again in ${remainingMin} minutes.`);
  }

  if (!user.password_hash) {
    throw AppError.unauthorized('Password login not available for this account.');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    // Increment failed attempts
    user.failed_login_attempts += 1;

    // Lock after 5 failed attempts for 15 minutes
    if (user.failed_login_attempts >= 5) {
      user.locked_until = new Date(Date.now() + 15 * 60 * 1000);
      user.failed_login_attempts = 0;
    }

    await user.save();
    throw AppError.unauthorized('Invalid email or password.');
  }

  // Reset failed attempts on successful login
  user.failed_login_attempts = 0;
  user.locked_until = undefined;

  // Block login until the user has verified their email address
  // (SRE-001 in security assessment 2026-04-22). Local-signup users land
  // in the collection with email_verified=false; SSO/SCIM/invite-accept
  // paths explicitly set it true. Invited users created before this gate
  // existed are unaffected because invite acceptance flips the flag.
  if (user.source === 'local' && user.email_verified === false) {
    await user.save(); // persist reset of failed_login_attempts
    throw new AppError(
      403,
      'Email Not Verified',
      'Please verify your email address before signing in. Check your inbox for the verification link.',
      'https://sreoncall.io/problems/email-not-verified',
    );
  }

  // Check if MFA is enabled — require second factor
  if (user.mfa?.mfa_enabled) {
    await user.save();

    const mfaToken = uuidv4();
    const redis = getRedis();
    await redis.setex(
      `${MFA_CHALLENGE_PREFIX}${mfaToken}`,
      MFA_CHALLENGE_TTL,
      JSON.stringify({ user_id: user._id.toString(), tenant_id: tenantId.toString() })
    );

    return { mfa_required: true, mfa_token: mfaToken };
  }

  user.last_login_at = new Date();
  await user.save();

  const tokens = generateTokens(user, tenantId);

  // Update session with IP
  if (ip) {
    const decoded = jwt.decode(tokens.access_token) as any;
    const redis = getRedis();
    const sessionKey = `${SESSION_PREFIX}${user._id}:${decoded.jti}`;
    const sessionData = JSON.stringify({
      jti: decoded.jti,
      user_id: user._id.toString(),
      tenant_id: tenantId.toString(),
      created_at: new Date().toISOString(),
      ip: anonymizeIp(ip),
    });
    redis.setex(sessionKey, 8 * 60 * 60, sessionData).catch(() => {});
  }

  return { tokens, user };
}

const EMAIL_VERIFY_PREFIX = 'email-verify:';
const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Generate + persist a one-time email-verification token. Mirrors the
 * pattern used by generatePasswordResetToken — Redis-backed, single-use,
 * 24-hour TTL.
 */
export async function generateEmailVerifyToken(userId: Types.ObjectId | string): Promise<string> {
  const token = uuidv4();
  const redis = getRedis();
  await redis.setex(
    `${EMAIL_VERIFY_PREFIX}${token}`,
    EMAIL_VERIFY_TTL_SECONDS,
    JSON.stringify({ user_id: userId.toString() }),
  );
  return token;
}

export async function signup(input: SignupInput): Promise<{
  user: UserDocument;
  tenant: TenantDocument;
  verify_token: string;
}> {
  // Slug uniqueness collision returns a generic 422 validation error with no
  // "already taken" signal, so the public signup endpoint cannot be used to
  // enumerate registered customer organizations via crt.sh-style probing
  // (F-04 in security assessment 2026-04-21).
  const existingTenant = await Tenant.findOne({ slug: input.tenant_slug });
  if (existingTenant) {
    throw AppError.unprocessable(
      'The provided details could not be registered. Please try again with different values.',
      [{ path: 'tenant_slug', message: 'invalid', code: 'invalid' }],
    );
  }

  // Email already registered returns the same generic error — same leak shape.
  const existingUser = await User.findOne({ email: input.email.toLowerCase() });
  if (existingUser) {
    throw AppError.unprocessable(
      'The provided details could not be registered. Please try again with different values.',
      [{ path: 'email', message: 'invalid', code: 'invalid' }],
    );
  }

  // Normalize website URL (silently ignored if invalid)
  const website = input.website ? normalizeUrl(input.website) : null;

  // Create tenant
  const tenant = await Tenant.create({
    slug: input.tenant_slug,
    name: input.tenant_name,
    status: 'active',
    plan: 'free',
    ...(website && { website }),
  });

  // Hash password
  const password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // Create user as tenant_admin
  const user = await User.create({
    tenant_id: tenant._id,
    email: input.email.toLowerCase(),
    email_verified: false,
    name: input.name,
    roles: ['tenant_admin'],
    status: 'active',
    source: 'local',
    password_hash,
  });

  // Seed default resources (e.g. Default project)
  await initializeTenant(tenant._id, user._id);

  // Auto-create website synthetic check (non-fatal)
  if (website) {
    try {
      await createWebsiteSyntheticCheck(tenant._id, user._id, website);
    } catch (err: any) {
      logger.warn('Failed to create website synthetic check during signup', {
        tenant_id: tenant._id.toString(),
        error: err.message,
      });
    }
  }

  // Do NOT issue an access token here — email must be verified first
  // (SRE-001 in security assessment 2026-04-22). Return a one-time
  // verification token that the signup route uses to compose the email.
  const verify_token = await generateEmailVerifyToken(user._id);

  return { user, tenant, verify_token };
}

/**
 * Re-issue an email-verification token for an account that already exists
 * but hasn't verified. Called by the public `resend-verification-email`
 * route. Returns null if the email is unknown or already verified — callers
 * MUST NOT distinguish these outcomes in the HTTP response (enumeration
 * protection).
 */
export async function generateVerifyTokenForEmail(
  email: string,
): Promise<{ user: UserDocument; tenant: TenantDocument | null; token: string } | null> {
  const user = await User.findOne({ email: email.toLowerCase(), status: 'active' });
  if (!user) return null;
  if (user.email_verified) return null;
  if (user.source !== 'local') return null;
  const tenant = await Tenant.findById(user.tenant_id);
  const token = await generateEmailVerifyToken(user._id);
  return { user, tenant, token };
}

export async function logout(userId: string, jti: string): Promise<void> {
  const redis = getRedis();

  // Add token to deny-list (expires when token would expire)
  await redis.setex(`token:revoked:${jti}`, 8 * 60 * 60, '1');

  // Remove session
  await redis.del(`${SESSION_PREFIX}${userId}:${jti}`);
}

export async function getUserSessions(userId: string): Promise<any[]> {
  const redis = getRedis();
  const keys = await redis.keys(`${SESSION_PREFIX}${userId}:*`);

  if (keys.length === 0) return [];

  const sessions = [];
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) {
      sessions.push(JSON.parse(data));
    }
  }

  return sessions;
}

export async function revokeSession(userId: string, jti: string): Promise<void> {
  const redis = getRedis();
  await redis.setex(`token:revoked:${jti}`, 8 * 60 * 60, '1');
  await redis.del(`${SESSION_PREFIX}${userId}:${jti}`);
}

export async function changePassword(
  userId: Types.ObjectId,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await User.findById(userId).select('+password_hash +password_history');
  if (!user) {
    throw AppError.notFound('User');
  }

  if (!user.password_hash) {
    throw AppError.badRequest('Password login not available for this account.');
  }

  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValid) {
    throw AppError.unauthorized('Current password is incorrect.');
  }

  // Check password history
  for (const oldHash of user.password_history) {
    const reused = await bcrypt.compare(newPassword, oldHash);
    if (reused) {
      throw AppError.badRequest('Cannot reuse a recent password.');
    }
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Keep last 5 passwords in history
  const history = [user.password_hash, ...user.password_history].slice(0, 5);

  user.password_hash = newHash;
  user.password_history = history;
  user.force_password_change = false;
  await user.save();
}

export async function generatePasswordResetToken(email: string, tenantId: Types.ObjectId): Promise<string> {
  const user = await User.findOne({ tenant_id: tenantId, email: email.toLowerCase() });
  if (!user) {
    // Don't reveal whether email exists
    return 'reset-token-placeholder';
  }

  const token = uuidv4();
  const redis = getRedis();
  // Store reset token for 1 hour
  await redis.setex(`password-reset:${token}`, 3600, JSON.stringify({
    user_id: user._id.toString(),
    tenant_id: tenantId.toString(),
  }));

  return token;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const redis = getRedis();
  const data = await redis.get(`password-reset:${token}`);
  if (!data) {
    throw AppError.badRequest('Invalid or expired reset token.');
  }

  const { user_id } = JSON.parse(data);
  const user = await User.findById(user_id).select('+password_hash +password_history');
  if (!user) {
    throw AppError.notFound('User');
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const history = user.password_hash
    ? [user.password_hash, ...user.password_history].slice(0, 5)
    : user.password_history;

  user.password_hash = newHash;
  user.password_history = history;
  user.force_password_change = false;
  await user.save();

  // Invalidate the reset token
  await redis.del(`password-reset:${token}`);
}

// --- MFA functions ---

function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex') // 10-char hex codes
  );
}

export async function setupMfa(userId: Types.ObjectId): Promise<{
  secret: string;
  qr_code: string;
  otpauth_url: string;
}> {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User');

  if (user.mfa?.mfa_enabled) {
    throw AppError.badRequest('MFA is already enabled.');
  }

  const secret = otpGenerateSecret();
  const otpauth_url = generateURI({ secret, issuer: 'SREonCall', label: user.email });
  const qr_code = await QRCode.toDataURL(otpauth_url);

  // Store secret encrypted (not yet enabled)
  user.mfa = {
    ...user.mfa,
    totp_secret: encryptToken(secret),
    totp_enabled: false,
    mfa_enabled: false,
  } as any;
  user.markModified('mfa');
  await user.save();

  return { secret, qr_code, otpauth_url };
}

export async function verifyAndEnableMfa(
  userId: Types.ObjectId,
  code: string
): Promise<{ backup_codes: string[] }> {
  const user = await User.findById(userId).select('+mfa.totp_secret');
  if (!user) throw AppError.notFound('User');

  if (user.mfa?.mfa_enabled) {
    throw AppError.badRequest('MFA is already enabled.');
  }

  const encryptedSecret = user.mfa?.totp_secret;
  if (!encryptedSecret) {
    throw AppError.badRequest('MFA setup not initiated. Call /mfa/setup first.');
  }

  // Decrypt secret (may be plaintext for legacy records)
  let secret: string;
  try {
    secret = decryptToken(encryptedSecret);
  } catch {
    secret = encryptedSecret; // fallback for unencrypted secrets
  }

  const isValid = verifySync({ token: code, secret });
  if (!isValid) {
    throw AppError.unauthorized('Invalid verification code.');
  }

  // Generate backup codes
  const plaintextCodes = generateBackupCodes(10);
  const hashedCodes = await Promise.all(
    plaintextCodes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS))
  );

  // Re-encrypt the secret (ensure it's encrypted)
  try {
    decryptToken(encryptedSecret); // already encrypted
  } catch {
    // Was plaintext, encrypt it now
    user.mfa.totp_secret = encryptToken(encryptedSecret);
  }
  user.mfa.totp_enabled = true;
  user.mfa.mfa_enabled = true;
  user.mfa.backup_codes = hashedCodes;
  user.markModified('mfa');
  await user.save();

  return { backup_codes: plaintextCodes };
}

export async function verifyMfaChallenge(
  mfaToken: string,
  code: string,
  ip?: string
): Promise<{ tokens: AuthTokens; user: UserDocument }> {
  const redis = getRedis();
  const challengeKey = `${MFA_CHALLENGE_PREFIX}${mfaToken}`;
  const data = await redis.get(challengeKey);

  if (!data) {
    throw AppError.unauthorized('MFA challenge expired or invalid.');
  }

  // Delete immediately (one-use)
  await redis.del(challengeKey);

  const { user_id, tenant_id } = JSON.parse(data);
  const user = await User.findById(user_id).select('+mfa.totp_secret +mfa.backup_codes');
  if (!user) {
    throw AppError.notFound('User');
  }

  const encryptedSecret = user.mfa?.totp_secret;
  if (!encryptedSecret) {
    throw AppError.unauthorized('MFA not configured.');
  }

  // Decrypt secret (may be plaintext for legacy records)
  let secret: string;
  try {
    secret = decryptToken(encryptedSecret);
  } catch {
    secret = encryptedSecret; // fallback for unencrypted secrets
  }

  // Try TOTP verification first
  let verified: boolean = !!verifySync({ token: code, secret });

  // If TOTP fails, try backup codes
  if (!verified && user.mfa.backup_codes?.length) {
    for (let i = 0; i < user.mfa.backup_codes.length; i++) {
      const match = await bcrypt.compare(code, user.mfa.backup_codes[i]);
      if (match) {
        // Remove used backup code
        user.mfa.backup_codes.splice(i, 1);
        user.markModified('mfa');
        verified = true;
        break;
      }
    }
  }

  if (!verified) {
    throw AppError.unauthorized('Invalid MFA code.');
  }

  user.last_login_at = new Date();
  await user.save();

  const tenantObjId = new Types.ObjectId(tenant_id);
  const tokens = generateTokens(user, tenantObjId);

  // Update session with IP
  if (ip) {
    const decoded = jwt.decode(tokens.access_token) as any;
    const sessionKey = `${SESSION_PREFIX}${user._id}:${decoded.jti}`;
    const sessionData = JSON.stringify({
      jti: decoded.jti,
      user_id: user._id.toString(),
      tenant_id: tenant_id,
      created_at: new Date().toISOString(),
      ip: anonymizeIp(ip),
    });
    redis.setex(sessionKey, 8 * 60 * 60, sessionData).catch(() => {});
  }

  return { tokens, user };
}

export async function disableMfa(
  userId: Types.ObjectId,
  password: string
): Promise<void> {
  const user = await User.findById(userId).select('+password_hash');
  if (!user) throw AppError.notFound('User');

  if (!user.password_hash) {
    throw AppError.badRequest('Password login not available for this account.');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw AppError.unauthorized('Invalid password.');
  }

  user.mfa = {
    totp_secret: undefined,
    totp_enabled: false,
    mfa_enabled: false,
    backup_codes: [],
    recovery_codes: [],
  } as any;
  user.markModified('mfa');
  await user.save();
}

export async function regenerateBackupCodes(
  userId: Types.ObjectId,
  password: string
): Promise<{ backup_codes: string[] }> {
  const user = await User.findById(userId).select('+password_hash');
  if (!user) throw AppError.notFound('User');

  if (!user.mfa?.mfa_enabled) {
    throw AppError.badRequest('MFA is not enabled.');
  }

  if (!user.password_hash) {
    throw AppError.badRequest('Password login not available for this account.');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw AppError.unauthorized('Invalid password.');
  }

  const plaintextCodes = generateBackupCodes(10);
  const hashedCodes = await Promise.all(
    plaintextCodes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS))
  );

  user.mfa.backup_codes = hashedCodes;
  user.markModified('mfa');
  await user.save();

  return { backup_codes: plaintextCodes };
}
