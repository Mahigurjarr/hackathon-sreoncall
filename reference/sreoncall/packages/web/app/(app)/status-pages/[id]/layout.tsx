'use client';

import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useStatusPage } from '@/lib/hooks/useStatusPages';
import { cn } from '@/lib/utils';

export default function StatusPageDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const pageId = params.id as string;

  const { data: page, isLoading } = useStatusPage(pageId);

  const tabs = [
    { label: 'Overview', href: `/status-pages/${pageId}` },
    { label: 'Updates', href: `/status-pages/${pageId}/updates` },
    { label: 'Settings', href: `/status-pages/${pageId}/settings` },
    { label: 'Subscribers', href: `/status-pages/${pageId}/subscribers` },
  ];

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="px-0 pb-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <Link
            href="/status-pages"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Status Pages
          </Link>
          <span className="text-muted-foreground/60">&rsaquo;</span>
          <span className="text-muted-foreground/60 font-medium">{page?.name ?? '...'}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading status page...</span>
          </div>
        ) : page ? (
          <>
            <div className="flex items-start justify-between gap-4 pb-4">
              <div className="min-w-0">
                <h1 className="text-[22px] font-extrabold text-foreground tracking-[-0.5px] leading-tight">
                  {page.name}
                </h1>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="font-mono text-[11.5px] text-muted-foreground/60">
                    /status/{page.slug}
                  </span>
                  <span className="text-muted-foreground/60">&middot;</span>
                  {page.is_public ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                      Public
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-400 border border-purple-500/20">
                      Private
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={`/status/${page.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    View Public
                  </Button>
                </a>
                <Link href={`/status-pages/${pageId}/updates`}>
                  <Button size="sm">
                    <Zap className="mr-1.5 h-3.5 w-3.5" />
                    Post Update
                  </Button>
                </Link>
              </div>
            </div>

            {/* Tab navigation */}
            <div className="border-b border-border mt-4">
              <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Status page tabs">
                {tabs.map((tab) => {
                  const isActive =
                    tab.href === `/status-pages/${pageId}`
                      ? pathname === `/status-pages/${pageId}`
                      : pathname.startsWith(tab.href);
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
          </>
        ) : null}
      </div>

      <div className="pt-6">{children}</div>
    </div>
  );
}
