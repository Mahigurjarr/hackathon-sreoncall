import { NextRequest, NextResponse } from 'next/server';

/**
 * Build a URL using the public-facing host (x-forwarded-host/x-forwarded-proto)
 * rather than the internal bind address (which may be 0.0.0.0:3000 behind a
 * reverse proxy). Prevents leaking internal addresses in redirects.
 */
function publicUrl(request: NextRequest, pathname: string): URL {
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '') ||
    'https';
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host;
  return new URL(`${proto}://${host}${pathname}`);
}

/**
 * GET /api/auth/sso/callback?code=...&state=...
 * Receives the OIDC callback from the IdP, exchanges code via API, then
 * creates a NextAuth session using the returned JWT.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(publicUrl(request, '/signin?error=missing_params'));
  }

  const callbackUrl = publicUrl(request, '/api/auth/sso/callback').toString();

  try {
    // Exchange code for tokens via our API
    const apiUrl = process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000';
    const res = await fetch(`${apiUrl}/api/v1/auth/sso/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state, callback_url: callbackUrl }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const errorMsg = encodeURIComponent(body.detail || 'SSO authentication failed');
      return NextResponse.redirect(publicUrl(request, `/signin?error=${errorMsg}`));
    }

    const data = await res.json();

    const redirectUrl = publicUrl(request, '/signin');
    redirectUrl.searchParams.set('sso_token', data.access_token);
    redirectUrl.searchParams.set('sso_email', data.user.email);
    redirectUrl.searchParams.set('org_slug', data.tenant.slug);
    redirectUrl.searchParams.set('sso_user_name', data.user.name);

    return NextResponse.redirect(redirectUrl);
  } catch {
    return NextResponse.redirect(publicUrl(request, '/signin?error=sso_failed'));
  }
}
