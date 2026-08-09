// packages/web/app/_marketing/sections/PricingStrip.tsx
import Link from 'next/link';
import { TIERS } from '../data/pricing';

// Compact versions — only 4 paid tiers (exclude Free from strip; shown in footnote)
const STRIP_TIERS = TIERS.filter((t) => t.id !== 'free');

export default function PricingStrip() {
  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-6xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3 text-center" style={{ color: '#FF6B2B' }}>
          Pricing
        </p>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-3" style={{ color: '#0D1117' }}>
          Simple, flat pricing. No per-host fees.
        </h2>
        <p className="text-center mb-12" style={{ color: '#64748B' }}>
          Billed annually. Monthly available at ~13% more.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {STRIP_TIERS.map((tier) => (
            <div
              key={tier.id}
              className="rounded-xl p-6"
              style={
                tier.popular
                  ? { background: '#0D1117', border: '2px solid #FF6B2B' }
                  : { background: '#F8F9FA', border: '1px solid #E9ECEF' }
              }
            >
              {tier.popular && (
                <span
                  className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3"
                  style={{ background: '#FF6B2B', color: '#fff' }}
                >
                  MOST POPULAR
                </span>
              )}
              <h3
                className="font-bold text-base mb-1"
                style={{ color: tier.popular ? '#E2E8F0' : '#0D1117' }}
              >
                {tier.name}
              </h3>
              <div className="mb-4">
                {tier.priceLabel ? (
                  <span className="text-2xl font-extrabold" style={{ color: '#FF6B2B' }}>{tier.priceLabel}</span>
                ) : tier.annualPrice === null ? (
                  <span className="text-2xl font-extrabold" style={{ color: '#FF6B2B' }}>Custom</span>
                ) : (
                  <>
                    <span className="text-3xl font-extrabold" style={{ color: '#FF6B2B', fontFamily: "'JetBrains Mono', monospace" }}>
                      ${tier.annualPrice.toLocaleString()}
                    </span>
                    <span className="text-sm" style={{ color: '#94A3B8' }}>/mo</span>
                  </>
                )}
              </div>
              <ul className="space-y-1.5 mb-6">
                {tier.highlights.slice(0, 2).map((h) => (
                  <li key={h} className="text-xs" style={{ color: tier.popular ? '#94A3B8' : '#64748B' }}>
                    {h}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.ctaHref}
                className="block text-center text-sm font-semibold py-2 rounded-lg transition-opacity hover:opacity-90"
                style={
                  tier.popular
                    ? { background: '#FF6B2B', color: '#fff' }
                    : tier.ctaVariant === 'ghost'
                    ? { border: '1px solid #E9ECEF', color: '#374151' }
                    : { border: '1px solid #FF6B2B', color: '#FF6B2B' }
                }
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#FF6B2B' }}>
            See full plan comparison →
          </Link>
          <p className="text-xs mt-2" style={{ color: '#94A3B8' }}>
            Free plan available · 14-day trial on paid plans · No credit card required
          </p>
        </div>
      </div>
    </section>
  );
}
