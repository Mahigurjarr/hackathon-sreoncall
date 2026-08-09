import { getRedis } from '../config/redis';
import { Tenant } from '../models/tenant.model';

/**
 * First-party platform origins. These are the ONLY sreoncall.com hostnames
 * trusted by CORS. Customer tenant subdomains (e.g. `acme.sreoncall.com`)
 * are NOT trusted because any user can self-register a tenant — trusting
 * them would give attacker-controlled origins credentialed cross-origin
 * access to the main API (F-02 in security assessment 2026-04-21).
 *
 * Verified tenant custom domains (which require DNS+TLS control to set up
 * and are approved by a tenant_admin) are still allowed via DB lookup.
 */
const STATIC_ALLOWED_HOSTS = new Set<string>([
  'sreoncall.com',
  'web.sreoncall.com',
  'dev-web.sreoncall.com',
  'app.sreoncall.com',
  'localhost',
  '127.0.0.1',
]);

const CACHE_TTL_SECONDS = 300;

function parseHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function isOriginAllowed(origin: string | undefined | null): Promise<boolean> {
  if (!origin) return false;

  // The literal string "null" is sent by sandboxed iframes and file:// origins.
  // It MUST NOT be paired with credentials — reject.
  if (origin === 'null') return false;

  const hostname = parseHostname(origin);
  if (!hostname) return false;

  if (STATIC_ALLOWED_HOSTS.has(hostname)) return true;

  // Deliberately NO `hostname.endsWith('.sreoncall.com')` fast-path — tenant
  // subdomains are untrusted third-party origins. They can still be allowed
  // via the Tenant.custom_domains lookup below if explicitly configured.

  // Verified tenant custom domain: check Redis then DB
  try {
    const redis = getRedis();
    const cached = await redis.get(`cors:origin:${hostname}`);
    if (cached === '1') return true;
    if (cached === '0') return false;
  } catch {
    // Redis unavailable — fall through to DB
  }

  try {
    const tenant = await Tenant.findOne({
      custom_domains: hostname,
      status: { $ne: 'deleted' },
    })
      .select('_id')
      .lean();
    const allowed = !!tenant;
    try {
      const redis = getRedis();
      await redis.setex(`cors:origin:${hostname}`, CACHE_TTL_SECONDS, allowed ? '1' : '0');
    } catch {
      // cache best-effort
    }
    return allowed;
  } catch {
    return false;
  }
}
