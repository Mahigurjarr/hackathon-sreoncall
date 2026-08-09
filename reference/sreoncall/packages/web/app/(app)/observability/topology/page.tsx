'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import {
  Activity,
  RefreshCw,
  Server,
  Network,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/* ─── Types ────────────────────────────────────────────────────────── */

interface TopoNode {
  id: string;
  label: string;
  ip: string;
  device_type: string;
  sys_descr: string;
  sys_location: string;
  interface_count: number;
  bgp_peer_count: number;
  status: 'healthy' | 'unknown';
}

interface TopoEdge {
  source: string;
  target: string;
  source_port: string;
  target_port: string;
  neighbor_name: string;
}

export interface TopologyResponse {
  nodes: TopoNode[];
  edges: TopoEdge[];
}

/* ─── Dynamic import of ReactFlow-based component (SSR disabled) ──── */

const NetworkTopologyMap = dynamic(
  () => import('./topology-map'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    ),
  },
);

/* ─── Main Page ────────────────────────────────────────────────────── */

function useNetworkTopology() {
  return useQuery<TopologyResponse>({
    queryKey: ['network-topology'],
    queryFn: () => api.get('/api/v1/observability/network-topology'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

function useDiscoveredNetworkAssets() {
  return useQuery<{ data: Array<{ id: string; name: string; resource_type: string; status: string; cloud_id?: string; metadata?: Record<string, any> }> }>({
    queryKey: ['assets-networking'],
    queryFn: () => api.get('/api/v1/assets', { category: 'networking', limit: 200 }),
    staleTime: 120_000,
  });
}

export default function NetworkTopologyPage() {
  const { data, isLoading, error, refetch, isFetching } = useNetworkTopology();
  const { data: assetsData } = useDiscoveredNetworkAssets();
  const discoveredAssets = assetsData?.data || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] gap-3">
        <p className="text-muted-foreground text-sm">Failed to load network topology</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data || (data.nodes.length === 0 && data.edges.length === 0)) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Network Topology</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Visualize your network infrastructure</p>
        </div>

        {discoveredAssets.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-4 py-3">
              <Network className="h-4 w-4 text-info shrink-0" />
              <p className="text-xs text-foreground">
                <span className="font-semibold">{discoveredAssets.length} network devices discovered</span> — LLDP topology links are not yet available. Enable LLDP polling to visualize connections between devices.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {discoveredAssets.map((asset) => (
                <Link
                  key={asset.id}
                  href={`/observability/assets/${asset.id}`}
                  className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground truncate">{asset.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', asset.status === 'healthy' ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                    <span className="text-xs text-muted-foreground">{asset.resource_type}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
            <Activity className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">No network topology data available</p>
            <p className="text-muted-foreground/60 text-xs max-w-md text-center">
              Connect a data source with network device discovery, or enable LLDP polling on your SNMP trapper to visualize topology.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Network Topology</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.nodes.length} devices, {data.edges.length} links (via LLDP discovery)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Topology Map */}
      <div className="h-[calc(100vh-280px)] min-h-[500px]">
        <NetworkTopologyMap data={data} />
      </div>
    </div>
  );
}
