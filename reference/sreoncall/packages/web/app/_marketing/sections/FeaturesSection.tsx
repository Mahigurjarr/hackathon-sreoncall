// packages/web/app/_marketing/sections/FeaturesSection.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FEATURES } from '../data/homepage';

export default function FeaturesSection() {
  const [activeId, setActiveId] = useState<string>(FEATURES[0].id);
  const active = FEATURES.find((f) => f.id === activeId) ?? FEATURES[0];

  return (
    <section id="features" className="py-20 px-4" style={{ background: '#F8F9FA' }}>
      <div className="max-w-6xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3 text-center" style={{ color: '#FF6B2B' }}>
          The Platform
        </p>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-14" style={{ color: '#0D1117' }}>
          Everything your SRE team needs.
        </h2>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {FEATURES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveId(f.id)}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={
                activeId === f.id
                  ? { background: '#FF6B2B', color: '#fff' }
                  : { background: '#fff', color: '#64748B', border: '1px solid #E9ECEF' }
              }
            >
              {f.tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h3 className="text-2xl font-extrabold mb-4 leading-snug" style={{ color: '#0D1117' }}>
              {active.title}
            </h3>
            <p className="text-base leading-relaxed mb-6" style={{ color: '#64748B' }}>
              {active.description}
            </p>
            <div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-8"
              style={{ background: '#FFF5F0', color: '#FF6B2B' }}
            >
              {active.stat}
            </div>
            <div>
              <Link
                href="/#demo"
                className="text-sm font-medium transition-colors hover:underline"
                style={{ color: '#FF6B2B' }}
              >
                See how it works →
              </Link>
            </div>
          </div>

          {/* Screenshot */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #1E293B' }}>
            <img
              src={`/screenshots/feature-${active.id}.png`}
              alt={active.screenshotLabel}
              className="w-full h-auto block"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
