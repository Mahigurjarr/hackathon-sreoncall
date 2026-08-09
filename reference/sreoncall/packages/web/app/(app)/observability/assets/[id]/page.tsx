'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Activity,
  Wifi,
  Server,
  Globe,
  Thermometer,
  Network,
  Radio,
  Shield,
  Zap,
  Link2,
  Unlink,
  Cpu,
  MemoryStick,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { useAssetById, useLinkAsset, useUnlinkAsset } from '@/lib/hooks/useAssets';
import { useServices, Service } from '@/lib/hooks/useServices';
import { useWorkloadMetrics } from '@/lib/hooks/useWorkloadMetrics';
import { useKubernetesEvents, K8sEvent } from '@/lib/hooks/useKubernetesEvents';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const DEVICE_TYPE_CONFIG: Record<string, { label: string; icon: typeof Server; color: string }> = {
  router:       { label: 'Router',       icon: Globe,       color: 'text-[#2563EB]' },
  switch:       { label: 'Switch',       icon: Network,     color: 'text-[#7C3AED]' },
  firewall:     { label: 'Firewall',     icon: Shield,      color: 'text-[#DC2626]' },
  olt:          { label: 'OLT',          icon: Radio,       color: 'text-[#EA580C]' },
  wireless_ap:  { label: 'Wireless AP',  icon: Wifi,        color: 'text-cyan-500' },
  ups:          { label: 'UPS',          icon: Zap,         color: 'text-[#A16207]' },
  server:       { label: 'Server',       icon: Server,      color: 'text-[#16A34A]' },
  snmp_device:  { label: 'Network Device', icon: Activity,  color: 'text-muted-foreground' },
  network_device: { label: 'Network Device', icon: Activity, color: 'text-muted-foreground' },
};

function statusDot(status: string) {
  switch (status) {
    case 'healthy':   return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,163,74,0.5)]';
    case 'degraded':  return 'bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]';
    case 'unhealthy': return 'bg-red-500 shadow-[0_0_6px_rgba(220,38,38,0.5)]';
    default:          return 'bg-muted-foreground/40';
  }
}

function formatTimeAgo(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function MetadataRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground max-w-[60%] text-right truncate">{String(value)}</span>
    </div>
  );
}

function formatBps(bps: number): string {
  if (!bps || bps === 0) return '-';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return `${Math.round(bps)} bps`;
}

function StatCard({ label, value, sub, className }: { label: string; value: string | number; sub?: string; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold font-mono text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function AssetDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: asset, isLoading, error } = useAssetById(id);
  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];
  const linkAsset = useLinkAsset();
  const unlinkAsset = useUnlinkAsset();
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Must be before early returns to respect rules of hooks
  const deviceIp = (asset?.metadata?.ip as string) || '';
  const isNetworkDevice = asset?.category === 'networking';
  const { data: ifData } = useQuery({
    queryKey: ['device-interfaces', deviceIp],
    queryFn: () => api.get<{
      interfaces: Array<{
        ifindex: string; ifdescr: string; ifname: string; ifalias: string;
        oper_status: string; speed_bps: number;
        in_bps: number; out_bps: number;
        in_errors_per_sec: number; out_errors_per_sec: number;
      }>;
      count: number;
    }>('/api/v1/observability/device-interfaces', { device_ip: deviceIp }),
    enabled: !!isNetworkDevice && !!deviceIp,
    refetchInterval: 60_000,
  });
  const liveIfCount = ifData?.count;

  const isK8sWorkload = !!asset?.k8s_kind;
  const { data: workloadMetrics, isLoading: metricsLoading } = useWorkloadMetrics({
    namespace: asset?.k8s_namespace ?? null,
    workload: asset?.name ?? null,
    kind: asset?.k8s_kind ?? null,
    enabled: isK8sWorkload && activeTab === 'metrics',
  });
  const { data: k8sEvents, isLoading: eventsLoading } = useKubernetesEvents({
    namespace: asset?.k8s_namespace ?? undefined,
    limit: 100,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Asset not found</p>
        <Link href="/observability" className="text-primary text-sm mt-2 inline-block">Back to Observability</Link>
      </div>
    );
  }

  const meta = asset.metadata ?? {};
  const deviceType = (meta.device_type as string) || asset.resource_type;
  const config = DEVICE_TYPE_CONFIG[deviceType] || DEVICE_TYPE_CONFIG.snmp_device;
  const DeviceIcon = config.icon;
  const linkedService = services.find((s: Service) => s.id === asset.service_id);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/observability" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm text-muted-foreground">Observability</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">Assets</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">{asset.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className={cn('h-12 w-12 rounded-xl border border-border bg-card flex items-center justify-center', config.color)}>
            <DeviceIcon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{asset.name}</h1>
              <span className={cn('h-2.5 w-2.5 rounded-full', statusDot(asset.status))} />
              <Badge variant={asset.status === 'healthy' ? 'default' : 'destructive'} className="text-xs">
                {asset.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span>{config.label}</span>
              {typeof meta.ip === 'string' && meta.ip && <span className="font-mono">{meta.ip}</span>}
              {asset.region && asset.region !== 'on-premise' && <span>{asset.region}</span>}
              <span>Last seen {formatTimeAgo(asset.last_seen_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {linkedService ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unlinkAsset.mutate(asset.id)}
              disabled={unlinkAsset.isPending}
            >
              <Unlink className="h-3.5 w-3.5 mr-1.5" />
              Unlink from {linkedService.name}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowLinkDialog(true)}>
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Link to Service
            </Button>
          )}
        </div>
      </div>

      {/* K8s Workload Tab Bar */}
      {isK8sWorkload && (
        <div className="flex items-center gap-1 border-b border-border mb-8">
          {(['overview', 'metrics', 'logs', 'traces', 'events', 'profiles'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                activeTab === tab
                  ? 'text-orange-400 border-orange-400'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-zinc-700',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Overview Tab (or non-K8s default view) */}
      {(!isK8sWorkload || activeTab === 'overview') && (<>

      {/* KPI Cards */}
      {isNetworkDevice && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          <StatCard label="Interfaces" value={String(liveIfCount ?? meta.interface_count ?? '-')} />
          <StatCard label="LLDP Neighbors" value={String(meta.lldp_neighbor_count ?? '-')} />
          <StatCard label="BGP Peers" value={String(meta.bgp_peer_count ?? '-')} />
          <StatCard label="Device Type" value={config.label} />
          <StatCard label="Model" value={String(meta.model || '-')} />
          <StatCard label="Serial" value={String(meta.serial || '-')} />
        </div>
      )}

      {/* Interfaces Table */}
      {isNetworkDevice && ifData && ifData.interfaces.length > 0 && (
        <Card className="mb-8">
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">
              Interfaces ({ifData.count})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Index</th>
                    <th className="text-left py-2 pr-4 font-medium">Name</th>
                    <th className="text-left py-2 pr-4 font-medium">Description</th>
                    <th className="text-left py-2 pr-4 font-medium">Alias</th>
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-right py-2 pr-4 font-medium">Speed</th>
                    <th className="text-right py-2 pr-4 font-medium">In (bps)</th>
                    <th className="text-right py-2 pr-4 font-medium">Out (bps)</th>
                    <th className="text-right py-2 font-medium">Errors/s</th>
                  </tr>
                </thead>
                <tbody>
                  {ifData.interfaces.map((iface) => (
                    <tr key={iface.ifindex} className="border-b border-border/50 last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{iface.ifindex}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{iface.ifname || '-'}</td>
                      <td className="py-2 pr-4 text-xs max-w-[200px] truncate">{iface.ifdescr || '-'}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground max-w-[150px] truncate">{iface.ifalias || '-'}</td>
                      <td className="py-2 pr-4">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-medium',
                          iface.oper_status === 'up' ? 'text-emerald-500' : iface.oper_status === 'down' ? 'text-red-500' : 'text-muted-foreground',
                        )}>
                          <span className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            iface.oper_status === 'up' ? 'bg-emerald-500' : iface.oper_status === 'down' ? 'bg-red-500' : 'bg-muted-foreground',
                          )} />
                          {iface.oper_status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-xs">{formatBps(iface.speed_bps)}</td>
                      <td className="py-2 pr-4 text-right font-mono text-xs">{formatBps(iface.in_bps)}</td>
                      <td className="py-2 pr-4 text-right font-mono text-xs">{formatBps(iface.out_bps)}</td>
                      <td className="py-2 text-right font-mono text-xs">
                        {(iface.in_errors_per_sec + iface.out_errors_per_sec).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: System Info */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">System Information</h2>
            <MetadataRow label="Device Type" value={config.label} />
            {meta.sys_name ? (
              <>
                <MetadataRow label="Name (sysName)" value={meta.sys_name as string} />
                <MetadataRow label="Description (sysDescr)" value={meta.sys_descr as string} />
                <MetadataRow label="Object ID (sysObjectID)" value={meta.sys_object_id as string} />
                <MetadataRow label="Location" value={meta.sys_location as string} />
                <MetadataRow label="Contact" value={meta.sys_contact as string} />
                <MetadataRow label="IP Address" value={meta.ip as string} />
                <MetadataRow label="Model" value={meta.model as string} />
                <MetadataRow label="Serial Number" value={meta.serial as string} />
                <MetadataRow label="Discovery Method" value={meta.discovery_method as string} />
                <MetadataRow label="Interface Count" value={meta.interface_count as number} />
                <MetadataRow label="LLDP Neighbors" value={meta.lldp_neighbor_count as number} />
                <MetadataRow label="BGP Peers" value={meta.bgp_peer_count as number} />
              </>
            ) : (
              <>
                {Object.entries(meta).filter(([k, v]) => v != null && v !== '' && k !== '_id').map(([key, value]) => (
                  <MetadataRow
                    key={key}
                    label={key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={typeof value === 'object' ? JSON.stringify(value) : value as string | number}
                  />
                ))}
                {Object.keys(meta).filter((k) => meta[k] != null && meta[k] !== '' && k !== '_id').length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No system information available for this resource.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Right: Status & Quick Info */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-foreground mb-4">Status</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Health</span>
                  <Badge variant={asset.status === 'healthy' ? 'default' : 'destructive'}>{asset.status}</Badge>
                </div>
                {asset.status_reason && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Reason</span>
                    <span className="text-xs text-foreground">{asset.status_reason}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Last Seen</span>
                  <span className="text-xs font-mono text-foreground">{formatTimeAgo(asset.last_seen_at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Provider</span>
                  <span className="text-xs text-foreground capitalize">{asset.provider.replace('_', ' ')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Category</span>
                  <span className="text-xs text-foreground capitalize">{asset.category}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Resource Type</span>
                  <span className="text-xs font-mono text-foreground">{asset.resource_type}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {linkedService && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">Linked Service</h2>
                <Link href={`/services/${linkedService.id}`} className="text-sm text-primary hover:underline">
                  {linkedService.name}
                </Link>
              </CardContent>
            </Card>
          )}

          {/* All Metadata (expandable) */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-foreground mb-4">Raw Metadata</h2>
              <pre className="text-[11px] font-mono text-muted-foreground bg-muted/50 rounded-md p-3 overflow-auto max-h-64">
                {JSON.stringify(meta, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      </>)}

      {/* Metrics Tab */}
      {isK8sWorkload && activeTab === 'metrics' && (
        <div>
          {metricsLoading ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* CPU */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Cpu className="h-4 w-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-foreground">CPU Usage</h3>
                  </div>
                  {workloadMetrics?.cpu && workloadMetrics.cpu.length > 0 ? (
                    <div className="space-y-2">
                      {workloadMetrics.cpu.map((item: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-b-0">
                          <span className="text-xs text-muted-foreground truncate max-w-[60%]">{item.pod || item.metric?.pod || `pod-${i}`}</span>
                          <span className="text-sm font-mono font-medium text-foreground">{typeof item.value === 'number' ? `${(item.value * 100).toFixed(1)}%` : String(item.value ?? '-')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No CPU data available</p>
                  )}
                </CardContent>
              </Card>

              {/* Memory */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <MemoryStick className="h-4 w-4 text-purple-400" />
                    <h3 className="text-sm font-semibold text-foreground">Memory Usage</h3>
                  </div>
                  {workloadMetrics?.memory && workloadMetrics.memory.length > 0 ? (
                    <div className="space-y-2">
                      {workloadMetrics.memory.map((item: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-b-0">
                          <span className="text-xs text-muted-foreground truncate max-w-[60%]">{item.pod || item.metric?.pod || `pod-${i}`}</span>
                          <span className="text-sm font-mono font-medium text-foreground">{typeof item.value === 'number' ? `${(item.value / 1024 / 1024).toFixed(0)} Mi` : String(item.value ?? '-')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No memory data available</p>
                  )}
                </CardContent>
              </Card>

              {/* Network RX */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ArrowDownToLine className="h-4 w-4 text-green-400" />
                    <h3 className="text-sm font-semibold text-foreground">Network RX</h3>
                  </div>
                  {workloadMetrics?.network_rx && workloadMetrics.network_rx.length > 0 ? (
                    <div className="space-y-2">
                      {workloadMetrics.network_rx.map((item: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-b-0">
                          <span className="text-xs text-muted-foreground truncate max-w-[60%]">{item.pod || item.metric?.pod || `pod-${i}`}</span>
                          <span className="text-sm font-mono font-medium text-foreground">{typeof item.value === 'number' ? formatBps(item.value) : String(item.value ?? '-')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No network RX data available</p>
                  )}
                </CardContent>
              </Card>

              {/* Network TX */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ArrowUpFromLine className="h-4 w-4 text-yellow-400" />
                    <h3 className="text-sm font-semibold text-foreground">Network TX</h3>
                  </div>
                  {workloadMetrics?.network_tx && workloadMetrics.network_tx.length > 0 ? (
                    <div className="space-y-2">
                      {workloadMetrics.network_tx.map((item: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-b-0">
                          <span className="text-xs text-muted-foreground truncate max-w-[60%]">{item.pod || item.metric?.pod || `pod-${i}`}</span>
                          <span className="text-sm font-mono font-medium text-foreground">{typeof item.value === 'number' ? formatBps(item.value) : String(item.value ?? '-')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No network TX data available</p>
                  )}
                </CardContent>
              </Card>

              {/* Restarts */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <RotateCcw className="h-4 w-4 text-red-400" />
                    <h3 className="text-sm font-semibold text-foreground">Container Restarts</h3>
                  </div>
                  {workloadMetrics?.restarts && workloadMetrics.restarts.length > 0 ? (
                    <div className="space-y-2">
                      {workloadMetrics.restarts.map((item: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-b-0">
                          <span className="text-xs text-muted-foreground truncate max-w-[60%]">{item.pod || item.metric?.pod || `pod-${i}`}</span>
                          <span className="text-sm font-mono font-medium text-foreground">{item.value ?? '-'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No restart data available</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Logs Tab */}
      {isK8sWorkload && activeTab === 'logs' && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center min-h-[200px]">
            <p className="text-sm text-muted-foreground mb-4">
              View logs for pods in <span className="font-mono text-foreground">{asset.k8s_namespace}/{asset.name}</span>
            </p>
            <Link
              href={`/observability/logs?query=${encodeURIComponent(`{namespace="${asset.k8s_namespace}", pod=~"${asset.name}-.*"}`)}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors text-sm font-medium"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Logs Explorer
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Traces Tab */}
      {isK8sWorkload && activeTab === 'traces' && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center min-h-[200px]">
            <p className="text-sm text-muted-foreground mb-4">
              View traces for service <span className="font-mono text-foreground">{asset.name}</span>
            </p>
            <Link
              href={`/observability/traces?query=${encodeURIComponent(`{resource.service.name="${asset.name}"}`)}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors text-sm font-medium"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Traces Explorer
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Events Tab */}
      {isK8sWorkload && activeTab === 'events' && (
        <div>
          {eventsLoading ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : k8sEvents && k8sEvents.length > 0 ? (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">
                  Kubernetes Events ({k8sEvents.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">Time</th>
                        <th className="text-left py-2 pr-4 font-medium">Severity</th>
                        <th className="text-left py-2 pr-4 font-medium">Workload</th>
                        <th className="text-left py-2 pr-4 font-medium">Pod</th>
                        <th className="text-left py-2 pr-4 font-medium">Type</th>
                        <th className="text-left py-2 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k8sEvents.map((evt: K8sEvent, i: number) => (
                        <tr key={i} className="border-b border-border/50 last:border-b-0">
                          <td className="py-2 pr-4 text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {formatTimeAgo(evt.timestamp)}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge
                              variant={evt.severity === 'critical' ? 'destructive' : evt.severity === 'warning' ? 'outline' : 'secondary'}
                              className="text-[10px]"
                            >
                              {evt.severity}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 text-xs font-mono">{evt.workload || '-'}</td>
                          <td className="py-2 pr-4 text-xs font-mono text-muted-foreground max-w-[180px] truncate">{evt.pod || '-'}</td>
                          <td className="py-2 pr-4 text-xs">{evt.event_type}</td>
                          <td className="py-2 text-xs text-muted-foreground max-w-[300px] truncate">{evt.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No events found for namespace {asset.k8s_namespace}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Profiles Tab */}
      {isK8sWorkload && activeTab === 'profiles' && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <p className="text-sm text-zinc-400 mb-3">CPU and memory profiles for this workload</p>
            <Link
              href={`/observability/profiles?service=${asset.name}`}
              className="text-sm text-orange-400 hover:text-orange-300 underline"
            >
              View profiles for {asset.name} &rarr;
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Link to Service Dialog */}
      <Dialog open={showLinkDialog} onClose={() => setShowLinkDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {services.map((svc: Service) => (
              <button
                key={svc.id}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-sm"
                onClick={() => {
                  linkAsset.mutate({ assetId: asset.id, serviceId: svc.id });
                  setShowLinkDialog(false);
                }}
              >
                {svc.name}
              </button>
            ))}
            {services.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No services found</p>
            )}
          </div>
          <DialogClose onClose={() => setShowLinkDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
