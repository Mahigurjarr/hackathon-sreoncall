'use client';

import { useRouter } from 'next/navigation';
import { Building2, Zap, CheckCircle2, Inbox, BookOpen, Bot, BarChart3 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { MetricCard } from './MetricCard';
import { formatDistanceToNow } from 'date-fns';
import {
  useProviderOverview,
  useAgentSummary,
  useDashboardStats,
  statusDotColor,
} from './useDashboardData';

export function MSPProviderDash() {
  const router = useRouter();
  const { data: providerData, isLoading: providerLoading } = useProviderOverview(true);
  const { data: agentSummary } = useAgentSummary();
  const { data: stats } = useDashboardStats();

  const consumers = providerData?.data || [];
  const totalEscalated = consumers.reduce((sum, c) => sum + c.active_incidents, 0);
  const avgSla = consumers.length > 0
    ? Math.round(consumers.reduce((sum, c) => sum + c.sla_compliance, 0) / consumers.length * 10) / 10
    : 100;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Consumer Tenants"
          value={consumers.length}
          icon={Building2}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
          loading={providerLoading}
        />
        <MetricCard
          label="Escalated Incidents"
          value={totalEscalated}
          icon={Zap}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
          pulse={totalEscalated > 0}
          loading={providerLoading}
        />
        <MetricCard
          label="Cross-Tenant SLA"
          value={`${avgSla}%`}
          icon={CheckCircle2}
          iconBg="#F0FDF4"
          iconColor="#16A34A"
          accent={avgSla >= 95 ? 'green' : avgSla >= 90 ? 'yellow' : 'red'}
          loading={providerLoading}
        />
        <MetricCard
          label="Shared Runbooks"
          value="—"
          icon={BookOpen}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
        />
        <MetricCard
          label="Agent Executions (30d)"
          value={agentSummary?.executions_30d ?? 0}
          icon={Bot}
          iconBg="#F1F5F9"
          iconColor="#64748B"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Consumer Health Matrix */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Consumer Health Matrix
              </CardTitle>
            </CardHeader>
            <CardContent>
              {consumers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0]">
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Tenant</th>
                        <th className="pb-2 text-center font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Incidents</th>
                        <th className="pb-2 text-center font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Tickets</th>
                        <th className="pb-2 text-center font-medium text-[#64748B] uppercase text-[10px] tracking-wider">SLA %</th>
                        <th className="pb-2 text-center font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumers.map((c) => {
                        const slaColor = c.sla_compliance >= 95 ? '#16A34A' : c.sla_compliance >= 90 ? '#EAB308' : '#DC2626';
                        const rowBg = c.sla_compliance < 95 ? 'bg-red-50/50 dark:bg-red-900/10' : '';
                        return (
                          <tr
                            key={c.consumer_id}
                            className={`border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors ${rowBg}`}
                            onClick={() => router.push(`/consumers`)}
                          >
                            <td className="py-3">
                              <p className="font-semibold text-[#0F172A] dark:text-[#E2E8F0]">{c.consumer_name}</p>
                              <p className="text-[10px] text-[#94A3B8]">{c.consumer_slug}</p>
                            </td>
                            <td className="py-3 text-center">
                              <span className={`font-mono font-semibold ${c.active_incidents > 0 ? 'text-[#DC2626]' : 'text-[#64748B]'}`}>
                                {c.active_incidents}
                              </span>
                            </td>
                            <td className="py-3 text-center font-mono text-[#64748B]">{c.open_tickets}</td>
                            <td className="py-3 text-center">
                              <span className="font-mono font-semibold" style={{ color: slaColor }}>
                                {c.sla_compliance}%
                              </span>
                            </td>
                            <td className="py-3 text-center">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: c.active_incidents > 0 ? '#DC2626' : c.sla_compliance < 95 ? '#EAB308' : '#16A34A' }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-[#64748B]">No consumer tenants linked</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Communication Inbox */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Inbox className="h-4 w-4" />
                Communication Inbox
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="py-4 text-center text-xs text-[#64748B]">
                View consumer messages
              </p>
              <button
                onClick={() => router.push('/consumers/communications')}
                className="w-full rounded-lg border border-brand text-brand text-xs font-semibold py-2 hover:bg-brand hover:text-white transition-colors"
              >
                Open Inbox
              </button>
            </CardContent>
          </Card>

          {/* Agent Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Bot className="h-4 w-4" />
                Agent Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Executions" value={agentSummary?.executions_30d ?? 0} />
                <MiniStat label="Successful" value={agentSummary?.successful ?? 0} color="#16A34A" />
                <MiniStat label="Failed" value={agentSummary?.failed ?? 0} color="#DC2626" />
                <MiniStat label="Pending" value={agentSummary?.pending_approvals ?? 0} color="#EAB308" />
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <ProviderAction label="View Consumer Incidents" onClick={() => router.push('/consumers/incidents')} />
                <ProviderAction label="View Consumer Tickets" onClick={() => router.push('/consumers/tickets')} />
                <ProviderAction label="SLA Metrics" onClick={() => router.push('/consumers/sla')} />
                <ProviderAction label="Manage Runbooks" onClick={() => router.push('/runbooks')} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg bg-[#F8FAFC] dark:bg-navy-elevated p-3 text-center">
      <p className="text-[16px] font-bold font-mono" style={{ color: color || '#0F172A' }}>{value}</p>
      <p className="text-[10px] text-[#64748B] mt-1">{label}</p>
    </div>
  );
}

function ProviderAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-3 py-2 text-xs font-medium text-[#334155] dark:text-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-brand/30 transition-all"
    >
      {label} →
    </button>
  );
}
