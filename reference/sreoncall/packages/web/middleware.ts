import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Hosts that serve the marketing site. Everything else is a tenant domain.
const PLATFORM_DOMAINS = ['web.sreoncall.com', 'dev-web.sreoncall.com', 'sreoncall.com', 'localhost'];

function isTenantHost(req: NextRequest): boolean {
  const raw = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const host = raw.toLowerCase().replace(/:\d+$/, '');
  if (PLATFORM_DOMAINS.includes(host)) return false;
  for (const base of PLATFORM_DOMAINS) {
    if (host.endsWith('.' + base)) return true;
  }
  // Custom domains (e.g. monitoring.thepackengers.com) — anything not in PLATFORM_DOMAINS
  return true;
}

function buildRedirectUrl(req: NextRequest, pathname: string): URL {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  // Build URL from scratch to avoid inheriting the internal port (e.g. :3000)
  const url = new URL(`${proto}://${host}${pathname}`);
  url.search = '';
  return url;
}

function withPathnameHeader(req: NextRequest, res: NextResponse): NextResponse {
  // Expose the current pathname to server components/layouts, which otherwise
  // cannot read it from Next.js 15's server context.
  res.headers.set('x-pathname', req.nextUrl.pathname);
  return res;
}

/**
 * Per-request nonce-based Content-Security-Policy. Replaces the previous
 * report-only + unsafe-inline/unsafe-eval policy (F-03 in security
 * assessment 2026-04-21). Next.js 15 automatically propagates `x-nonce`
 * from the request headers into the inline hydration scripts it emits.
 *
 * We keep `'unsafe-inline'` on `style-src` because React's `style={{…}}`
 * prop emits per-element inline styles that cannot be nonced. Style-src
 * unsafe-inline has no practical XSS lift compared to script-src, which
 * is now strictly nonce-gated.
 *
 * Development builds keep `'unsafe-eval'` in script-src because Next.js /
 * React Refresh / HMR rely on eval for hot module replacement. Production
 * builds get the strict policy.
 */
const IS_DEV = process.env.NODE_ENV !== 'production';

function buildCsp(nonce: string): string {
  const scriptSrc = IS_DEV
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https:`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`;
  // Split style-src into -elem and -attr (SRE-007 in security assessment
  // 2026-04-22). <style> blocks now require a nonce — blocks CSS injection
  // via `<style>` payloads. `style="…"` attributes still need unsafe-inline
  // because React renders per-element `style={{…}}` props that cannot
  // carry a nonce; attribute-level CSS injection has a much narrower
  // threat model than stylesheet-level injection.
  const styleSrcElem = `style-src-elem 'self' 'nonce-${nonce}'`;
  const styleSrcAttr = `style-src-attr 'unsafe-inline'`;
  // Fallback `style-src` kept for older browsers that don't yet honour
  // -elem / -attr splitting. In those browsers, 'unsafe-inline' is
  // ignored once a nonce is present on style-src — so we include the
  // nonce here too.
  const styleSrc = `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`;
  return [
    `default-src 'self'`,
    scriptSrc,
    styleSrc,
    styleSrcElem,
    styleSrcAttr,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https: wss:${IS_DEV ? ` ws:` : ''}`,
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

function generateNonce(): string {
  // Edge runtime has Web Crypto. Use it instead of Node's Buffer which
  // isn't always available under the edge runtime.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function applySecurityHeaders(res: NextResponse, nonce: string): NextResponse {
  res.headers.set('Content-Security-Policy', buildCsp(nonce));
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = generateNonce();

  // Forward pathname and nonce to downstream handlers via request headers so
  // server layouts (e.g. (partner)/layout.tsx) can gate by route and Next
  // can pick up the nonce for auto-injected scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-nonce', nonce);
  const passthrough = () =>
    applySecurityHeaders(
      withPathnameHeader(req, NextResponse.next({ request: { headers: requestHeaders } })),
      nonce,
    );

  // ─── Partner portal paths ────────────────────────────────────────────────────
  // Partner portal has its own separate authentication (partner_token cookie)
  // and must be handled before the main app auth logic
  if (pathname.startsWith('/partner/')) {
    const isPublicPartnerPath =
      pathname.startsWith('/partner/login') ||
      pathname.startsWith('/partner/register') ||
      pathname.startsWith('/partner/forgot-password') ||
      pathname.startsWith('/partner/reset-password');

    if (isPublicPartnerPath) {
      return passthrough();
    }

    // Protected partner path — check for partner_token cookie
    const partnerToken = req.cookies.get('partner_token')?.value;
    if (!partnerToken) {
      const loginUrl = buildRedirectUrl(req, '/partner/login');
      return applySecurityHeaders(
        withPathnameHeader(req, NextResponse.redirect(loginUrl)),
        nonce,
      );
    }

    return passthrough();
  }

  // ─── Custom domain redirect ──────────────────────────────────────────────────
  // If a tenant is accessed via slug.sreoncall.com but has a custom domain configured,
  // redirect all traffic to the custom domain. This prevents accessing a tenant
  // through the wrong URL (e.g., thepackengers.sreoncall.com when monitoring.thepackengers.com exists).
  const raw = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const hostLower = raw.toLowerCase().replace(/:\d+$/, '');
  const SREONCALL_BASES = ['sreoncall.com', 'dev-web.sreoncall.com', 'web.sreoncall.com'];
  const isSubdomainAccess = SREONCALL_BASES.some((base) => hostLower.endsWith('.' + base)) && !PLATFORM_DOMAINS.includes(hostLower);

  if (isSubdomainAccess) {
    // Extract slug from subdomain
    let tenantSlug = '';
    for (const base of SREONCALL_BASES) {
      if (hostLower.endsWith('.' + base)) {
        tenantSlug = hostLower.slice(0, -(base.length + 1)).split('.')[0];
        break;
      }
    }

    if (tenantSlug) {
      try {
        const apiUrl = process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000';
        const brandingRes = await fetch(`${apiUrl}/api/v1/public/tenant-branding?slug=${tenantSlug}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (brandingRes.ok) {
          const data = await brandingRes.json();
          // If tenant has a custom domain, redirect there
          if (data.custom_domain) {
            const proto = req.headers.get('x-forwarded-proto') || 'https';
            const redirectUrl = new URL(`${proto}://${data.custom_domain}${pathname}`);
            redirectUrl.search = req.nextUrl.search;
            return applySecurityHeaders(NextResponse.redirect(redirectUrl, 301), nonce);
          }
        }
      } catch {
        // Non-fatal — continue with normal flow if API is unreachable
      }
    }
  }

  // Check for NextAuth session token cookie
  const sessionToken =
    req.cookies.get('__Secure-authjs.session-token')?.value ||
    req.cookies.get('authjs.session-token')?.value ||
    req.cookies.get('next-auth.session-token')?.value;

  const isAuthenticated = !!sessionToken;

  // Public paths that don't require auth
  const publicPaths = [
    '/signin', '/signup', '/verify-email', '/accept-invite', '/forgot-password', '/reset-password',
    '/onboarding',
    '/privacy', '/terms',
    // Marketing pages — must be accessible without a session
    '/pricing', '/contact', '/about', '/partners', '/blog', '/careers', '/changelog',
  ];
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p)) || pathname.startsWith('/status/');

  // Admin paths (/admin/*) are protected by the admin layout's server-side auth check
  const isAdminPath = pathname.startsWith('/admin');

  // Root path handling
  if (pathname === '/') {
    if (isAuthenticated) {
      const url = buildRedirectUrl(req, '/dashboard');
      return applySecurityHeaders(NextResponse.redirect(url), nonce);
    }
    // Tenant domains (e.g. acum.sreoncall.com) should land on their branded signin,
    // not the SREonCall marketing site.
    if (isTenantHost(req)) {
      const url = buildRedirectUrl(req, '/signin');
      return applySecurityHeaders(NextResponse.redirect(url), nonce);
    }
    return passthrough();
  }

  // Redirect unauthenticated users to signin
  if (!isAuthenticated && !isPublicPath) {
    const url = buildRedirectUrl(req, '/signin');
    const fullPath = req.nextUrl.search
      ? `${pathname}${req.nextUrl.search}`
      : pathname;
    url.searchParams.set('callbackUrl', fullPath);
    return applySecurityHeaders(NextResponse.redirect(url), nonce);
  }

  // Redirect authenticated users away from auth pages (except accept-invite — allow either way)
  if (isAuthenticated && isPublicPath && !pathname.startsWith('/accept-invite') && !pathname.startsWith('/status/')) {
    const url = buildRedirectUrl(req, '/dashboard');
    return applySecurityHeaders(NextResponse.redirect(url), nonce);
  }

  return passthrough();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|partner-resources/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf)$).*)',
  ],
};
