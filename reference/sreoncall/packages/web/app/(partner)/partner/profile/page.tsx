'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { usePartnerMe, useUpdatePartnerMe } from '@/lib/hooks/usePartnerProfile';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const PARTNER_TYPE_BADGE: Record<string, string> = {
  referral: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  reseller: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  msp: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
};

function PartnerTypeBadge({ type }: { type: string }) {
  const cls =
    PARTNER_TYPE_BADGE[type] ??
    'bg-slate-500/10 text-slate-400 border border-slate-500/20';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${cls}`}
    >
      {type}
    </span>
  );
}

// ─── Shared input style ───────────────────────────────────────────────────────

const INPUT_CLS =
  'w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] outline-none focus:border-[#FF6B2B]';
const LABEL_CLS =
  'block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#94A3B8]';
const SAVE_BTN_CLS =
  'bg-[#FF6B2B] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PartnerProfilePage() {
  const { data: partnerData, isLoading, error } = usePartnerMe();
  const updateMe = useUpdatePartnerMe();

  // ── Personal info state ──
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // ── Password state ──
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  // Populate personal info when data loads
  useEffect(() => {
    if (partnerData) {
      setName(partnerData.partnerUser.name);
      setEmail(partnerData.partnerUser.email);
    }
  }, [partnerData]);

  // ── Handlers ──

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    updateMe.mutate(
      { name, email },
      {
        onSuccess: () => toast.success('Profile updated'),
        onError: (err: Error) => toast.error(err.message),
      }
    );
  }

  function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('New passwords do not match');
      return;
    }
    updateMe.mutate(
      { password: { current: currentPw, new: newPw } },
      {
        onSuccess: () => {
          toast.success('Password updated');
          setCurrentPw('');
          setNewPw('');
          setConfirmPw('');
        },
        onError: (err: Error) => toast.error(err.message),
      }
    );
  }

  // ── Loading / error states ──

  if (isLoading) {
    return <div className="p-6 text-sm text-[#94A3B8]">Loading…</div>;
  }

  if (error || !partnerData) {
    return (
      <div className="p-6 text-sm text-red-400">
        Failed to load profile data.
      </div>
    );
  }

  const { partnerUser, partner } = partnerData;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Heading */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#0F172A]">Profile</h1>
        <p className="text-sm text-[#94A3B8] mt-0.5">
          Manage your account details and password
        </p>
      </div>

      {/* ── Section 1: Personal info ── */}
      <form onSubmit={handleSaveProfile}>
        <div className="rounded-xl p-6 mb-6 bg-white border border-[#E2E8F0]">
          <h2 className="text-sm font-semibold text-[#0F172A] mb-4">
            Personal information
          </h2>

          <div className="mb-4">
            <label className={LABEL_CLS}>Name</label>
            <input
              type="text"
              className={INPUT_CLS}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="mb-6">
            <label className={LABEL_CLS}>Email</label>
            <input
              type="email"
              className={INPUT_CLS}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className={SAVE_BTN_CLS}
            disabled={updateMe.isPending}
          >
            Save changes
          </button>
        </div>
      </form>

      {/* ── Section 2: Change password ── */}
      <form onSubmit={handleUpdatePassword}>
        <div className="rounded-xl p-6 mb-6 bg-white border border-[#E2E8F0]">
          <h2 className="text-sm font-semibold text-[#0F172A] mb-4">
            Change password
          </h2>

          <div className="mb-4">
            <label className={LABEL_CLS}>Current password</label>
            <input
              type="password"
              className={INPUT_CLS}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
            />
          </div>

          <div className="mb-4">
            <label className={LABEL_CLS}>New password</label>
            <input
              type="password"
              className={INPUT_CLS}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              minLength={8}
              required
            />
          </div>

          <div className="mb-6">
            <label className={LABEL_CLS}>Confirm new password</label>
            <input
              type="password"
              className={INPUT_CLS}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className={SAVE_BTN_CLS}
            disabled={updateMe.isPending}
          >
            Update password
          </button>
        </div>
      </form>

      {/* ── Section 3: Partner info (read-only) ── */}
      <div className="rounded-xl p-6 mb-6 bg-white border border-[#E2E8F0]">
        <h2 className="text-sm font-semibold text-[#0F172A] mb-4">
          Partner information
        </h2>

        <dl className="space-y-4">
          <div>
            <dt className={LABEL_CLS}>Company</dt>
            <dd className="text-sm text-[#0F172A]">{partner.company}</dd>
          </div>

          <div>
            <dt className={LABEL_CLS}>Partner type</dt>
            <dd>
              <PartnerTypeBadge type={partner.partnerType} />
            </dd>
          </div>

          <div>
            <dt className={LABEL_CLS}>Commission rate</dt>
            <dd className="text-sm text-[#0F172A]">{partner.commissionRate}%</dd>
          </div>

          <div>
            <dt className={LABEL_CLS}>Last login</dt>
            <dd className="text-sm text-[#0F172A]">
              {fmtDate(partnerUser.lastLoginAt)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
