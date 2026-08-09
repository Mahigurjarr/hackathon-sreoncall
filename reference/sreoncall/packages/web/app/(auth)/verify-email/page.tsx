'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';

type Status = 'verifying' | 'success' | 'error' | 'missing-token';

export default function VerifyEmailPage() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'missing-token');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (res.ok) {
          setStatus('success');
        } else {
          const body = await res.json().catch(() => ({}));
          setErrorDetail(body?.detail || 'This verification link is invalid or has expired.');
          setStatus('error');
        }
      } catch {
        if (!cancelled) {
          setErrorDetail('Could not reach the server. Please try again.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
      {status === 'verifying' && (
        <>
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-[#FF6B2B]" />
          <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
            Verifying your email…
          </h2>
          <p className="text-[14px] text-[#64748B]">
            Hang tight while we confirm your account.
          </p>
        </>
      )}

      {status === 'success' && (
        <>
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
          <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
            Email verified
          </h2>
          <p className="mb-6 text-[14px] text-[#64748B]">
            Your account is ready to use. Sign in to get started.
          </p>
          <Link
            href="/signin"
            className="inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-6 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5"
            style={{ height: 48 }}
          >
            Continue to Sign In
          </Link>
        </>
      )}

      {(status === 'error' || status === 'missing-token') && (
        <>
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-amber-500" />
          <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
            Verification link problem
          </h2>
          <p className="mb-6 text-[14px] text-[#64748B]">
            {status === 'missing-token'
              ? 'The verification link appears to be missing its token. Paste the full URL from the email you received.'
              : errorDetail}
          </p>
          <div className="flex flex-col items-center gap-3">
            <Link
              href="/signin"
              className="inline-flex items-center justify-center rounded-[10px] border border-[#E2E8F0] dark:border-[#334155] px-6 text-[15px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] transition-all hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B]"
              style={{ height: 48 }}
            >
              Back to Sign In
            </Link>
            <ResendForm />
          </div>
        </>
      )}
    </div>
  );
}

function ResendForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending');
    try {
      await fetch('/api/v1/auth/resend-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } finally {
      // Always show "sent" — response is deliberately identical for
      // unknown/verified emails to prevent enumeration.
      setState('sent');
    }
  }

  if (state === 'sent') {
    return (
      <p className="mt-2 flex items-center gap-2 text-[13px] text-[#64748B]">
        <Mail className="h-4 w-4" />
        If the email is valid and unverified, a fresh link has been sent.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 flex w-full max-w-[360px] flex-col gap-2">
      <label className="text-left text-[12px] font-medium text-[#64748B]">
        Didn&apos;t get it? Resend the verification email
      </label>
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 rounded-[8px] border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-navy-surface px-3 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8]"
          style={{ height: 40 }}
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="inline-flex items-center justify-center rounded-[8px] bg-[#0F172A] dark:bg-[#E2E8F0] px-4 text-[13px] font-semibold text-white dark:text-[#0F172A] disabled:opacity-60"
          style={{ height: 40 }}
        >
          {state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Resend'}
        </button>
      </div>
    </form>
  );
}
