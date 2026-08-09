'use client';

import { useRouter } from 'next/navigation';
import { Users, TicketCheck, HardDrive, Activity, CreditCard, Settings, Shield, ClipboardList, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { formatDistanceToNow } from 'date-fns';
import { MetricCard } from './MetricCard';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import {
  useDashboardStats,
  useDashboardActivity,
  useServicesHealth,
  useAgentSummary,
} from './useDashboardData';

export function TenantAdminDash() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: activityData } = useDashboardActivity();
  const { data: servicesData } = useServicesHealth();
  const { data: agentSummary } = useAgentSummary();
  const { data: currentUser } = useCurrentUser();

  const activityItems = activityData?.data || [];
  const plan = currentUser?.tenant?.plan || 'free';

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Open Tickets"
          value={stats?.open_tickets ?? 0}
          icon={TicketCheck}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
          loading={statsLoading}
        />
        <MetricCard
          label="Active Incidents"
          value={stats?.active_incidents ?? 0}
          icon={Activity}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
          loading={statsLoading}
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
        <MetricCard
          label="Services"
          value={servicesData?.total ?? 0}
          icon={HardDrive}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
          loading={!servicesData}
        />
        <MetricCard
          label="Plan"
          value={plan.charAt(0).toUpperCase() + plan.slice(1)}
          icon={CreditCard}
          iconBg="#F1F5F9"
          iconColor="#64748B"
          trend={plan === 'free' ? 'Upgrade for more features' : undefined}
          trendColor="#FF6B2B"
          trendBg="#FFF3ED"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Organization Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Organization Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <OrgStat label="Services" value={servicesData?.total ?? 0} onClick={() => router.push('/services')} />
                <OrgStat label="Agents Installed" value={agentSummary?.installed_count ?? 0} onClick={() => router.push('/agents')} />
                <OrgStat label="Tickets (open)" value={stats?.open_tickets ?? 0} onClick={() => router.push('/tickets')} />
                <OrgStat label="Resolved Today" value={stats?.resolved_today ?? 0} />
              </div>
            </CardContent>
          </Card>

          {/* Compliance Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Compliance Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                <ComplianceItem label="Privacy Policy" status="active" />
                <ComplianceItem label="Terms of Service" status="active" />
                <ComplianceItem label="DSAR Processing" status="active" />
                <ComplianceItem label="Breach Reporting" status="active" />
                <ComplianceItem label="Data Retention Policy" status="active" />
                <ComplianceItem label="MFA Enforcement" status="warning" detail="Review user MFA status" />
              </div>
              <button
                onClick={() => router.push('/settings/privacy')}
                className="mt-4 text-xs text-brand font-semibold hover:underline"
              >
                Manage privacy settings →
              </button>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Pending Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4" />
                Pending Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <ActionItem
                  label={`${stats?.overdue_count ?? 0} overdue tickets`}
                  severity={stats?.overdue_count && stats.overdue_count > 0 ? 'error' : 'ok'}
                  onClick={() => router.push('/tickets')}
                />
                <ActionItem
                  label={`${agentSummary?.pending_approvals ?? 0} pending agent approvals`}
                  severity={agentSummary?.pending_approvals && agentSummary.pending_approvals > 0 ? 'warning' : 'ok'}
                  onClick={() => router.push('/agents/approvals')}
                />
              </div>
            </CardContent>
          </Card>

          {/* Billing Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4" />
                Billing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-[#F8FAFC] dark:bg-navy-elevated p-4">
                <p className="text-xs text-[#64748B]">Current Plan</p>
                <p className="text-lg font-bold text-[#0F172A] dark:text-[#E2E8F0] capitalize">{plan}</p>
              </div>
              <button
                onClick={() => router.push('/settings/billing')}
                className="mt-3 w-full rounded-lg border border-brand text-brand text-xs font-semibold py-2 hover:bg-brand hover:text-white transition-colors"
              >
                Manage Billing
              </button>
            </CardContent>
          </Card>

          {/* Recent Audit Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ClipboardList className="h-4 w-4" />
                Audit Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activityItems.length > 0 ? (
                <div className="space-y-2.5">
                  {activityItems.slice(0, 6).map((item) => (
                    <div key={item.id} className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#0F172A] dark:text-[#E2E8F0] truncate">{item.action}</p>
                        <p className="text-[10px] text-[#94A3B8]">{item.actor}</p>
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
              <button
                onClick={() => router.push('/settings/audit-log')}
                className="mt-3 text-xs text-brand font-semibold hover:underline"
              >
                View full audit log →
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OrgStat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-[#F8FAFC] dark:bg-navy-elevated p-3 text-center hover:bg-[#F1F5F9] transition-colors"
    >
      <p className="text-[20px] font-bold font-mono text-[#0F172A] dark:text-[#E2E8F0]">{value}</p>
      <p className="text-[10px] text-[#64748B] mt-1">{label}</p>
    </button>
  );
}

function ComplianceItem({ label, status, detail }: { label: string; status: 'active' | 'warning'; detail?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-3 py-2">
      <div className="flex items-center gap-2">
        {status === 'active' ? (
          <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-[#EAB308]" />
        )}
        <span className="text-xs font-medium text-[#334155] dark:text-[#E2E8F0]">{label}</span>
      </div>
      {detail && <span className="text-[10px] text-[#EAB308]">{detail}</span>}
    </div>
  );
}

function ActionItem({ label, severity, onClick }: { label: string; severity: 'error' | 'warning' | 'ok'; onClick?: () => void }) {
  const color = severity === 'error' ? '#DC2626' : severity === 'warning' ? '#EAB308' : '#16A34A';
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-2.5 text-left hover:bg-[#F8FAFC] transition-colors"
    >
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-[#334155] dark:text-[#E2E8F0]">{label}</span>
    </button>
  );
}
