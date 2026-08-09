// packages/web/app/_marketing/sections/StatsBar.tsx
import { STATS } from '../data/homepage';

export default function StatsBar() {
  return (
    <section
      className="py-10 px-4"
      style={{ background: '#161B22', borderBottom: '1px solid #1E293B' }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8 text-center">
          {STATS.map((stat) => (
            <div key={stat.value}>
              <div
                className="text-3xl font-extrabold mb-1"
                style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", color: '#FF6B2B' }}
              >
                {stat.value}
              </div>
              <div className="text-xs leading-snug whitespace-pre-line" style={{ color: '#64748B' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
