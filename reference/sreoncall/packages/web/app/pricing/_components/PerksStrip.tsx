// packages/web/app/pricing/_components/PerksStrip.tsx
import { Infinity, ShieldCheck, Lock, CircleDollarSign, Activity, XCircle } from 'lucide-react';
import { PERKS } from '../../_marketing/data/pricing';

const ICON_MAP = {
  infinity: Infinity,
  'shield-check': ShieldCheck,
  lock: Lock,
  'circle-dollar-sign': CircleDollarSign,
  activity: Activity,
  'x-circle': XCircle,
} as const;

export function PerksStrip() {
  return (
    <div
      className="mt-16 rounded-xl py-8 px-6"
      style={{ background: '#FFF5F0', borderTop: '2px solid #FF6B2B' }}
    >
      <p className="text-center text-xs font-semibold uppercase tracking-wider mb-6" style={{ color: '#FF6B2B' }}>
        Included in every plan
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {PERKS.map((perk) => {
          const Icon = ICON_MAP[perk.icon as keyof typeof ICON_MAP];
          return (
            <div key={perk.label} className="flex flex-col items-center gap-2 text-center">
              <Icon size={20} style={{ color: '#FF6B2B' }} />
              <span className="text-xs font-medium" style={{ color: '#374151' }}>{perk.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
