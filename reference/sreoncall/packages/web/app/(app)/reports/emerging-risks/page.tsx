'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  TrendingUp,
  Clock,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { useEmergingRisks } from '@/lib/hooks/useICCExtras';
import { api, APIError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SLOBurnRate {
  slo_name: string;
  service: string;
  burn_rate_1h: number;
  burn_rate_6h: number;
  burn_rate_24h: number;
  forecast_breach_time: string | null;
  budget_consumed_pct: number;
}

function useSLOBurnRates() {
  return useQuery<SLOBurnRate[], APIError>({
    queryKey: ['slo-burn-rates'],
    queryFn: async () => {
      const res = await api.get<{ data: SLOBurnRate[] }>(
        '/api/v1/reports/emerging-risks/slo-burn-rates',
      );
      return res.data;
    },
  });
}

function useDismissRisk() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/emerging-risks/${id}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emerging-risks'] });
    },
  });
}

function getRiskLevelVariant(
  level: string,
): 'destructive' | 'warning' | 'info' | 'secondary' {
  switch (level) {
    case 'critical':
      return 'destructive';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    default:
      return 'secondary';
  }
}

function getSeverityIcon(level: string) {
  if (level === 'critical' || level === 'high')
    return <AlertTriangle className="h-4 w-4 text-red-500" />;
  return <Eye className="h-4 w-4 text-yellow-500" />;
}

function formatTimeUntil(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'Imminent';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function BurnRateValue({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'font-mono text-xs font-bold',
        value > 10 ? 'text-red-500' : value > 2 ? 'text-yellow-500' : 'text-foreground',
      )}
    >
      {value.toFixed(2)}x
    </span>
  );
}

function BudgetBar({ pct }: { pct: number }) {
  const clampedPct = Math.min(pct, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct > 90
              ? 'bg-red-500'
              : pct > 70
                ? 'bg-yellow-500'
                : 'bg-emerald-500',
          )}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
      <span
        className={cn(
          'text-xs font-mono font-bold w-10 text-right',
          pct > 90
            ? 'text-red-500'
            : pct > 70
              ? 'text-yellow-500'
              : 'text-emerald-500',
        )}
      >
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export default function EmergingRisksPage() {
  const { data: risks, isLoading: risksLoading } = useEmergingRisks();
  const { data: burnRates, isLoading: burnLoading } = useSLOBurnRates();
  const dismissRisk = useDismissRisk();

  const activeRisks = risks ?? [];
  const activeCount = activeRisks.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Emerging Risks</h1>
            {!risksLoading && activeCount > 0 && (
              <Badge variant="destructive">{activeCount} active</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Predictive warnings and SLO burn rate analysis.
          </p>
        </div>
      </div>

      {/* Active Risks */}
      {risksLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : activeRisks.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center">
              <div className="rounded-full bg-emerald-500/10 p-4 mb-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                All clear — no emerging risks detected
              </h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                The system is continuously monitoring for potential issues. You will be
                notified when risks are detected.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeRisks.map((risk) => (
            <Card key={risk.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {getSeverityIcon(risk.risk_level)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">
                          {risk.title}
                        </p>
                        <Badge variant={getRiskLevelVariant(risk.risk_level)}>
                          {risk.risk_level}
                        </Badge>
                        <Badge variant="secondary">{risk.source}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {risk.description}
                      </p>
                      {risk.affected_services.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {risk.affected_services.map((svc) => (
                            <span
                              key={svc}
                              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              {svc}
                            </span>
                          ))}
                        </div>
                      )}
                      {risk.indicators.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-3">
                          {risk.indicators.map((ind, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] text-muted-foreground"
                            >
                              <span className="font-medium">{ind.metric}:</span>{' '}
                              <span
                                className={cn(
                                  'font-mono font-bold',
                                  ind.trend === 'rising'
                                    ? 'text-red-500'
                                    : ind.trend === 'falling'
                                      ? 'text-emerald-500'
                                      : 'text-foreground',
                                )}
                              >
                                {ind.current_value}
                              </span>
                              <span className="text-muted-foreground">
                                {' '}
                                / {ind.threshold}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-muted-foreground">
                        Detected
                      </p>
                      <p className="text-xs font-mono text-foreground">
                        {new Date(risk.detected_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dismissRisk.mutate(risk.id)}
                      disabled={dismissRisk.isPending}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* SLO Burn Rates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            SLO Burn Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {burnLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !burnRates || burnRates.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="No SLO data"
              description="SLO burn rate data will appear here once SLOs are configured."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-input">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      SLO
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Service
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      1h Burn
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      6h Burn
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      24h Burn
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      Breach In
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground min-w-[160px]">
                      Budget Consumed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-input">
                  {burnRates.map((slo, idx) => (
                    <tr key={idx} className="bg-background hover:bg-muted/30">
                      <td className="px-4 py-3 text-foreground font-medium">
                        {slo.slo_name}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {slo.service}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <BurnRateValue value={slo.burn_rate_1h} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <BurnRateValue value={slo.burn_rate_6h} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <BurnRateValue value={slo.burn_rate_24h} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            'text-xs font-mono font-bold',
                            slo.forecast_breach_time
                              ? 'text-red-500'
                              : 'text-muted-foreground',
                          )}
                        >
                          {formatTimeUntil(slo.forecast_breach_time)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <BudgetBar pct={slo.budget_consumed_pct} />
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
  );
}
