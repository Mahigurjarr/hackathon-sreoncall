'use client';

import { BookOpen, FileText, Swords, Presentation, Award, Gift, Download } from 'lucide-react';
import { PartnerPage, PartnerCard, PartnerMascot } from '@/components/partner/PartnerPage';

interface Resource {
  icon: typeof FileText;
  title: string;
  description: string;
  href: string;
  filename: string;
}

const RESOURCES: Resource[] = [
  {
    icon: Presentation,
    title: 'Pitch deck',
    description: 'Narrative deck you can walk a prospect through in 20 minutes — problem, solution, differentiators, commercials.',
    href: '/partner-resources/pitch-deck.pdf',
    filename: 'SREonCall-Pitch-Deck.pdf',
  },
  {
    icon: FileText,
    title: 'Product one-pager',
    description: 'Branded one-page PDF summarising the SREonCall platform, pricing, and partner economics.',
    href: '/partner-resources/product-one-pager.pdf',
    filename: 'SREonCall-Product-One-Pager.pdf',
  },
  {
    icon: Swords,
    title: 'Competitive battle cards',
    description: 'Datadog, PagerDuty, Groundcover — positioning, landmines, and counter-plays for each.',
    href: '/partner-resources/competitive-battle-cards.pdf',
    filename: 'SREonCall-Battle-Cards.pdf',
  },
  {
    icon: Award,
    title: 'Partner badge guidelines',
    description: 'Approved usage rules, clear space, minimum sizes, and colours for the "SREonCall Partner" badge.',
    href: '/partner-resources/partner-badge-guidelines.pdf',
    filename: 'SREonCall-Partner-Badge-Guidelines.pdf',
  },
  {
    icon: Gift,
    title: 'NFR tenant guide',
    description: 'Everything about your free Not-For-Resale Growth tenant — what it includes and how to request provisioning.',
    href: '/partner-resources/nfr-tenant-guide.pdf',
    filename: 'SREonCall-NFR-Tenant-Guide.pdf',
  },
];

export default function PartnerResourcesPage() {
  return (
    <PartnerPage
      title="Resources"
      subtitle="Sales collateral, competitive materials, and partner-only assets"
      icon={BookOpen}
    >
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#FFF3ED] to-white border border-[#E2E8F0] p-6 pr-40">
        <h2 className="text-lg font-bold text-[#0F172A]">Everything you need to win deals</h2>
        <p className="mt-1 text-sm text-[#64748B] max-w-xl">
          Pitch decks, battle cards, and positioning assets — all in one place. Every download is a branded PDF ready to share with prospects.
        </p>
        <div className="absolute right-4 bottom-0">
          <PartnerMascot variant="stand" size={130} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {RESOURCES.map((r) => {
          const Icon = r.icon;
          return (
            <PartnerCard key={r.title}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0F172A]">{r.title}</p>
                  <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">{r.description}</p>
                  <a
                    href={r.href}
                    download={r.filename}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF6B2B] hover:underline"
                  >
                    <Download size={12} />
                    Download PDF
                  </a>
                </div>
              </div>
            </PartnerCard>
          );
        })}
      </div>

      <p className="text-[11px] text-[#94A3B8]">
        Need something not listed here? Email{' '}
        <a href="mailto:partners@sreoncall.com" className="text-[#FF6B2B] hover:underline">
          partners@sreoncall.com
        </a>
        {' '}and we'll put it together.
      </p>
    </PartnerPage>
  );
}
