'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, AlertTriangle, Info, RefreshCw, Server, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { api, APIError } from '@/lib/api';
import { ClusterSelector } from '@/components/observability/ClusterSelector';
import { useKubernetesEvents, K8sEvent } from '@/lib/hooks/useKubernetesEvents';

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';

const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    icon: AlertCircle,
    rowClass: 'text-red-400',
    badgeClass: 'bg-red-500/10 text-red-400 border-red-500/20',
    btnActive: 'bg-red-500/10 text-red-400 border-red-500/30',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    rowClass: 'text-yellow-400',
    badgeClass: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    btnActive: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  },
  info: {
    label: 'Info',
    icon: Info,
    rowClass: 'text-blue-400',
    badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    btnActive: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  },
} as const;

function SeverityIcon({ severity }: { severity: K8sEvent['severity'] }) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return <Icon className={cn('w-4 h-4 shrink-0', cfg.rowClass)} />;
}

function SeverityBadge({ severity }: { severity: K8sEvent['severity'] }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        cfg.badgeClass,
      )}
    >
      <SeverityIcon severity={severity} />
      {cfg.label}
    </span>
  );
}

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function DiscoveredK8sFallback() {
  const { data: assetsRes } = useQuery<{ data: Array<{ id: string; name: string; resource_type: string; status: string; metadata?: Record<string, any> }> }, APIError>({
    queryKey: ['assets-kubernetes'],
    queryFn: () => api.get('/api/v1/assets', { category: 'kubernetes', limit: 50 }),
    staleTime: 120_000,
  });
  const clusters = assetsRes?.data || [];

  if (clusters.length === 0) {
    return <div className="py-16 text-center text-sm text-zinc-500">No Kubernetes events or clusters found</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <Info className="h-4 w-4 text-blue-400 shrink-0" />
        <p className="text-xs text-zinc-300">
          <span className="font-semibold">{clusters.length} Kubernetes cluster{clusters.length !== 1 ? 's' : ''} discovered</span> — No events are flowing yet. Install a monitoring agent (OTel Collector or Prometheus) on your cluster to see real-time events and metrics.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {clusters.map((cluster) => (
          <Link
            key={cluster.id}
            href={`/observability/assets/${cluster.id}`}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-600 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Server className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-200 truncate">{cluster.name}</span>
              <ExternalLink className="h-3 w-3 text-zinc-600 ml-auto shrink-0" />
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span className={cn('h-2 w-2 rounded-full', cluster.status === 'healthy' ? 'bg-emerald-500' : 'bg-zinc-500')} />
              <span>{cluster.resource_type}</span>
              {cluster.metadata?.version && <span>v{cluster.metadata.version}</span>}
              {cluster.metadata?.node_count && <span>{cluster.metadata.node_count} nodes</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function KubernetesEventsPage() {
  const searchParams = useSearchParams();
  const cluster = searchParams.get('cluster');

  const [namespace, setNamespace] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  const { data: events, isLoading, dataUpdatedAt, refetch } = useKubernetesEvents({
    cluster,
    namespace: namespace || undefined,
    severity: severity === 'all' ? undefined : severity,
  });

  const criticalCount = events?.filter((e) => e.severity === 'critical').length ?? 0;
  const warningCount = events?.filter((e) => e.severity === 'warning').length ?? 0;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Kubernetes Events</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time events from your Kubernetes clusters. Auto-refreshes every 30 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="shrink-0 flex items-center gap-2 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:border-zinc-600"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <ClusterSelector />

            {/* Namespace filter */}
            <input
              type="text"
              placeholder="Namespace"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm bg-zinc-900 border-zinc-700 text-zinc-200',
                'placeholder:text-zinc-500 focus:outline-none focus:border-orange-400/60 focus:ring-0',
                'w-40',
              )}
            />

            {/* Severity filter buttons */}
            <div className="flex items-center gap-1">
              {(['all', 'critical', 'warning', 'info'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                    severity === s
                      ? s === 'all'
                        ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                        : SEVERITY_CONFIG[s].btnActive
                      : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-200',
                  )}
                >
                  {s === 'all' ? 'All' : SEVERITY_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {criticalCount > 0 && (
          <Badge className="bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1 text-sm font-medium">
            <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
            {criticalCount} Critical
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-3 py-1 text-sm font-medium">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
            {warningCount} Warning
          </Badge>
        )}
        {lastUpdated && (
          <span className="text-xs text-zinc-500 ml-auto">Last updated: {lastUpdated}</span>
        )}
      </div>

      {/* Events table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-zinc-500">Loading events...</div>
          ) : !events || events.length === 0 ? (
            <DiscoveredK8sFallback />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    {['Time', 'Severity', 'Namespace', 'Workload', 'Pod', 'Type', 'Message', 'Source'].map(
                      (col) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {events.map((event, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-zinc-800/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap font-mono text-xs">
                        {formatTime(event.timestamp)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <SeverityBadge severity={event.severity} />
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs font-mono">
                          {event.namespace}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap max-w-[160px] truncate">
                        {event.workload}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap max-w-[180px] truncate font-mono text-xs">
                        {event.pod}
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {event.event_type}
                      </td>
                      <td className="px-4 py-3 text-zinc-300 max-w-[320px]">
                        <span
                          className="block truncate"
                          title={event.message}
                        >
                          {event.message}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={cn(
                            'text-xs px-2 py-0.5 rounded border',
                            event.source === 'k8s_api'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700',
                          )}
                        >
                          {event.source === 'k8s_api' ? 'K8s API' : 'Metrics'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
