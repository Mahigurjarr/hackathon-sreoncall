'use client';

import dynamic from 'next/dynamic';

export const QueryEditor = dynamic(
  () => import('@/components/shared/QueryEditor').then((mod) => mod.QueryEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[140px] rounded-md border border-border bg-muted/40 animate-pulse" />
    ),
  },
);
