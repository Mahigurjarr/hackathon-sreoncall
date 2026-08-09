import { Types } from 'mongoose';
import { Tenant, TenantDocument } from '../models/tenant.model';
import { User } from '../models/user.model';
import { Ticket } from '../models/ticket.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { normalizeUrl } from '../utils/url';

interface UpdateTenantInput {
  name?: string;
  branding?: {
    logo_url?: string;
    favicon_url?: string;
    primary_color?: string;
    accent_color?: string;
  };
  auth_settings?: Partial<{
    password_policy: Partial<{
      min_length: number;
      require_uppercase: boolean;
      require_lowercase: boolean;
      require_numbers: boolean;
      require_special: boolean;
      max_age_days: number;
      history_count: number;
    }>;
    session_policy: Partial<{
      max_sessions: number;
      session_timeout_minutes: number;
      idle_timeout_minutes: number;
    }>;
    mfa_required: boolean;
  }>;
  voice_call_settings?: Partial<{
    greeting: string;
  }>;
  custom_domains?: string[];
  website?: string | null;
}

export async function getTenantById(tenantId: Types.ObjectId): Promise<TenantDocument> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }
  return tenant;
}

export async function getTenantBySlug(slug: string): Promise<TenantDocument> {
  const tenant = await Tenant.findOne({ slug });
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }
  return tenant;
}

export async function updateTenant(
  tenantId: Types.ObjectId,
  input: UpdateTenantInput
): Promise<TenantDocument> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant');
  }

  if (input.name !== undefined) tenant.name = input.name;
  if (input.custom_domains !== undefined) tenant.custom_domains = input.custom_domains;

  if (input.website !== undefined) {
    if (!input.website) {
      tenant.website = undefined;
    } else {
      const normalized = normalizeUrl(input.website);
      if (!normalized) {
        throw AppError.badRequest('Invalid website URL.');
      }
      tenant.website = normalized;
    }
  }

  if (input.branding) {
    if (input.branding.logo_url !== undefined) tenant.branding.logo_url = input.branding.logo_url;
    if (input.branding.favicon_url !== undefined) tenant.branding.favicon_url = input.branding.favicon_url;
    if (input.branding.primary_color !== undefined) tenant.branding.primary_color = input.branding.primary_color;
    if (input.branding.accent_color !== undefined) tenant.branding.accent_color = input.branding.accent_color;
  }

  if (input.auth_settings) {
    if (input.auth_settings.password_policy) {
      Object.assign(tenant.auth_settings.password_policy, input.auth_settings.password_policy);
    }
    if (input.auth_settings.session_policy) {
      Object.assign(tenant.auth_settings.session_policy, input.auth_settings.session_policy);
    }
    if (input.auth_settings.mfa_required !== undefined) {
      tenant.auth_settings.mfa_required = input.auth_settings.mfa_required;
    }
  }

  if (input.voice_call_settings) {
    if (input.voice_call_settings.greeting !== undefined) {
      (tenant as any).voice_call_settings.greeting = input.voice_call_settings.greeting;
    }
    tenant.markModified('voice_call_settings');
  }

  tenant.markModified('branding');
  tenant.markModified('auth_settings');
  await tenant.save();

  // Invalidate Redis cache
  const { getRedis } = await import('../config/redis');
  const redis = getRedis();
  await redis.del(`tenant:slug:${tenant.slug}`).catch(() => {});

  return tenant;
}

export async function getTenantStats(tenantId: Types.ObjectId): Promise<{
  total_users: number;
  active_users: number;
  total_tickets: number;
  open_tickets: number;
  resolved_tickets: number;
}> {
  const [totalUsers, activeUsers, totalTickets, openTickets, resolvedTickets] = await Promise.all([
    User.countDocuments({ tenant_id: tenantId, status: { $ne: 'deleted' } }),
    User.countDocuments({ tenant_id: tenantId, status: 'active' }),
    Ticket.countDocuments({ tenant_id: tenantId }),
    Ticket.countDocuments({ tenant_id: tenantId, status: { $in: ['open', 'in_progress'] } }),
    Ticket.countDocuments({ tenant_id: tenantId, resolved_at: { $ne: null } }),
  ]);

  return {
    total_users: totalUsers,
    active_users: activeUsers,
    total_tickets: totalTickets,
    open_tickets: openTickets,
    resolved_tickets: resolvedTickets,
  };
}
