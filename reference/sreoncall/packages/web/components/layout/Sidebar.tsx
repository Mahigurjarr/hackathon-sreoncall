'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  LayoutDashboard,
  TicketCheck,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Siren,
  Server,
  Phone,
  GitPullRequest,
  BookOpen,
  Globe,
  FileText,
  Users,
  CreditCard,
  Lock,
  Puzzle,
  Webhook,
  ClipboardList,
  Zap,
  Users2,
  MessageSquare,
  Mic,
  GitBranch,
  BarChart3,
  FileSearch,
  Search,
  BellRing,
  Activity,
  Building2,
  Bell,
  Inbox,
  FolderKanban,
  Eye,
  LineChart,
  ScrollText,
  Network,
  Gauge,
  Link2,
  Share2,
  Brain,
  Monitor,
  Filter,
  Bot,
  CheckCircle,
  Shield,
  ShieldCheck,
  Radar,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui.store';
import { SRELogo } from '@/components/brand/SRELogo';
import { Mascot } from '@/components/brand/Mascot';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useCommsUnreadTotal } from '@/lib/hooks/useCommunications';

interface NavLeaf {
  type: 'leaf';
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  badgeColor?: 'brand' | 'error';
}

interface NavGroup {
  type: 'group';
  label: string;
  icon: LucideIcon;
  items: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function buildNav(openTickets?: number, activeIncidents?: number, tenantType?: string, commsUnread?: number): NavEntry[] {
  const nav: NavEntry[] = [
  {
    type: 'leaf',
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    type: 'leaf',
    label: 'Projects',
    href: '/projects',
    icon: FolderKanban,
  },
  {
    type: 'group',
    label: 'Reports',
    icon: BarChart3,
    items: [
      { type: 'leaf', label: 'Incident Analytics', href: '/reports/incident-analytics', icon: Siren },
      { type: 'leaf', label: 'Work Logs',          href: '/reports',                    icon: ClipboardList },
      { type: 'leaf', label: 'Incident Learning',  href: '/reports/incident-learning',  icon: BookOpen },
      { type: 'leaf', label: 'Alert Quality',      href: '/reports/alert-quality',      icon: BellRing },
      { type: 'leaf', label: 'Emerging Risks',     href: '/reports/emerging-risks',     icon: Activity },
      { type: 'leaf', label: 'Toil',               href: '/reports/toil',               icon: Zap },
    ],
  },
  {
    type: 'group',
    label: 'Services',
    icon: Server,
    items: [
      { type: 'leaf', label: 'Services',  href: '/services',          icon: Server },
      { type: 'leaf', label: 'Topology',  href: '/services/topology', icon: Network },
    ],
  },
  {
    type: 'leaf',
    label: 'Command Center',
    href: '/command-center',
    icon: Radar,
    badge: activeIncidents,
    badgeColor: 'error',
  },
  {
    type: 'group',
    label: 'Operations',
    icon: Zap,
    items: [
      { type: 'leaf', label: 'Incidents',     href: '/incidents',            icon: Siren,           badge: activeIncidents, badgeColor: 'error' },
      { type: 'leaf', label: 'Work Tickets',  href: '/tickets',              icon: TicketCheck,     badge: openTickets,     badgeColor: 'brand' },
      { type: 'leaf', label: 'Alerts',        href: '/alerts',              icon: BellRing },
      { type: 'leaf', label: 'Changes',       href: '/changes',             icon: GitPullRequest },
      { type: 'leaf', label: 'Runbooks',      href: '/runbooks',            icon: BookOpen },
      { type: 'leaf', label: 'Status Pages',  href: '/status-pages',        icon: Globe },
    ],
  },
  {
    type: 'group',
    label: 'On-Call',
    icon: Phone,
    items: [
      { type: 'leaf', label: 'On-Call',       href: '/on-call',             icon: Phone },
      { type: 'leaf', label: 'Escalation',    href: '/escalation-policies', icon: GitBranch },
      { type: 'leaf', label: 'Teams',         href: '/teams',               icon: Users2 },
    ],
  },
  {
    type: 'group',
    label: 'Observability',
    icon: Eye,
    items: [
      { type: 'leaf', label: 'Overview',         href: '/observability',           icon: Eye },
      { type: 'leaf', label: 'Metrics',          href: '/observability/metrics',   icon: LineChart },
      { type: 'leaf', label: 'Logs',             href: '/observability/logs',      icon: ScrollText },
      { type: 'leaf', label: 'Traces',           href: '/observability/traces',    icon: Network },
      { type: 'leaf', label: 'Synthetics',       href: '/observability/synthetics',icon: Activity },
      { type: 'leaf', label: 'SLOs',             href: '/observability/slos',      icon: Gauge },
      { type: 'leaf', label: 'Alert Rules',      href: '/observability/alerts',           icon: BellRing },
      { type: 'leaf', label: 'Topology',         href: '/observability/topology',         icon: Share2 },
      { type: 'leaf', label: 'Bandwidth',        href: '/observability/bandwidth-report', icon: BarChart3 },
      { type: 'leaf', label: 'LLM',              href: '/observability/llm',              icon: Brain },
      { type: 'leaf', label: 'RUM',              href: '/observability/rum',              icon: Monitor },
      { type: 'leaf', label: 'Pipelines',        href: '/observability/log-pipelines',    icon: Filter },
      { type: 'leaf', label: 'Dashboards',       href: '/dashboards',                     icon: BarChart3 },
      { type: 'leaf', label: 'Connect Stack',    href: '/observability/connect',          icon: Link2 },
    ],
  },
  {
    type: 'group',
    label: 'Collaborate',
    icon: MessageSquare,
    items: [
      { type: 'leaf', label: 'Communications',   href: '/communications',      icon: Inbox },
      { type: 'leaf', label: 'Post-Mortems',     href: '/postmortems',         icon: FileText },
      { type: 'leaf', label: 'Channels',         href: '/channels',            icon: MessageSquare },
      { type: 'leaf', label: 'AI Notetaker',     href: '/notetaker',           icon: Mic },
      { type: 'leaf', label: 'Notifications',    href: '/notifications',       icon: Bell },
    ],
  },
  ];

  // AI Agents group — visible to standalone + provider tenants
  if (tenantType !== 'consumer') {
    nav.push({
      type: 'group',
      label: 'AI Agents',
      icon: Bot,
      items: [
        { type: 'leaf', label: 'Agent Hub',       href: '/agents',             icon: Bot },
        { type: 'leaf', label: 'Marketplace',    href: '/agents/marketplace', icon: Zap },
        { type: 'leaf', label: 'Approvals',      href: '/agents/approvals',   icon: Shield },
      ],
    });
  }

  // Provider-specific navigation
  if (tenantType === 'provider') {
    nav.push({
      type: 'group',
      label: 'Provider',
      icon: Server,
      items: [
        { type: 'leaf', label: 'My Consumers',          href: '/consumers',                        icon: Users2 },
        { type: 'leaf', label: 'Communications',        href: '/consumers/communications',         icon: MessageSquare, badge: commsUnread, badgeColor: 'error' },
        { type: 'leaf', label: 'Consumer Incidents',    href: '/consumers/incidents',               icon: Siren },
        { type: 'leaf', label: 'Consumer Tickets',      href: '/consumers/tickets',                 icon: TicketCheck },
        { type: 'leaf', label: 'Consumer Changes',      href: '/consumers/changes',                 icon: GitPullRequest },
        { type: 'leaf', label: 'SLA Metrics',           href: '/consumers/sla',                     icon: BarChart3 },
        { type: 'leaf', label: 'Support Ops',        href: '/managed-support/dashboard', icon: Activity },
        { type: 'leaf', label: 'Support Contracts',  href: '/managed-support',          icon: ShieldCheck },
      ],
    });
  }

  const adminItems: NavLeaf[] = [
    { type: 'leaf', label: 'Org Members',   href: '/settings/team',        icon: Users },
    { type: 'leaf', label: 'General',       href: '/settings/general',     icon: Settings },
    { type: 'leaf', label: 'Auth',          href: '/settings/auth',        icon: Lock },
    { type: 'leaf', label: 'Billing',       href: '/settings/billing',     icon: CreditCard },
    { type: 'leaf', label: 'Integrations',  href: '/settings/integrations',icon: Puzzle },
    { type: 'leaf', label: 'Webhooks',      href: '/settings/webhooks',    icon: Webhook },
    { type: 'leaf', label: 'Audit Log',     href: '/settings/audit-log',   icon: ClipboardList },
    { type: 'leaf', label: 'Privacy',      href: '/settings/privacy',     icon: Shield },
    { type: 'leaf', label: 'Work Log Approvals', href: '/settings/work-log-approvals', icon: CheckCircle },
    { type: 'leaf', label: 'Service Map',        href: '/settings/service-map',        icon: Network },
    { type: 'leaf', label: 'Business Impact',    href: '/settings/business-impact',    icon: Building2 },
    { type: 'leaf', label: 'Validation Suites',  href: '/settings/validation-suites',  icon: FileSearch },
    { type: 'leaf', label: 'Migrations',         href: '/settings/migrations',         icon: GitBranch },
  ];

  // Consumer-specific: add work log approvals before Reports, and provider/comms/agent to admin
  if (tenantType === 'consumer') {
    const reportsIdx = nav.findIndex(
      (n) => (n as NavLeaf).href === '/reports' || (n as { label?: string }).label === 'Reports',
    );
    if (reportsIdx !== -1) {
      nav.splice(reportsIdx + 1, 0, ({
        type: 'leaf',
        label: 'Work Log Approvals',
        href: '/work-log-approvals',
        icon: CheckCircle,
      }) as NavLeaf);
    }
    nav.push({
      type: 'leaf',
      label: 'Managed Support',
      href: '/my-support',
      icon: ShieldCheck,
    } as NavLeaf);
    adminItems.push({ type: 'leaf', label: 'My Provider', href: '/settings/provider', icon: Server });
    adminItems.push({ type: 'leaf', label: 'Comm Channels', href: '/settings/communication-channels', icon: MessageSquare });
    adminItems.push({ type: 'leaf', label: 'Agent Activity', href: '/settings/agent-activity', icon: Activity });
    adminItems.push({ type: 'leaf', label: 'Agent Prefs', href: '/settings/agent-preferences', icon: Bot });
  }

  nav.push({
    type: 'group',
    label: 'Admin',
    icon: Settings,
    items: adminItems,
  });

  return nav;
}


function groupContainsPath(group: NavGroup, pathname: string): boolean {
  return group.items.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
  );
}

export function Sidebar({ tenantType }: { tenantType?: string }) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { data: session } = useSession();
  const { data: currentUser } = useCurrentUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const isPlatformAdmin = (session?.user as any)?.role === 'platform_admin';

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // Fetch live counts for sidebar badges
  const { data: dashStats } = useQuery<{ open_tickets: number; active_incidents: number }>({
    queryKey: ['sidebar-stats'],
    queryFn: () => api.get('/api/v1/dashboard/stats'),
    refetchInterval: 15000, // refresh every 15s for near real-time
    staleTime: 10000,
  });

  const { data: commsData } = useCommsUnreadTotal();
  const commsUnread = tenantType === 'provider' ? (commsData as any)?.total || 0 : 0;

  const navEntries = useMemo(() => {
    const nav = buildNav(dashStats?.open_tickets, dashStats?.active_incidents, tenantType, commsUnread);
    if (isPlatformAdmin) {
      nav.push({
        type: 'leaf',
        label: 'Admin Console',
        href: '/admin',
        icon: Shield,
      });
    }
    return nav;
  }, [isPlatformAdmin, dashStats?.open_tickets, dashStats?.active_incidents, tenantType, commsUnread]);

  // Filter nav entries based on search query
  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return navEntries;
    return navEntries.reduce<NavEntry[]>((acc, entry) => {
      if (entry.type === 'leaf') {
        if (entry.label.toLowerCase().includes(q)) acc.push(entry);
      } else {
        const matchingItems = entry.items.filter((item) =>
          item.label.toLowerCase().includes(q)
        );
        if (entry.label.toLowerCase().includes(q)) {
          acc.push(entry); // group label matches — show all items
        } else if (matchingItems.length > 0) {
          acc.push({ ...entry, items: matchingItems });
        }
      }
      return acc;
    }, []);
  }, [navEntries, searchQuery]);

  // Auto-expand groups that contain the active path
  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const entry of navEntries) {
        if (entry.type === 'group' && groupContainsPath(entry, pathname)) {
          next[entry.label] = true;
        }
      }
      return next;
    });
  }, [pathname, navEntries]);

  return (
    <>
      {/* Mobile overlay */}
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        data-testid="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 lg:relative lg:z-auto',
          'bg-gradient-to-b from-navy-900 to-navy-surface border-r border-white/[0.04]',
          sidebarCollapsed ? 'w-16' : 'w-[250px]',
          sidebarCollapsed ? '-translate-x-full lg:translate-x-0' : 'translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="shrink-0 border-b border-[#1E293B] px-4 py-4">
          <div className={cn('flex items-center', sidebarCollapsed ? 'justify-center' : '')}>
            <SRELogo width={sidebarCollapsed ? 32 : 210} mark />
          </div>
          {!sidebarCollapsed && currentUser?.tenant?.name && (
            <p className="mt-2 truncate text-center text-[11px] font-medium tracking-wide text-[#94A3B8]">
              {currentUser.tenant.name}
            </p>
          )}
        </div>


        {/* Search */}
        {!sidebarCollapsed && (
          <div className="shrink-0 px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search features..."
                className="h-8 w-full rounded-md border border-white/10 bg-white/[0.04] pl-8 pr-7 text-[12px] text-[#E2E8F0] placeholder:text-[#64748B] focus:border-[#FF6B2B]/50 focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#94A3B8]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          {searchQuery && filteredEntries.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-[#64748B] text-center">No results for &ldquo;{searchQuery}&rdquo;</p>
          )}
          {filteredEntries.map((entry) => {
            if (entry.type === 'leaf') {
              const isActive =
                pathname === entry.href || pathname.startsWith(entry.href + '/');
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  data-testid="nav-item"
                  title={sidebarCollapsed ? entry.label : undefined}
                  className={cn(
                    'relative mb-0.5 flex items-center gap-3 rounded-[7px] px-3 py-2 text-[13px] transition-all duration-150',
                    isActive
                      ? 'bg-[rgba(255,107,43,0.12)] text-[#FF6B2B] font-semibold'
                      : 'text-[#E2E8F0] hover:bg-white/[0.06] hover:text-white',
                    sidebarCollapsed && 'justify-center px-2',
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[34px] bg-[#FF6B2B] rounded-r-[2px]" />
                  )}
                  <Icon className={cn('h-[19px] w-[19px] shrink-0', isActive ? 'opacity-100' : 'opacity-90')} />
                  {!sidebarCollapsed && (
                    <span className="flex-1">{entry.label}</span>
                  )}
                </Link>
              );
            }

            // Group — per design spec: always visible, no collapse toggle
            const isGroupActive = groupContainsPath(entry, pathname);

            if (sidebarCollapsed) {
              return (
                <Link
                  key={entry.label}
                  href={entry.items[0].href}
                  title={entry.label}
                  className={cn(
                    'mb-1 flex justify-center rounded-lg p-2 transition-colors',
                    isGroupActive
                      ? 'bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]'
                      : 'text-[#E2E8F0] hover:bg-white/[0.06] hover:text-white',
                  )}
                >
                  <entry.icon className="h-[18px] w-[18px] shrink-0" />
                </Link>
              );
            }

            // Find the longest matching href within this group so only one item highlights
            const activeHref = entry.items.reduce<string | null>((best, item) => {
              const matches = pathname === item.href || pathname.startsWith(item.href + '/');
              if (matches && (!best || item.href.length > best.length)) {
                return item.href;
              }
              return best;
            }, null);

            const isCollapsed = !expandedGroups[entry.label] && !searchQuery;

            return (
              <div key={entry.label}>
                {/* Section label — clickable to toggle collapse */}
                <button
                  onClick={() => toggleGroup(entry.label)}
                  className="mt-4 mb-1 flex w-full items-center justify-between px-3 group cursor-pointer"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#94A3B8] group-hover:text-white/70 transition-colors">
                    {entry.label}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 text-[#64748B] group-hover:text-[#94A3B8] transition-all duration-200',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                </button>

                <div className={cn(
                  'overflow-hidden transition-all duration-200',
                  isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100',
                )}>
                  {entry.items.map((item) => {
                    const isActive = item.href === activeHref;
                    const ItemIcon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-testid="nav-item"
                        className={cn(
                          'relative mb-0.5 flex items-center gap-3 rounded-[7px] px-3 py-1.5 text-[13px] transition-all duration-150',
                          isActive
                            ? 'bg-[rgba(255,107,43,0.12)] text-[#FF6B2B] font-semibold'
                            : 'text-[#E2E8F0] hover:bg-white/[0.06] hover:text-white',
                        )}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[34px] bg-[#FF6B2B] rounded-r-[2px]" />
                        )}
                        <ItemIcon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'opacity-100' : 'opacity-90')} />
                        <span className="flex-1">{item.label}</span>
                        {/* Badge count */}
                        {item.badge && item.badge > 0 && (
                          <span
                            className={cn(
                              'flex h-4 min-w-[28px] items-center justify-center rounded-full px-1.5 font-mono text-[8px] font-semibold',
                              item.badgeColor === 'error'
                                ? 'bg-[rgba(220,38,38,0.15)] text-[#EF4444]'
                                : 'bg-[rgba(255,107,43,0.15)] text-[#FF6B2B]',
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer: mascot + user profile + collapse */}
        <div className="shrink-0 border-t border-[#1E293B] p-3">
          {/* User profile bar — per spec: avatar, name, role, with mascot */}
          {!sidebarCollapsed && (
            <div className="mb-2 flex items-center gap-2 rounded-[6px] bg-white/[0.04] px-3 py-2.5">
              {currentUser?.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt={currentUser.name}
                  className="h-8 w-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF6B2B] shrink-0">
                  <span className="text-[11px] font-semibold text-white">
                    {getInitials(currentUser?.name || 'U')}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-[13px] font-medium text-[#E2E8F0] truncate">
                  {currentUser?.name || 'User'}
                </span>
                <span className="text-[11px] text-[#94A3B8]">
                  {currentUser?.roles?.[0] === 'tenant_admin' ? 'Admin' : currentUser?.roles?.[0] || 'Agent'} · Online
                </span>
              </div>
              {/* Mascot */}
              <img
                src="/mascot/mascot-happy.png"
                alt="SREonCall mascot"
                width={52}
                height={39}
                className="shrink-0 object-contain pointer-events-none"
              />
            </div>
          )}

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
