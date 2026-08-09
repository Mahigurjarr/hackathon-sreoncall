'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SRELogo } from '@/components/brand/SRELogo';

export default function PartnerLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get('error')) {
      setError('Invalid email or password');
    }
    if (searchParams.get('registered') === '1') {
      setSuccess('Registration complete! Sign in with your new credentials.');
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/partner-auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        setError(err.detail || 'Invalid email or password');
        return;
      }
      router.push('/partner/dashboard');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle =
    'w-full bg-[#0D1117] border border-[#1E293B] text-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm focus:border-[#FF6B2B] outline-none transition-colors placeholder:text-[#475569]';

  return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <SRELogo width={80} branded />
          <h1 className="mt-3 text-xl font-bold text-[#E2E8F0]">Partner Portal</h1>
          <p className="mt-1 text-sm text-[#64748B]">Sign in to your partner account</p>
        </div>

        {/* Card */}
        <div className="bg-[#161B22] border border-[#1E293B] rounded-xl p-8">
          {/* Success message */}
          {success && (
            <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400">
              {success}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputStyle}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  Password
                </label>
                <a
                  href="/partner/forgot-password"
                  className="text-[11px] font-semibold text-[#FF6B2B] hover:underline"
                >
                  Forgot?
                </a>
              </div>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#FF6B2B] text-white rounded-lg px-4 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60 mt-2"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#1E293B]" />
            </div>
            <div className="relative flex justify-center text-[11px]">
              <span className="bg-[#161B22] px-3 text-[#475569]">or continue with</span>
            </div>
          </div>

          {/* OAuth buttons */}
          <div className="space-y-3">
            <a
              href={`/api/partner-auth/signin/google?callbackUrl=${encodeURIComponent('/api/partner-auth/set-cookie?callbackUrl=/partner/dashboard')}`}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#1E293B] bg-[#0D1117] px-4 py-2.5 text-sm font-medium text-[#E2E8F0] transition-colors hover:border-[#334155] hover:bg-white/[0.02]"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </a>

            <a
              href={`/api/partner-auth/signin/github?callbackUrl=${encodeURIComponent('/api/partner-auth/set-cookie?callbackUrl=/partner/dashboard')}`}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#1E293B] bg-[#0D1117] px-4 py-2.5 text-sm font-medium text-[#E2E8F0] transition-colors hover:border-[#334155] hover:bg-white/[0.02]"
            >
              <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              Continue with GitHub
            </a>
          </div>
        </div>

        {/* Apply link */}
        <p className="mt-6 text-center text-sm text-[#64748B]">
          Not a partner yet?{' '}
          <a href="https://web.sreoncall.com/contact?track=partner" className="text-[#FF6B2B] hover:underline font-medium">
            Apply to become a partner →
          </a>
        </p>
      </div>
    </div>
  );
}
