import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { getConfig } from '../config/index';
import { getRedis } from '../config/redis';
import { Tenant, TenantDocument } from '../models/tenant.model';
import { User, UserDocument } from '../models/user.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { assertUrlSafe } from '../utils/ssrf-guard';

const SSO_STATE_PREFIX = 'sso:state:';
const SSO_STATE_TTL = 600; // 10 minutes

export interface SsoConfig {
  provider: 'oidc' | 'keycloak' | 'okta' | 'azure_ad' | 'google';
  issuer_url: string;
  client_id: string;
  client_secret: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  scopes?: string[];
  auto_create_users?: boolean;
  default_roles?: string[];
}

interface OidcTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface OidcUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  preferred_username?: string;
}

/**
 * Discover OIDC endpoints from issuer URL.
 */
async function discoverOidcEndpoints(issuerUrl: string): Promise<{
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}> {
  const wellKnown = issuerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
  // SSRF protection: block discovery from private/internal addresses
  await assertUrlSafe(wellKnown);
  const res = await fetch(wellKnown);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const endpoints = await res.json() as {
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    jwks_uri: string;
  };
  // Also validate the discovered endpoints
  await assertUrlSafe(endpoints.token_endpoint);
  await assertUrlSafe(endpoints.userinfo_endpoint);
  return endpoints;
}

/**
 * Get tenant's SSO configuration.
 */
export function getSsoConfig(tenant: TenantDocument): SsoConfig | null {
  if (!tenant.auth_settings.sso_enabled || !tenant.auth_settings.sso_config) {
    return null;
  }
  return tenant.auth_settings.sso_config as SsoConfig;
}

/**
 * Generate SSO authorization URL and store state in Redis.
 */
export async function initiateSSO(tenant: TenantDocument, callbackUrl: string): Promise<string> {
  const ssoConfig = getSsoConfig(tenant);
  if (!ssoConfig) throw AppError.badRequest('SSO is not configured for this tenant.');

  const endpoints = ssoConfig.authorization_endpoint
    ? { authorization_endpoint: ssoConfig.authorization_endpoint }
    : await discoverOidcEndpoints(ssoConfig.issuer_url);

  const state = uuidv4();
  const redis = getRedis();
  await redis.setex(
    `${SSO_STATE_PREFIX}${state}`,
    SSO_STATE_TTL,
    JSON.stringify({
      tenant_id: tenant._id.toString(),
      tenant_slug: tenant.slug,
      callback_url: callbackUrl,
    }),
  );

  const scopes = ssoConfig.scopes?.join(' ') || 'openid email profile';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ssoConfig.client_id,
    redirect_uri: callbackUrl,
    scope: scopes,
    state,
  });

  return `${endpoints.authorization_endpoint}?${params}`;
}

/**
 * Handle SSO callback — exchange code for tokens, find/create user, return JWT.
 */
export async function handleSSOCallback(
  code: string,
  state: string,
  callbackUrl: string,
): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserDocument;
  tenant: TenantDocument;
}> {
  // Validate state
  const redis = getRedis();
  const stateData = await redis.get(`${SSO_STATE_PREFIX}${state}`);
  if (!stateData) throw AppError.badRequest('Invalid or expired SSO state.');
  await redis.del(`${SSO_STATE_PREFIX}${state}`);

  const { tenant_id } = JSON.parse(stateData);
  const tenant = await Tenant.findById(tenant_id);
  if (!tenant) throw AppError.notFound('Tenant');

  const ssoConfig = getSsoConfig(tenant);
  if (!ssoConfig) throw AppError.badRequest('SSO is not configured.');

  // Discover endpoints if not explicitly set
  const discovery = await discoverOidcEndpoints(ssoConfig.issuer_url);
  const tokenEndpoint = ssoConfig.token_endpoint || discovery.token_endpoint;
  const userinfoEndpoint = ssoConfig.userinfo_endpoint || discovery.userinfo_endpoint;

  // Exchange code for tokens
  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: ssoConfig.client_id,
      client_secret: ssoConfig.client_secret,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    logger.error('SSO token exchange failed', { status: tokenRes.status, body });
    throw AppError.unauthorized('SSO authentication failed.');
  }

  const tokens = await tokenRes.json() as OidcTokenResponse;

  // Get user info
  const userInfoRes = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    throw AppError.unauthorized('Failed to retrieve user information from IdP.');
  }

  const userInfo = await userInfoRes.json() as OidcUserInfo;

  if (!userInfo.email) {
    throw AppError.badRequest('IdP did not return an email address.');
  }

  // Find or create user
  let user = await User.findOne({
    tenant_id: tenant._id,
    email: userInfo.email.toLowerCase(),
  });

  if (user) {
    // Link existing user if source is local
    if (user.source === 'local') {
      user.source = 'sso';
    }
    user.last_login_at = new Date();
    if (userInfo.name && !user.name) user.name = userInfo.name;
    if (userInfo.picture && !user.avatar_url) user.avatar_url = userInfo.picture;
    await user.save();
  } else if (ssoConfig.auto_create_users !== false) {
    // Auto-create user
    const name = userInfo.name
      || [userInfo.given_name, userInfo.family_name].filter(Boolean).join(' ')
      || userInfo.preferred_username
      || userInfo.email.split('@')[0];

    user = await User.create({
      tenant_id: tenant._id,
      email: userInfo.email.toLowerCase(),
      email_verified: userInfo.email_verified ?? true,
      name,
      avatar_url: userInfo.picture,
      roles: ssoConfig.default_roles || ['agent'],
      status: 'active',
      source: 'sso',
      last_login_at: new Date(),
    });

    logger.info('SSO auto-created user', { email: userInfo.email, tenantId: tenant._id.toString() });
  } else {
    throw AppError.unauthorized('No account found. Contact your administrator.');
  }

  if (user.status !== 'active') {
    throw AppError.unauthorized('Account is not active.');
  }

  // Generate JWT (same format as local login)
  const config = getConfig();
  const jti = uuidv4();
  const payload = {
    sub: user._id.toString(),
    tenant_id: tenant._id.toString(),
    email: user.email,
    roles: user.roles,
    jti,
    sso: true,
  };

  const access_token = jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });

  // Store session in Redis
  const sessionKey = `session:${user._id}:${jti}`;
  await redis.setex(sessionKey, 8 * 60 * 60, JSON.stringify({
    jti,
    user_id: user._id.toString(),
    tenant_id: tenant._id.toString(),
    created_at: new Date().toISOString(),
    sso: true,
  }));

  return {
    access_token,
    token_type: 'Bearer',
    expires_in: 8 * 60 * 60,
    user,
    tenant,
  };
}

/**
 * Generate an impersonation token for admin use.
 */
export async function impersonate(
  adminUserId: Types.ObjectId,
  targetUserId: string,
  tenantId: Types.ObjectId,
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const admin = await User.findById(adminUserId);
  if (!admin || !admin.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r))) {
    throw AppError.forbidden('Only admins can impersonate users.');
  }

  const target = await User.findOne({ _id: targetUserId, tenant_id: tenantId });
  if (!target) throw AppError.notFound('User');
  if (target.status !== 'active') throw AppError.badRequest('Cannot impersonate inactive user.');

  const config = getConfig();
  const jti = uuidv4();
  const payload = {
    sub: target._id.toString(),
    tenant_id: tenantId.toString(),
    email: target.email,
    roles: target.roles,
    jti,
    impersonated_by: adminUserId.toString(),
  };

  const access_token = jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

  // Store session
  const redis = getRedis();
  await redis.setex(`session:${target._id}:${jti}`, 3600, JSON.stringify({
    jti,
    user_id: target._id.toString(),
    tenant_id: tenantId.toString(),
    created_at: new Date().toISOString(),
    impersonated_by: adminUserId.toString(),
  }));

  logger.info('Admin impersonation', {
    admin_id: adminUserId.toString(),
    target_id: targetUserId,
    tenant_id: tenantId.toString(),
  });

  return { access_token, token_type: 'Bearer', expires_in: 3600 };
}
