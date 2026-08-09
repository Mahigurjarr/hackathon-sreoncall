'use client';

import { useRouter } from 'next/navigation';
import { Server, BellRing, Activity, Gauge, GitPullRequest, Zap, LineChart } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { MetricCard } from './MetricCard';
import { formatDistanceToNow } from 'date-fns';
import {
  useDashboardStats,
  useServicesHealth,
  useIncidentsSummary,
  useChangesSummary,
  severityColor,
  severityLabel,
  statusDotColor,
} from './useDashboardData';

export function PlatformEngineerDash() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: servicesData } = useServicesHealth();
  const { data: incidentsData } = useIncidentsSummary();
  const { data: changesSummary } = useChangesSummary();

  const services = servicesData?.services || [];
  const incidents = incidentsData?.data || [];
  const recentChanges = changesSummary?.recent || [];
  const totalServices = servicesData?.total || 0;
  const operational = servicesData?.by_status?.operational || 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Services Operational"
          value={`${operational}/${totalServices}`}
          icon={Server}
          iconBg="#F0FDF4"
          iconColor="#16A34A"
          accent={operational < totalServices ? 'yellow' : 'green'}
          loading={!servicesData}
        />
        <MetricCard
          label="Active Alerts"
          value={stats?.active_incidents ?? 0}
          icon={BellRing}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
          loading={statsLoading}
        />
        <MetricCard
          label="SLA Compliance"
          value={stats ? `${stats.sla_compliance}%` : '—'}
          icon={Gauge}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
          loading={statsLoading}
        />
        <MetricCard
          label="Open Tickets"
          value={stats?.open_tickets ?? 0}
          icon={Activity}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
          loading={statsLoading}
        />
        <MetricCard
          label="Changes Today"
          value={recentChanges.length}
          icon={GitPullRequest}
          iconBg="#F1F5F9"
          iconColor="#64748B"
          loading={!changesSummary}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Infrastructure Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                Infrastructure Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {services.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {services.map((svc) => (
                    <div
                      key={svc.id}
                      className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-3 hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
                      onClick={() => router.push('/services')}
                    >
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: statusDotColor(svc.current_status) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#0F172A] dark:text-[#E2E8F0] truncate">{svc.name}</p>
                        <p className="text-[10px] text-[#94A3B8] capitalize">{svc.type} · {svc.current_status.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-[#64748B]">No services configured</p>
              )}
            </CardContent>
          </Card>

          {/* Alert Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-[#DC2626]" />
                Active Incidents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {incidents.length > 0 ? (
                <div className="space-y-3">
                  {incidents.slice(0, 8).map((inc) => (
                    <div
                      key={inc.id}
                      className="flex items-start gap-3 rounded-lg border-l-4 bg-[#F8FAFC] dark:bg-navy-elevated p-3 cursor-pointer hover:bg-[#F1F5F9] transition-colors"
                      style={{ borderLeftColor: severityColor(inc.severity) }}
                      onClick={() => router.push(`/incidents/${inc.id}`)}
                    >
                      <span
                        className="mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                        style={{ backgroundColor: severityColor(inc.severity) }}
                      >
                        {severityLabel(inc.severity)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#0F172A] dark:text-[#E2E8F0] truncate">{inc.title}</p>
                        <p className="text-[10px] text-[#94A3B8] mt-0.5">
                          {inc.affected_services?.[0]?.name || 'Unknown service'} · {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <StatusBadge status={inc.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-[#64748B]">No active incidents</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <QuickAction icon={BellRing} label="Alert Rules" onClick={() => router.push('/observability/alerts')} />
                <QuickAction icon={Zap} label="Create Incident" onClick={() => router.push('/incidents')} />
                <QuickAction icon={LineChart} label="Query Metrics" onClick={() => router.push('/observability/metrics')} />
                <QuickAction icon={Activity} label="Synthetics" onClick={() => router.push('/observability/synthetics')} />
                <QuickAction icon={Gauge} label="SLOs" onClick={() => router.push('/observability/slos')} />
                <QuickAction icon={Server} label="Dashboards" onClick={() => router.push('/dashboards')} />
              </div>
            </CardContent>
          </Card>

          {/* Recent Changes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <GitPullRequest className="h-4 w-4" />
                Recent Deployments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentChanges.length > 0 ? (
                <div className="space-y-2.5">
                  {recentChanges.slice(0, 4).map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-2.5 cursor-pointer hover:bg-[#F8FAFC] transition-colors"
                      onClick={() => router.push(`/changes/${c.id}`)}
                    >
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] truncate">{c.title}</p>
                        <p className="text-[10px] text-[#94A3B8] mt-0.5">
                          {c.type} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-[#64748B]">No recent changes</p>
              )}
            </CardContent>
          </Card>

          {/* Service Status Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(servicesData?.by_status || {}).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusDotColor(status) }} />
                      <span className="text-xs capitalize text-[#334155] dark:text-[#E2E8F0]">{status.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-xs font-mono font-semibold text-[#64748B]">{count as number}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: typeof Server; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-2.5 text-xs font-medium text-[#334155] dark:text-[#E2E8F0] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] hover:border-brand/30 transition-all"
    >
      <Icon className="h-3.5 w-3.5 text-[#64748B]" />
      {label}
    </button>
  );
}
