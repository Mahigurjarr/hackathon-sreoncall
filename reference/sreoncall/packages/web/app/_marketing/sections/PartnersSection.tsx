// packages/web/app/_marketing/sections/PartnersSection.tsx
import Link from 'next/link';
import { PARTNER_TRACKS } from '../data/homepage';

export default function PartnersSection() {
  return (
    <section id="partners" className="py-20 px-4" style={{ background: '#0D1117' }}>
      <div className="max-w-6xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3 text-center" style={{ color: '#FF6B2B' }}>
          Partner Programme
        </p>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-3 text-white">
          Build your SRE practice on SREonCall.
        </h2>
        <p className="text-center mb-14" style={{ color: '#64748B' }}>
          Three tracks. Different obligations, different rewards.
        </p>

        <div className="grid sm:grid-cols-3 gap-6">
          {PARTNER_TRACKS.map((track) => (
            <div
              key={track.badge}
              className="rounded-xl p-7"
              style={{ background: '#161B22', border: `1px solid ${track.primary ? '#FF6B2B' : '#1E293B'}` }}
            >
              <span
                className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-4"
                style={{ background: track.badgeColor + '22', color: track.badgeColor }}
              >
                {track.badge}
              </span>
              <h3 className="font-bold text-base mb-2 text-white">{track.title}</h3>
              <p className="text-sm leading-relaxed mb-4" style={{ color: '#64748B' }}>
                {track.description}
              </p>
              <p className="text-xs font-semibold mb-6" style={{ color: '#FF6B2B' }}>
                {track.earnings}
              </p>
              <Link
                href={track.ctaHref}
                className="block text-center text-sm font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90"
                style={
                  track.primary
                    ? { background: '#FF6B2B', color: '#fff' }
                    : { border: '1px solid #FF6B2B', color: '#FF6B2B' }
                }
              >
                {track.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
