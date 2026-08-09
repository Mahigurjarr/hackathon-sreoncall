'use client';

import {
  Shield,
  Building2,
  Users,
  Activity,
  Loader2,
  TrendingUp,
  TicketCheck,
  Siren,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { usePlatformOverview, useSystemHealth } from '@/lib/hooks/usePlatformAdmin';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  starter: 'bg-blue-100 text-blue-700',
  business: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  provisioning: 'bg-yellow-100 text-yellow-700',
  deleted: 'bg-gray-100 text-gray-500',
};

const HEALTH_COLORS: Record<string, string> = {
  healthy: 'text-green-600',
  degraded: 'text-yellow-600',
  unhealthy: 'text-red-600',
};

interface KPICardProps {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
  loading?: boolean;
  accent?: string; // hex color, e.g. '#DC2626' for critical
}

function KPICard({ title, value, description, icon, loading, accent }: KPICardProps) {
  const iconBg = accent
    ? `${accent}1a` // 10% opacity
    : 'rgba(255,107,43,0.10)';
  const iconColor = accent ?? '#FF6B2B';

  return (
    <Card className="relative overflow-hidden">
      {accent && (
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: accent }}
        />
      )}
      <CardContent className="pt-5 pb-4">
        {loading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg"
              style={{ background: iconBg, color: iconColor }}
            >
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {title}
              </p>
              <p className="mt-0.5 text-[22px] font-bold leading-none text-foreground">
                {value}
              </p>
            </div>
          </div>
        )}
        {!loading && (
          <div
            className="mt-3 inline-flex items-center rounded px-2 py-1 text-[9px] font-medium"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          >
            {description}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { data: overview, isLoading: overviewLoading } = usePlatformOverview();
  const { data: health, isLoading: healthLoading } = useSystemHealth();

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-1 h-8 w-[5px] shrink-0 rounded-full bg-[#FF6B2B]" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Platform Overview</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cross-tenant platform analytics and system status
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Tenants"
          value={overview?.total_tenants ?? 0}
          description={`${overview?.active_tenants ?? 0} active, ${overview?.suspended_tenants ?? 0} suspended`}
          icon={<Building2 className="h-5 w-5" />}
          loading={overviewLoading}
        />
        <KPICard
          title="Total Users"
          value={overview?.total_users ?? 0}
          description={`${overview?.active_users ?? 0} active users`}
          icon={<Users className="h-5 w-5" />}
          loading={overviewLoading}
        />
        <KPICard
          title="System Status"
          value={health?.status ?? '...'}
          description={
            health
              ? `${health.services.filter((s) => s.status === 'up').length}/${health.services.length} services up`
              : 'Checking...'
          }
          icon={<Activity className="h-5 w-5" />}
          loading={healthLoading}
          accent={health?.status === 'unhealthy' ? '#DC2626' : health?.status === 'degraded' ? '#EAB308' : undefined}
        />
        <KPICard
          title="Total Tickets"
          value={overview?.total_tickets ?? 0}
          description="Across all tenants"
          icon={<TicketCheck className="h-5 w-5" />}
          loading={overviewLoading}
        />
        <KPICard
          title="Incidents"
          value={overview?.total_incidents ?? 0}
          description={`${overview?.active_incidents ?? 0} active`}
          icon={<Siren className="h-5 w-5" />}
          loading={overviewLoading}
          accent={overview?.active_incidents && overview.active_incidents > 0 ? '#DC2626' : undefined}
        />
        <KPICard
          title="Plans Breakdown"
          value={
            overview?.tenants_by_plan
              ? Object.values(overview.tenants_by_plan).reduce((a, b) => a + b, 0)
              : 0
          }
          description={
            overview?.tenants_by_plan
              ? Object.entries(overview.tenants_by_plan)
                  .map(([plan, count]) => `${count} ${plan}`)
                  .join(', ')
              : 'Loading...'
          }
          icon={<TrendingUp className="h-5 w-5" />}
          loading={overviewLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* System Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : health ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Overall:</span>
                  <span className={`text-sm font-bold capitalize ${HEALTH_COLORS[health.status] || ''}`}>
                    {health.status}
                  </span>
                </div>
                <div className="space-y-2">
                  {health.services.map((service) => (
                    <div
                      key={service.name}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            service.status === 'up'
                              ? 'bg-green-500'
                              : service.status === 'degraded'
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                          }`}
                        />
                        <span className="text-sm font-medium capitalize text-foreground">
                          {service.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {service.latency_ms !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            {service.latency_ms}ms
                          </span>
                        )}
                        <Badge
                          variant={service.status === 'up' ? 'success' : 'destructive'}
                          className="capitalize"
                        >
                          {service.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Unable to fetch system health.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Tenants by Plan */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Tenants by Plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overviewLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : overview?.tenants_by_plan ? (
              <div className="space-y-3">
                {Object.entries(overview.tenants_by_plan).map(([plan, count]) => (
                  <div
                    key={plan}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className={PLAN_COLORS[plan] || 'bg-gray-100 text-gray-700'}>
                        {plan}
                      </Badge>
                    </div>
                    <span className="text-lg font-bold text-foreground">{count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tenant data available.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recent Signups */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Recent Signups
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overviewLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : overview?.recent_signups && overview.recent_signups.length > 0 ? (
              <div className="space-y-2">
                {overview.recent_signups.map((tenant) => (
                  <Link
                    key={tenant.id}
                    href={`/admin/tenants`}
                    className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{tenant.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {tenant.slug}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={PLAN_COLORS[tenant.plan] || ''}>
                        {tenant.plan}
                      </Badge>
                      <Badge className={STATUS_COLORS[tenant.status] || ''}>
                        {tenant.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(tenant.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tenants yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
