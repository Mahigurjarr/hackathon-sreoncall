import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import * as authService from '../services/auth.service';
import * as ssoService from '../services/sso.service';
import * as consentService from '../services/consent.service';
import { sendPasswordResetEmail } from '../services/email.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, lookupTenantForRequest } from '../middleware/tenant.middleware';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { getRedis } from '../config/redis';

const router = Router();

const signupSchema = z.object({
  tenant_name: z.string().min(2).max(200),
  tenant_slug: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
  website: z.string().max(2048).optional(),
  consent_privacy: z.literal(true).optional(),
  consent_terms: z.literal(true).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
});

// Rate limit the public signup endpoint to blunt brute-force tenant-slug
// enumeration (F-04 in security assessment 2026-04-21). 10 requests / 15
// minutes per IP is a generous ceiling for legitimate signups while making
// large-scale enumeration impractical.
const signupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many signup attempts. Please try again later.',
  },
});

// POST /api/v1/auth/signup - Public
router.post('/signup', signupRateLimit, async (req: Request, res: Response) => {
  const body = signupSchema.parse(req.body);
  const { user, tenant, verify_token } = await authService.signup(body);

  // Record consent if provided
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  if (body.consent_privacy) {
    await consentService.grantConsent({
      tenant_id: tenant._id,
      user_id: user._id,
      consent_type: 'privacy_policy',
      ip_address: ip,
      user_agent: userAgent,
    }).catch(() => {});
    await consentService.grantConsent({
      tenant_id: tenant._id,
      user_id: user._id,
      consent_type: 'terms_of_service',
      ip_address: ip,
      user_agent: userAgent,
    }).catch(() => {});
  }

  // Send the verification email. Failure is non-fatal for the HTTP
  // response — the user can trigger a resend from the signin page —
  // but the failure is logged so ops can see email delivery problems.
  try {
    const { sendVerificationEmail } = await import('../services/email.service');
    await sendVerificationEmail({
      to: user.email,
      name: user.name,
      verifyToken: verify_token,
      orgName: tenant.name,
    });
  } catch (err: any) {
    const { logger } = await import('../utils/logger');
    logger.warn('Failed to send verification email on signup', {
      user_id: user._id.toString(),
      tenant_id: tenant._id.toString(),
      error: err?.message,
    });
  }

  // SRE-001 (security assessment 2026-04-22): do NOT return a JWT until
  // the user has verified their email. Return 202 Accepted so the client
  // knows the account was created but isn't yet usable.
  res.status(202).json({
    message: 'Account created. Check your email for a verification link to activate sign-in.',
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    },
    tenant: {
      id: tenant._id,
      slug: tenant.slug,
      name: tenant.name,
      website: tenant.website || null,
    },
  });
});

// POST /api/v1/auth/resend-verification-email — public endpoint that
// re-issues a verification email for an unverified account. Returns the
// same 200 body regardless of whether the email exists / is already
// verified so the endpoint cannot be used for email enumeration.
const resendVerifySchema = z.object({ email: z.string().email() });
const resendVerifyRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `resend-verify:${(req.body?.email || req.ip || '').toLowerCase()}`,
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many verification email requests. Please try again later.',
  },
});
router.post(
  '/resend-verification-email',
  resendVerifyRateLimit,
  async (req: Request, res: Response) => {
    const { email } = resendVerifySchema.parse(req.body);
    const result = await authService.generateVerifyTokenForEmail(email);
    if (result && result.tenant) {
      try {
        const { sendVerificationEmail } = await import('../services/email.service');
        await sendVerificationEmail({
          to: result.user.email,
          name: result.user.name,
          verifyToken: result.token,
          orgName: result.tenant.name,
        });
      } catch (err: any) {
        const { logger } = await import('../utils/logger');
        logger.warn('Failed to resend verification email', {
          email: email.toLowerCase(),
          error: err?.message,
        });
      }
    }
    res.json({
      message: 'If an unverified account exists for that email, a verification link has been sent.',
    });
  },
);

// Rate limit the login endpoint to stop credential stuffing / brute force
// (finding-001, pentest 2026-06-11). Two layers stacked: a tight per-account
// limit (acts as account lockout — 10 failures / 15 min for a given email)
// and a per-IP limit as the primary anti-credential-stuffing control
// (10 attempts / minute from one source). Both return RFC-7807 429s with a
// Retry-After header. `skipSuccessfulRequests` means a legitimate login does
// not burn the budget, so normal users are unaffected.
const loginAccountRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // per account per window — account lockout threshold
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `login:account:${(req.body?.email || '').toLowerCase()}`,
  skip: (req: Request) => !req.body?.email,
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many failed login attempts for this account. Please try again later.',
  },
});

const loginIpRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // per IP per minute — blunts distributed credential stuffing
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `login:ip:${req.ip || 'unknown'}`,
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many login attempts from this address. Please try again later.',
  },
});

// MFA verify shares the same brute-force exposure (a 6-digit code is guessable
// without a limit). Per-IP limit only — the mfa_token already scopes attempts.
const mfaVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `mfa-verify:${(req.body?.mfa_token || req.ip || '').toString()}`,
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many verification attempts. Please try again later.',
  },
});

// POST /api/v1/auth/login — tenant is resolved locally so that an invalid
// slug returns the same generic 401 as invalid credentials (prevents slug
// enumeration — see F-04 in security assessment 2026-04-17).
router.post('/login', loginIpRateLimit, loginAccountRateLimit, async (req: Request, res: Response) => {
  const GENERIC_UNAUTHORIZED = {
    type: 'https://sreoncall.io/problems/unauthorized',
    title: 'Unauthorized',
    status: 401,
    detail: 'Invalid credentials.',
  };

  const tenant = await lookupTenantForRequest(req);
  if (!tenant) {
    res.status(401).json(GENERIC_UNAUTHORIZED);
    return;
  }
  req.tenant = tenant;
  req.tenantId = tenant._id;

  // Enforce domain-locked tenants: if tenant has custom_domains, login must come from that domain
  if (tenant?.custom_domains?.length > 0) {
    const forwarded = req.headers['x-forwarded-host'];
    const host = (typeof forwarded === 'string' ? forwarded : req.hostname || '').toLowerCase().replace(/:\d+$/, '');
    const isAllowedDomain = tenant.custom_domains.some((d: string) => d.toLowerCase() === host);
    if (!isAllowedDomain) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/domain-restricted',
        title: 'Domain Restricted',
        status: 403,
        detail: `This organization can only be accessed through its designated portal. Please use the correct URL to sign in.`,
      });
      return;
    }
  }

  const body = loginSchema.parse(req.body);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const result = await authService.login(req.tenantId, body.email, body.password, ip);

  // MFA challenge required
  if ('mfa_required' in result) {
    res.json({
      mfa_required: true,
      mfa_token: result.mfa_token,
    });
    return;
  }

  const { tokens, user } = result;
  res.json({
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.roles[0] || 'agent',
      roles: user.roles,
      tenant_id: req.tenantId.toString(),
      tenant_type: req.tenant?.type || 'standalone',
      force_password_change: user.force_password_change,
    },
  });
});

// GET /api/v1/auth/config - Returns tenant auth configuration (public, needs tenant)
router.get('/config', tenantMiddleware, async (req: Request, res: Response) => {
  const tenant = req.tenant;
  res.json({
    sso_enabled: tenant.auth_settings.sso_enabled,
    sso_provider: tenant.auth_settings.sso_provider,
    mfa_required: tenant.auth_settings.mfa_required,
    password_policy: {
      min_length: tenant.auth_settings.password_policy.min_length,
      require_uppercase: tenant.auth_settings.password_policy.require_uppercase,
      require_lowercase: tenant.auth_settings.password_policy.require_lowercase,
      require_numbers: tenant.auth_settings.password_policy.require_numbers,
      require_special: tenant.auth_settings.password_policy.require_special,
    },
  });
});

// GET /api/v1/auth/verify-email?token=xxx - Public
router.get('/verify-email', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({
      type: 'https://sreoncall.io/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Missing verification token.',
    });
    return;
  }

  // Verify email token from Redis
  const { getRedis } = await import('../config/redis');
  const redis = getRedis();
  const data = await redis.get(`email-verify:${token}`);
  if (!data) {
    res.status(400).json({
      type: 'https://sreoncall.io/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid or expired verification token.',
    });
    return;
  }

  const { user_id } = JSON.parse(data);
  const { User } = await import('../models/user.model');
  const user = await User.findById(user_id);
  if (!user) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'User not found.',
    });
    return;
  }

  user.email_verified = true;
  await user.save();
  await redis.del(`email-verify:${token}`);

  res.json({ message: 'Email verified successfully.' });
});

// Rate limit the password-reset endpoint to blunt email-flood abuse
// (SRE-002 in security assessment 2026-04-22). Two layers stacked: a
// tight per-email limit (so a single address can't be flooded even from
// many IPs) and a looser per-IP limit as a fallback (so one requester
// can't pivot across many emails).
const forgotPasswordEmailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // per email per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `forgot-pw:email:${(req.body?.email || '').toLowerCase()}`,
  skip: (req: Request) => !req.body?.email, // schema validator will reject below
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many password-reset requests for this email. Please try again later.',
  },
});

const forgotPasswordIpRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // per IP per hour — looser fallback
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `forgot-pw:ip:${req.ip || 'unknown'}`,
  message: {
    type: 'https://sreoncall.io/problems/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many password-reset requests from this address. Please try again later.',
  },
});

// POST /api/v1/auth/forgot-password
router.post(
  '/forgot-password',
  forgotPasswordEmailRateLimit,
  forgotPasswordIpRateLimit,
  tenantMiddleware,
  async (req: Request, res: Response) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    try {
      const user = await User.findOne({ tenant_id: req.tenantId, email: email.toLowerCase() });
      if (user) {
        const token = await authService.generatePasswordResetToken(email, req.tenantId);
        await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetToken: token,
          orgSlug: req.tenant?.slug || '',
        });
      }
    } catch {
      // Don't reveal whether email exists
    }

    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  },
);

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  const body = z
    .object({
      token: z.string().min(1),
      new_password: z.string().min(8).max(128).optional(),
      password: z.string().min(8).max(128).optional(),
    })
    .refine((d) => d.new_password || d.password, {
      message: 'password or new_password is required',
      path: ['password'],
    })
    .parse(req.body);

  await authService.resetPassword(body.token, (body.new_password || body.password)!);
  res.json({ message: 'Password has been reset successfully.' });
});

// --- SSO routes ---

// GET /api/v1/auth/sso/authorize - Initiate SSO login
router.get('/sso/authorize', tenantMiddleware, async (req: Request, res: Response) => {
  const callbackUrl = (req.query.callback_url as string) || `${process.env.APP_URL || ''}/api/auth/sso/callback`;
  const authorizeUrl = await ssoService.initiateSSO(req.tenant, callbackUrl);
  res.json({ authorize_url: authorizeUrl });
});

// POST /api/v1/auth/sso/callback - Handle SSO callback
router.post('/sso/callback', async (req: Request, res: Response) => {
  const { code, state, callback_url } = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
    callback_url: z.string().url(),
  }).parse(req.body);

  const result = await ssoService.handleSSOCallback(code, state, callback_url);

  res.json({
    access_token: result.access_token,
    token_type: result.token_type,
    expires_in: result.expires_in,
    user: {
      id: result.user._id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.roles[0] || 'agent',
      roles: result.user.roles,
      tenant_id: result.tenant._id.toString(),
    },
    tenant: {
      id: result.tenant._id,
      slug: result.tenant.slug,
      name: result.tenant.name,
    },
  });
});

// GET /api/v1/auth/sso/config - Get SSO configuration for tenant (public-safe subset)
router.get('/sso/config', tenantMiddleware, async (req: Request, res: Response) => {
  const config = ssoService.getSsoConfig(req.tenant);
  if (!config) {
    res.json({ sso_enabled: false });
    return;
  }

  res.json({
    sso_enabled: true,
    provider: config.provider,
    issuer_url: config.issuer_url,
    // Don't expose client_secret
  });
});

// --- MFA routes (public, needs tenant only) ---

const mfaVerifySchema = z.object({
  mfa_token: z.string().uuid(),
  code: z.string().min(6).max(10),
});

// POST /api/v1/auth/mfa/verify - Public (complete MFA challenge after login)
router.post('/mfa/verify', mfaVerifyRateLimit, tenantMiddleware, async (req: Request, res: Response) => {
  const body = mfaVerifySchema.parse(req.body);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const { tokens, user } = await authService.verifyMfaChallenge(body.mfa_token, body.code, ip);

  res.json({
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.roles[0] || 'agent',
      roles: user.roles,
      tenant_id: user.tenant_id.toString(),
      tenant_type: req.tenant?.type || 'standalone',
      force_password_change: user.force_password_change,
    },
  });
});

// --- Authenticated routes ---

// GET /api/v1/auth/me
router.get('/me', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const user = req.user;
  res.json({
    id: user._id,
    email: user.email,
    email_verified: user.email_verified,
    name: user.name,
    avatar_url: user.avatar_url,
    roles: user.roles,
    status: user.status,
    force_password_change: user.force_password_change,
    mfa_enabled: user.mfa.mfa_enabled,
    backup_codes_remaining: user.mfa.backup_codes?.length || 0,
    mfa_required_by_tenant: req.tenant.auth_settings?.mfa_required || false,
    phone_number: user.phone_number || null,
    timezone: user.timezone || 'UTC',
    notification_preferences: user.notification_preferences,
    last_login_at: user.last_login_at,
    tenant: {
      id: req.tenant._id,
      slug: req.tenant.slug,
      name: req.tenant.name,
      plan: req.tenant.plan,
      plan_limits: req.tenant.plan_limits,
      type: req.tenant.type || 'standalone',
    },
  });
});

// POST /api/v1/auth/logout
router.post('/logout', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const token = req.headers.authorization!.slice(7);
  const decoded = jwt.decode(token) as any;
  await authService.logout(req.userId.toString(), decoded.jti);
  res.json({ message: 'Logged out successfully.' });
});

// GET /api/v1/auth/sessions
router.get('/sessions', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const sessions = await authService.getUserSessions(req.userId.toString());
  res.json({ sessions });
});

// DELETE /api/v1/auth/sessions/:id
router.delete('/sessions/:id', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  await authService.revokeSession(req.userId.toString(), req.params.id as string);
  res.json({ message: 'Session revoked.' });
});

// POST /api/v1/auth/change-password
router.post('/change-password', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const body = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.userId, body.current_password, body.new_password);
  res.json({ message: 'Password changed successfully.' });
});

// --- Authenticated MFA management routes ---

// POST /api/v1/auth/mfa/setup - Initiate MFA setup (returns QR code)
router.post('/mfa/setup', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const result = await authService.setupMfa(req.userId);
  res.json(result);
});

// POST /api/v1/auth/mfa/enable - Verify TOTP code and enable MFA
router.post('/mfa/enable', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
  const result = await authService.verifyAndEnableMfa(req.userId, code);
  res.json(result);
});

// POST /api/v1/auth/mfa/disable - Disable MFA (requires password)
router.post('/mfa/disable', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
  await authService.disableMfa(req.userId, password);
  res.json({ message: 'MFA disabled successfully.' });
});

// POST /api/v1/auth/mfa/backup-codes - Regenerate backup codes (requires password)
router.post('/mfa/backup-codes', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
  const result = await authService.regenerateBackupCodes(req.userId, password);
  res.json(result);
});

// POST /api/v1/auth/impersonate - Admin impersonation
router.post('/impersonate', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const { user_id } = z.object({ user_id: z.string().min(1) }).parse(req.body);
  const result = await ssoService.impersonate(req.userId, user_id, req.tenantId);
  res.json(result);
});

// GET /api/v1/auth/sso/settings - Get full SSO configuration (admin only)
router.get('/sso/settings', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const isAdmin = req.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r));
  if (!isAdmin) {
    res.status(403).json({ detail: 'Only admins can view SSO settings.' });
    return;
  }

  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) {
    res.status(404).json({ detail: 'Tenant not found.' });
    return;
  }

  res.json({
    sso_enabled: tenant.auth_settings.sso_enabled,
    sso_provider: tenant.auth_settings.sso_provider,
    sso_config: tenant.auth_settings.sso_config ? {
      provider: (tenant.auth_settings.sso_config as any).provider,
      issuer_url: (tenant.auth_settings.sso_config as any).issuer_url,
      client_id: (tenant.auth_settings.sso_config as any).client_id,
      scopes: (tenant.auth_settings.sso_config as any).scopes,
      auto_create_users: (tenant.auth_settings.sso_config as any).auto_create_users,
      default_roles: (tenant.auth_settings.sso_config as any).default_roles,
    } : null,
  });
});

// PUT /api/v1/auth/sso/settings - Update SSO configuration (admin only)
router.put('/sso/settings', tenantMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const isAdmin = req.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r));
  if (!isAdmin) {
    res.status(403).json({ detail: 'Only admins can configure SSO.' });
    return;
  }

  const body = z.object({
    sso_enabled: z.boolean(),
    provider: z.enum(['oidc', 'keycloak', 'okta', 'azure_ad', 'google']).optional(),
    issuer_url: z.string().url().optional(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    auto_create_users: z.boolean().optional(),
    default_roles: z.array(z.string()).optional(),
  }).parse(req.body);

  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) {
    res.status(404).json({ detail: 'Tenant not found.' });
    return;
  }

  tenant.auth_settings.sso_enabled = body.sso_enabled;
  if (body.provider) tenant.auth_settings.sso_provider = body.provider;

  if (body.sso_enabled && body.issuer_url && body.client_id && body.client_secret) {
    tenant.auth_settings.sso_config = {
      provider: body.provider || 'oidc',
      issuer_url: body.issuer_url,
      client_id: body.client_id,
      client_secret: body.client_secret,
      scopes: body.scopes || ['openid', 'email', 'profile'],
      auto_create_users: body.auto_create_users ?? true,
      default_roles: body.default_roles || ['agent'],
    };
  }

  tenant.markModified('auth_settings');
  await tenant.save();

  // Invalidate Redis tenant cache so public endpoints reflect changes immediately
  try {
    const redis = getRedis();
    await redis.del(`tenant:slug:${tenant.slug}`);
  } catch { /* non-critical */ }

  res.json({
    sso_enabled: tenant.auth_settings.sso_enabled,
    sso_provider: tenant.auth_settings.sso_provider,
    sso_config: tenant.auth_settings.sso_config ? {
      provider: (tenant.auth_settings.sso_config as any).provider,
      issuer_url: (tenant.auth_settings.sso_config as any).issuer_url,
      client_id: (tenant.auth_settings.sso_config as any).client_id,
      scopes: (tenant.auth_settings.sso_config as any).scopes,
      auto_create_users: (tenant.auth_settings.sso_config as any).auto_create_users,
      default_roles: (tenant.auth_settings.sso_config as any).default_roles,
    } : null,
  });
});

export default router;
