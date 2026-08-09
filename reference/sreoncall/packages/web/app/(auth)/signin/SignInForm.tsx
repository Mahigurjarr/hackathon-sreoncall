'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { AlertCircle, Loader2, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';

const BASE_DOMAINS = ['dev-web.sreoncall.com', 'web.sreoncall.com', 'sreoncall.com', 'localhost'];

function extractTenantSlugFromHost(): { slug: string; isCustomDomain: boolean } {
  if (typeof window === 'undefined') return { slug: '', isCustomDomain: false };
  const h = window.location.hostname.toLowerCase();
  if (BASE_DOMAINS.includes(h)) return { slug: '', isCustomDomain: false };
  for (const base of BASE_DOMAINS) {
    if (h.endsWith('.' + base)) {
      return { slug: h.slice(0, -(base.length + 1)).split('.')[0] || '', isCustomDomain: false };
    }
  }
  // Custom domain — don't extract slug, let user type it (or load from localStorage)
  return { slug: '', isCustomDomain: true };
}

function getSavedOrgSlug(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem('sreoncall_org_slug') || ''; } catch { return ''; }
}

function saveOrgSlug(slug: string) {
  try { localStorage.setItem('sreoncall_org_slug', slug); } catch {}
}

const signInSchema = z.object({
  org_slug: z.string().min(1, 'Organization slug is required'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type SignInFormData = z.infer<typeof signInSchema>;

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  // MFA state
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const mfaInputRef = useRef<HTMLInputElement>(null);

  // Store credentials for MFA flow
  const [pendingOrgSlug, setPendingOrgSlug] = useState('');

  // Auto-detect org from tenant subdomain (e.g., acum.sreoncall.com → "acum")
  // For custom domains, don't auto-fill — let user type or load from localStorage
  const { slug: tenantSlugFromHost, isCustomDomain } = extractTenantSlugFromHost();
  const savedSlug = getSavedOrgSlug();
  const orgFromUrl = searchParams.get('org_slug') || tenantSlugFromHost || (isCustomDomain ? savedSlug : '') || '';
  const rawCallbackUrl = searchParams.get('callbackUrl') || '';
  // Only allow safe relative paths to prevent open-redirect attacks
  const postLoginUrl =
    rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')
      ? rawCallbackUrl
      : '/dashboard';
  // Only lock the field for known sreoncall.com subdomains, not custom domains.
  // Unlock on login error so the user can correct the slug.
  const [orgUnlocked, setOrgUnlocked] = useState(false);
  const isOrgLocked = !!tenantSlugFromHost && !isCustomDomain && !orgUnlocked;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormData>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      org_slug: orgFromUrl,
      email: searchParams.get('email') || '',
      password: '',
    },
  });

  const orgSlug = watch('org_slug');

  // Focus MFA input when step changes
  useEffect(() => {
    if (mfaStep) {
      setTimeout(() => mfaInputRef.current?.focus(), 100);
    }
  }, [mfaStep]);

  // Handle SSO callback — auto-login with SSO token
  useEffect(() => {
    const ssoToken = searchParams.get('sso_token');
    const ssoEmail = searchParams.get('sso_email');
    const ssoOrgSlug = searchParams.get('org_slug');
    const ssoError = searchParams.get('error');

    if (ssoError) {
      setError(decodeURIComponent(ssoError));
      return;
    }

    if (ssoToken && ssoEmail && ssoOrgSlug) {
      signIn('credentials', {
        org_slug: ssoOrgSlug,
        email: ssoEmail,
        password: `__sso_token__:${ssoToken}`,
        redirect: false,
      }).then((result) => {
        if (result?.error) {
          setError('SSO login failed. Please try again.');
        } else {
          router.push(postLoginUrl);
          router.refresh();
        }
      });
    }
  }, [searchParams, router]);

  async function onSubmit(data: SignInFormData) {
    setError(null);

    try {
      // Call login API directly to detect MFA requirement
      const loginRes = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Slug': data.org_slug,
        },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });

      if (!loginRes.ok) {
        const err = await loginRes.json().catch(() => ({}));
        const detail = err.detail || 'Invalid email or password. Please try again.';
        setError(detail);
        // Unlock the org field if the tenant slug is invalid so the user can correct it
        if (loginRes.status === 404 || /tenant|slug|organization/i.test(detail)) {
          setOrgUnlocked(true);
        }
        return;
      }

      const loginData = await loginRes.json();

      // MFA required — switch to MFA step
      if (loginData.mfa_required && loginData.mfa_token) {
        setMfaToken(loginData.mfa_token);
        setPendingOrgSlug(data.org_slug);
        setMfaStep(true);
        setMfaCode('');
        setMfaError(null);
        return;
      }

      // No MFA — complete NextAuth sign-in with the token we already have
      if (loginData.access_token) {
        const result = await signIn('credentials', {
          org_slug: data.org_slug,
          email: data.email,
          password: `__sso_token__:${loginData.access_token}`,
          redirect: false,
        });

        if (result?.error) {
          setError('Sign in failed. Please try again.');
          return;
        }

        // Remember org slug for next login (especially useful for custom domains)
        saveOrgSlug(data.org_slug);

        if (loginData.user?.force_password_change) {
          router.push('/change-password');
        } else {
          router.push(postLoginUrl);
        }
        router.refresh();
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    }
  }

  async function onMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaCode.trim()) return;

    setMfaError(null);
    setMfaSubmitting(true);

    try {
      // Call MFA verify API directly
      const mfaRes = await fetch('/api/v1/auth/mfa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Slug': pendingOrgSlug,
        },
        body: JSON.stringify({ mfa_token: mfaToken, code: mfaCode.trim() }),
      });

      if (!mfaRes.ok) {
        const err = await mfaRes.json().catch(() => ({}));
        setMfaError(err.detail || 'Invalid code. Please try again.');
        setMfaCode('');
        mfaInputRef.current?.focus();
        return;
      }

      const mfaData = await mfaRes.json();

      // Complete NextAuth sign-in with the MFA-verified token
      const result = await signIn('credentials', {
        org_slug: pendingOrgSlug,
        email: mfaData.user.email,
        password: `__sso_token__:${mfaData.access_token}`,
        redirect: false,
      });

      if (result?.error) {
        setMfaError('Sign in failed after verification. Please try again.');
        return;
      }

      if (mfaData.user?.force_password_change) {
        router.push('/change-password');
      } else {
        router.push(postLoginUrl);
      }
      router.refresh();
    } catch {
      setMfaError('Verification failed. Please try again.');
    } finally {
      setMfaSubmitting(false);
    }
  }

  function handleBackToSignIn() {
    setMfaStep(false);
    setMfaToken('');
    setMfaCode('');
    setMfaError(null);
  }

  // MFA verification step
  if (mfaStep) {
    return (
      <div data-testid="mfa-form" className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EFF6FF] dark:bg-[rgba(37,99,235,0.1)]">
            <ShieldCheck className="h-7 w-7 text-[#2563EB]" />
          </div>
          <h2 className="mt-4 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
            Two-Factor Authentication
          </h2>
          <p className="mt-2 text-[14px] text-[#64748B]">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        {mfaError && (
          <div className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{mfaError}</span>
          </div>
        )}

        <form onSubmit={onMfaSubmit} className="mt-8 space-y-6">
          <div className="space-y-1.5">
            <label htmlFor="mfa_code" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
              Verification Code
            </label>
            <input
              ref={mfaInputRef}
              id="mfa_code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              placeholder="000000"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              className="h-[48px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-center text-[20px] font-mono tracking-[0.3em] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            />
            <p className="text-[11px] text-[#94A3B8] text-center mt-2">
              You can also use a backup code
            </p>
          </div>

          <button
            type="submit"
            disabled={mfaSubmitting || !mfaCode.trim()}
            className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
            style={{ height: 48 }}
          >
            {mfaSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify'
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={handleBackToSignIn}
          className="mt-4 flex w-full items-center justify-center gap-2 text-[13px] text-[#64748B] hover:text-[#334155] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div data-testid="login-form" className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
      {/* Heading */}
      <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
        Welcome back
      </h2>
      <p className="mt-2 text-[14px] text-[#64748B]">
        Sign in to your workspace
      </p>

      {error && (
        <div data-testid="error-message" className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SSO Button */}
      <button
        type="button"
        disabled={ssoLoading || !orgSlug}
        onClick={async () => {
          if (!orgSlug) {
            setError('Enter your organization slug to use SSO.');
            return;
          }
          setSsoLoading(true);
          setError(null);
          try {
            const callbackUrl = `${window.location.origin}/api/auth/sso/callback`;
            const res = await fetch(`/api/v1/auth/sso/authorize?callback_url=${encodeURIComponent(callbackUrl)}`, {
              headers: { 'X-Tenant-Slug': orgSlug },
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.detail || 'SSO is not configured for this organization.');
            }
            const { authorize_url } = await res.json();
            window.location.href = authorize_url;
          } catch (err: any) {
            setError(err.message || 'Failed to initiate SSO.');
            setSsoLoading(false);
          }
        }}
        className="mt-8 flex w-full items-center justify-center rounded-[8px] border-[1.5px] border-[#E2E8F0] bg-white dark:bg-navy-elevated px-4 text-[14px] font-medium text-[#334155] dark:text-[#E2E8F0] transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.06] disabled:opacity-50"
        style={{ height: 44 }}
      >
        {ssoLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Redirecting to SSO...
          </>
        ) : (
          'Continue with SSO'
        )}
      </button>

      {/* Divider */}
      <div className="my-6 flex items-center gap-4">
        <div className="flex-1 border-t border-[#E2E8F0] dark:border-[#1E293B]" />
        <span className="text-[12px] text-[#94A3B8]">or</span>
        <div className="flex-1 border-t border-[#E2E8F0] dark:border-[#1E293B]" />
      </div>

      <form method="POST" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Organization slug */}
        <div className="space-y-1.5">
          <label htmlFor="org_slug" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Organization
          </label>
          <input
            id="org_slug"
            data-testid="input-org-slug"
            placeholder="acme-corp"
            autoComplete="organization"
            readOnly={isOrgLocked}
            className={`h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)] ${isOrgLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            {...register('org_slug')}
          />
          {errors.org_slug && (
            <p className="text-[11px] text-[#DC2626]">{errors.org_slug.message}</p>
          )}
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Email
          </label>
          <input
            id="email"
            data-testid="input-email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-[11px] text-[#DC2626]">{errors.email.message}</p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-[12px] font-medium text-[#FF6B2B] hover:underline"
            >
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              data-testid="input-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••••"
              autoComplete="current-password"
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
              {...register('password')}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-[11px] text-[#DC2626]">{errors.password.message}</p>
          )}
        </div>

        {/* Sign In button */}
        <button
          type="submit"
          data-testid="btn-sign-in"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
          style={{ height: 48 }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </button>
      </form>

      {/* Sign up */}
      <p className="mt-6 text-center text-[13px] text-[#64748B]">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-[#FF6B2B] hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
