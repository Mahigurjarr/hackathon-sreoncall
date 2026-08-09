// packages/web/app/_marketing/Nav.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SRELogo } from '@/components/brand/SRELogo';
import { Menu, X } from 'lucide-react';

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-200"
      style={{
        background: scrolled ? 'rgba(13,17,23,0.95)' : '#0D1117',
        borderBottom: scrolled ? '1px solid #1E293B' : '1px solid transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
      }}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" aria-label="SREonCall home">
          <SRELogo width={120} branded />
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {[
            { label: 'Features', href: '/#features' },
            { label: 'Pricing', href: '/pricing' },
            { label: 'Partners', href: '/contact?track=partner' },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm text-[#94A3B8] hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/signin"
            className="text-sm text-[#94A3B8] hover:text-white transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm font-semibold text-white px-4 py-2 rounded-lg transition-colors"
            style={{ background: '#FF6B2B' }}
          >
            Sign Up
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="md:hidden text-[#94A3B8] hover:text-white"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#1E293B] px-4 py-4 space-y-3" style={{ background: '#0D1117' }}>
          {[
            { label: 'Features', href: '/#features' },
            { label: 'Pricing', href: '/pricing' },
            { label: 'Partners', href: '/contact?track=partner' },
            { label: 'Sign in', href: '/signin' },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="block text-sm text-[#94A3B8] hover:text-white py-2"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/signup"
            className="block text-sm font-semibold text-white text-center px-4 py-2.5 rounded-lg"
            style={{ background: '#FF6B2B' }}
            onClick={() => setMobileOpen(false)}
          >
            Sign Up
          </Link>
        </div>
      )}
    </header>
  );
}
