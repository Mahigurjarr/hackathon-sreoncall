'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Flag,
  Settings,
  ClipboardList,
  Activity,
  KeyRound,
  Network,
  Bot,
  UserPlus,
  Ticket,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui.store';
import { SRELogo } from '@/components/brand/SRELogo';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard',     href: '/admin',              icon: LayoutDashboard },
  { label: 'Tenants',       href: '/admin/tenants',      icon: Building2 },
  { label: 'Onboarding',    href: '/admin/onboarding',   icon: UserPlus },
  { label: 'All Users',     href: '/admin/users',        icon: Users },
  { label: 'Provider Map',  href: '/admin/provider-map', icon: Network },
  { label: 'Plans',            href: '/admin/plans',             icon: CreditCard },
  { label: 'Activation Codes', href: '/admin/activation-codes', icon: Ticket },
  { label: 'Feature Flags',    href: '/admin/feature-flags',    icon: Flag },
  { label: 'Agent Catalog', href: '/admin/agent-catalog', icon: Bot },
  { label: 'Config',        href: '/admin/config',       icon: Settings },
  { label: 'Audit Log',     href: '/admin/audit-log',    icon: ClipboardList },
  { label: 'System',        href: '/admin/health',       icon: Activity },
  { label: 'Credentials',   href: '/admin/credentials',  icon: KeyRound },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <>
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 lg:relative lg:z-auto',
          'bg-gradient-to-b from-[#0D1117] to-[#161B22] border-r border-white/[0.04]',
          sidebarCollapsed ? 'w-16' : 'w-[250px]',
          sidebarCollapsed ? '-translate-x-full lg:translate-x-0' : 'translate-x-0',
        )}
      >
        {/* Logo + platform label */}
        <div className="shrink-0 border-b border-[#1E293B] px-4 py-3">
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <SRELogo width={sidebarCollapsed ? 36 : 110} />
          </div>
          {!sidebarCollapsed && (
            <p className="mt-1 text-[11px] text-[#475569]">Super Admin Console</p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          {ADMIN_NAV.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/admin' && pathname.startsWith(item.href + '/'));
            const Icon = item.icon;

            if (sidebarCollapsed) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cn(
                    'mb-1 flex justify-center rounded-lg p-2 transition-colors',
                    isActive
                      ? 'bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]'
                      : 'text-[#E2E8F0] hover:bg-white/[0.04] hover:text-white',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative mb-0.5 flex items-center gap-3 rounded-[7px] px-3 py-2 text-[12px] transition-all duration-150',
                  isActive
                    ? 'bg-[rgba(255,107,43,0.12)] text-[#FF6B2B] font-semibold'
                    : 'text-[#E2E8F0] hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[34px] bg-[#FF6B2B] rounded-r-[2px]" />
                )}
                <Icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'opacity-100' : 'opacity-80')} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer: collapse */}
        <div className="shrink-0 border-t border-[#1E293B] p-3">
          <button
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center rounded-lg p-2 text-[#64748B] transition-colors hover:bg-white/[0.04] hover:text-[#94A3B8]"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
