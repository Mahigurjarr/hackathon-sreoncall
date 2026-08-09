'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  Zap,
  Users,
  Wrench,
  Loader2,
  BarChart3,
  ArrowUpRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { api, APIError } from '@/lib/api';

interface ToilSummary {
  total_toil_hours: number;
  automatable_hours: number;
  top_toil_source: string;
  engineers_affected: number;
}

interface AutomationOpportunity {
  action: string;
  count: number;
  estimated_time_saved_hours: number;
  service?: string;
}

interface ToilByEngineer {
  engineer_name: string;
  toil_hours: number;
  top_action: string;
}

interface ToilByService {
  service_name: string;
  toil_hours: number;
  incident_count: number;
}

function useToilSummary() {
  return useQuery<ToilSummary, APIError>({
    queryKey: ['toil-summary'],
    queryFn: () => api.get<ToilSummary>('/api/v1/reports/toil/summary'),
  });
}

function useAutomationOpportunities() {
  return useQuery<AutomationOpportunity[], APIError>({
    queryKey: ['toil-automation'],
    queryFn: async () => {
      const res = await api.get<{ data: AutomationOpportunity[] }>(
        '/api/v1/reports/toil/automation-opportunities',
      );
      return res.data;
    },
  });
}

function useToilByEngineer() {
  return useQuery<ToilByEngineer[], APIError>({
    queryKey: ['toil-by-engineer'],
    queryFn: async () => {
      const res = await api.get<{ data: ToilByEngineer[] }>(
        '/api/v1/reports/toil/by-engineer',
      );
      return res.data;
    },
  });
}

function useToilByService() {
  return useQuery<ToilByService[], APIError>({
    queryKey: ['toil-by-service'],
    queryFn: async () => {
      const res = await api.get<{ data: ToilByService[] }>(
        '/api/v1/reports/toil/by-service',
      );
      return res.data;
    },
  });
}

export default function ToilDashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useToilSummary();
  const { data: opportunities, isLoading: oppsLoading } = useAutomationOpportunities();
  const { data: engineers, isLoading: engLoading } = useToilByEngineer();
  const { data: services, isLoading: svcLoading } = useToilByService();

  const isLoading = summaryLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Toil Measurement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Identify repetitive work and automation opportunities across your team.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total Toil Hours"
          value={isLoading ? '...' : `${(summary?.total_toil_hours ?? 0).toFixed(1)}h`}
          icon={Clock}
          iconBg="rgba(220,38,38,0.08)"
          iconColor="#DC2626"
          accent="red"
          loading={isLoading}
        />
        <MetricCard
          label="Automatable Hours"
          value={isLoading ? '...' : `${(summary?.automatable_hours ?? 0).toFixed(1)}h`}
          icon={Zap}
          iconBg="rgba(22,163,74,0.08)"
          iconColor="#16A34A"
          accent="green"
          loading={isLoading}
        />
        <MetricCard
          label="Top Toil Source"
          value={isLoading ? '...' : summary?.top_toil_source ?? '-'}
          icon={Wrench}
          iconBg="rgba(234,88,12,0.08)"
          iconColor="#EA580C"
          loading={isLoading}
        />
        <MetricCard
          label="Engineers Affected"
          value={isLoading ? '...' : summary?.engineers_affected ?? 0}
          icon={Users}
          iconBg="rgba(37,99,235,0.08)"
          iconColor="#2563EB"
          loading={isLoading}
        />
      </div>

      {/* Automation Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-500" />
            Top Automation Opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {oppsLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !opportunities || opportunities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No automation opportunities identified yet.
            </p>
          ) : (
            <div className="space-y-3">
              {opportunities.map((opp, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg border border-input p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {opp.action}
                    </p>
                    {opp.service && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Service: {opp.service}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Occurrences</p>
                      <p className="text-sm font-bold text-foreground">{opp.count}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Est. Savings</p>
                      <p className="text-sm font-bold text-emerald-500 flex items-center gap-0.5">
                        <ArrowUpRight className="h-3 w-3" />
                        {opp.estimated_time_saved_hours.toFixed(1)}h
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tables: By Engineer + By Service */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* By Engineer */}
        <Card>
          <CardHeader>
            <CardTitle>By Engineer</CardTitle>
          </CardHeader>
          <CardContent>
            {engLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : !engineers || engineers.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No data"
                description="Engineer toil data will appear here."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-input">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                        Engineer
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Toil Hours
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                        Top Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-input">
                    {engineers.map((eng, idx) => (
                      <tr key={idx} className="bg-background hover:bg-muted/30">
                        <td className="px-4 py-3 text-foreground font-medium">
                          {eng.engineer_name}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground font-mono">
                          {eng.toil_hours.toFixed(1)}h
                        </td>
                        <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                          {eng.top_action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Service */}
        <Card>
          <CardHeader>
            <CardTitle>By Service</CardTitle>
          </CardHeader>
          <CardContent>
            {svcLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : !services || services.length === 0 ? (
              <EmptyState
                icon={Wrench}
                title="No data"
                description="Service toil data will appear here."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-input">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                        Service
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Toil Hours
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Incidents
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-input">
                    {services.map((svc, idx) => (
                      <tr key={idx} className="bg-background hover:bg-muted/30">
                        <td className="px-4 py-3 text-foreground font-medium">
                          {svc.service_name}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground font-mono">
                          {svc.toil_hours.toFixed(1)}h
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {svc.incident_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
