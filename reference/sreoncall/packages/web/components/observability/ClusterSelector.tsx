'use client';

import { useRef, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Cloud, ChevronDown } from 'lucide-react';
import { useKubernetesClusters, KubernetesCluster } from '@/lib/hooks/useKubernetesClusters';
import { cn } from '@/lib/utils';

export function ClusterSelector() {
  const { data: clusters, isLoading } = useKubernetesClusters();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedCloudId = searchParams.get('cluster');

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Return null if no clusters
  if (!isLoading && (!clusters || clusters.length === 0)) {
    return null;
  }

  const selectedCluster = clusters?.find((c) => c.cloud_id === selectedCloudId) ?? null;

  function selectCluster(cloudId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (cloudId) {
      params.set('cluster', cloudId);
    } else {
      params.delete('cluster');
    }
    router.replace(`?${params.toString()}`);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
          'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800',
          open && 'border-orange-400/60 bg-zinc-800',
        )}
      >
        <Cloud className="w-4 h-4 text-orange-400" />
        <span>
          {isLoading
            ? 'Loading…'
            : selectedCluster
            ? selectedCluster.name
            : 'All Clusters'}
        </span>
        <ChevronDown
          className={cn('w-4 h-4 text-zinc-400 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && clusters && clusters.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl py-1">
          {/* All Clusters option */}
          <button
            onClick={() => selectCluster(null)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
              'hover:bg-zinc-800 text-zinc-200',
              !selectedCloudId && 'text-orange-400 font-medium',
            )}
          >
            <Cloud className="w-4 h-4 text-zinc-500" />
            <span>All Clusters</span>
          </button>

          <div className="border-t border-zinc-800 my-1" />

          {clusters.map((cluster) => (
            <button
              key={cluster.id}
              onClick={() => selectCluster(cluster.cloud_id)}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors',
                'hover:bg-zinc-800 text-zinc-200',
                selectedCloudId === cluster.cloud_id && 'text-orange-400 font-medium',
              )}
            >
              <span className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-orange-400/70" />
                {cluster.name}
              </span>
              {cluster.metadata?.node_count != null && (
                <span className="text-xs text-zinc-500">
                  {cluster.metadata.node_count} node{cluster.metadata.node_count !== 1 ? 's' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
