'use client';

import type { LucideIcon } from 'lucide-react';

interface PartnerPageProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared page chrome for /partner/* routes. Light theme per design.svg:
 * - Page bg #F8FAFC, white cards with #E2E8F0 borders + subtle shadow
 * - Primary text #0F172A, secondary #64748B, muted #94A3B8
 * - Orange accent #FF6B2B, dark sidebar remains (#0D1117 → #161B22)
 */
export function PartnerPage({ title, subtitle, icon: Icon, actions, children }: PartnerPageProps) {
  return (
    <div className="min-h-full bg-[#F8FAFC]">
      <div className="mx-auto max-w-7xl px-6 py-8 md:px-8 md:py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              {Icon ? (
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF3ED]">
                  <Icon size={19} className="text-[#FF6B2B]" />
                </span>
              ) : null}
              <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">{title}</h1>
            </div>
            {subtitle ? (
              <p className="mt-1.5 text-sm text-[#64748B]">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>

        <div className="space-y-8">{children}</div>
      </div>
    </div>
  );
}

/** Standard card container for sections within a PartnerPage. */
export function PartnerCard({
  children,
  className = '',
  padding = 'p-5',
}: {
  children: React.ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-white border border-[#E2E8F0] shadow-[0_2px_8px_rgba(15,23,42,0.04)] ${padding} ${className}`}
    >
      {children}
    </div>
  );
}

/** Stat chip used on dashboard / commissions pages. */
export function PartnerStat({
  label,
  value,
  highlight = false,
  icon: Icon,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl p-5 bg-white border border-[#E2E8F0] shadow-[0_2px_8px_rgba(15,23,42,0.04)] h-[112px] flex flex-col justify-center">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-2xl font-bold leading-tight"
            style={{ color: highlight ? '#FF6B2B' : '#0F172A' }}
          >
            {value}
          </p>
          <p className="text-xs text-[#64748B] mt-1.5 font-medium">{label}</p>
        </div>
        {Icon ? (
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF3ED]">
            <Icon size={16} className="text-[#FF6B2B]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Section header inside a page. */
export function PartnerSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-[#0F172A]">{title}</h2>
        {description ? (
          <p className="text-xs text-[#64748B] mt-0.5">{description}</p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

/** Mascot illustration helper. `variant` picks the asset. */
export function PartnerMascot({
  variant = 'happy',
  size = 120,
  className = '',
  opacity = 1,
}: {
  variant?: 'happy' | 'stand';
  size?: number;
  className?: string;
  opacity?: number;
}) {
  const src = variant === 'stand' ? '/mascot/mascot-stand.png' : '/mascot/mascot-happy.png';
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ opacity }}
      className={`select-none pointer-events-none ${className}`}
    />
  );
}
