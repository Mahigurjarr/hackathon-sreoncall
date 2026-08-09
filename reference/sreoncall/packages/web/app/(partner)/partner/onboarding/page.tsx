'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function partnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

interface OnboardingData {
  legalEntityName: string | null;
  legalStructure: string | null;
  businessAddress: string | null;
  taxId: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankRoutingCode: string | null;
  agreementAccepted: boolean;
  completedAt: string | null;
}

const LEGAL_STRUCTURES = [
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'llp', label: 'LLP (Limited Liability Partnership)' },
  { value: 'pvt_ltd', label: 'Private Limited (Pvt Ltd)' },
  { value: 'ltd', label: 'Public Limited (Ltd)' },
  { value: 'partnership', label: 'Partnership Firm' },
  { value: 'other', label: 'Other' },
];

const INPUT_CLS = 'w-full bg-[#0D1117] border border-[#1E293B] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] outline-none focus:border-[#FF6B2B] placeholder:text-[#475569]';
const LABEL_CLS = 'block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#64748B]';

export default function PartnerOnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<OnboardingData>({
    queryKey: ['partner-onboarding'],
    queryFn: () => partnerFetch<OnboardingData>('/api/v1/partner/onboarding'),
  });

  const [form, setForm] = useState({
    legalEntityName: '',
    legalStructure: '',
    businessAddress: '',
    taxId: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankRoutingCode: '',
    agreementAccepted: false,
  });

  useEffect(() => {
    if (data) {
      setForm({
        legalEntityName: data.legalEntityName ?? '',
        legalStructure: data.legalStructure ?? '',
        businessAddress: data.businessAddress ?? '',
        taxId: data.taxId ?? '',
        bankAccountName: data.bankAccountName ?? '',
        bankAccountNumber: data.bankAccountNumber ?? '',
        bankRoutingCode: data.bankRoutingCode ?? '',
        agreementAccepted: data.agreementAccepted ?? false,
      });
      if (data.completedAt) {
        router.replace('/partner/dashboard');
      }
    }
  }, [data, router]);

  const save = useMutation({
    mutationFn: (body: typeof form) =>
      partnerFetch('/api/v1/partner/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (result: unknown) => {
      qc.invalidateQueries({ queryKey: ['partner-onboarding'] });
      const r = result as OnboardingData;
      if (r.completedAt) {
        toast.success('Onboarding complete! Welcome to the partner portal.');
        router.replace('/partner/dashboard');
      } else {
        toast.success('Progress saved.');
      }
    },
    onError: () => toast.error('Failed to save. Please try again.'),
  });

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.legalEntityName.trim() || !form.legalStructure || !form.businessAddress.trim() ||
        !form.bankAccountName.trim() || !form.bankAccountNumber.trim() || !form.bankRoutingCode.trim()) {
      toast.error('Please fill in all required fields.');
      return;
    }
    if (!form.agreementAccepted) {
      toast.error('You must accept the Partner Agreement to proceed.');
      return;
    }
    save.mutate(form);
  }

  const requiredFields = [
    form.legalEntityName.trim(),
    form.legalStructure,
    form.businessAddress.trim(),
    form.bankAccountName.trim(),
    form.bankAccountNumber.trim(),
    form.bankRoutingCode.trim(),
  ];
  const filledCount = requiredFields.filter(Boolean).length + (form.agreementAccepted ? 1 : 0);
  const totalSteps = requiredFields.length + 1;
  const progress = Math.round((filledCount / totalSteps) * 100);

  if (isLoading) {
    return <div className="p-8 text-sm text-[#64748B]">Loading onboarding…</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-[#E2E8F0]">Partner Onboarding</h1>
        <p className="text-sm text-[#64748B] mt-1">
          Complete your profile to activate your partner account and start earning commissions.
        </p>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-[#64748B] mb-1.5">
            <span>{filledCount} of {totalSteps} steps complete</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1E293B]">
            <div
              className="h-1.5 rounded-full bg-[#FF6B2B] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Legal */}
        <div className="rounded-xl p-6 bg-[#161B22] border border-[#1E293B]">
          <h2 className="text-sm font-semibold text-[#E2E8F0] mb-5 pb-3 border-b border-[#1E293B]">
            Legal Information
          </h2>
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Legal Entity Name <span className="text-[#FF6B2B]">*</span></label>
              <input
                required
                className={INPUT_CLS}
                value={form.legalEntityName}
                onChange={(e) => set('legalEntityName', e.target.value)}
                placeholder="Acme Technologies Pvt Ltd"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Legal Structure <span className="text-[#FF6B2B]">*</span></label>
              <select
                required
                className={INPUT_CLS}
                value={form.legalStructure}
                onChange={(e) => set('legalStructure', e.target.value)}
              >
                <option value="">Select structure…</option>
                {LEGAL_STRUCTURES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Registered Business Address <span className="text-[#FF6B2B]">*</span></label>
              <textarea
                required
                rows={3}
                className={INPUT_CLS + ' resize-none'}
                value={form.businessAddress}
                onChange={(e) => set('businessAddress', e.target.value)}
                placeholder="123 Main Street, Bengaluru, Karnataka 560001, India"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Tax ID / GST / VAT Number</label>
              <input
                className={INPUT_CLS}
                value={form.taxId}
                onChange={(e) => set('taxId', e.target.value)}
                placeholder="29AABCT1332L1ZT"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Banking */}
        <div className="rounded-xl p-6 bg-[#161B22] border border-[#1E293B]">
          <h2 className="text-sm font-semibold text-[#E2E8F0] mb-1 pb-3 border-b border-[#1E293B] flex items-baseline gap-2">
            Banking Details
            <span className="text-[10px] font-normal text-[#475569]">Used for commission payouts</span>
          </h2>
          <div className="space-y-4 mt-4">
            <div>
              <label className={LABEL_CLS}>Account Holder Name <span className="text-[#FF6B2B]">*</span></label>
              <input
                required
                className={INPUT_CLS}
                value={form.bankAccountName}
                onChange={(e) => set('bankAccountName', e.target.value)}
                placeholder="Acme Technologies Pvt Ltd"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>Account Number <span className="text-[#FF6B2B]">*</span></label>
                <input
                  required
                  className={INPUT_CLS}
                  value={form.bankAccountNumber}
                  onChange={(e) => set('bankAccountNumber', e.target.value)}
                  placeholder="00112233445566"
                />
              </div>
              <div>
                <label className={LABEL_CLS}>IFSC / SWIFT Code <span className="text-[#FF6B2B]">*</span></label>
                <input
                  required
                  className={INPUT_CLS}
                  value={form.bankRoutingCode}
                  onChange={(e) => set('bankRoutingCode', e.target.value)}
                  placeholder="HDFC0001234"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Agreement */}
        <div className="rounded-xl p-6 bg-[#161B22] border border-[#1E293B]">
          <h2 className="text-sm font-semibold text-[#E2E8F0] mb-4 pb-3 border-b border-[#1E293B]">
            Partner Agreement
          </h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.agreementAccepted}
              onChange={(e) => set('agreementAccepted', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#1E293B] accent-[#FF6B2B]"
            />
            <span className="text-sm text-[#94A3B8] leading-relaxed">
              I confirm that the information provided is accurate and I accept the{' '}
              <a
                href="https://web.sreoncall.com/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF6B2B] hover:underline"
              >
                SREonCall Partner Agreement
              </a>{' '}
              and{' '}
              <a
                href="https://web.sreoncall.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF6B2B] hover:underline"
              >
                Privacy Policy
              </a>.
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={save.isPending}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ background: '#FF6B2B' }}
        >
          {save.isPending ? 'Saving…' : 'Submit & Activate Account →'}
        </button>
      </form>
    </div>
  );
}
