// packages/web/app/pricing/page.tsx
import type { Metadata } from 'next';
import MarketingLayout from '../_marketing/layout';
import { PricingCards } from './_components/PricingCards';
import { FeatureTable } from './_components/FeatureTable';
import { PricingComparison } from './_components/PricingComparison';
import { PerksStrip } from './_components/PerksStrip';
import { FaqSection } from './_components/FaqSection';
import CtaFooter from '../_marketing/sections/CtaFooter';

export const metadata: Metadata = {
  title: 'Pricing — SREonCall',
  description:
    'Simple, flat pricing for SREonCall. Unlimited hosts on every plan. No per-host fees, no overage charges. From $0 free to Enterprise at $6,999/mo.',
};

export default function PricingPage() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section
        className="pt-32 pb-16 px-4 text-center"
        style={{ background: 'linear-gradient(160deg, #0D1117, #161B22)' }}
      >
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: '#FF6B2B' }}>
            Pricing
          </p>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4" style={{ color: '#E2E8F0' }}>
            SRE Operations — One Price.{' '}
            <span style={{ color: '#FF6B2B' }}>No Surprises.</span>
          </h1>
          <p className="text-lg" style={{ color: '#94A3B8' }}>
            Unlimited Hosts. Zero Per-GB Fees. Flat Pricing for Teams irrespective of Team Size.
          </p>
        </div>
      </section>

      {/* Cards + Toggle + Expandable Table */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <PricingCards />
          <FeatureTable />
        </div>
      </section>

      {/* Perks Strip */}
      <section className="px-4 pb-16 bg-white">
        <div className="max-w-7xl mx-auto">
          <PerksStrip />
        </div>
      </section>

      {/* Competitor comparison */}
      <PricingComparison />

      {/* FAQ */}
      <FaqSection />

      {/* CTA */}
      <CtaFooter />
    </MarketingLayout>
  );
}
