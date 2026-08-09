'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SRELogo } from '@/components/brand/SRELogo';

interface InviteData {
  email: string;
  role: string;
  partnerName: string;
}

export default function PartnerTeamAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const router = useRouter();

  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/partner-team-invite?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.detail || 'This invite link is no longer valid.');
          setStatus('invalid');
          return;
        }
        const data = (await res.json()) as InviteData;
        setInvite(data);
        setStatus('valid');
      } catch {
        setStatus('invalid');
      }
    })();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/public/partner-team-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || 'Failed to accept invite.');
        setSubmitting(false);
        return;
      }
      router.push('/partner/login?accepted=1');
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <SRELogo />
        </div>
        <div className="rounded-xl bg-white border border-[#E2E8F0] p-8">
          {status === 'loading' ? (
            <p className="text-center text-sm text-[#94A3B8]">Validating invite…</p>
          ) : status === 'invalid' ? (
            <>
              <h1 className="text-lg font-semibold text-[#0F172A] mb-2">Invite unavailable</h1>
              <p className="text-sm text-[#64748B]">{error || 'This invite link is no longer valid.'}</p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#0F172A] mb-1">Join {invite?.partnerName}</h1>
              <p className="text-sm text-[#94A3B8] mb-6">
                Accepting as <strong className="text-[#0F172A]">{invite?.email}</strong> ({invite?.role})
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Your name</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] focus:border-[#FF6B2B] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Password</label>
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] focus:border-[#FF6B2B] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Confirm password</label>
                  <input
                    required
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] focus:border-[#FF6B2B] outline-none"
                  />
                </div>
                {error ? <p className="text-xs text-red-400">{error}</p> : null}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-[#FF6B2B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E85D1F] disabled:opacity-50"
                >
                  {submitting ? 'Creating account…' : 'Accept and create account'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
