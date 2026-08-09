'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';

const baseSettingsTabs = [
  { label: 'Profile', href: '/settings/profile' },
  { label: 'General', href: '/settings/general' },
  { label: 'Notifications', href: '/settings/notifications' },
  { label: 'Org Members', href: '/settings/team' },
  { label: 'Authentication', href: '/settings/auth' },
  { label: 'Integrations', href: '/settings/integrations' },
  { label: 'Calendar', href: '/settings/calendar' },
  { label: 'AI', href: '/settings/ai' },
  { label: 'Webhooks', href: '/settings/webhooks' },
  { label: 'Audit Log', href: '/settings/audit-log' },
  { label: 'Billing', href: '/settings/billing' },
  { label: 'Privacy & Data', href: '/settings/privacy' },
  { label: 'Work Log Approvals', href: '/settings/work-log-approvals' },
  { label: 'Service Map', href: '/settings/service-map' },
  { label: 'Business Impact', href: '/settings/business-impact' },
  { label: 'Validation Suites', href: '/settings/validation-suites' },
  { label: 'Migrations', href: '/settings/migrations' },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType;

  const settingsTabs = useMemo(() => {
    const tabs = [...baseSettingsTabs];
    if (tenantType === 'consumer') {
      tabs.push({ label: 'Comm Channels', href: '/settings/communication-channels' });
      tabs.push({ label: 'Agent Activity', href: '/settings/agent-activity' });
      tabs.push({ label: 'Agent Prefs', href: '/settings/agent-preferences' });
    }
    return tabs;
  }, [tenantType]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your organization settings and preferences
        </p>
      </div>

      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Settings tabs">
          {settingsTabs.map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
