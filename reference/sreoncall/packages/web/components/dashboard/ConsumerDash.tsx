'use client';

import { useRouter } from 'next/navigation';
import { Zap, TicketCheck, ArrowUpRight, CheckCircle2, BookOpen, Inbox, Server } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PriorityBadge } from '@/components/shared/PriorityBadge';
import { formatDistanceToNow } from 'date-fns';
import { MetricCard } from './MetricCard';
import {
  useDashboardStats,
  useRecentTickets,
  useIncidentsSummary,
  useServicesHealth,
  severityColor,
  severityLabel,
  statusDotColor,
} from './useDashboardData';
import type { TicketPriority } from '@/lib/hooks/useTickets';

export function ConsumerDash() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: ticketsData } = useRecentTickets();
  const { data: incidentsData } = useIncidentsSummary();
  const { data: servicesData } = useServicesHealth();

  const tickets = ticketsData?.data || [];
  const incidents = incidentsData?.data || [];
  const services = servicesData?.services || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="My Incidents"
          value={stats?.active_incidents ?? 0}
          icon={Zap}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
          loading={statsLoading}
        />
        <MetricCard
          label="My Tickets"
          value={stats?.open_tickets ?? 0}
          icon={TicketCheck}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
          loading={statsLoading}
        />
        <MetricCard
          label="Escalated to Provider"
          value="—"
          icon={ArrowUpRight}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
        />
        <MetricCard
          label="SLA Compliance"
          value={stats ? `${stats.sla_compliance}%` : '—'}
          icon={CheckCircle2}
          iconBg="#F0FDF4"
          iconColor="#16A34A"
          accent="green"
          loading={statsLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Incidents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#DC2626]" />
                My Incidents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {incidents.length > 0 ? (
                <div className="space-y-2">
                  {incidents.slice(0, 6).map((inc) => (
                    <div
                      key={inc.id}
                      className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-3 hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                      onClick={() => router.push(`/incidents/${inc.id}`)}
                    >
                      <span
                        className="inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                        style={{ backgroundColor: severityColor(inc.severity) }}
                      >
                        {severityLabel(inc.severity)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#0F172A] dark:text-[#E2E8F0] truncate">{inc.title}</p>
                        <p className="text-[10px] text-[#94A3B8]">
                          {inc.affected_services?.[0]?.name || '—'} · {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}
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

          {/* Tickets */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TicketCheck className="h-4 w-4 text-brand" />
                My Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tickets.length > 0 ? (
                <div className="space-y-2">
                  {tickets.slice(0, 5).map((ticket) => (
                    <a
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="flex items-center justify-between rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-3 hover:bg-[#F8FAFC] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-[#94A3B8]">TK-{String(ticket.number).padStart(4, '0')}</span>
                        <PriorityBadge priority={ticket.priority as TicketPriority} />
                        <span className="text-xs font-medium text-[#0F172A] dark:text-[#E2E8F0] truncate">{ticket.title}</span>
                      </div>
                      <StatusBadge status={ticket.status} />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-[#64748B]">No tickets</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Shared Runbooks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <BookOpen className="h-4 w-4" />
                Shared Runbooks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="py-4 text-center text-xs text-[#64748B]">
                Runbooks shared by your provider
              </p>
              <button
                onClick={() => router.push('/runbooks')}
                className="w-full rounded-lg border border-brand text-brand text-xs font-semibold py-2 hover:bg-brand hover:text-white transition-colors"
              >
                View Runbooks
              </button>
            </CardContent>
          </Card>

          {/* Provider Communication */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Inbox className="h-4 w-4" />
                Provider Communication
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="py-4 text-center text-xs text-[#64748B]">
                Messages with your MSP provider
              </p>
              <button
                onClick={() => router.push('/communications')}
                className="w-full rounded-lg border border-brand text-brand text-xs font-semibold py-2 hover:bg-brand hover:text-white transition-colors"
              >
                Open Communications
              </button>
            </CardContent>
          </Card>

          {/* Service Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Server className="h-4 w-4" />
                Service Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              {services.length > 0 ? (
                <div className="space-y-2.5">
                  {services.slice(0, 6).map((svc) => (
                    <div key={svc.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusDotColor(svc.current_status) }} />
                        <span className="text-xs font-medium text-[#334155] dark:text-[#E2E8F0]">{svc.name}</span>
                      </div>
                      <span className="text-[10px] capitalize text-[#94A3B8]">{svc.current_status.replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-[#64748B]">No services</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
