// packages/web/app/_marketing/sections/CtaFooter.tsx
import Link from 'next/link';

export default function CtaFooter() {
  return (
    <section className="py-24 px-4 text-center" style={{ background: '#FF6B2B' }}>
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 leading-tight">
          Start free.
          <br />
          No credit card required.
        </h2>
        <p className="text-lg mb-10" style={{ color: 'rgba(255,255,255,0.8)' }}>
          Join engineering teams who replaced their entire SRE stack.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center px-8 py-3.5 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
            style={{ background: '#fff', color: '#FF6B2B' }}
          >
            Start for free
          </Link>
          <Link
            href="/contact?demo=1"
            className="inline-flex items-center justify-center px-8 py-3.5 rounded-lg text-sm font-bold transition-colors hover:bg-white/10"
            style={{ border: '2px solid rgba(255,255,255,0.6)', color: '#fff' }}
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}
