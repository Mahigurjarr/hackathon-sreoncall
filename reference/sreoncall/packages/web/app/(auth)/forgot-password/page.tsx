'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !orgSlug.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Slug': orgSlug.trim(),
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || 'Request failed');
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
      {success ? (
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          </div>
          <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Check your email</h2>
          <p className="text-[14px] text-[#64748B]">
            Check your email for the password reset link. If you can&apos;t find it,
            please check your Spam folder.
          </p>
          <Link href="/signin" className="inline-block text-[13px] font-semibold text-[#FF6B2B] hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
            Forgot your password?
          </h2>
          <p className="mt-2 text-[14px] text-[#64748B]">
            Enter your details and we&apos;ll send you a reset link
          </p>

          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="org_slug" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
                Organization Slug
              </label>
              <input
                id="org_slug"
                placeholder="acme-corp"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim() || !orgSlug.trim()}
              className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
              style={{ height: 48 }}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Reset Link'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-[#64748B]">
            Remember your password?{' '}
            <Link href="/signin" className="font-semibold text-[#FF6B2B] hover:underline">
              Sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
