// packages/web/app/_marketing/sections/LogoStrip.tsx
import { LOGOS } from '../data/homepage';

export default function LogoStrip() {
  return (
    <section
      className="py-10 px-4"
      style={{ background: '#0D1117', borderTop: '1px solid #1E293B', borderBottom: '1px solid #1E293B' }}
    >
      <div className="max-w-5xl mx-auto text-center">
        <p className="text-xs mb-6 uppercase tracking-wider" style={{ color: '#64748B' }}>
          Trusted by engineering teams at
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {LOGOS.map((name) => (
            <span
              key={name}
              className="text-sm font-semibold tracking-wide"
              style={{ color: '#334155' }}
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
