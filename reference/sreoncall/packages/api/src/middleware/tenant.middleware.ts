import { Request, Response, NextFunction } from 'express';
import { trace } from '@opentelemetry/api';
import { getRedis } from '../config/redis';
import { Tenant } from '../models/tenant.model';
import { logger } from '../utils/logger';

const TENANT_CACHE_TTL = 60; // seconds

function isIPAddress(host: string): boolean {
  // IPv4 or IPv6 (including [::1] bracket notation)
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

// Known app base domains (without tenant subdomain prefix)
const BASE_DOMAINS = [
  'dev-web.sreoncall.com',
  'web.sreoncall.com',
  'sreoncall.com',
  'sreoncall.io',
  'localhost',
];

function extractSlug(req: Request): string | null {
  // For dev: check X-Tenant-Slug header first (highest priority fallback)
  const slugHeader = req.headers['x-tenant-slug'];
  if (typeof slugHeader === 'string' && slugHeader) {
    return slugHeader;
  }

  const forwarded = req.headers['x-forwarded-host'];
  const host = typeof forwarded === 'string' ? forwarded : req.hostname;

  if (!host || isIPAddress(host)) return null;

  // Check if host is a known base domain (no tenant prefix) → default to platform
  const hostLower = host.toLowerCase().replace(/:\d+$/, ''); // strip port
  if (BASE_DOMAINS.includes(hostLower)) {
    return 'platform';
  }

  // Check if host is a subdomain of a known base domain
  // e.g., acme.dev-web.sreoncall.com → acme
  for (const base of BASE_DOMAINS) {
    if (hostLower.endsWith('.' + base)) {
      const prefix = hostLower.slice(0, -(base.length + 1));
      // prefix could be "acme" or "acme.dept" — take leftmost segment
      const slug = prefix.split('.')[0];
      if (slug) return slug;
    }
  }

  // Generic fallback: extract first subdomain if 3+ parts
  const parts = host.split('.');
  if (parts.length >= 3) {
    return parts[0];
  }

  return null;
}

function getFullHost(req: Request): string {
  const forwarded = req.headers['x-forwarded-host'];
  const host = typeof forwarded === 'string' ? forwarded : req.hostname;
  return (host || '').toLowerCase().replace(/:\d+$/, '');
}

/**
 * Silent tenant lookup — returns the tenant document or null without sending
 * any HTTP response. Use this in contexts (like login) where the caller needs
 * to return a uniform response regardless of whether the slug exists, to
 * prevent tenant-slug enumeration (F-04 in security assessment 2026-04-17).
 */
export async function lookupTenantForRequest(req: Request): Promise<any | null> {
  const slug = extractSlug(req);
  const fullHost = getFullHost(req);
  if (!slug) return null;

  const redis = getRedis();
  const domainCacheKey = `tenant:domain:${fullHost}`;
  const cacheKey = `tenant:slug:${slug}`;

  try {
    const cached = (await redis.get(domainCacheKey)) || (await redis.get(cacheKey));
    if (cached) {
      const tenantData = JSON.parse(cached);
      return Tenant.hydrate(tenantData);
    }
  } catch (err: any) {
    logger.warn('Redis cache miss for tenant lookup', { slug, error: err.message });
  }

  let tenant = await Tenant.findOne({ slug, status: { $ne: 'deleted' } });
  if (!tenant && fullHost) {
    tenant = await Tenant.findOne({ custom_domains: fullHost, status: { $ne: 'deleted' } });
  }
  if (!tenant || tenant.status === 'suspended') return null;

  try {
    const tenantJson = JSON.stringify(tenant.toObject());
    await redis.setex(`tenant:slug:${tenant.slug}`, TENANT_CACHE_TTL, tenantJson);
    if (fullHost && tenant.custom_domains?.includes(fullHost)) {
      await redis.setex(domainCacheKey, TENANT_CACHE_TTL, tenantJson);
    }
  } catch (err: any) {
    logger.warn('Failed to cache tenant in Redis', { slug: tenant.slug, error: err.message });
  }

  return tenant;
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const slug = extractSlug(req);
  const fullHost = getFullHost(req);

  if (!slug) {
    res.status(400).json({
      type: 'https://sreoncall.io/problems/missing-tenant',
      title: 'Missing Tenant',
      status: 400,
      detail: 'Could not resolve tenant from request hostname.',
    });
    return;
  }

  const redis = getRedis();
  // Try custom domain cache first, then slug cache
  const domainCacheKey = `tenant:domain:${fullHost}`;
  const cacheKey = `tenant:slug:${slug}`;

  try {
    // Check Redis cache — custom domain first, then slug
    const cached = await redis.get(domainCacheKey) || await redis.get(cacheKey);
    if (cached) {
      const tenantData = JSON.parse(cached);
      const tenant = await Tenant.hydrate(tenantData);
      req.tenant = tenant;
      req.tenantId = tenant._id;
      trace.getActiveSpan()?.setAttribute('tenant.id', String(tenant._id));
      next();
      return;
    }
  } catch (err: any) {
    logger.warn('Redis cache miss for tenant lookup', { slug, error: err.message });
  }

  // Fetch from database — try slug first, then custom_domains
  let tenant = await Tenant.findOne({ slug, status: { $ne: 'deleted' } });

  if (!tenant && fullHost) {
    tenant = await Tenant.findOne({ custom_domains: fullHost, status: { $ne: 'deleted' } });
  }

  if (!tenant) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/tenant-not-found',
      title: 'Tenant Not Found',
      status: 404,
      detail: `No tenant found for slug "${slug}".`,
    });
    return;
  }

  if (tenant.status === 'suspended') {
    res.status(403).json({
      type: 'https://sreoncall.io/problems/tenant-suspended',
      title: 'Tenant Suspended',
      status: 403,
      detail: 'This tenant account has been suspended.',
    });
    return;
  }

  // Cache in Redis — by slug and by custom domain
  try {
    const tenantJson = JSON.stringify(tenant.toObject());
    await redis.setex(`tenant:slug:${tenant.slug}`, TENANT_CACHE_TTL, tenantJson);
    if (fullHost && tenant.custom_domains?.includes(fullHost)) {
      await redis.setex(domainCacheKey, TENANT_CACHE_TTL, tenantJson);
    }
  } catch (err: any) {
    logger.warn('Failed to cache tenant in Redis', { slug: tenant.slug, error: err.message });
  }

  req.tenant = tenant;
  req.tenantId = tenant._id;
  trace.getActiveSpan()?.setAttribute('tenant.id', String(tenant._id));
  next();
}
