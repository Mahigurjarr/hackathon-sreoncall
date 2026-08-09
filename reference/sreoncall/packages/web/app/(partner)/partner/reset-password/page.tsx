'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { SRELogo } from '@/components/brand/SRELogo';

export default function PartnerResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('Invalid reset link. Please request a new one.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/partner-auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail || 'Failed to reset password. The link may have expired.');
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
          <p className="mt-1 text-sm text-[#64748B]">Set a new password</p>
        </div>

        {/* Card */}
        <div className="bg-[#161B22] border border-[#1E293B] rounded-xl p-8">
          {success ? (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              </div>
              <h2 className="text-lg font-bold text-[#E2E8F0]">Password reset</h2>
              <p className="text-sm text-[#64748B]">
                Your password has been updated successfully. You can now sign in with your new password.
              </p>
              <a
                href="/partner/login"
                className="inline-flex items-center justify-center w-full bg-[#FF6B2B] text-white rounded-lg px-4 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90"
              >
                Sign in
              </a>
            </div>
          ) : !token ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-red-400">
                Invalid reset link. Please request a new password reset.
              </p>
              <a
                href="/partner/forgot-password"
                className="inline-block text-sm font-semibold text-[#FF6B2B] hover:underline"
              >
                Request password reset
              </a>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className={inputStyle}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    className={inputStyle}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#FF6B2B] text-white rounded-lg px-4 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60 mt-2"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Resetting...
                    </span>
                  ) : (
                    'Reset Password'
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
