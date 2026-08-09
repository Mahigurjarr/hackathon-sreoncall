import Image from 'next/image';
import { CheckCircle2, AlertTriangle, XCircle, Wrench, Info, AlertOctagon } from 'lucide-react';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';
import { SubscribeForm } from './SubscribeForm';
import { ServiceList } from './ServiceList';

interface StatusComponent {
  name: string;
  description: string;
  status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
  uptime_24h?: number;
  uptime_7d?: number;
  uptime_30d?: number;
  uptime_90d?: number;
}

interface ActiveIncident {
  id: string;
  title: string;
  severity: number;
  status: string;
  created_at: string;
  source: string;
}

interface StatusUpdatePublic {
  id: string;
  title: string;
  body: string;
  status: string;
  affected_components: Array<{ name: string; status_before: string; status_after: string }>;
  created_at: string;
}

interface CustomAnnouncement {
  enabled: boolean;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'critical';
}

interface TenantBranding {
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
}

interface PublicStatusPage {
  slug: string;
  name: string;
  description: string;
  components: StatusComponent[];
  settings?: {
    branding?: {
      primary_color?: string;
      custom_domain?: string;
    };
    display_options?: {
      show_incidents: boolean;
      show_weekly_summary: boolean;
      show_rca_followups: boolean;
    };
  };
  tenant_branding?: TenantBranding;
  custom_announcement?: CustomAnnouncement;
  recent_updates?: StatusUpdatePublic[];
  active_incidents?: ActiveIncident[];
  updated_at: string;
}

// ---- Status config maps ----

const statusLabels: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Maintenance',
};

const statusPillStyles: Record<string, string> = {
  operational: 'bg-success/10 text-success border-success/20',
  degraded: 'bg-warning/10 text-warning border-warning/20',
  partial_outage: 'bg-brand/10 text-brand border-brand/20',
  major_outage: 'bg-error/10 text-error border-error/20',
  maintenance: 'bg-info/10 text-info border-info/20',
};

const statusDotStyles: Record<string, string> = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  partial_outage: 'bg-brand',
  major_outage: 'bg-error',
  maintenance: 'bg-info',
};

const updateStatusConfig: Record<string, { label: string; pillClass: string; dotClass: string }> = {
  investigating: { label: 'Investigating', pillClass: 'bg-error/10 text-error border-error/20', dotClass: 'bg-error' },
  identified: { label: 'Identified', pillClass: 'bg-warning/10 text-warning border-warning/20', dotClass: 'bg-warning' },
  monitoring: { label: 'Monitoring', pillClass: 'bg-info/10 text-info border-info/20', dotClass: 'bg-info' },
  resolved: { label: 'Resolved', pillClass: 'bg-success/10 text-success border-success/20', dotClass: 'bg-success' },
  informational: { label: 'Informational', pillClass: 'bg-brand/10 text-brand border-brand/20', dotClass: 'bg-brand' },
};

const announcementStyles = {
  info: { border: 'border-info/20', bg: 'bg-info/5', icon: Info, iconClass: 'text-info' },
  warning: { border: 'border-warning/20', bg: 'bg-warning/5', icon: AlertTriangle, iconClass: 'text-warning' },
  critical: { border: 'border-error/20', bg: 'bg-error/5', icon: AlertOctagon, iconClass: 'text-error' },
};

function getOverallStatus(components: StatusComponent[]) {
  if (components.some((c) => c.status === 'major_outage')) return 'major_outage';
  if (components.some((c) => c.status === 'partial_outage')) return 'partial_outage';
  if (components.some((c) => c.status === 'degraded')) return 'degraded';
  if (components.some((c) => c.status === 'maintenance')) return 'maintenance';
  return 'operational';
}

const overallConfig = {
  operational: {
    text: 'All Systems Operational',
    icon: CheckCircle2,
    iconClass: 'text-success',
    bgClass: 'bg-success/5 border-success/15',
    textClass: 'text-success',
  },
  degraded: {
    text: 'Some Systems Experiencing Issues',
    icon: AlertTriangle,
    iconClass: 'text-warning',
    bgClass: 'bg-warning/5 border-warning/15',
    textClass: 'text-warning',
  },
  partial_outage: {
    text: 'Partial System Outage',
    icon: AlertTriangle,
    iconClass: 'text-brand',
    bgClass: 'bg-brand/5 border-brand/15',
    textClass: 'text-brand',
  },
  major_outage: {
    text: 'Major System Outage',
    icon: XCircle,
    iconClass: 'text-error',
    bgClass: 'bg-error/5 border-error/15',
    textClass: 'text-error',
  },
  maintenance: {
    text: 'Scheduled Maintenance',
    icon: Wrench,
    iconClass: 'text-info',
    bgClass: 'bg-info/5 border-info/15',
    textClass: 'text-info',
  },
};

// ---- Uptime bar visualization ----

function UptimeBars({ status, uptime }: { status: string; uptime?: number }) {
  const bars = Array.from({ length: 30 }, (_, i) => {
    if (status === 'maintenance') return 'bg-info/60';
    if (uptime == null) return 'bg-muted-foreground/10';
    const threshold = (1 - (uptime / 100)) * 30;
    if (i >= 30 - Math.ceil(threshold)) {
      return statusDotStyles[status] || 'bg-warning/60';
    }
    return 'bg-success/60';
  });

  return (
    <div className="flex items-end gap-[2px] h-5">
      {bars.map((color, i) => (
        <div
          key={i}
          className={cn('w-[3px] rounded-sm transition-all', color)}
          style={{ height: `${8 + ((i * 7) % 12)}px` }}
        />
      ))}
    </div>
  );
}

function formatTimestamp(dateStr: string) {
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) +
    ' UTC'
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---- Data fetching ----

async function getStatusPage(slug: string, viewerEmail?: string): Promise<PublicStatusPage | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const params = new URLSearchParams();
    if (viewerEmail) params.set('viewer_email', viewerEmail);
    const qs = params.toString() ? `?${params}` : '';
    const res = await fetch(`${apiUrl}/api/v1/public/status-pages/${slug}${qs}`, {
      next: { revalidate: 15 },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to fetch');
    const json = await res.json();
    return json.data ?? json;
  } catch {
    return null;
  }
}

// ---- Fetch tenant branding for private gate ----

async function getTenantBrandingForSlug(slug: string): Promise<{ logo_url?: string; name?: string; primary_color?: string } | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const res = await fetch(`${apiUrl}/api/v1/public/tenant-branding?slug=${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = await res.json();
    return { logo_url: data.branding?.logo_url, name: data.tenant_name, primary_color: data.branding?.primary_color };
  } catch { return null; }
}

// ---- Private access gate ----

function PrivateAccessGate({ slug, brand }: { slug: string; brand?: { logo_url?: string; name?: string; primary_color?: string } | null }) {
  const color = brand?.primary_color || '#0F172A';
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="max-w-md w-full mx-4 text-center">
        <div className="mb-6">
          {brand?.logo_url ? (
            <div className="inline-block rounded-xl bg-slate-50 px-6 py-4 mb-4">
              <Image
                src={brand.logo_url}
                alt={brand.name || 'Logo'}
                width={200}
                height={48}
                className="object-contain"
                style={{ maxHeight: 48 }}
                unoptimized
              />
            </div>
          ) : (
            <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
          )}
          <h2 className="text-lg font-semibold text-slate-900">
            {brand?.name ? `${brand.name} Status` : 'Private Status Page'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">Enter your email to verify access</p>
        </div>
        <form method="GET" className="space-y-3">
          <input
            type="email"
            name="viewer_email"
            required
            placeholder="your@company.com"
            className="w-full h-10 rounded-lg border border-slate-200 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2"
            style={{ borderColor: 'rgb(226 232 240)', outlineColor: color }}
          />
          <button
            type="submit"
            className="w-full h-10 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: color }}
          >
            View Status Page
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-4">
          Access is restricted to authorized emails and domains
        </p>
      </div>
    </div>
  );
}

// ---- Page Component ----

export default async function PublicStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ viewer_email?: string }>;
}) {
  const { slug } = await params;
  const { viewer_email } = await searchParams;
  const page = await getStatusPage(slug, viewer_email);

  if (!page && !viewer_email) {
    // Could be private — show branded email gate
    const brand = await getTenantBrandingForSlug(slug);
    return <PrivateAccessGate slug={slug} brand={brand} />;
  }

  if (!page && viewer_email) {
    // Email was provided but access denied — show branded denial
    const brand = await getTenantBrandingForSlug(slug);
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="max-w-md w-full mx-4 text-center">
          {brand?.logo_url && (
            <div className="inline-block rounded-xl bg-slate-50 px-6 py-4 mb-4">
              <Image src={brand.logo_url} alt={brand.name || ''} width={200} height={48} className="object-contain" style={{ maxHeight: 48 }} unoptimized />
            </div>
          )}
          <div className="mx-auto h-12 w-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <XCircle className="h-6 w-6 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Access Denied</h2>
          <p className="text-sm text-slate-500 mt-1">
            {viewer_email} does not have access to this status page.
          </p>
          <a href={`/status/${slug}`} className="inline-block mt-4 text-sm text-blue-600 hover:underline">
            Try a different email
          </a>
        </div>
      </div>
    );
  }

  if (!page) {
    notFound();
  }

  const components = page.components ?? [];
  const overall = getOverallStatus(components);
  const activeIncidents = page.active_incidents ?? [];
  const cfg = overallConfig[overall];
  const OverallIcon = cfg.icon;
  const announcement = page.custom_announcement;
  const updates = page.recent_updates ?? [];
  const operationalCount = components.filter((c) => c.status === 'operational').length;

  // Tenant branding: use tenant logo + colors if available, else fall back to SREonCall defaults
  const tb = page.tenant_branding;
  const brandColor = page.settings?.branding?.primary_color || tb?.primary_color;
  const logoUrl = tb?.logo_url || '/logo/sreoncall-logo.png';
  const logoAlt = tb?.logo_url ? page.name : 'SREonCall';

  return (
    <div className="min-h-screen bg-white font-sans">
      <div className="max-w-[720px] mx-auto py-12 px-5">
        {/* Header with tenant branding */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <Image
            src={logoUrl}
            alt={logoAlt}
            width={tb?.logo_url ? 140 : 150}
            height={tb?.logo_url ? 40 : 48}
            className="shrink-0"
            style={tb?.logo_url ? { objectFit: 'contain', maxHeight: 40 } : { objectFit: 'contain', maxHeight: 48 }}
          />
          {!tb?.logo_url && (
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {page.name}
            </h1>
          )}
        </div>

        {/* Page name (shown below logo when tenant logo is used) */}
        {tb?.logo_url && (
          <h1 className="text-xl font-bold tracking-tight text-slate-900 text-center -mt-4 mb-2">
            {page.name}
          </h1>
        )}

        {page.description && (
          <p className="text-center text-sm text-slate-500 mb-8">{page.description}</p>
        )}

        {/* Announcement banner */}
        {announcement?.enabled && announcement.title && (() => {
          const aStyle = announcementStyles[announcement.type] || announcementStyles.info;
          const AIcon = aStyle.icon;
          return (
            <div
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 mb-5',
                aStyle.border,
                aStyle.bg,
              )}
            >
              <AIcon className={cn('h-4 w-4 shrink-0 mt-0.5', aStyle.iconClass)} />
              <div>
                <p className="text-sm font-semibold text-slate-900">{announcement.title}</p>
                {announcement.body && (
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {announcement.body}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Hero status card */}
        <div
          className={cn(
            'rounded-xl border p-8 text-center mb-5',
            cfg.bgClass,
          )}
          style={brandColor && overall === 'operational' ? {
            borderColor: `${brandColor}20`,
            backgroundColor: `${brandColor}08`,
          } : undefined}
        >
          <OverallIcon className={cn('h-10 w-10 mx-auto mb-3', cfg.iconClass)} />
          <div className={cn('text-xl font-bold tracking-tight', cfg.textClass)}>
            {cfg.text}
          </div>
          <div className="text-xs text-slate-400 mt-2 font-mono">
            Updated {timeAgo(page.updated_at)} &middot; {operationalCount}/{components.length} up
          </div>
        </div>

        {/* Active incidents — live open incidents tied to the page's components */}
        {activeIncidents.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 px-1">
              Active Incidents
            </h2>
            <div className="rounded-xl border border-rose-200 bg-rose-50/40 overflow-hidden shadow-sm">
              {activeIncidents.map((inc, i) => {
                const isLast = i === activeIncidents.length - 1;
                const sevLabel = `SEV${inc.severity}`;
                return (
                  <div
                    key={inc.id}
                    className={cn('flex items-start gap-3 px-5 py-3.5', !isLast && 'border-b border-rose-100')}
                  >
                    <AlertOctagon className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="inline-flex items-center rounded-md bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          {sevLabel}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          {inc.status}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{timeAgo(inc.created_at)}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-900 leading-snug truncate">{inc.title}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Services — each row is expandable to show per-service incident history */}
        <ServiceList
          components={components}
          slug={slug}
          apiUrl={process.env.NEXT_PUBLIC_API_URL || ''}
          viewerEmail={viewer_email}
        />

        {/* Recent Updates */}
        {updates.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 px-1">
              Recent Updates
            </h2>
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              {updates.map((update, i) => {
                const uCfg = updateStatusConfig[update.status] || updateStatusConfig.informational;
                const isLast = i === updates.length - 1;
                return (
                  <div
                    key={update.id}
                    className={cn('flex gap-4 px-5 py-4', !isLast && 'border-b border-slate-100')}
                  >
                    {/* Timeline */}
                    <div className="flex flex-col items-center shrink-0 w-3 pt-1.5">
                      <div className={cn('h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-white', uCfg.dotClass)} />
                      {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1.5" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                            uCfg.pillClass,
                          )}
                        >
                          {uCfg.label}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {formatTimestamp(update.created_at)}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-slate-900">{update.title}</div>
                      {update.body && (
                        <div className="text-xs text-slate-500 leading-relaxed mt-1">
                          {update.body}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Subscribe */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 mb-8 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 mb-1">Stay notified</h2>
          <p className="text-xs text-slate-500 mb-5">
            Get notified when we post updates. Choose how you want to be reached.
          </p>
          <SubscribeForm slug={slug} />
        </div>

        {/* Footer */}
        <a
          href="https://sreoncall.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 opacity-60 hover:opacity-90 transition-opacity"
        >
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-medium">Powered by</span>
          <Image
            src="/logo/sreoncall-logo.png"
            alt="SREonCall"
            width={120}
            height={38}
            className="inline-block"
          />
        </a>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getStatusPage(slug);
  return {
    title: page ? `${page.name} Status` : 'Status Page',
    description: page?.description ?? 'Service status page',
  };
}
