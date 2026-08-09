// packages/web/app/_marketing/sections/ProblemSection.tsx
import { Layers, BellOff, FileX } from 'lucide-react';
import { PROBLEMS } from '../data/homepage';

const ICONS = { layers: Layers, 'bell-off': BellOff, 'file-x': FileX } as const;

export default function ProblemSection() {
  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3 text-center" style={{ color: '#FF6B2B' }}>
          The Problem
        </p>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-4" style={{ color: '#0D1117' }}>
          Your SRE stack is a patchwork.
        </h2>
        <p className="text-center text-lg mb-14" style={{ color: '#64748B' }}>
          And you're paying for every seam.
        </p>

        <div className="grid sm:grid-cols-3 gap-6 mb-14">
          {PROBLEMS.map((p) => {
            const Icon = ICONS[p.icon as keyof typeof ICONS];
            return (
              <div
                key={p.title}
                className="rounded-xl p-6"
                style={{ background: '#F8F9FA', border: '1px solid #E9ECEF' }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: '#FFF5F0' }}
                >
                  <Icon size={20} style={{ color: '#FF6B2B' }} />
                </div>
                <h3 className="font-bold text-base mb-2" style={{ color: '#0D1117' }}>
                  {p.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                  {p.description}
                </p>
              </div>
            );
          })}
        </div>

        <div
          className="rounded-xl py-5 px-8 text-center"
          style={{ background: '#0D1117' }}
        >
          <p className="font-bold text-lg" style={{ color: '#E2E8F0' }}>
            SREonCall replaces all of it.{' '}
            <span style={{ color: '#FF6B2B' }}>One platform. One price.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
