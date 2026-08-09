'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SRELogo } from '@/components/brand/SRELogo';

interface TokenData {
  name: string;
  email: string;
}

export default function PartnerRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [tokenStatus, setTokenStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenStatus('invalid');
      return;
    }

    let cancelled = false;
    // Token is single-use and expires in 48h, minimising the risk of URL exposure in logs
    fetch(`/api/v1/public/partner-register?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json() as TokenData;
          setName(data.name || '');
          setEmail(data.email || '');
          setTokenStatus('valid');
        } else {
          setTokenStatus('invalid');
        }
      })
      .catch(() => {
        if (!cancelled) setTokenStatus('invalid');
      });

    return () => { cancelled = true; };
  }, [token]);

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

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/public/partner-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });

      if (res.status === 201) {
        router.push('/partner/login?registered=1');
        return;
      }

      const err = await res.json().catch(() => ({})) as { detail?: string };
      setError(err.detail || 'Registration failed. Please try again.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle =
    'w-full bg-[#0D1117] border border-[#1E293B] text-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm focus:border-[#FF6B2B] outline-none transition-colors placeholder:text-[#475569]';

  const readonlyInputStyle =
    'w-full bg-[#0D1117]/60 border border-[#1E293B] text-[#94A3B8] rounded-lg px-3 py-2.5 text-sm outline-none cursor-not-allowed';

  return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <SRELogo width={80} branded />
          <h1 className="mt-3 text-xl font-bold text-[#E2E8F0]">Partner Portal</h1>
          <p className="mt-1 text-sm text-[#64748B]">Complete your registration</p>
        </div>

        {/* Card */}
        <div className="bg-[#161B22] border border-[#1E293B] rounded-xl p-8">
          {/* Loading state */}
          {tokenStatus === 'loading' && (
            <div className="flex flex-col items-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FF6B2B] border-t-transparent" />
              <p className="mt-3 text-sm text-[#64748B]">Validating your invite link…</p>
            </div>
          )}

          {/* Invalid token */}
          {tokenStatus === 'invalid' && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-4 text-sm text-red-400 text-center">
              <p className="font-semibold mb-1">Invite link invalid or expired</p>
              <p>
                This invite link has expired or is invalid. Contact{' '}
                <a href="mailto:partners@sreoncall.com" className="underline hover:text-red-300">
                  partners@sreoncall.com
                </a>
                .
              </p>
            </div>
          )}

          {/* Valid token — registration form */}
          {tokenStatus === 'valid' && (
            <>
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
                    value={email}
                    readOnly
                    className={readonlyInputStyle}
                    tabIndex={-1}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Full name
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className={inputStyle}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Password
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
                    Confirm password
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
                  disabled={submitting}
                  className="w-full bg-[#FF6B2B] text-white rounded-lg px-4 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60 mt-2"
                >
                  {submitting ? 'Creating account…' : 'Complete registration'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-[#64748B]">
          Already have an account?{' '}
          <a href="/partner/login" className="text-[#FF6B2B] hover:underline font-medium">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
