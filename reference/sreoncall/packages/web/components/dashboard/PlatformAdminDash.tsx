'use client';

import { useRouter } from 'next/navigation';
import { Shield, Building2, Users, Activity, FileText, Server, Database, Zap, ToggleLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { MetricCard } from './MetricCard';
import {
  usePlatformOverview,
  useDashboardStats,
} from './useDashboardData';

export function PlatformAdminDash() {
  const router = useRouter();
  const { data: platformData, isLoading: platformLoading } = usePlatformOverview(true);
  const { data: stats } = useDashboardStats();

  const byType = platformData?.by_type || {};
  const byPlan = platformData?.by_plan || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Total Tenants"
          value={platformData?.total_tenants ?? 0}
          icon={Building2}
          iconBg="#EFF6FF"
          iconColor="#2563EB"
          accent="blue"
          loading={platformLoading}
        />
        <MetricCard
          label="Total Users"
          value={platformData?.total_users ?? 0}
          icon={Users}
          iconBg="#FFF3ED"
          iconColor="#FF6B2B"
          accent="orange"
          loading={platformLoading}
        />
        <MetricCard
          label="System Health"
          value="Operational"
          icon={Activity}
          iconBg="#F0FDF4"
          iconColor="#16A34A"
          accent="green"
        />
        <MetricCard
          label="Active Incidents"
          value={stats?.active_incidents ?? 0}
          icon={Zap}
          iconBg="#FEF2F2"
          iconColor="#DC2626"
          accent="red"
        />
        <MetricCard
          label="Active DSARs"
          value="—"
          icon={Shield}
          iconBg="#F1F5F9"
          iconColor="#64748B"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Tenant Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Tenant Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <TenantTypeStat label="Standalone" count={byType.standalone || 0} color="#2563EB" />
                <TenantTypeStat label="Provider" count={byType.provider || 0} color="#FF6B2B" />
                <TenantTypeStat label="Consumer" count={byType.consumer || 0} color="#16A34A" />
                <TenantTypeStat label="Platform" count={byType.platform || 0} color="#64748B" />
              </div>

              <h4 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-3">By Plan</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <PlanStat label="Free" count={byPlan.free || 0} />
                <PlanStat label="Starter" count={byPlan.starter || 0} />
                <PlanStat label="Business" count={byPlan.business || 0} />
                <PlanStat label="Enterprise" count={byPlan.enterprise || 0} />
              </div>

              <button
                onClick={() => router.push('/admin/tenants')}
                className="mt-4 text-xs text-brand font-semibold hover:underline"
              >
                Manage tenants →
              </button>
            </CardContent>
          </Card>

          {/* Feature Flags */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ToggleLeft className="h-4 w-4" />
                Feature Flags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                <FlagItem name="ai_agents" description="AI agent marketplace and execution" enabled />
                <FlagItem name="synthetic_monitoring" description="HTTP/TCP/DNS synthetic checks" enabled />
                <FlagItem name="change_management" description="Change requests with CAB workflow" enabled />
                <FlagItem name="observability" description="Managed LGTM stack" enabled />
                <FlagItem name="gdpr_compliance" description="GDPR/DPDP compliance features" enabled />
              </div>
              <button
                onClick={() => router.push('/admin/feature-flags')}
                className="mt-4 text-xs text-brand font-semibold hover:underline"
              >
                Manage feature flags →
              </button>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* System Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Server className="h-4 w-4" />
                System Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                <HealthItem name="MongoDB" status="connected" />
                <HealthItem name="Redis" status="connected" />
                <HealthItem name="NATS JetStream" status="connected" />
                <HealthItem name="Meilisearch" status="connected" />
                <HealthItem name="MinIO" status="connected" />
                <HealthItem name="LGTM Stack" status="connected" />
              </div>
              <button
                onClick={() => router.push('/admin/health')}
                className="mt-4 text-xs text-brand font-semibold hover:underline"
              >
                View health details →
              </button>
            </CardContent>
          </Card>

          {/* DSAR Queue */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4" />
                DSAR Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="py-4 text-center text-xs text-[#64748B]">
                Manage data subject access requests
              </p>
              <button
                onClick={() => router.push('/admin/dsar')}
                className="w-full rounded-lg border border-brand text-brand text-xs font-semibold py-2 hover:bg-brand hover:text-white transition-colors"
              >
                View DSAR Queue
              </button>
            </CardContent>
          </Card>

          {/* Quick Admin Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Admin Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <AdminAction label="Manage Plans" onClick={() => router.push('/admin/plans')} />
                <AdminAction label="Global Config" onClick={() => router.push('/admin/config')} />
                <AdminAction label="Audit Log" onClick={() => router.push('/admin/audit-log')} />
                <AdminAction label="Compliance Dashboard" onClick={() => router.push('/admin/compliance')} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TenantTypeStat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-3 text-center">
      <p className="text-[18px] font-bold font-mono" style={{ color }}>{count}</p>
      <p className="text-[10px] text-[#64748B] mt-1">{label}</p>
    </div>
  );
}

function PlanStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg bg-[#F8FAFC] dark:bg-navy-elevated p-2.5 text-center">
      <p className="text-[14px] font-bold font-mono text-[#334155] dark:text-[#E2E8F0]">{count}</p>
      <p className="text-[10px] text-[#94A3B8]">{label}</p>
    </div>
  );
}

function HealthItem({ name, status }: { name: string; status: string }) {
  const isOk = status === 'connected';
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-3 py-2">
      <div className="flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-[#64748B]" />
        <span className="text-xs font-medium text-[#334155] dark:text-[#E2E8F0]">{name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${isOk ? 'bg-[#16A34A]' : 'bg-[#DC2626]'}`} />
        <span className={`text-[10px] font-medium ${isOk ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
          {isOk ? 'Connected' : 'Down'}
        </span>
      </div>
    </div>
  );
}

function FlagItem({ name, description, enabled }: { name: string; description: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-3 py-2">
      <div>
        <p className="text-xs font-mono font-medium text-[#334155] dark:text-[#E2E8F0]">{name}</p>
        <p className="text-[10px] text-[#94A3B8]">{description}</p>
      </div>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${enabled ? 'bg-[#F0FDF4] text-[#16A34A]' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>
        {enabled ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

function AdminAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-3 py-2 text-xs font-medium text-[#334155] dark:text-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-brand/30 transition-all"
    >
      {label} →
    </button>
  );
}
