// packages/web/app/pricing/_components/BillingToggle.tsx
'use client';

import type { BillingCycle } from '../../_marketing/data/pricing';

interface Props {
  value: BillingCycle;
  onChange: (v: BillingCycle) => void;
}

export function BillingToggle({ value, onChange }: Props) {
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      <span style={{ color: value === 'annual' ? '#0D1117' : '#94A3B8', fontWeight: value === 'annual' ? 700 : 400 }}>
        Annual
      </span>
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
        style={{ background: '#FFF5F0', color: '#FF6B2B' }}
      >
        Save ~13%
      </span>
      <button
        role="switch"
        aria-checked={value === 'monthly'}
        onClick={() => onChange(value === 'annual' ? 'monthly' : 'annual')}
        className="relative w-12 h-6 rounded-full transition-colors focus:outline-none"
        style={{ background: value === 'monthly' ? '#FF6B2B' : '#E9ECEF' }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
          style={{ transform: value === 'monthly' ? 'translateX(24px)' : 'translateX(0)' }}
        />
      </button>
      <span style={{ color: value === 'monthly' ? '#0D1117' : '#94A3B8', fontWeight: value === 'monthly' ? 700 : 400 }}>
        Monthly
      </span>
    </div>
  );
}
