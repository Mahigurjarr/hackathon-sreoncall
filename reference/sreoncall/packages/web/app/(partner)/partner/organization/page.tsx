'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { PartnerPage, PartnerCard, PartnerSectionHeader } from '@/components/partner/PartnerPage';
import { usePartnerMe } from '@/lib/hooks/usePartnerProfile';

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

async function partnerFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function maskAccount(n: string | null): string {
  if (!n) return '—';
  if (n.length <= 4) return n;
  return '•••• •••• ' + n.slice(-4);
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</p>
      <p className="text-sm text-[#0F172A] mt-1 break-words">{value || '—'}</p>
    </div>
  );
}

export default function PartnerOrganizationPage() {
  const { data: me } = usePartnerMe();
  const { data: onboarding, isLoading } = useQuery<OnboardingData>({
    queryKey: ['partner-onboarding-readonly'],
    queryFn: () => partnerFetch<OnboardingData>('/api/v1/partner/onboarding'),
  });

  return (
    <PartnerPage
      title="Organization"
      subtitle="Your legal entity, banking, and agreement status"
      icon={Building2}
    >
      {isLoading ? (
        <PartnerCard><p className="text-sm text-[#94A3B8]">Loading…</p></PartnerCard>
      ) : (
        <>
          <div>
            <PartnerSectionHeader title="Company" />
            <PartnerCard>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Company name" value={me?.partner.company} />
                <Field label="Partner track" value={me?.partner.partnerType} />
                <Field label="Account status" value={me?.partner.status} />
                <Field
                  label="Commission rate"
                  value={
                    me?.partner.commissionRate !== undefined
                      ? `${me.partner.commissionRate}%`
                      : null
                  }
                />
              </div>
            </PartnerCard>
          </div>

          <div>
            <PartnerSectionHeader title="Legal entity" />
            <PartnerCard>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Legal entity name" value={onboarding?.legalEntityName} />
                <Field label="Legal structure" value={onboarding?.legalStructure} />
                <Field label="Business address" value={onboarding?.businessAddress} />
                <Field label="Tax ID" value={onboarding?.taxId} />
              </div>
            </PartnerCard>
          </div>

          <div>
            <PartnerSectionHeader title="Banking" description="For quarterly commission payouts" />
            <PartnerCard>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Account holder" value={onboarding?.bankAccountName} />
                <Field label="Account number" value={maskAccount(onboarding?.bankAccountNumber ?? null)} />
                <Field label="Routing / IFSC / SWIFT" value={onboarding?.bankRoutingCode} />
                <Field label="Agreement accepted" value={onboarding?.agreementAccepted ? 'Yes' : 'No'} />
              </div>
            </PartnerCard>
          </div>

          <p className="text-xs text-[#94A3B8]">
            To update these details, contact <a href="mailto:partners@sreoncall.com" className="text-[#FF6B2B] hover:underline">partners@sreoncall.com</a>.
          </p>
        </>
      )}
    </PartnerPage>
  );
}
