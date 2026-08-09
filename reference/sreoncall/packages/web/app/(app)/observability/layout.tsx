'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFeatureFlag } from '@/lib/hooks/useFeatureFlag';

// Navigation moved to the left sidebar (components/layout/Sidebar.tsx).
// This list only resolves the breadcrumb label for the current route.
const OBS_PAGES = [
  { label: 'Overview',   href: '/observability' },
  { label: 'Metrics',    href: '/observability/metrics' },
  { label: 'Logs',       href: '/observability/logs' },
  { label: 'Traces',     href: '/observability/traces' },
  { label: 'Synthetics', href: '/observability/synthetics' },
  { label: 'SLOs',       href: '/observability/slos' },
  { label: 'Alerts',     href: '/observability/alerts' },
  { label: 'Topology',   href: '/observability/topology' },
  { label: 'Bandwidth',  href: '/observability/bandwidth-report' },
  { label: 'LLM',        href: '/observability/llm' },
  { label: 'RUM',        href: '/observability/rum' },
  { label: 'Pipelines',  href: '/observability/log-pipelines' },
  { label: 'Connect',    href: '/observability/connect' },
];

export default function ObservabilityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const currentLabel =
    OBS_PAGES.find((t) =>
      t.href === '/observability'
        ? pathname === '/observability'
        : pathname.startsWith(t.href),
    )?.label ?? 'Overview';

  // "+ Connect Source" belongs only on Overview and Connect Stack, not on data sub-pages.
  const showConnectSource =
    pathname === '/observability' || pathname.startsWith('/observability/connect');

  // The flag-gated v12 Metrics Explore is a full-page takeover with its own topstrip +
  // breadcrumb. When it's active, render it full-bleed: no layout breadcrumb, and cancel
  // the parent <main> padding (p-4 sm:p-6) so it sits flush under the app top bar.
  const exploreV2 = useFeatureFlag('observability_discovery_enabled') && (pathname.startsWith('/observability/metrics') || pathname.startsWith('/observability/logs'));
  if (exploreV2) {
    return <div className="-m-4 sm:-m-6">{children}</div>;
  }

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="text-foreground font-semibold">Observability</span>
          <span className="text-muted-foreground/50">&rsaquo;</span>
          <span className="text-muted-foreground">{currentLabel}</span>
        </div>
        {showConnectSource && (
          <div className="flex items-center gap-2">
            <Link href="/observability/connect">
              <Button size="sm" data-testid="connect-source-btn">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Connect Source
              </Button>
            </Link>
          </div>
        )}
      </div>

      <div className="pt-6">{children}</div>
    </div>
  );
}
