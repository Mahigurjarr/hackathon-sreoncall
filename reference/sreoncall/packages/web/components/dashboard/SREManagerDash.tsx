'use client';

import { useRouter } from 'next/navigation';
import { Zap, CheckCircle2, Clock, TrendingDown, GitPullRequest, Users, FileText, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { MetricCard } from './MetricCard';
import {
  useDashboardStats,
  useSLASummary,
  useChangesSummary,
  useIncidentsSummary,
  useDashboardActivity,
  useAgentSummary,
  formatDuration,
} from './useDashboardData';

export function SREManagerDash() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: slaSummary } = useSLASummary();
  const { data: changesSummary } = useChangesSummary();
  const { data: incidents } = useIncidentsSummary();
  const { data: activityData } = useDashboardActivity();
  const { data: agentSummary } = useAgentSummary();

  const activityItems = activityData?.data || [];
  const recentChanges = changesSummary?.recent || [];
  const slaByService = slaSummary?.by_service || [];
  const pendingApproval = changesSummary?.by_status?.pending_approval || 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Active Incidents"
          value={stats?.active_incidents ?? 0}
          icon={Zap}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
          loading={statsLoading}
        />
        <MetricCard
          label="SLA Compliance"
          value={slaSummary ? `${slaSummary.compliance_percentage}%` : '—'}
          icon={CheckCircle2}
          iconBg="#F0FDF4"
          iconColor="#16A34A"
          accent="green"
          trend={slaSummary && slaSummary.breached_count > 0 ? `${slaSummary.breached_count} breached` : undefined}
          trendColor="#DC2626"
          trendBg="#FEF2F2"
          loading={!slaSummary}
        />
        <MetricCard
          label="MTTR (30d)"
          value={stats ? formatDuration(stats.avg_resolution_minutes) : '—'}
          icon={TrendingDown}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
          loading={statsLoading}
        />
        <MetricCard
          label="Open Tickets"
          value={stats?.open_tickets ?? 0}
          icon={Clock}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
          loading={statsLoading}
        />
        <MetricCard
          label="Pending Changes"
          value={pendingApproval}
          icon={GitPullRequest}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent={pendingApproval > 0 ? 'yellow' : undefined}
          trend={pendingApproval > 0 ? 'Awaiting CAB approval' : undefined}
          trendColor="#EAB308"
          trendBg="#FEFCE8"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* SLA Performance by Service */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
                SLA Performance by Service
              </CardTitle>
            </CardHeader>
            <CardContent>
              {slaByService.length > 0 ? (
                <div className="space-y-3">
                  {slaByService.slice(0, 8).map((entry) => {
                    const pct = entry.compliance;
                    const barColor = pct >= 95 ? '#16A34A' : pct >= 90 ? '#EAB308' : '#DC2626';
                    return (
                      <div key={entry.service_id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-[#334155] dark:text-[#E2E8F0]">
                            {entry.service_name}
                          </span>
                          <span className="text-xs font-mono font-semibold" style={{ color: barColor }}>
                            {pct}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[#F1F5F9]">
                          <div
                            className="h-2 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: barColor }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-[#64748B]">No SLA data available yet</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Changes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitPullRequest className="h-4 w-4" />
                Recent Changes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentChanges.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0]">
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Change</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Type</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Risk</th>
                        <th className="pb-2 text-left font-medium text-[#64748B] uppercase text-[10px] tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentChanges.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                          onClick={() => router.push(`/changes/${c.id}`)}
                        >
                          <td className="py-2.5">
                            <span className="font-mono text-[10px] text-[#94A3B8]">CHG-{String(c.number).padStart(3, '0')}</span>
                            <p className="mt-0.5 font-medium text-[#0F172A] dark:text-[#E2E8F0] truncate max-w-[200px]">{c.title}</p>
                          </td>
                          <td className="py-2.5 capitalize text-[#64748B]">{c.type}</td>
                          <td className="py-2.5">
                            <RiskBadge score={c.risk_score} />
                          </td>
                          <td className="py-2.5">
                            <StatusBadge status={c.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-[#64748B]">No recent changes</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Pending Approvals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4" />
                Pending Approvals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pendingApproval > 0 && (
                  <ApprovalItem
                    label={`${pendingApproval} change request${pendingApproval > 1 ? 's' : ''}`}
                    sub="Awaiting CAB approval"
                    color="#EAB308"
                    onClick={() => router.push('/changes')}
                  />
                )}
                {(agentSummary?.pending_approvals ?? 0) > 0 && (
                  <ApprovalItem
                    label={`${agentSummary!.pending_approvals} agent action${agentSummary!.pending_approvals > 1 ? 's' : ''}`}
                    sub="High-risk actions need review"
                    color="#FF6B2B"
                    onClick={() => router.push('/agents/approvals')}
                  />
                )}
                {pendingApproval === 0 && (agentSummary?.pending_approvals ?? 0) === 0 && (
                  <p className="py-4 text-center text-xs text-[#64748B]">No pending approvals</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Team Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activityItems.length > 0 ? (
                <div className="space-y-3">
                  {activityItems.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between border-b border-[#F1F5F9] pb-3 last:border-0 last:pb-0"
                    >
                      <div>
                        <p className="text-[11px] font-medium text-[#0F172A] dark:text-[#E2E8F0]">{item.action}</p>
                        <p className="text-[10px] text-[#94A3B8]">by {item.actor}</p>
                      </div>
                      <span className="text-[10px] text-[#94A3B8] shrink-0 ml-2">
                        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-[#64748B]">No recent activity</p>
              )}
            </CardContent>
          </Card>

          {/* Post-Mortem Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4" />
                Post-Mortems
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <StatPill label="Draft" value="—" color="#EAB308" />
                <StatPill label="In Review" value="—" color="#2563EB" />
                <StatPill label="Published" value="—" color="#16A34A" />
              </div>
              <button
                onClick={() => router.push('/postmortems')}
                className="mt-3 text-xs text-brand font-semibold hover:underline"
              >
                View all post-mortems →
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RiskBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[#94A3B8]">—</span>;
  const color = score >= 75 ? '#DC2626' : score >= 50 ? '#FF6B2B' : score >= 25 ? '#EAB308' : '#16A34A';
  const label = score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low';
  return (
    <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ color, backgroundColor: `${color}15` }}>
      {label}
    </span>
  );
}

function ApprovalItem({ label, sub, color, onClick }: { label: string; sub: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-[#E2E8F0] p-3 text-left hover:bg-[#F8FAFC] transition-colors"
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <p className="text-xs font-semibold text-[#0F172A] dark:text-[#E2E8F0]">{label}</p>
      <p className="text-[10px] text-[#94A3B8] mt-0.5">{sub}</p>
    </button>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex-1 rounded-lg bg-[#F8FAFC] dark:bg-navy-elevated p-3 text-center">
      <p className="text-[16px] font-bold font-mono" style={{ color }}>{value}</p>
      <p className="text-[10px] text-[#64748B] mt-1">{label}</p>
    </div>
  );
}
