// packages/web/app/pricing/_components/PricingCards.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { TIERS, type BillingCycle } from '../../_marketing/data/pricing';
import { BillingToggle } from './BillingToggle';

export function PricingCards() {
  const [billing, setBilling] = useState<BillingCycle>('annual');

  return (
    <div>
      <div className="mb-10">
        <BillingToggle value={billing} onChange={setBilling} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {TIERS.map((tier) => {
          const price = billing === 'annual' ? tier.annualPrice : tier.monthlyPrice;
          return (
            <div
              key={tier.id}
              className="rounded-xl p-5 flex flex-col"
              style={
                tier.popular
                  ? { background: '#0D1117', border: '2px solid #FF6B2B' }
                  : { background: '#F8F9FA', border: '1px solid #E9ECEF' }
              }
            >
              {tier.popular && (
                <span
                  className="inline-block self-start text-xs font-bold px-3 py-1 rounded-full mb-3"
                  style={{ background: '#FF6B2B', color: '#fff' }}
                >
                  MOST POPULAR
                </span>
              )}

              <h3
                className="font-bold text-base mb-2"
                style={{ color: tier.popular ? '#E2E8F0' : '#0D1117' }}
              >
                {tier.name}
              </h3>

              <div className="mb-1">
                {tier.priceLabel ? (
                  <span className="text-3xl font-extrabold" style={{ color: '#FF6B2B' }}>{tier.priceLabel}</span>
                ) : price === null ? (
                  <span className="text-3xl font-extrabold" style={{ color: '#FF6B2B' }}>Custom</span>
                ) : (
                  <>
                    <span
                      className="text-3xl font-extrabold"
                      style={{ color: '#FF6B2B', fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      ${price.toLocaleString()}
                    </span>
                    <span className="text-xs ml-1" style={{ color: '#94A3B8' }}>
                      /mo · {billing}
                    </span>
                  </>
                )}
              </div>

              <p className="text-xs mb-4" style={{ color: tier.popular ? '#64748B' : '#94A3B8' }}>
                {tier.users}
              </p>

              <ul className="space-y-2 flex-1 mb-6">
                {tier.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-xs">
                    <Check size={12} className="mt-0.5 shrink-0" style={{ color: '#FF6B2B' }} />
                    <span style={{ color: tier.popular ? '#94A3B8' : '#64748B' }}>{h}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className="block text-center text-sm font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90"
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
          );
        })}
      </div>
    </div>
  );
}
