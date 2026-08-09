'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Plus,
  Plug,
  Activity,
  Search,
  Server,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Globe,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { useServices, Service, ServiceStatus, ServiceClassification } from '@/lib/hooks/useServices';
import { useProjects } from '@/lib/hooks/useProjects';
import { useIncidents, Incident } from '@/lib/hooks/useIncidents';
import { useAlertRules, AlertRule } from '@/lib/hooks/useAlertRules';
import { useSLOs, SloDefinition } from '@/lib/hooks/useSLOs';
import { useSyntheticChecks, SyntheticCheck } from '@/lib/hooks/useSyntheticChecks';
import { useObservabilityConnections, ObservabilityConnection } from '@/lib/hooks/useObservabilityConnections';
import { useAssetsSummary, AssetsSummary } from '@/lib/hooks/useAssets';
import { useTenantObservabilityVerification, TenantObservabilityVerificationReport } from '@/lib/hooks/useTenantObservabilityVerification';
import InfrastructureInventory from '@/components/observability/InfrastructureInventory';
import AIQueryBar from '@/components/observability/AIQueryBar';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────

function formatTimeAgo(ts: string | null | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusDot(status: ServiceStatus) {
  switch (status) {
    case 'operational':
      return 'bg-[#16A34A] shadow-[0_0_6px_rgba(16,163,74,0.5)]';
    case 'degraded':
      return 'bg-[#A16207] shadow-[0_0_6px_rgba(234,179,8,0.5)]';
    case 'major_outage':
    case 'partial_outage':
      return 'bg-[#DC2626] shadow-[0_0_6px_rgba(220,38,38,0.5)]';
    case 'maintenance':
      return 'bg-[#2563EB] shadow-[0_0_6px_rgba(37,99,235,0.5)]';
    default:
      return 'bg-muted-foreground/40';
  }
}

function statusLabel(status: ServiceStatus) {
  switch (status) {
    case 'operational': return 'Operational';
    case 'degraded': return 'Degraded';
    case 'major_outage': return 'Major Outage';
    case 'partial_outage': return 'Partial Outage';
    case 'maintenance': return 'Maintenance';
    default: return 'Unknown';
  }
}

function statusBadgeVariant(status: ServiceStatus) {
  switch (status) {
    case 'operational': return 'success' as const;
    case 'degraded': return 'warning' as const;
    case 'major_outage':
    case 'partial_outage': return 'destructive' as const;
    case 'maintenance': return 'info' as const;
    default: return 'secondary' as const;
  }
}

function severityBadgeVariant(severity: 'critical' | 'high' | 'medium' | 'low') {
  switch (severity) {
    case 'critical': return 'sev1' as const;
    case 'high': return 'sev2' as const;
    case 'medium': return 'sev3' as const;
    case 'low': return 'sev4' as const;
  }
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    web: 'Web', api: 'API', database: 'DB', queue: 'Queue',
    cache: 'Cache', worker: 'Worker', storage: 'Storage', other: 'Other',
  };
  return labels[type] || type;
}

// ── Empty State ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Observability Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor your infrastructure, services, and applications
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="relative mb-6">
            <Image
              src="/mascot/mascot-smirk.png"
              alt="SREonCall mascot"
              width={120}
              height={120}
              style={{ objectFit: 'contain' }}
            />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            No data sources connected yet
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            Connect your first data source to start collecting telemetry and see your
            services, alerts, and SLOs here.
          </p>
          <Link href="/observability/connect">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Connect Data Source
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

// ── KPI Strip ────────────────────────────────────────────────────────

function KPIStrip({
  services,
  openIncidents,
  firingAlerts,
  slos,
  assetsSummary,
}: {
  services: Service[];
  openIncidents: Incident[];
  firingAlerts: AlertRule[];
  slos: SloDefinition[];
  assetsSummary: AssetsSummary | undefined;
}) {
  const healthyCount = services.filter((s) => s.current_status === 'operational').length;
  const critAlerts = firingAlerts.filter((a) => a.severity === 'critical').length;

  const activeSlos = slos.filter((s) => s.status === 'active' && s.current_sli_pct !== null);
  const sloCompliance = activeSlos.length > 0
    ? activeSlos.reduce((sum, s) => sum + (s.current_sli_pct ?? 0), 0) / activeSlos.length
    : null;
  const breachingSlos = activeSlos.filter(
    (s) => s.current_sli_pct !== null && s.current_sli_pct < s.objective_pct,
  ).length;

  const sev1Incidents = openIncidents.filter((i) => i.severity === 1).length;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {/* Total Assets */}
      {assetsSummary && assetsSummary.total > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1.5">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground font-medium">Total Assets</span>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">{assetsSummary.total}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {assetsSummary.healthy} healthy
          </div>
        </div>
      )}

      {/* Total Services */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">Total Services</span>
        </div>
        <div className="text-2xl font-bold font-mono text-foreground">{services.length}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {healthyCount} healthy
        </div>
      </div>

      {/* Open Incidents */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1.5">
          {openIncidents.length > 0 && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
          )}
          <span className="text-sm text-muted-foreground font-medium">Open Incidents</span>
        </div>
        <div className={cn('text-2xl font-bold font-mono', openIncidents.length > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]')}>
          {openIncidents.length}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {sev1Incidents > 0 ? (
            <span className="text-[#DC2626]">{sev1Incidents} sev1</span>
          ) : (
            openIncidents.length > 0 ? (
              <Link href="/incidents" className="text-primary hover:underline">View all &rarr;</Link>
            ) : 'All clear'
          )}
        </div>
      </div>

      {/* Firing Alerts */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">Firing Alerts</span>
        </div>
        <div className={cn('text-2xl font-bold font-mono', firingAlerts.length > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]')}>
          {firingAlerts.length}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {critAlerts > 0 ? (
            <span className="text-[#DC2626]">{critAlerts} critical</span>
          ) : (
            firingAlerts.length > 0 ? `${firingAlerts.length} active` : 'All clear'
          )}
        </div>
      </div>

      {/* SLO Compliance */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">SLO Compliance</span>
        </div>
        <div className={cn(
          'text-2xl font-bold font-mono',
          sloCompliance === null
            ? 'text-muted-foreground'
            : sloCompliance >= 99
              ? 'text-[#16A34A]'
              : sloCompliance >= 95
                ? 'text-[#A16207]'
                : 'text-[#DC2626]',
        )}>
          {sloCompliance !== null ? `${sloCompliance.toFixed(1)}%` : '\u2014'}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {breachingSlos > 0 ? (
            <span className="text-[#DC2626]">{breachingSlos} breaching</span>
          ) : (
            activeSlos.length > 0 ? 'All within target' : 'No SLOs configured'
          )}
        </div>
      </div>
    </div>
  );
}

// ── Service Catalog ──────────────────────────────────────────────────

const CLASSIFICATION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All classifications' },
  { value: 'app', label: 'Application' },
  { value: 'platform', label: 'Platform' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'system', label: 'System' },
];

function ServiceCatalog({
  services,
  alertRules,
  slos,
}: {
  services: Service[];
  alertRules: AlertRule[];
  slos: SloDefinition[];
}) {
  const [search, setSearch] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('app');
  const [clusterFilter, setClusterFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const { data: projectsData } = useProjects();
  const projects = (projectsData as any)?.data ?? [];

  const clusters = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => { if (s.cloud_metadata?.cluster) set.add(s.cloud_metadata.cluster); });
    return [...set].sort();
  }, [services]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => { if (s.cloud_metadata?.provider) set.add(s.cloud_metadata.provider); });
    return [...set].sort();
  }, [services]);

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (classificationFilter && (s.classification ?? 'app') !== classificationFilter) return false;
      if (projectFilter && s.project_id !== projectFilter) return false;
      if (clusterFilter && s.cloud_metadata?.cluster !== clusterFilter) return false;
      if (providerFilter && s.cloud_metadata?.provider !== providerFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.type.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [services, search, classificationFilter, projectFilter, clusterFilter, providerFilter]);

  const alertsByService = useMemo(() => {
    const map = new Map<string, number>();
    alertRules
      .filter((a) => a.alert_state === 'firing' && a.status === 'active')
      .forEach((a) => {
        if (a.service_id) map.set(a.service_id, (map.get(a.service_id) ?? 0) + 1);
      });
    return map;
  }, [alertRules]);

  const sloBestByService = useMemo(() => {
    const map = new Map<string, number>();
    slos
      .filter((s) => s.status === 'active' && s.service_id && s.current_sli_pct !== null)
      .forEach((s) => {
        const existing = map.get(s.service_id!);
        if (existing === undefined || s.current_sli_pct! < existing) {
          map.set(s.service_id!, s.current_sli_pct!);
        }
      });
    return map;
  }, [slos]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const statusOrder: Record<string, number> = {
        major_outage: 0, partial_outage: 1, degraded: 2, maintenance: 3, unknown: 4, operational: 5,
      };
      const diff = (statusOrder[a.current_status] ?? 4) - (statusOrder[b.current_status] ?? 4);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  // Group by cluster
  const grouped = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const svc of sorted) {
      const key = svc.cloud_metadata?.cluster || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(svc);
    }
    // Auto-expand groups with impacted services
    const autoExpand = new Set<string>();
    groups.forEach((svcs, key) => {
      if (svcs.some((s) => s.current_status !== 'operational' && s.current_status !== 'unknown')) {
        autoExpand.add(key);
      }
    });
    if (autoExpand.size > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        autoExpand.forEach((k) => next.add(k));
        return next;
      });
    }
    return groups;
  }, [sorted]);

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectClass = 'rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-foreground outline-none';

  function renderServiceRow(svc: Service) {
    const alertCount = alertsByService.get(svc.id) ?? 0;
    const sloVal = sloBestByService.get(svc.id);
    return (
      <div
        key={svc.id}
        className="grid grid-cols-[1fr_90px_60px_100px_70px_80px] gap-3 items-center px-4 py-2.5 sm:px-6 pl-10 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn('h-2 w-2 rounded-full shrink-0', statusDot(svc.current_status))} />
          <span className="text-[13px] font-semibold text-foreground truncate">{svc.name}</span>
        </div>
        <div className="flex justify-center">
          <Badge variant={statusBadgeVariant(svc.current_status)}>{statusLabel(svc.current_status)}</Badge>
        </div>
        <div className="text-center text-[11px] text-muted-foreground font-medium">{typeLabel(svc.type)}</div>
        <div className="text-right text-[10px] text-muted-foreground font-mono truncate">
          {svc.cloud_metadata?.namespace || '\u2014'}
        </div>
        <div className="text-right text-[13px] font-mono">
          {alertCount > 0 ? <span className="text-[#DC2626] font-bold">{alertCount}</span> : <span className="text-muted-foreground">0</span>}
        </div>
        <div className="text-right text-[13px] font-mono">
          {sloVal !== undefined ? (
            <span className={cn('font-bold', sloVal >= 99.5 ? 'text-[#16A34A]' : sloVal >= 95 ? 'text-[#A16207]' : 'text-[#DC2626]')}>
              {sloVal.toFixed(1)}%
            </span>
          ) : <span className="text-muted-foreground">&mdash;</span>}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 gap-3">
          <h3 className="text-sm font-semibold text-foreground shrink-0">Your Services</h3>
          <div className="relative flex-1 max-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
              className="w-full rounded-lg border border-border bg-muted pl-7 pr-7 py-1.5 text-[11px] text-foreground outline-none focus:border-primary" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors">
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
          <Link href="/services">
            <Button variant="ghost" size="sm" className="text-[11px] shrink-0">View All <ArrowRight className="h-3 w-3 ml-1" /></Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 pb-3 sm:px-6 flex-wrap">
          <select className={selectClass} value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)}>
            {CLASSIFICATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {projects.length > 0 && (
            <select className={selectClass} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {clusters.length > 0 && (
            <select className={selectClass} value={clusterFilter} onChange={(e) => setClusterFilter(e.target.value)}>
              <option value="">All clusters</option>
              {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {providers.length > 0 && (
            <select className={selectClass} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
              <option value="">All providers</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Server className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {services.length === 0 ? 'No services registered yet.' : 'No services match your filters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_90px_60px_100px_70px_80px] gap-3 px-4 py-2 sm:px-6 pl-10 border-b border-border">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Service</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-center">Status</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-center">Type</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Namespace</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Alerts</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">SLO</span>
            </div>

            <div className="divide-y divide-border">
              {[...grouped.entries()].map(([clusterName, svcs]) => {
                const isExpanded = expanded.has(clusterName);
                const operational = svcs.filter((s) => s.current_status === 'operational').length;
                const impacted = svcs.filter((s) => !['operational', 'unknown'].includes(s.current_status)).length;
                return (
                  <div key={clusterName}>
                    <button
                      onClick={() => toggleGroup(clusterName)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 sm:px-6 hover:bg-muted/50 transition-colors text-left"
                    >
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="text-[12px] font-bold text-foreground">{clusterName}</span>
                      <span className="text-[11px] text-muted-foreground ml-1">{svcs.length} service{svcs.length !== 1 ? 's' : ''}</span>
                      <span className="ml-auto flex items-center gap-2 text-[10px]">
                        {operational > 0 && <span className="text-[#16A34A]">{operational} operational</span>}
                        {impacted > 0 && <span className="text-[#DC2626] font-semibold">{impacted} impacted</span>}
                      </span>
                    </button>
                    {isExpanded && svcs.map(renderServiceRow)}
                  </div>
                );
              })}
            </div>

            <div className="text-center px-4 py-3 sm:px-6 border-t border-border text-xs text-muted-foreground">
              {sorted.length} service{sorted.length !== 1 ? 's' : ''} shown
              {sorted.length !== services.length && ` of ${services.length} total`}
              {' \u00B7 '}
              {sorted.filter((s) => s.current_status === 'operational').length} operational
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Firing Alerts ────────────────────────────────────────────────────

function FiringAlertsPanel({ alerts }: { alerts: AlertRule[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {alerts.length > 0 ? `${alerts.length} alert${alerts.length !== 1 ? 's' : ''} firing` : 'Firing Alerts'}
          </h3>
          <Link href="/observability/alerts">
            <Button variant="ghost" size="sm" className="text-[11px]">View all alerts &rarr;</Button>
          </Link>
        </div>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
            All clear — no alerts are currently firing.
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.slice(0, 5).map((rule) => {
              const drillHref = rule.source_type === 'managed_logql' && rule.query
                ? `/observability/logs?q=${encodeURIComponent(rule.query)}`
                : rule.query || rule.condition?.metric
                  ? `/observability/metrics?q=${encodeURIComponent(rule.query || rule.condition.metric)}`
                  : '/alerts';
              return (
                <Link key={rule.id} href={drillHref} className="flex items-start gap-3 group">
                  <span className={cn(
                    'mt-1 h-2 w-2 rounded-full shrink-0',
                    rule.severity === 'critical' ? 'bg-red-500' :
                    rule.severity === 'high' ? 'bg-orange-500' :
                    rule.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500',
                  )} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate block group-hover:text-primary">{rule.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      <Badge variant={severityBadgeVariant(rule.severity)} className="mr-1.5">
                        {rule.severity}
                      </Badge>
                      {(rule.service?.name || rule.last_firing_labels?.instance || rule.last_firing_labels?.job) && (
                        <span>{rule.service?.name || rule.last_firing_labels?.instance || rule.last_firing_labels?.job} · </span>
                      )}
                      {formatTimeAgo(rule.last_triggered_at)}
                      <span className="ml-1.5 text-primary/70 opacity-0 group-hover:opacity-100 transition-opacity">
                        {rule.source_type === 'managed_logql' ? '→ View Logs' : '→ View Metrics'}
                      </span>
                    </span>
                  </div>
                </Link>
              );
            })}
            {alerts.length > 5 && (
              <div className="text-[10px] text-muted-foreground text-center">
                +{alerts.length - 5} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Open Incidents ───────────────────────────────────────────────────

function OpenIncidentsPanel({ incidents }: { incidents: Incident[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {incidents.length > 0 ? `${incidents.length} open incident${incidents.length !== 1 ? 's' : ''}` : 'Open Incidents'}
          </h3>
          <Link href="/incidents">
            <Button variant="ghost" size="sm" className="text-[11px]">View all incidents &rarr;</Button>
          </Link>
        </div>
        {incidents.length === 0 ? (
          <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
            No open incidents.
          </div>
        ) : (
          <div className="space-y-3">
            {incidents.slice(0, 5).map((inc) => (
              <Link key={inc.id} href={`/incidents/${inc.id}`} className="flex items-start gap-3 group">
                <span className={cn(
                  'mt-1 h-2 w-2 rounded-full shrink-0',
                  inc.severity <= 2 ? 'bg-red-500' : inc.severity <= 3 ? 'bg-yellow-500' : 'bg-blue-500',
                )} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground truncate block group-hover:text-primary">
                    <Badge variant={`sev${inc.severity}` as 'sev1' | 'sev2' | 'sev3' | 'sev4' | 'sev5'} className="mr-1.5">
                      SEV{inc.severity}
                    </Badge>
                    {inc.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimeAgo(inc.created_at)}
                  </span>
                </div>
              </Link>
            ))}
            {incidents.length > 5 && (
              <div className="text-[10px] text-muted-foreground text-center">
                +{incidents.length - 5} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── SLO Status ───────────────────────────────────────────────────────

function SLOStatusPanel({ slos }: { slos: SloDefinition[] }) {
  const active = slos.filter((s) => s.status === 'active');

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {active.length > 0 ? `${active.length} SLO${active.length !== 1 ? 's' : ''} tracked` : 'SLO Status'}
          </h3>
          <Link href="/observability/slos">
            <Button variant="ghost" size="sm" className="text-[11px]">View all SLOs &rarr;</Button>
          </Link>
        </div>
        {active.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Set up SLOs to track service reliability.</p>
            <Link href="/observability/slos" className="text-xs text-primary hover:underline mt-1 block">
              Create your first SLO &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {active.slice(0, 5).map((slo) => {
              const meeting = slo.current_sli_pct !== null && slo.current_sli_pct >= slo.objective_pct;
              return (
                <div key={slo.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate block">{slo.name}</span>
                  </div>
                  <span className={cn(
                    'text-[13px] font-bold font-mono',
                    slo.current_sli_pct === null
                      ? 'text-muted-foreground'
                      : meeting ? 'text-[#16A34A]' : 'text-[#DC2626]',
                  )}>
                    {slo.current_sli_pct !== null ? `${slo.current_sli_pct.toFixed(2)}%` : '\u2014'}
                  </span>
                  {slo.current_sli_pct !== null && (
                    meeting
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                </div>
              );
            })}
            {active.length > 5 && (
              <div className="text-[10px] text-muted-foreground text-center">
                +{active.length - 5} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Synthetic Checks ─────────────────────────────────────────────────

function SyntheticChecksPanel({ checks }: { checks: SyntheticCheck[] }) {
  const active = checks.filter((c) => c.status === 'active');

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {active.length > 0 ? `${active.length} endpoint${active.length !== 1 ? 's' : ''} monitored` : 'Synthetic Checks'}
          </h3>
          <Link href="/observability/synthetics">
            <Button variant="ghost" size="sm" className="text-[11px]">View all checks &rarr;</Button>
          </Link>
        </div>
        {active.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Add synthetic checks to monitor endpoint availability.</p>
            <Link href="/synthetic-checks" className="text-xs text-primary hover:underline mt-1 block">
              Create your first check &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {active.slice(0, 5).map((check) => (
              <div key={check.id} className="flex items-center gap-3">
                {check.last_status === 'up' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : check.last_status === 'down' ? (
                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                ) : check.last_status === 'degraded' ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground truncate block">
                    {check.name}
                  </span>
                  {check.url && (
                    <span className="text-[10px] text-muted-foreground truncate block">{check.url}</span>
                  )}
                </div>
                <span className={cn(
                  'text-[13px] font-mono font-bold shrink-0',
                  check.last_status === 'up' ? 'text-emerald-400' :
                  check.last_status === 'down' ? 'text-red-400' :
                  check.last_status === 'degraded' ? 'text-yellow-400' : 'text-muted-foreground',
                )}>
                  {check.last_response_time_ms !== null ? `${check.last_response_time_ms}ms` : '\u2014'}
                </span>
              </div>
            ))}
            {active.length > 5 && (
              <div className="text-[10px] text-muted-foreground text-center">
                +{active.length - 5} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Connected Data Sources ───────────────────────────────────────────

function getCloudAccountId(conn: ObservabilityConnection): string | null {
  const creds = (conn.config as any)?.credentials;
  if (!creds) return null;
  const provider = (conn.config as any)?.cloud_provider;
  if (provider === 'aws') return creds.account_id || creds.role_arn || null;
  if (provider === 'gcp') return creds.project_id || null;
  if (provider === 'azure') return creds.tenant_id || null;
  if (provider === 'scaleway') return creds.project_id || null;
  if (provider === 'heroku') return creds.api_key ? 'Heroku Account' : null;
  if (provider === 'supabase') return creds.access_token ? 'Supabase Account' : null;
  if (provider === 'vercel') return creds.team_id || (creds.api_token ? 'Vercel Account' : null);
  if (provider === 'digitalocean') return null;
  return null;
}

function ConnectedSourcesPanel({ connections }: { connections: ObservabilityConnection[] }) {
  const connected = connections.filter((c) => c.status === 'connected');

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Connected Data Sources</h3>
          <Link href="/observability/connect">
            <Button variant="ghost" size="sm" className="text-[11px]">Manage connections &rarr;</Button>
          </Link>
        </div>
        {connected.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Connect your first data source to start collecting telemetry.</p>
            <Link href="/observability/connect" className="text-xs text-primary hover:underline mt-1 block">
              Connect a data source &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {connected.map((conn) => {
              const signals: string[] = [];
              if (conn.endpoints.metrics_url) signals.push('Metrics');
              if (conn.endpoints.logs_url) signals.push('Logs');
              if (conn.endpoints.traces_url) signals.push('Traces');
              const cloudId = getCloudAccountId(conn);
              return (
                <div key={conn.id} className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,163,74,0.5)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{conn.name}</span>
                      {cloudId && (
                        <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-[200px]" title={cloudId}>
                          {cloudId}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Connected{signals.length > 0 ? ` \u00B7 ${signals.join(', ')}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function verificationBadge(status: 'verified' | 'missing' | 'not_supported' | 'unknown' | 'covered' | 'partial') {
  if (status === 'verified' || status === 'covered') return <Badge variant="success">{status === 'covered' ? 'Covered' : 'Verified'}</Badge>;
  if (status === 'partial') return <Badge variant="warning">Partial</Badge>;
  if (status === 'not_supported') return <Badge variant="secondary">N/A</Badge>;
  if (status === 'missing') return <Badge variant="destructive">Missing</Badge>;
  return <Badge variant="secondary">Unknown</Badge>;
}

function providerLabel(provider: string) {
  return provider
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function TenantVerificationPanel({ report }: { report: TenantObservabilityVerificationReport }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tenant Verification</h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              Checks whether this tenant has live telemetry and alert coverage across connected providers.
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {formatTimeAgo(report.generated_at)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Metrics</div>
            <div className={cn('text-sm font-semibold mt-1', report.tenant_checks.metrics_available ? 'text-emerald-400' : 'text-red-400')}>
              {report.tenant_checks.metrics_available ? 'Live' : 'Missing'}
            </div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Logs</div>
            <div className={cn('text-sm font-semibold mt-1', report.tenant_checks.logs_available ? 'text-emerald-400' : 'text-red-400')}>
              {report.tenant_checks.logs_available ? 'Live' : 'Missing'}
            </div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active Rules</div>
            <div className="text-sm font-semibold mt-1 text-foreground">{report.summary.active_alert_rules}</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">No Data Rules</div>
            <div className={cn('text-sm font-semibold mt-1', report.summary.alert_rules_no_data > 0 ? 'text-yellow-400' : 'text-emerald-400')}>
              {report.summary.alert_rules_no_data}
            </div>
          </div>
        </div>

        {report.global_gaps.length > 0 && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-3 mb-4">
            <div className="text-[11px] font-semibold text-yellow-400 mb-1">Global Gaps</div>
            <div className="space-y-1">
              {report.global_gaps.map((gap) => (
                <div key={gap} className="text-[11px] text-muted-foreground">{gap}</div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {report.providers.map((provider) => (
            <div key={provider.provider} className="rounded-lg border border-border px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{providerLabel(provider.provider)}</span>
                    <Badge variant={provider.connection_status === 'connected' ? 'success' : provider.connection_status === 'missing' ? 'secondary' : 'warning'}>
                      {provider.connection_status}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {provider.asset_count} assets · {provider.healthy_asset_count} healthy
                    {provider.connection_name ? ` · ${provider.connection_name}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {verificationBadge(provider.metrics_status)}
                  {verificationBadge(provider.logs_status)}
                  {verificationBadge(provider.alert_coverage_status)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-md bg-muted/40 px-2.5 py-2">
                  <div className="text-[10px] text-muted-foreground">Metric series</div>
                  <div className="text-xs font-mono text-foreground mt-1">{provider.evidence.metric_series_count ?? '\u2014'}</div>
                </div>
                <div className="rounded-md bg-muted/40 px-2.5 py-2">
                  <div className="text-[10px] text-muted-foreground">Recent logs</div>
                  <div className="text-xs font-mono text-foreground mt-1">{provider.evidence.log_entry_count ?? 0}</div>
                </div>
                <div className="rounded-md bg-muted/40 px-2.5 py-2">
                  <div className="text-[10px] text-muted-foreground">Active rules</div>
                  <div className="text-xs font-mono text-foreground mt-1">{provider.evidence.active_alert_rule_count}</div>
                </div>
              </div>

              {provider.gaps.length > 0 && (
                <div className="mt-3 space-y-1">
                  {provider.gaps.map((gap) => (
                    <div key={gap} className="text-[11px] text-muted-foreground">
                      <span className="text-red-400 mr-1">•</span>{gap}
                    </div>
                  ))}
                </div>
              )}

              {provider.notes.length > 0 && (
                <div className="mt-2 space-y-1">
                  {provider.notes.map((note) => (
                    <div key={note} className="text-[10px] text-muted-foreground/80">
                      Note: {note}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function ObservabilityOverview() {
  const { data: connsData, isLoading: connsLoading } = useObservabilityConnections();
  const connections = connsData?.data ?? [];

  const { data: servicesData, isLoading: servicesLoading } = useServices();
  const services = servicesData?.data ?? [];

  const { data: openIncidents = [], isLoading: incidentsLoading } = useIncidents({ status: 'open' });

  const { data: alertRulesData, isLoading: alertsLoading } = useAlertRules();
  const alertRules = alertRulesData?.data ?? [];
  const firingAlerts = useMemo(
    () => alertRules.filter((r) => r.alert_state === 'firing' && r.status === 'active'),
    [alertRules],
  );

  const { data: slosData, isLoading: slosLoading } = useSLOs();
  const slos = slosData?.data ?? [];

  const { data: checksData, isLoading: checksLoading } = useSyntheticChecks();
  const checks = checksData?.data ?? [];

  const { data: assetsSummary, isLoading: assetsLoading } = useAssetsSummary();
  const { data: verificationReport, isLoading: verificationLoading } = useTenantObservabilityVerification();

  const isLoading = connsLoading || servicesLoading || incidentsLoading || alertsLoading || slosLoading || checksLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Show empty state if no connections configured
  if (connections.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Observability Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor your infrastructure, services, and applications
        </p>
      </div>

      {/* AI Query Bar */}
      <AIQueryBar />

      {/* KPI Strip */}
      <KPIStrip
        services={services}
        openIncidents={openIncidents}
        firingAlerts={firingAlerts}
        slos={slos}
        assetsSummary={assetsSummary}
      />

      {/* Onboarding hints for empty sections */}
      {(services.length === 0 || alertRules.length === 0 || slos.length === 0 || checks.length === 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {services.length === 0 && (
            <Link href="/services" className="flex items-center gap-3 rounded-lg border border-dashed border-info/30 bg-info/5 p-3 hover:bg-info/10 transition-colors">
              <Server className="h-5 w-5 text-info shrink-0" />
              <div><p className="text-xs font-semibold text-foreground">Add Services</p><p className="text-[10px] text-muted-foreground">Define your service catalog</p></div>
            </Link>
          )}
          {alertRules.length === 0 && (
            <Link href="/observability/alerts" className="flex items-center gap-3 rounded-lg border border-dashed border-warning/30 bg-warning/5 p-3 hover:bg-warning/10 transition-colors">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              <div><p className="text-xs font-semibold text-foreground">Create Alert Rules</p><p className="text-[10px] text-muted-foreground">Get notified on anomalies</p></div>
            </Link>
          )}
          {slos.length === 0 && (
            <Link href="/observability/slos" className="flex items-center gap-3 rounded-lg border border-dashed border-brand/30 bg-brand/5 p-3 hover:bg-brand/10 transition-colors">
              <Shield className="h-5 w-5 text-brand shrink-0" />
              <div><p className="text-xs font-semibold text-foreground">Define SLOs</p><p className="text-[10px] text-muted-foreground">Track error budgets</p></div>
            </Link>
          )}
          {checks.length === 0 && (
            <Link href="/observability/synthetics" className="flex items-center gap-3 rounded-lg border border-dashed border-success/30 bg-success/5 p-3 hover:bg-success/10 transition-colors">
              <Activity className="h-5 w-5 text-success shrink-0" />
              <div><p className="text-xs font-semibold text-foreground">Add Synthetic Checks</p><p className="text-[10px] text-muted-foreground">Monitor endpoint uptime</p></div>
            </Link>
          )}
        </div>
      )}

      {/* Infrastructure Inventory */}
      <InfrastructureInventory summary={assetsSummary} />

      {/* Tenant Verification */}
      {!verificationLoading && verificationReport && (
        <TenantVerificationPanel report={verificationReport} />
      )}

      {/* Service Catalog */}
      <ServiceCatalog services={services} alertRules={alertRules} slos={slos} />

      {/* Firing Alerts + Open Incidents */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <FiringAlertsPanel alerts={firingAlerts} />
        <OpenIncidentsPanel incidents={openIncidents} />
      </div>

      {/* SLO Status + Synthetic Checks */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SLOStatusPanel slos={slos} />
        <SyntheticChecksPanel checks={checks} />
      </div>

      {/* Connected Data Sources */}
      <ConnectedSourcesPanel connections={connections} />
    </div>
  );
}
