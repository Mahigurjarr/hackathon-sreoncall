'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, ShieldAlert } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
          ...((session as any)?.tenantSlug ? { 'X-Tenant-Slug': (session as any).tenantSlug } : {}),
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || 'Failed to change password.');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF7ED]">
          <ShieldAlert className="h-5 w-5 text-[#FF6B2B]" />
        </div>
        <div>
          <h2 className="text-[22px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Change your password</h2>
        </div>
      </div>
      <p className="mt-1 text-[14px] text-[#64748B]">
        You must set a new password before continuing.
      </p>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="current_password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Current Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              id="current_password"
              type={showCurrent ? 'text' : 'password'}
              placeholder="Enter your temporary password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowCurrent(!showCurrent)}
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new_password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            New Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              id="new_password"
              type={showNew ? 'text' : 'password'}
              placeholder="Min. 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowNew(!showNew)}
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
              placeholder="Confirm your new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowConfirm(!showConfirm)}
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
          style={{ height: 48 }}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating...
            </>
          ) : (
            'Set New Password'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-[#64748B]">
        <Link href="/signin" className="font-semibold text-[#FF6B2B] hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
