// packages/web/app/_marketing/sections/Hero.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Hero() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', email, company: '', track: 'hero' }),
      });
      if (res.status === 429) {
        setError('Too many requests. Please try again later.');
      } else {
        router.push(`/signup?email=${encodeURIComponent(email)}`);
      }
    } catch {
      router.push(`/signup?email=${encodeURIComponent(email)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="pt-32 pb-20 px-4 text-center"
      style={{ background: 'linear-gradient(160deg, #0D1117 0%, #161B22 60%, #0D1117 100%)' }}
    >
      <div className="max-w-4xl mx-auto">
        <p
          className="text-xs font-semibold tracking-[0.2em] uppercase mb-6"
          style={{ color: '#FF6B2B' }}
        >
          The All-in-One SRE Platform
        </p>

        <h1
          className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.15] mb-6"
          style={{ color: '#E2E8F0' }}
        >
          Your entire SRE stack.{' '}
          <span style={{ color: '#FF6B2B' }}>One flat price.</span>
        </h1>

        <p
          className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
          style={{ color: '#94A3B8' }}
        >
          Incidents · On-call · Observability · AI agents · Runbooks — unified.
          No per-host fees. No surprises. Cancel anytime.
        </p>

        {/* Email capture */}
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto mb-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your work email"
            required
            className="flex-1 px-4 py-3 rounded-lg text-sm outline-none"
            style={{
              background: '#161B22',
              border: '1px solid #334155',
              color: '#E2E8F0',
            }}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
            style={{ background: '#FF6B2B' }}
          >
            {loading ? 'Loading…' : 'Get started →'}
          </button>
        </form>

        {error && (
          <p className="text-xs mb-3" style={{ color: '#F87171' }}>{error}</p>
        )}

        <p className="text-xs mb-3" style={{ color: '#64748B' }}>
          Free plan available · No credit card required · 14-day trial on paid plans
        </p>

        <Link
          href="/contact?demo=1"
          className="text-xs hover:underline"
          style={{ color: '#64748B' }}
        >
          Book a demo instead
        </Link>
      </div>
    </section>
  );
}
