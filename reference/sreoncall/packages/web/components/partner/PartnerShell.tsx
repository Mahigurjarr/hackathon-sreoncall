'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BriefcaseBusiness,
  Coins,
  User,
  LogOut,
  Menu,
  ChevronLeft,
  ClipboardList,
  BookOpen,
  GraduationCap,
  Users,
  Building2,
  LifeBuoy,
  Handshake,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SRELogo } from '@/components/brand/SRELogo';
import type { PartnerData } from '@/lib/types/partner';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  section?: 'sell' | 'resources' | 'org';
}

const PARTNER_NAV: NavItem[] = [
  { label: 'Dashboard',    href: '/partner/dashboard',    icon: LayoutDashboard, section: 'sell' },
  { label: 'Deals',        href: '/partner/deals',        icon: BriefcaseBusiness, section: 'sell' },
  { label: 'Commissions',  href: '/partner/commissions',  icon: Coins, section: 'sell' },
  { label: 'Program',      href: '/partner/program',      icon: Handshake, section: 'resources' },
  { label: 'Resources',    href: '/partner/resources',    icon: BookOpen, section: 'resources' },
  { label: 'Training',     href: '/partner/training',     icon: GraduationCap, section: 'resources' },
  { label: 'Support',      href: '/partner/support',      icon: LifeBuoy, section: 'resources' },
  { label: 'Team',         href: '/partner/team',         icon: Users, section: 'org' },
  { label: 'Organization', href: '/partner/organization', icon: Building2, section: 'org' },
  { label: 'Profile',      href: '/partner/profile',      icon: User, section: 'org' },
];

const SECTION_LABELS: Record<NonNullable<NavItem['section']>, string> = {
  sell: 'Sell',
  resources: 'Enablement',
  org: 'Organization',
};

const ONBOARDING_NAV_ITEM: NavItem = { label: 'Onboarding', href: '/partner/onboarding', icon: ClipboardList };

interface PartnerShellProps {
  partnerData: PartnerData;
  children: React.ReactNode;
}

async function handleSignOut() {
  try {
    await fetch('/api/v1/partner-auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore logout fetch errors
  } finally {
    window.location.href = '/partner/login';
  }
}

export function PartnerShell({ partnerData, children }: PartnerShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const onboardingCompleted = partnerData.partner.onboardingCompleted;

  const partnerName = partnerData.partnerUser.name || 'Partner';
  const partnerCompany = partnerData.partner.company || '';

  const sidebar = (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.04] bg-gradient-to-b from-[#0D1117] to-[#161B22]">
      {/* Logo */}
      <div className="shrink-0 border-b border-[#1E293B] px-4 py-3">
        <div className="flex items-end justify-between">
          <div className="flex items-end">
            <SRELogo width={68} branded />
            <span className="text-[14px] font-bold text-[#FF6B2B] leading-none -mb-[1px]">
              Partner
            </span>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden flex items-center justify-center rounded-md p-1 text-[#64748B] hover:text-[#94A3B8]"
            aria-label="Close sidebar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[#475569]">Partner Portal</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3">
        {(() => {
          const items = onboardingCompleted ? PARTNER_NAV : [ONBOARDING_NAV_ITEM];
          let currentSection: NavItem['section'] | undefined;
          return items.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/partner' && pathname.startsWith(item.href + '/'));
            const Icon = item.icon;

            const showSectionHeader =
              onboardingCompleted && item.section && item.section !== currentSection;
            if (showSectionHeader) currentSection = item.section;

            return (
              <div key={item.href}>
                {showSectionHeader && (
                  <p className="mt-4 first:mt-0 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
                    {SECTION_LABELS[item.section!]}
                  </p>
                )}
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'relative mb-0.5 flex items-center gap-3 rounded-[7px] px-3 py-2 text-[12px] transition-all duration-150',
                    isActive
                      ? 'bg-[rgba(255,107,43,0.12)] text-[#FF6B2B] font-semibold'
                      : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#94A3B8]',
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[34px] bg-[#FF6B2B] rounded-r-[2px]" />
                  )}
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0',
                      isActive ? 'opacity-100' : 'opacity-80',
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                </Link>
              </div>
            );
          });
        })()}
      </nav>

      {/* Mascot — subtle branding per design.svg §08 */}
      <div className="shrink-0 flex justify-center pb-2 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mascot/mascot-happy.png"
          alt=""
          width={72}
          height={54}
          className="opacity-30 select-none pointer-events-none"
        />
      </div>

      {/* Sign out */}
      <div className="shrink-0 border-t border-[#1E293B] p-3">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-[7px] px-3 py-2 text-[12px] text-[#64748B] transition-colors hover:bg-white/[0.04] hover:text-[#94A3B8]"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0 opacity-80" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#0D1117]">
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — desktop: static flex item; mobile: fixed overlay */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 lg:static lg:z-auto lg:translate-x-0 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebar}
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: '#F8FAFC' }}>
        {/* Top bar */}
        <header className="shrink-0 flex items-center justify-between border-b border-[#E2E8F0] bg-white px-6 py-3">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden flex items-center justify-center rounded-md p-1 text-[#64748B] hover:text-[#94A3B8]"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[13px] font-medium text-[#0F172A] leading-tight">
                {partnerName}
              </p>
              {partnerCompany && (
                <p className="text-[11px] text-[#94A3B8] leading-tight">{partnerCompany}</p>
              )}
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,107,43,0.15)] text-[#FF6B2B] text-[13px] font-semibold">
              {partnerName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
