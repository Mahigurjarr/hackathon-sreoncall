import { NextRequest, NextResponse } from 'next/server';
import { partnerAuth } from '@/lib/partner-auth.config';

export async function GET(req: NextRequest) {
  const session = await partnerAuth();
  const partnerToken = session?.partnerToken;
  if (!partnerToken) {
    return NextResponse.redirect(new URL('/partner/login', req.url));
  }
  const rawCallback = req.nextUrl.searchParams.get('callbackUrl') || '/partner/dashboard';
  const callbackUrl = rawCallback.startsWith('/') && !rawCallback.startsWith('//') ? rawCallback : '/partner/dashboard';
  const res = NextResponse.redirect(new URL(callbackUrl, req.url));
  res.cookies.set('partner_token', partnerToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60,
    path: '/',
  });
  return res;
}
