import { headers } from 'next/headers';
import Image from 'next/image';
import { SRELogo } from '@/components/brand/SRELogo';

/**
 * Auth layout — tenant-aware branding.
 * If the tenant has a custom logo/colors, show them on the login page.
 * Otherwise, show the default SREonCall branding.
 */

const BASE_DOMAINS = ['dev-web.sreoncall.com', 'web.sreoncall.com', 'sreoncall.com', 'localhost'];

function extractSlugAndDomain(host: string) {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (BASE_DOMAINS.includes(h)) return { slug: 'platform', domain: '' };
  for (const base of BASE_DOMAINS) {
    if (h.endsWith('.' + base)) {
      return { slug: h.slice(0, -(base.length + 1)).split('.')[0] || 'platform', domain: '' };
    }
  }
  // Custom domain — extract first subdomain as slug guess, pass full domain
  const parts = h.split('.');
  return { slug: parts.length >= 3 ? parts[0] : '', domain: h };
}

interface TenantBranding {
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
}

interface LoginStatusPage {
  slug: string;
  name: string;
}

async function getTenantBranding(slug: string, domain: string): Promise<{ branding: TenantBranding | null; tenant_name?: string; white_label?: boolean; login_status_page?: LoginStatusPage | null }> {
  try {
    const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const params = new URLSearchParams();
    if (slug) params.set('slug', slug);
    if (domain) params.set('domain', domain);
    const res = await fetch(`${apiUrl}/api/v1/public/tenant-branding?${params}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return { branding: null };
    return await res.json();
  } catch {
    return { branding: null };
  }
}

const featurePills: { label: string; tint: 'orange' | 'blue' }[] = [
  { label: 'Tickets', tint: 'orange' },
  { label: 'Incidents', tint: 'orange' },
  { label: 'Observability', tint: 'blue' },
];

const complianceBadges = ['SOC2', 'ISO', '99.99% UP'];

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || '';
  const { slug, domain } = extractSlugAndDomain(host);

  const { branding, tenant_name, white_label, login_status_page } = await getTenantBranding(slug, domain);
  const hasCustomBranding = !!(branding?.logo_url || (branding?.primary_color && branding.primary_color !== '#4F46E5'));
  const primaryColor = branding?.primary_color || '#FF6B2B';
  const accentColor = branding?.accent_color || '#1E3A5F';
  const hideProviderBranding = !!white_label;

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden rounded-[16px]"
        style={{
          background: hasCustomBranding
            ? `linear-gradient(135deg, #0D1117 0%, #111827 40%, ${accentColor} 100%)`
            : 'linear-gradient(135deg, #0D1117 0%, #111827 40%, #1E3A5F 100%)',
        }}
      >
        <div className="absolute inset-0 grid-overlay opacity-20" />
        <div className="absolute right-0 top-0 bottom-0 w-1/3 dot-texture-dark opacity-80" />

        <div className="relative z-10 flex flex-col justify-center m-5 flex-1 rounded-[12px] bg-white/[0.03] px-16 xl:px-20">
          {/* Logo — tenant or SREonCall */}
          <div className="mb-8">
            {hasCustomBranding && branding?.logo_url ? (
              <div className="inline-block rounded-xl bg-white/95 px-6 py-4 shadow-lg">
                <Image
                  src={branding.logo_url}
                  alt={tenant_name || 'Logo'}
                  width={260}
                  height={56}
                  className="object-contain"
                  style={{ maxHeight: 56 }}
                  unoptimized
                />
              </div>
            ) : (
              <SRELogo width={220} />
            )}
          </div>

          {/* Tagline */}
          {hasCustomBranding ? (
            <>
              <p className="text-[24px] font-bold text-white mb-3">
                {tenant_name || 'Welcome'}
              </p>
              <p className="text-[14px] text-white/70 mb-10">
                Monitoring &amp; Incident Management
              </p>
            </>
          ) : (
            <>
              <p className="text-[18px] font-bold text-white mb-2">
                24&times;7 SRE Operations
              </p>
              <p className="text-[12px] text-white/50 mb-8">
                Monitor. Respond. Resolve. Repeat.
              </p>
            </>
          )}

          {/* Feature pills */}
          <div className="flex flex-wrap gap-3 mb-8">
            {featurePills.map((pill) => (
              <span
                key={pill.label}
                className="inline-flex items-center rounded-[5px] px-4 py-1 text-[10px] font-semibold"
                style={{
                  background: pill.tint === 'orange'
                    ? 'rgba(255,107,43,0.15)'
                    : 'rgba(37,99,235,0.15)',
                  border: `1px solid ${pill.tint === 'orange'
                    ? 'rgba(255,107,43,0.3)'
                    : 'rgba(37,99,235,0.3)'}`,
                  color: pill.tint === 'orange' ? '#FF8F4F' : '#60A5FA',
                }}
              >
                {pill.label}
              </span>
            ))}
          </div>

          {/* Trust section */}
          <p className="text-[10px] text-white/40 mb-3">
            Trusted by 100+ teams
          </p>
          <div className="flex items-center gap-2 mb-10">
            {complianceBadges.map((badge) => (
              <span
                key={badge}
                className="inline-flex items-center justify-center rounded-[4px] bg-white/10 px-3 py-1 text-[8px] text-white/60"
              >
                {badge}
              </span>
            ))}
          </div>

          {/* Status page link — on left panel with branding */}
          {login_status_page && (
            <a
              href={`/status/${login_status_page.slug}`}
              className="inline-flex items-center gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 hover:bg-emerald-500/20 transition-colors group"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[12px] font-medium text-emerald-300 group-hover:text-emerald-200">
                System Status
              </span>
            </a>
          )}

          {/* SREonCall branding — hidden when white-label is enabled */}
          {!hideProviderBranding && (
            <a
              href="https://www.sreoncall.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-lg bg-white/[0.06] border border-white/10 px-4 py-2.5 hover:bg-white/10 transition-colors group"
            >
              <span className="text-[11px] font-medium text-white/60 group-hover:text-white/80">Powered by</span>
              <SRELogo width={90} />
            </a>
          )}
        </div>
      </div>

      {/* Right panel — form area */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-white dark:bg-navy-surface px-6 py-12">
        <div className="w-full max-w-[510px] space-y-8">
          {/* Mobile-only logo */}
          <div className="flex flex-col items-center lg:hidden">
            {hasCustomBranding && branding?.logo_url ? (
              <div className="mb-4 inline-block rounded-lg bg-slate-50 px-5 py-3">
                <Image
                  src={branding.logo_url}
                  alt={tenant_name || 'Logo'}
                  width={180}
                  height={44}
                  className="object-contain"
                  style={{ maxHeight: 44 }}
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <SRELogo width={140} />
              </div>
            )}
            <p className="text-sm text-[#64748B]">
              Sign in to your workspace
            </p>
          </div>
          {children}

          {/* Legal links */}
          <div className="mt-6 flex justify-center gap-4 text-[11px] text-[#94A3B8]">
            <a href="/privacy" className="hover:text-[#64748B] hover:underline">Privacy Policy</a>
            <span>&middot;</span>
            <a href="/terms" className="hover:text-[#64748B] hover:underline">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  );
}
