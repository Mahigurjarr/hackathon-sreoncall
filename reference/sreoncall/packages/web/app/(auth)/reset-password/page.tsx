'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock } from 'lucide-react';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError('Invalid reset link. Please request a new one.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || 'Failed to reset password. The link may have expired.');
      }
      setSuccess(true);
      setTimeout(() => router.push('/signin'), 3000);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <AlertCircle className="h-12 w-12 text-[#DC2626]" />
        </div>
        <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Invalid Reset Link</h2>
        <p className="text-[14px] text-[#64748B]">
          This password reset link is invalid or missing. Please request a new one.
        </p>
        <Link href="/forgot-password" className="inline-block text-[13px] font-semibold text-[#FF6B2B] hover:underline">
          Request new reset link
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
        </div>
        <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Password reset!</h2>
        <p className="text-[14px] text-[#64748B]">
          Your password has been reset successfully. Redirecting you to sign in...
        </p>
        <Link href="/signin" className="inline-block text-[13px] font-semibold text-[#FF6B2B] hover:underline">
          Sign in now
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Set new password</h2>
      <p className="mt-2 text-[14px] text-[#64748B]">
        Choose a strong password for your account
      </p>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            New Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm_password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Confirm New Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              id="confirm_password"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowConfirm(!showConfirm)}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !password || !confirmPassword}
          className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
          style={{ height: 48 }}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Resetting...
            </>
          ) : (
            'Reset Password'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-[#64748B]">
        <Link href="/signin" className="font-semibold text-[#FF6B2B] hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
      <Suspense
        fallback={
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#FF6B2B]" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
