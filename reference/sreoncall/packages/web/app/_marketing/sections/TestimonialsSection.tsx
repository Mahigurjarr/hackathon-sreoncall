// packages/web/app/_marketing/sections/TestimonialsSection.tsx
import { TESTIMONIALS } from '../data/homepage';

export default function TestimonialsSection() {
  return (
    <section className="py-20 px-4" style={{ background: '#F8F9FA' }}>
      <div className="max-w-6xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3 text-center" style={{ color: '#FF6B2B' }}>
          What Teams Say
        </p>
        <h2 className="text-3xl font-extrabold text-center mb-14" style={{ color: '#0D1117' }}>
          Built for the SRE who's done firefighting.
        </h2>

        <div className="grid sm:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.company}
              className="rounded-xl p-8"
              style={{ background: '#fff', border: '1px solid #E9ECEF' }}
            >
              <p
                className="text-4xl font-black mb-4 leading-none"
                style={{ color: '#FF6B2B' }}
              >
                "
              </p>
              <p className="text-base leading-relaxed mb-6" style={{ color: '#374151' }}>
                {t.quote}
              </p>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#0D1117' }}>{t.name}</p>
                <p className="text-xs" style={{ color: '#64748B' }}>{t.company}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
