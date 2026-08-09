'use client';

import { useState } from 'react';
import {
  Bell,
  RefreshCw,
  Loader2,
  Signal,
  Volume2,
  Lightbulb,
  BarChart3,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAlertQuality, useAlertQualityReport } from '@/lib/hooks/useICCExtras';
import { cn } from '@/lib/utils';

type Period = '7d' | '30d';

function getSignalColor(score: number): string {
  if (score > 80) return 'text-emerald-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

function getSignalBg(score: number): string {
  if (score > 80) return 'bg-emerald-500/10';
  if (score >= 50) return 'bg-yellow-500/10';
  return 'bg-red-500/10';
}

function getRecommendationVariant(rec: string): 'success' | 'warning' | 'destructive' {
  const lower = rec.toLowerCase();
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('disable'))
    return 'destructive';
  if (lower.includes('retune') || lower.includes('adjust') || lower.includes('review'))
    return 'warning';
  return 'success';
}

function getRecommendationLabel(rec: string): string {
  const lower = rec.toLowerCase();
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('disable'))
    return 'Delete';
  if (lower.includes('retune') || lower.includes('adjust') || lower.includes('review'))
    return 'Retune';
  return 'Keep';
}

export default function AlertQualityReportPage() {
  const [period, setPeriod] = useState<Period>('7d');

  const { data: entries, isLoading: entriesLoading } = useAlertQuality();
  const { data: report, isLoading: reportLoading, refetch } = useAlertQualityReport();

  const isLoading = entriesLoading || reportLoading;

  const totalAlerts = report?.total_alerts ?? 0;
  const avgScore = report?.average_score ?? 0;
  const noisyAlerts = report?.top_noisy_alerts ?? [];
  const noisyCount = noisyAlerts.reduce((sum, a) => sum + a.noise_count, 0);
  const suggestionsCount = report?.recommendations?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alert Quality Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signal-to-noise analysis for your alert rules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setPeriod('7d')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                period === '7d'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              7 days
            </button>
            <button
              onClick={() => setPeriod('30d')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                period === '30d'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              30 days
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn('mr-1 h-4 w-4', isLoading && 'animate-spin')} />
            Recalculate
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total Alerts Analyzed"
          value={isLoading ? '...' : totalAlerts}
          icon={Bell}
          iconBg="rgba(37,99,235,0.08)"
          iconColor="#2563EB"
          loading={isLoading}
        />
        <MetricCard
          label="Avg Signal Score"
          value={isLoading ? '...' : `${avgScore.toFixed(0)}%`}
          icon={Signal}
          iconBg="rgba(22,163,74,0.08)"
          iconColor="#16A34A"
          accent={avgScore > 80 ? 'green' : avgScore >= 50 ? 'yellow' : 'red'}
          loading={isLoading}
        />
        <MetricCard
          label="Noisy Alerts"
          value={isLoading ? '...' : noisyCount}
          icon={Volume2}
          iconBg="rgba(234,88,12,0.08)"
          iconColor="#EA580C"
          accent={noisyCount > 0 ? 'orange' : undefined}
          loading={isLoading}
        />
        <MetricCard
          label="Suggestions"
          value={isLoading ? '...' : suggestionsCount}
          icon={Lightbulb}
          iconBg="rgba(124,58,237,0.08)"
          iconColor="#7C3AED"
          loading={isLoading}
        />
      </div>

      {/* Alert Rules Table */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !entries || entries.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No alert quality data"
          description="Alert quality analysis will appear here once alerts have been evaluated."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Alert Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border border-input">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Alert Name
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      Source
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      Signal Score
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      Noise Rate
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      Actionability
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                      Recommendation
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-input">
                  {entries.map((entry) => {
                    const primaryRec = entry.recommendation ?? 'keep';
                    const recVariant = getRecommendationVariant(primaryRec);
                    const recLabel = getRecommendationLabel(primaryRec);

                    return (
                      <tr
                        key={entry.id}
                        className="bg-background hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 text-foreground font-medium">
                          {entry.alert_rule?.name ?? entry.alert_rule_id ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="info">{entry.alert_rule?.severity ?? '—'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                              getSignalColor(entry.signal_score),
                              getSignalBg(entry.signal_score),
                            )}
                          >
                            {entry.signal_score}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-muted-foreground">
                          {entry.noise_score?.toFixed(1) ?? '—'}%
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={
                              entry.recommendation === 'keep'
                                ? 'success'
                                : entry.recommendation === 'retune_threshold'
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {entry.recommendation ?? '—'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={recVariant}>{recLabel}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
