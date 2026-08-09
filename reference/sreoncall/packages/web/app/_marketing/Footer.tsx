// packages/web/app/_marketing/Footer.tsx
import Link from 'next/link';
import { SRELogo } from '@/components/brand/SRELogo';

const FOOTER_COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Partners',
    links: [
      { label: 'Referral programme', href: '/contact?track=referral' },
      { label: 'Reseller programme', href: '/contact?track=reseller' },
      { label: 'MSP programme', href: '/contact?track=msp' },
      { label: 'Partner Portal', href: '/partner/login' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of service', href: '/terms' },
      { label: 'GDPR', href: '/privacy#gdpr' },
      { label: 'DPA', href: '/privacy#dpa' },
    ],
  },
] as const;

export default function Footer() {
  return (
    <footer style={{ background: '#0D1117', borderTop: '1px solid #1E293B' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {FOOTER_COLS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: '#64748B' }}>
                {col.heading}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors hover:text-[#94A3B8]"
                      style={{ color: '#64748B' }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between pt-8" style={{ borderTop: '1px solid #1E293B' }}>
          <SRELogo width={100} branded />
          <p className="text-xs mt-4 md:mt-0" style={{ color: '#64748B' }}>
            © 2026 SREonCall. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
