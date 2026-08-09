'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { SRELogo } from '@/components/brand/SRELogo';

export default function PartnerForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/partner-auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail || 'Something went wrong. Please try again.');
        return;
      }
      setSuccess(true);
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
          <p className="mt-1 text-sm text-[#64748B]">Reset your password</p>
        </div>

        {/* Card */}
        <div className="bg-[#161B22] border border-[#1E293B] rounded-xl p-8">
          {success ? (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              </div>
              <h2 className="text-lg font-bold text-[#E2E8F0]">Check your email</h2>
              <p className="text-sm text-[#64748B]">
                If an account exists with that email, we&apos;ve sent a password reset link.
                If you haven&apos;t completed registration yet, we&apos;ve re-sent your invitation.
                Check your Spam folder if you can&apos;t find it.
              </p>
              <a
                href="/partner/login"
                className="inline-block text-sm font-semibold text-[#FF6B2B] hover:underline"
              >
                Back to sign in
              </a>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <p className="text-sm text-[#64748B] mb-6">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className={inputStyle + ' pl-9'}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#FF6B2B] text-white rounded-lg px-4 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60 mt-2"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-[#64748B]">
          Remember your password?{' '}
          <a href="/partner/login" className="text-[#FF6B2B] hover:underline font-medium">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
