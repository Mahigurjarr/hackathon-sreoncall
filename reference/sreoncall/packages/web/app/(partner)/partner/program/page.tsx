'use client';

import {
  Handshake,
  UserCheck,
  Store,
  Server,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  PartnerPage,
  PartnerCard,
  PartnerSectionHeader,
} from '@/components/partner/PartnerPage';

// ─── Tracks ──────────────────────────────────────────────────────────────────

const TRACKS = [
  {
    id: 'referral',
    icon: UserCheck,
    name: 'Referral Partner',
    bestFor: 'Consultants, advisors, agencies',
    billing: 'SREonCall bills the customer',
    earnings: '15% of ARR (Year 1) · 7.5% (Year 2+)',
    obligations: 'None — no technical or billing obligations',
    prereqs: 'Signed agreement + 1-hour onboarding call',
    minActivity: '1 closed referral per 12 months',
  },
  {
    id: 'reseller',
    icon: Store,
    name: 'Reseller Partner',
    bestFor: 'VARs, distributors, system integrators',
    billing: 'You bill the customer · SREonCall invoices you monthly net 30',
    earnings: '35% Y1 → 30% Y2 → 25% Y3+ margin on list price',
    obligations: 'Light — sales-level training',
    prereqs: 'Signed agreement + Reseller Certification (4h self-paced)',
    minActivity: '2 active customer accounts after month 6',
  },
  {
    id: 'msp',
    icon: Server,
    name: 'MSP Partner',
    bestFor: 'Managed service providers, NOC/SOC operators',
    billing: 'You bill the customer · SREonCall invoices you monthly net 30',
    earnings: '40% platform margin (flat) + 80% of managed services',
    obligations: 'Full — deployment, onboarding, L1 support',
    prereqs:
      'Signed agreement + MSP Technical Certification (8h self-paced) + tech onboarding call',
    minActivity:
      '2 new customers in Year 1 · 5/year from Year 2 · drops to 3/year once 20+ tenants',
  },
] as const;

// ─── Benefits ────────────────────────────────────────────────────────────────

const BENEFITS = [
  { title: 'Partner Portal', detail: 'Deal registration, pipeline tracking, commission reporting' },
  { title: 'Sales collateral', detail: 'Pitch decks, one-pagers, Datadog/PagerDuty battle cards' },
  { title: 'Demo environment', detail: 'Pre-configured demo tenant with sample data' },
  { title: 'NFR licence', detail: 'One free Not-For-Resale tenant (Growth tier) for internal use' },
  { title: 'Partner Slack channel', detail: 'Direct access to SREonCall engineering & support' },
  { title: 'Dedicated Partner Manager', detail: 'Named contact for escalations and deal support' },
  { title: 'Priority support SLA', detail: 'Partner tickets resolved within 4 business hours' },
  { title: 'Early access programme', detail: 'Beta-test new features before general availability' },
  { title: 'MDF (Market Development Funds)', detail: 'Available on request for qualified joint campaigns' },
];

// ─── Obligations ─────────────────────────────────────────────────────────────

const OBLIGATIONS = [
  {
    title: 'Accurate representation',
    detail: 'Represent SREonCall capabilities only as documented. No feature commitments outside the current roadmap.',
  },
  {
    title: 'Pricing integrity',
    detail: 'Do not publicly advertise SREonCall below list price without written approval.',
  },
  {
    title: 'Data protection',
    detail: 'Handle customer data in compliance with GDPR, DPDP Act 2023, and other applicable laws.',
  },
  {
    title: 'Certification currency',
    detail: 'Maintain at least one active certified contact. Lapsed certifications (12+ months) require renewal.',
  },
  {
    title: 'Pipeline reporting',
    detail: 'Resellers and MSPs share a quarterly pipeline update with their Partner Manager.',
  },
  {
    title: 'Brand guidelines',
    detail: 'Use logos and brand assets per brand guidelines. No derivative brand materials.',
  },
  {
    title: 'Conflict disclosure',
    detail: 'Disclose if you resell competing products (Datadog, PagerDuty). Not disqualifying — must be declared.',
  },
];

// ─── Deal registration rules ─────────────────────────────────────────────────

const DEAL_RULES = [
  {
    track: 'Referral',
    protection: '90 days from registration',
    attribution: 'First-registered-wins',
    payout: 'Quarterly in arrears · within 30 days of quarter close',
  },
  {
    track: 'Reseller',
    protection: '120 days from registration',
    attribution: 'Conflicts escalated to Partner Manager · 5 business day SLA',
    payout: 'Monthly invoice from SREonCall · net 30',
  },
  {
    track: 'MSP',
    protection: '120 days from registration',
    attribution: 'Conflicts escalated to Partner Manager · 5 business day SLA',
    payout: 'Monthly invoice from SREonCall · net 30',
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PartnerProgramPage() {
  return (
    <PartnerPage
      title="Partner Program"
      subtitle="Tracks, commissions, obligations, and how to stay active"
      icon={Handshake}
    >
      {/* Tracks comparison */}
      <div>
        <PartnerSectionHeader
          title="Partner tracks"
          description="Three independent tracks. You may qualify for one or more depending on your business model."
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {TRACKS.map((t) => {
            const Icon = t.icon;
            return (
              <PartnerCard key={t.id}>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
                    <Icon size={18} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-[#0F172A]">{t.name}</h3>
                    <p className="text-[11px] text-[#94A3B8] mt-0.5">{t.bestFor}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2.5 text-xs">
                  {[
                    ['Billing', t.billing],
                    ['Earnings', t.earnings],
                    ['Obligations', t.obligations],
                    ['Prerequisites', t.prereqs],
                    ['Min. activity', t.minActivity],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                        {k}
                      </dt>
                      <dd className="text-[#64748B] mt-0.5 leading-relaxed">{v}</dd>
                    </div>
                  ))}
                </dl>
              </PartnerCard>
            );
          })}
        </div>
      </div>

      {/* Deal registration & payout rules */}
      <div>
        <PartnerSectionHeader
          title="Deal registration & payout"
          description="Register early to lock in protection and earn commission. Rules differ by track."
        />
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                {['Track', 'Deal protection', 'Attribution', 'Payout'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left font-semibold text-[#94A3B8]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEAL_RULES.map((r) => (
                <tr key={r.track} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC]">
                  <td className="px-5 py-3.5 text-[#0F172A] font-semibold">{r.track}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{r.protection}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{r.attribution}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{r.payout}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[#94A3B8]">
          Referral commission is only payable on customers who remain active past month 3. Churned customers do not generate commission.
        </p>
      </div>

      {/* What all partners get */}
      <div>
        <PartnerSectionHeader
          title="What you get as a partner"
          description="All active partners — regardless of track — receive the following."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {BENEFITS.map((b) => (
            <PartnerCard key={b.title}>
              <div className="flex items-start gap-3">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-[#FF6B2B]" />
                <div>
                  <p className="text-sm font-semibold text-[#0F172A]">{b.title}</p>
                  <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">{b.detail}</p>
                </div>
              </div>
            </PartnerCard>
          ))}
        </div>
      </div>

      {/* Obligations */}
      <div>
        <PartnerSectionHeader
          title="Partner obligations"
          description="Standards all partners uphold, regardless of track."
        />
        <PartnerCard>
          <ul className="space-y-3.5">
            {OBLIGATIONS.map((o) => (
              <li key={o.title} className="flex gap-3">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-[#FF6B2B]" />
                <div>
                  <p className="text-sm font-semibold text-[#0F172A]">{o.title}</p>
                  <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">{o.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </PartnerCard>
      </div>

      {/* Program status */}
      <div>
        <PartnerSectionHeader
          title="Program status"
          description="Partner status is reviewed annually. Falling below minimum activity triggers a 60-day notice period before downgrade to Registered status."
        />
        <PartnerCard>
          <p className="text-xs text-[#64748B] leading-relaxed">
            There are <span className="font-semibold text-[#0F172A]">no upfront fees</span> to join the SREonCall Partner Programme.
            Initial agreement term is 12 months, auto-renewing annually unless either party gives 60 days notice.
            The programme is non-exclusive — SREonCall may engage other partners and direct sales in your markets.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="mailto:partners@sreoncall.com?subject=Partner%20Program%20Enquiry"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#FF6B2B] hover:bg-[#e85e22] transition-colors"
            >
              Contact partners@sreoncall.com
            </a>
            <a
              href="mailto:billing@sreoncall.com?subject=Partner%20Billing%20Query"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-[#0F172A] border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors"
            >
              Billing queries
            </a>
          </div>
        </PartnerCard>
      </div>
    </PartnerPage>
  );
}
