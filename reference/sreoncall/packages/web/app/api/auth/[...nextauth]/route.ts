import { handlers } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const nextAuthGet = handlers.GET;
export const POST = handlers.POST;

/**
 * Thin wrapper over NextAuth's GET handler that strips internal backend
 * URLs from `/api/auth/providers` responses. NextAuth bakes the value of
 * `AUTH_URL` / `NEXTAUTH_URL` into `signinUrl` + `callbackUrl` fields,
 * which on prod pointed at `web.sreoncall.com` — the Express backend
 * subdomain a pentester used to fingerprint the infrastructure (SRE-003
 * in security assessment 2026-04-22).
 *
 * The provider list is only consumed client-side to render "Sign in with
 * X" buttons; the actual sign-in POST hits `/api/auth/callback/...`
 * same-origin, so removing the explicit URLs breaks nothing downstream.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const res = await nextAuthGet(req);
  if (!req.nextUrl.pathname.endsWith('/api/auth/providers')) {
    return res;
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return res;

  try {
    const body = await res.clone().json();
    if (body && typeof body === 'object') {
      for (const key of Object.keys(body)) {
        const provider = body[key];
        if (provider && typeof provider === 'object') {
          delete provider.signinUrl;
          delete provider.callbackUrl;
        }
      }
    }
    const headers = new Headers(res.headers);
    // Preserve all upstream headers but recompute content-length
    headers.delete('content-length');
    return NextResponse.json(body, { status: res.status, headers });
  } catch {
    return res;
  }
}
