// packages/web/app/pricing/_components/FaqSection.tsx
'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FAQ_ITEMS } from '../../_marketing/data/pricing';

export function FaqSection() {
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl font-extrabold text-center mb-12" style={{ color: '#0D1117' }}>
          Frequently asked questions
        </h2>
        <div className="space-y-0" style={{ border: '1px solid #F1F3F5', borderRadius: '12px', overflow: 'hidden' }}>
          {FAQ_ITEMS.map((item, i) => (
            <div key={item.q} style={{ borderBottom: i < FAQ_ITEMS.length - 1 ? '1px solid #F1F3F5' : 'none' }}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="font-semibold text-sm pr-4" style={{ color: '#0D1117' }}>{item.q}</span>
                <ChevronDown
                  size={16}
                  className="shrink-0 transition-transform"
                  style={{ color: '#64748B', transform: openIndexes.has(i) ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              {openIndexes.has(i) && (
                <div className="px-6 pb-5">
                  <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
