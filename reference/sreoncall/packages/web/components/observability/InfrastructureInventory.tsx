'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  Link2,
  Unlink,
  Search,
} from 'lucide-react';
import { useAssets, useLinkAsset, useUnlinkAsset, Asset, AssetsSummary } from '@/lib/hooks/useAssets';
import { useServices, Service } from '@/lib/hooks/useServices';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, { label: string; color: string; bgClass: string }> = {
  aws:            { label: 'AWS',          color: '#FF9900', bgClass: 'bg-[#FF9900]' },
  gcp:            { label: 'GCP',          color: '#4285F4', bgClass: 'bg-[#4285F4]' },
  azure:          { label: 'Azure',        color: '#0078D4', bgClass: 'bg-[#0078D4]' },
  scaleway:       { label: 'Scaleway',     color: '#4F0599', bgClass: 'bg-[#4F0599]' },
  digitalocean:   { label: 'DigitalOcean', color: '#0080FF', bgClass: 'bg-[#0080FF]' },
  heroku:         { label: 'Heroku',       color: '#430098', bgClass: 'bg-[#430098]' },
  supabase:       { label: 'Supabase',    color: '#3ECF8E', bgClass: 'bg-[#3ECF8E]' },
  vercel:         { label: 'Vercel',      color: '#000000', bgClass: 'bg-[#000000]' },
  self_managed:   { label: 'Self-Managed', color: '#8B949E', bgClass: 'bg-muted-foreground' },
};

const CATEGORY_LABELS: Record<string, string> = {
  kubernetes: 'Kubernetes',
  compute: 'Compute',
  database: 'Databases',
  networking: 'Networking',
  serverless: 'Serverless',
  cache: 'Cache',
  queue: 'Queues',
  storage: 'Storage',
  container: 'Containers',
  app_platform: 'App Platform',
};

const CATEGORY_ORDER = ['kubernetes', 'compute', 'database', 'networking', 'serverless', 'container', 'cache', 'queue', 'storage', 'app_platform'];

const DEVICE_TYPE_LABELS: Record<string, string> = {
  router: 'Router',
  switch: 'Switch',
  firewall: 'Firewall',
  olt: 'OLT',
  wireless_ap: 'Wireless AP',
  ups: 'UPS',
  server: 'Server',
  snmp_device: 'Network Device',
  network_device: 'Network Device',
};

function statusDot(status: string) {
  switch (status) {
    case 'healthy':   return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,163,74,0.5)]';
    case 'degraded':  return 'bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]';
    case 'unhealthy': return 'bg-red-500 shadow-[0_0_6px_rgba(220,38,38,0.5)]';
    default:          return 'bg-muted-foreground/40';
  }
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case 'healthy':   return 'success' as const;
    case 'degraded':  return 'warning' as const;
    case 'unhealthy': return 'destructive' as const;
    default:          return 'secondary' as const;
  }
}

function statusDisplayName(status: string) {
  switch (status) {
    case 'healthy':   return 'Healthy';
    case 'degraded':  return 'Degraded';
    case 'unhealthy': return 'Unhealthy';
    default:          return 'Unknown';
  }
}

// ── Link to Service Dialog ───────────────────────────────────────────

function LinkToServiceDialog({
  asset,
  open,
  onClose,
}: {
  asset: Asset | null;
  open: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];
  const linkMutation = useLinkAsset();

  const filtered = useMemo(() => {
    if (!search) return services;
    const q = search.toLowerCase();
    return services.filter((s) => s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q));
  }, [services, search]);

  const handleLink = useCallback(
    (serviceId: string) => {
      if (!asset) return;
      linkMutation.mutate({ assetId: asset.id, serviceId }, { onSuccess: () => onClose() });
    },
    [asset, linkMutation, onClose],
  );

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to Service</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <div className="px-6 py-4 space-y-3">
          {asset && (
            <div className="text-xs text-muted-foreground">
              Linking <span className="font-semibold text-foreground">{asset.name}</span> ({asset.resource_type}) to a service
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services..."
              className="w-full rounded-lg border border-border bg-muted pl-8 pr-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto divide-y divide-border rounded-lg border border-border">
            {filtered.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">No services found</div>
            ) : (
              filtered.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => handleLink(svc.id)}
                  disabled={linkMutation.isPending}
                  className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <span className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    svc.current_status === 'operational'
                      ? 'bg-emerald-500'
                      : svc.current_status === 'degraded'
                        ? 'bg-yellow-500'
                        : 'bg-red-500',
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{svc.name}</div>
                    <div className="text-[10px] text-muted-foreground">{svc.type}</div>
                  </div>
                  <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Asset Link Button ───────────────────────────────────────────────

function AssetLinkButton({
  asset,
  services,
  onLinkClick,
}: {
  asset: Asset;
  services: Service[];
  onLinkClick: (asset: Asset) => void;
}) {
  const unlinkMutation = useUnlinkAsset();
  const linkedService = asset.service_id ? services.find((s) => s.id === asset.service_id) : null;

  if (linkedService) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-blue-400 font-medium truncate max-w-[100px]" title={linkedService.name}>
          {linkedService.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); unlinkMutation.mutate(asset.id); }}
          disabled={unlinkMutation.isPending}
          className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
          title="Unlink from service"
        >
          <Unlink className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onLinkClick(asset); }}
      className="p-0.5 rounded hover:bg-primary/20 text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
      title="Link to service"
    >
      <Link2 className="h-3 w-3" />
    </button>
  );
}

// ── K8s Workload Row ─────────────────────────────────────────────────

function K8sWorkloadRow({ asset, services, onLinkClick }: { asset: Asset; services: Service[]; onLinkClick: (a: Asset) => void }) {
  const replicaColor = asset.k8s_replicas_ready === asset.k8s_replicas_desired
    ? 'text-emerald-400'
    : 'text-red-400';

  return (
    <div className="flex items-start gap-2.5 py-1.5 ml-8">
      <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1.5', statusDot(asset.status))} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium font-mono text-foreground">{asset.name}</span>
        <span className="text-[10px] text-muted-foreground ml-2">
          {asset.k8s_kind}
          {asset.metadata?.image ? ` \u00B7 ${String(asset.metadata.image)}` : null}
        </span>
        {(asset.k8s_pod_issues?.length ?? 0) > 0 && (
          <div className="text-[10px] text-red-400 font-medium">
            {(asset.k8s_pod_issues ?? []).join(', ')}
          </div>
        )}
      </div>
      <AssetLinkButton asset={asset} services={services} onLinkClick={onLinkClick} />
      {asset.k8s_replicas_desired !== null && (
        <span className={cn('text-xs font-mono font-bold shrink-0', replicaColor)}>
          {asset.k8s_replicas_ready}/{asset.k8s_replicas_desired}
        </span>
      )}
    </div>
  );
}

// ── K8s Namespace Section ────────────────────────────────────────────

function K8sNamespace({
  namespace,
  workloads,
  defaultExpanded,
  services,
  onLinkClick,
}: {
  namespace: string;
  workloads: Asset[];
  defaultExpanded: boolean;
  services: Service[];
  onLinkClick: (a: Asset) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasIssues = workloads.some((w) => w.status !== 'healthy');
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="ml-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1 w-full text-left hover:bg-muted/30 rounded px-1 -ml-1"
      >
        <ChevronIcon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-semibold text-blue-400 font-mono">{namespace}</span>
        <span className="text-[10px] text-muted-foreground">
          {workloads.length} workload{workloads.length !== 1 ? 's' : ''}
          {hasIssues
            ? ` \u00B7 ${workloads.filter((w) => w.status !== 'healthy').length} issue${workloads.filter((w) => w.status !== 'healthy').length !== 1 ? 's' : ''}`
            : ' \u00B7 all healthy'}
        </span>
      </button>
      {expanded && workloads.map((w) => <K8sWorkloadRow key={w.id} asset={w} services={services} onLinkClick={onLinkClick} />)}
    </div>
  );
}

// ── K8s Cluster Section ──────────────────────────────────────────────

function K8sCluster({
  cluster,
  workloads,
  services,
  onLinkClick,
}: {
  cluster: Asset;
  workloads: Asset[];
  services: Service[];
  onLinkClick: (a: Asset) => void;
}) {
  const hasIssues = workloads.some((w) => w.status !== 'healthy');
  const [expanded, setExpanded] = useState(hasIssues);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  // Group workloads by namespace
  const byNamespace = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const w of workloads) {
      const ns = w.k8s_namespace || 'default';
      if (!map.has(ns)) map.set(ns, []);
      map.get(ns)!.push(w);
    }
    return map;
  }, [workloads]);

  return (
    <div className="py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full text-left hover:bg-muted/30 rounded px-1 py-1 -ml-1"
      >
        <ChevronIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className={cn('h-2 w-2 rounded-full shrink-0', statusDot(cluster.status))} />
        <span className="text-[13px] font-semibold text-foreground">{cluster.name}</span>
        <Badge variant={statusBadgeVariant(cluster.status)} className="text-[9px] px-1.5 py-0">
          {statusDisplayName(cluster.status)}
        </Badge>
        <span className="text-[11px] text-muted-foreground font-mono ml-auto">
          {cluster.metadata?.version ? `v${cluster.metadata.version} \u00B7 ` : ''}
          {(cluster.metadata?.node_count as number) || '?'} nodes
          {cluster.metadata?.pod_count ? ` \u00B7 ${cluster.metadata.pod_count} pods` : ''}
          {cluster.region ? ` \u00B7 ${cluster.region}` : ''}
        </span>
      </button>
      {expanded && (
        <div className="mt-1">
          {Array.from(byNamespace.entries()).map(([ns, wls]) => (
            <K8sNamespace
              key={ns}
              namespace={ns}
              workloads={wls}
              defaultExpanded={wls.some((w) => w.status !== 'healthy')}
              services={services}
              onLinkClick={onLinkClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Resource Row ─────────────────────────────────────────────────────

function ResourceRow({ asset, services, onLinkClick }: { asset: Asset; services: Service[]; onLinkClick: (a: Asset) => void }) {
  if (asset.is_aggregate) {
    return (
      <div className="flex items-center gap-2.5 py-1.5">
        <div className="h-4 w-4 rounded bg-muted border border-border flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
          +
        </div>
        <span className="text-xs text-muted-foreground flex-1">{asset.name}</span>
        <span className="text-[11px] text-muted-foreground font-mono">
          {asset.status === 'healthy'
            ? 'all healthy'
            : asset.status_reason || statusDisplayName(asset.status)}
        </span>
      </div>
    );
  }

  const metaParts: string[] = [];
  if (asset.metadata?.instance_type) metaParts.push(asset.metadata.instance_type as string);
  if (asset.metadata?.vm_size) metaParts.push(asset.metadata.vm_size as string);
  if (asset.metadata?.machine_type) metaParts.push(asset.metadata.machine_type as string);
  if (asset.metadata?.instance_class) metaParts.push(asset.metadata.instance_class as string);
  if (asset.metadata?.engine) metaParts.push(asset.metadata.engine as string);
  if (asset.metadata?.node_type) metaParts.push(asset.metadata.node_type as string);
  if (asset.metadata?.role) metaParts.push(asset.metadata.role as string);
  if (asset.metadata?.os_image) metaParts.push(asset.metadata.os_image as string);
  if (asset.metadata?.az) metaParts.push(asset.metadata.az as string);
  if (asset.metadata?.multi_az) metaParts.push('Multi-AZ');
  if (asset.metadata?.target_groups) metaParts.push(`${asset.metadata.target_groups} target groups`);
  if (asset.metadata?.origins) metaParts.push(`${asset.metadata.origins} origins`);
  // SNMP device metadata
  if (asset.metadata?.device_type && asset.metadata.device_type !== 'snmp_device') {
    metaParts.push(DEVICE_TYPE_LABELS[asset.metadata.device_type as string] || (asset.metadata.device_type as string));
  }
  if (asset.metadata?.model) metaParts.push(asset.metadata.model as string);
  if (asset.metadata?.interface_count && (asset.metadata.interface_count as number) > 0) {
    metaParts.push(`${asset.metadata.interface_count} ifs`);
  }
  if (asset.metadata?.bgp_peer_count && (asset.metadata.bgp_peer_count as number) > 0) {
    metaParts.push(`${asset.metadata.bgp_peer_count} BGP`);
  }
  if (asset.metadata?.ip && asset.category === 'networking') metaParts.push(asset.metadata.ip as string);
  if (asset.region && !metaParts.some((p) => p.includes(asset.region))) metaParts.push(asset.region);

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={cn('h-2 w-2 rounded-full shrink-0', statusDot(asset.status))} />
      <Link href={`/observability/assets/${asset.id}`} className="text-[13px] font-medium text-foreground hover:text-primary transition-colors flex-1 min-w-0 truncate">
        {asset.name}
      </Link>
      <AssetLinkButton asset={asset} services={services} onLinkClick={onLinkClick} />
      <Badge variant={statusBadgeVariant(asset.status)} className="text-[9px] px-1.5 py-0 shrink-0">
        {asset.status_reason || statusDisplayName(asset.status)}
      </Badge>
      {metaParts.length > 0 && (
        <span className="text-[11px] text-muted-foreground font-mono shrink-0">
          {metaParts.join(' \u00B7 ')}
        </span>
      )}
    </div>
  );
}

// ── Category Group ───────────────────────────────────────────────────

function CategoryGroup({
  category,
  assets,
  allAssets,
  services,
  onLinkClick,
}: {
  category: string;
  assets: Asset[];
  allAssets: Asset[];
  services: Service[];
  onLinkClick: (a: Asset) => void;
}) {
  if (category === 'kubernetes') {
    // Separate clusters from workloads
    const clusters = assets.filter((a) => ['eks', 'gke', 'aks', 'k8s_cluster', 'kapsule'].includes(a.resource_type));
    const workloads = allAssets.filter(
      (a) => a.category === 'kubernetes' && a.parent_asset_id !== null,
    );

    return (
      <div className="py-3 border-b border-border last:border-b-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
          {CATEGORY_LABELS[category] || category}
        </div>
        {clusters.map((cluster) => (
          <K8sCluster
            key={cluster.id}
            cluster={cluster}
            workloads={workloads.filter((w) => w.parent_asset_id === cluster.id)}
            services={services}
            onLinkClick={onLinkClick}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
        {CATEGORY_LABELS[category] || category}
      </div>
      {assets.map((asset) => (
        <ResourceRow key={asset.id} asset={asset} services={services} onLinkClick={onLinkClick} />
      ))}
    </div>
  );
}

// ── Provider Section ─────────────────────────────────────────────────

function ProviderSection({
  provider,
  assets,
  allAssets,
  defaultExpanded,
  services,
  onLinkClick,
}: {
  provider: string;
  assets: Asset[];
  allAssets: Asset[];
  defaultExpanded: boolean;
  services: Service[];
  onLinkClick: (a: Asset) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const info = PROVIDER_LABELS[provider] || { label: provider, color: '#8B949E', bgClass: 'bg-muted-foreground' };
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  // Top-level assets only (no children)
  const topLevel = assets.filter((a) => a.parent_asset_id === null);

  // Group by category
  const byCategory = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of topLevel) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return map;
  }, [topLevel]);

  const region = topLevel[0]?.region || '';
  const hasIssues = assets.some((a) => a.status !== 'healthy' && a.status !== 'unknown');
  const assetCount = topLevel.length;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-4 py-3 sm:px-6 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <ChevronIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className={cn('h-5 w-5 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0', info.bgClass)}>
          {info.label.charAt(0)}
        </div>
        <span className="text-[13px] font-semibold text-foreground flex-1">
          {info.label}
          {region && <span className="text-muted-foreground font-normal text-[11px] ml-2">{region}</span>}
        </span>
        <span className="text-[11px] text-muted-foreground font-mono">
          {assetCount} asset{assetCount !== 1 ? 's' : ''}
          {!hasIssues && ' \u00B7 all healthy'}
        </span>
      </button>
      {expanded && (
        <div className="px-4 sm:px-6">
          {CATEGORY_ORDER
            .filter((cat) => byCategory.has(cat))
            .map((cat) => (
              <CategoryGroup
                key={cat}
                category={cat}
                assets={byCategory.get(cat)!}
                allAssets={allAssets}
                services={services}
                onLinkClick={onLinkClick}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export default function InfrastructureInventory({
  summary,
}: {
  summary: AssetsSummary | undefined;
}) {
  const { data: assetsData, isLoading } = useAssets({ tree: true });
  const assets = assetsData?.data ?? [];
  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];

  const [linkDialogAsset, setLinkDialogAsset] = useState<Asset | null>(null);

  // Group top-level by provider (must be before any early return — Rules of Hooks)
  const providers = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of assets) {
      if (!map.has(a.provider)) map.set(a.provider, []);
      map.get(a.provider)!.push(a);
    }
    return map;
  }, [assets]);

  const handleLinkClick = useCallback((asset: Asset) => setLinkDialogAsset(asset), []);

  if (isLoading || !summary || summary.total === 0) return null;

  const providerKeys = Array.from(providers.keys()).sort((a, b) => {
    return (providers.get(b)?.length ?? 0) - (providers.get(a)?.length ?? 0);
  });

  const providerCount = providerKeys.length;
  const degradedCount = assets.filter((a) => a.status === 'degraded').length;
  const unhealthyCount = assets.filter((a) => a.status === 'unhealthy').length;

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            Infrastructure Inventory
            <span className="text-muted-foreground font-normal text-xs ml-2">
              {summary.total} asset{summary.total !== 1 ? 's' : ''} across {providerCount} provider{providerCount !== 1 ? 's' : ''}
            </span>
          </h3>
        </div>

        {/* Provider sections */}
        {providerKeys.map((provider, i) => (
          <ProviderSection
            key={provider}
            provider={provider}
            assets={providers.get(provider)!}
            allAssets={assets}
            defaultExpanded={i === 0}
            services={services}
            onLinkClick={handleLinkClick}
          />
        ))}

        {/* Footer */}
        <div className="flex items-center justify-center gap-3 px-4 py-3 sm:px-6 border-t border-border">
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
            {summary.healthy} healthy
          </span>
          {degradedCount > 0 && (
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
              {degradedCount} degraded
            </span>
          )}
          {unhealthyCount > 0 && (
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-400">
              {unhealthyCount} unhealthy
            </span>
          )}
        </div>
      </CardContent>

      {/* Link to Service Dialog */}
      <LinkToServiceDialog
        asset={linkDialogAsset}
        open={linkDialogAsset !== null}
        onClose={() => setLinkDialogAsset(null)}
      />
    </Card>
  );
}
