'use client';

import { useRouter } from 'next/navigation';
import { Zap, TicketCheck, Phone, Clock, BookOpen, Bot, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { PriorityBadge } from '@/components/shared/PriorityBadge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { MetricCard } from './MetricCard';
import {
  useDashboardStats,
  useRecentTickets,
  useIncidentsSummary,
  useServicesHealth,
  useOnCallStatus,
  severityColor,
  severityLabel,
  formatSeconds,
  statusDotColor,
} from './useDashboardData';
import type { TicketPriority } from '@/lib/hooks/useTickets';

export function SREEngineerDash() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: ticketsData, isLoading: ticketsLoading } = useRecentTickets();
  const { data: incidentsData, isLoading: incidentsLoading } = useIncidentsSummary();
  const { data: servicesData } = useServicesHealth();
  const { data: onCallData } = useOnCallStatus();

  const tickets = ticketsData?.data || [];
  const incidents = incidentsData?.data || [];
  const services = servicesData?.services || [];
  const schedules = onCallData?.data || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Incidents"
          value={stats?.active_incidents ?? 0}
          icon={Zap}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
          pulse={(stats?.active_incidents ?? 0) > 0}
          trend={stats && stats.active_incidents > 0 ? `${stats.active_incidents} need attention` : undefined}
          trendColor="#DC2626"
          trendBg="#FEF2F2"
          loading={statsLoading}
        />
        <MetricCard
          label="My Open Tickets"
          value={stats?.open_tickets ?? 0}
          icon={TicketCheck}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
          trend={stats ? `${stats.overdue_count} overdue` : undefined}
          trendColor={stats && stats.overdue_count > 0 ? '#DC2626' : '#16A34A'}
          trendBg={stats && stats.overdue_count > 0 ? '#FEF2F2' : '#F0FDF4'}
          loading={statsLoading}
        />
        <MetricCard
          label="On-Call Status"
          value={schedules.length > 0 ? 'On Call' : 'Off Duty'}
          icon={Phone}
          iconBg={schedules.length > 0 ? '#F0FDF4' : '#F1F5F9'}
          iconColor={schedules.length > 0 ? '#16A34A' : '#94A3B8'}
          accent={schedules.length > 0 ? 'green' : undefined}
          loading={false}
        />
        <MetricCard
          label="MTTR (30d)"
          value={stats ? formatSeconds(stats.avg_resolution_minutes * 60) : '—'}
          icon={Clock}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
          loading={statsLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* My Incidents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#DC2626]" />
                Active Incidents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {incidentsLoading ? (
                <LoadingSpinner />
              ) : incidents.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0]">
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Severity</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Incident</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Service</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Status</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((inc) => (
                        <tr
                          key={inc.id}
                          className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                          onClick={() => router.push(`/incidents/${inc.id}`)}
                        >
                          <td className="py-2.5">
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                              style={{ backgroundColor: severityColor(inc.severity) }}
                            >
                              {severityLabel(inc.severity)}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <span className="font-mono text-[10px] text-[#94A3B8]">INC-{String(inc.number).padStart(4, '0')}</span>
                            <p className="mt-0.5 font-medium text-[#0F172A] dark:text-[#E2E8F0] truncate max-w-[250px]">{inc.title}</p>
                          </td>
                          <td className="py-2.5 text-[#64748B]">
                            {inc.affected_services?.[0]?.name || '—'}
                          </td>
                          <td className="py-2.5">
                            <StatusBadge status={inc.status} />
                          </td>
                          <td className="py-2.5 font-mono text-[#64748B]">
                            {formatDistanceToNow(new Date(inc.created_at))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-[#64748B]">No active incidents. All clear!</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Tickets */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TicketCheck className="h-4 w-4 text-brand" />
                Recent Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ticketsLoading ? (
                <LoadingSpinner />
              ) : tickets.length > 0 ? (
                <div className="space-y-2">
                  {tickets.slice(0, 6).map((ticket) => (
                    <a
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="flex items-center justify-between rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] p-3 transition-all hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] hover:shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-[#94A3B8]">
                            TK-{String(ticket.number).padStart(4, '0')}
                          </span>
                          <PriorityBadge priority={ticket.priority as TicketPriority} />
                          <StatusBadge status={ticket.status} />
                        </div>
                        <p className="mt-1 truncate text-[12px] font-semibold text-[#0F172A] dark:text-[#E2E8F0]">
                          {ticket.title}
                        </p>
                      </div>
                      <span className="ml-3 shrink-0 text-[10px] text-[#94A3B8]">
                        {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-[#64748B]">No tickets yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Service Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4" />
                Service Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              {services.length > 0 ? (
                <div className="space-y-2.5">
                  {services.slice(0, 8).map((svc) => (
                    <div key={svc.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: statusDotColor(svc.current_status) }}
                        />
                        <span className="text-xs font-medium text-[#334155] dark:text-[#E2E8F0]">
                          {svc.name}
                        </span>
                      </div>
                      <span className="text-[10px] capitalize text-[#94A3B8]">
                        {svc.current_status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-[#64748B]">No services configured</p>
              )}
            </CardContent>
          </Card>

          {/* On-Call Now */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4" />
                On-Call Now
              </CardTitle>
            </CardHeader>
            <CardContent>
              {schedules.length > 0 ? (
                <div className="space-y-3">
                  {schedules.slice(0, 4).map((s) => (
                    <div key={s.schedule_id} className="rounded-lg bg-[#F8FAFC] dark:bg-navy-elevated p-3">
                      <p className="text-[11px] font-semibold text-[#334155] dark:text-[#E2E8F0]">{s.schedule_name}</p>
                      {s.layers?.[0]?.users?.slice(0, 2).map((u) => (
                        <p key={u.id} className="mt-1 text-[11px] text-[#64748B]">{u.name || u.email}</p>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center">
                  <p className="text-xs text-[#64748B]">No schedules configured</p>
                  <button
                    onClick={() => router.push('/on-call')}
                    className="mt-2 text-xs text-brand font-semibold hover:underline"
                  >
                    Set up on-call →
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Copilot Suggestions */}
          <Card className="border-[#1E3A5F] bg-gradient-to-br from-[#0D1117] to-[#1E3A5F]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Bot className="h-4 w-4 text-brand" />
                AI Copilot
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-[#94A3B8]">
                {incidents.length > 0
                  ? `${incidents.length} active incident${incidents.length > 1 ? 's' : ''} — AI analysis available`
                  : 'No active incidents. AI agents are monitoring your services.'}
              </p>
              {incidents.length > 0 && (
                <button
                  onClick={() => router.push(`/incidents/${incidents[0].id}`)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand/90 transition-colors"
                >
                  <Bot className="h-3 w-3" />
                  View AI Analysis
                </button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex h-32 items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-brand animate-spin" />
    </div>
  );
}
