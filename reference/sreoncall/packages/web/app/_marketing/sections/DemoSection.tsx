// packages/web/app/_marketing/sections/DemoSection.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DEMO_TABS } from '../data/homepage';

export default function DemoSection() {
  const [activeId, setActiveId] = useState<string>(DEMO_TABS[0].id);
  const active = DEMO_TABS.find((t) => t.id === activeId) ?? DEMO_TABS[0];

  return (
    <section id="demo" className="py-20 px-4" style={{ background: '#0D1117' }}>
      <div className="max-w-5xl mx-auto text-center">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: '#FF6B2B' }}>
          See It In Action
        </p>
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-14 text-white">
          From alert to resolved. In one platform.
        </h2>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {DEMO_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className="px-4 py-2 text-sm font-medium rounded-full transition-all"
              style={
                activeId === tab.id
                  ? { color: '#fff', borderBottom: '2px solid #FF6B2B' }
                  : { color: '#64748B' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Screenshot */}
        <div
          className="rounded-2xl overflow-hidden mx-auto mb-10"
          style={{ border: '1px solid #1E293B', maxWidth: '800px' }}
        >
          <img
            src={`/screenshots/demo-${active.id === 'agent' ? 'agents' : active.id}.png`}
            alt={active.screenshotLabel}
            className="w-full h-auto block"
          />
        </div>

        <p className="text-sm" style={{ color: '#64748B' }}>
          Want a live walkthrough?{' '}
          <Link href="/contact?demo=1" className="font-medium hover:underline" style={{ color: '#FF6B2B' }}>
            Book a 20-min demo →
          </Link>
        </p>
      </div>
    </section>
  );
}
