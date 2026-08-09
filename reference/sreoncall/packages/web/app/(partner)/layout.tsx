import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PartnerShell } from '@/components/partner/PartnerShell';
import type { PartnerData } from '@/lib/types/partner';

// Routes inside (partner) that are always public (no auth gate).
const PUBLIC_PARTNER_ROUTES = ['/partner/login', '/partner/register', '/partner/forgot-password', '/partner/reset-password', '/partner/team/accept'];

function getPathname(): string {
  // Next.js doesn't expose the current pathname directly to a server layout,
  // but sets x-invoke-path / x-pathname on the forwarded request headers.
  // Fall back to '' so auth-only behavior is applied when we can't tell.
  return '';
}

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const [cookieStore, hdrs] = await Promise.all([cookies(), headers()]);
  const partnerToken = cookieStore.get('partner_token')?.value;
  const pathname =
    hdrs.get('x-invoke-path') ||
    hdrs.get('x-pathname') ||
    hdrs.get('next-url') ||
    getPathname();

  const isPublicRoute = PUBLIC_PARTNER_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/')
  );

  if (!partnerToken) {
    // Unauthenticated: only allow public pages; everything else bounces to login.
    if (!isPublicRoute) redirect('/partner/login');
    return <>{children}</>;
  }

  const apiBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000';
  let partnerData: PartnerData | null = null;
  try {
    const res = await fetch(`${apiBase}/api/v1/partner-auth/me`, {
      headers: { Cookie: `partner_token=${partnerToken}` },
      cache: 'no-store',
    });
    if (res.ok) partnerData = (await res.json()) as PartnerData;
  } catch (error) {
    console.error('Partner session fetch failed:', error);
  }

  if (!partnerData) {
    if (!isPublicRoute) redirect('/partner/login');
    return <>{children}</>;
  }

  // Onboarding gate: un-onboarded partners can only access /partner/onboarding.
  const onboardingCompleted = partnerData.partner.onboardingCompleted;
  const onOnboarding = pathname.startsWith('/partner/onboarding');
  if (!onboardingCompleted && !onOnboarding && !isPublicRoute) {
    redirect('/partner/onboarding');
  }
  // Conversely, fully-onboarded partners shouldn't sit on the onboarding page.
  if (onboardingCompleted && onOnboarding) {
    redirect('/partner/dashboard');
  }

  return <PartnerShell partnerData={partnerData}>{children}</PartnerShell>;
}
