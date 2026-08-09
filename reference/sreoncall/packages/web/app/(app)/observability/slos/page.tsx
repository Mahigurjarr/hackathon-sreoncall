'use client';

import { useState, useMemo } from 'react';
import { Plus, Loader2, AlertCircle, Target, X, Trash2, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  useSLOs,
  useCreateSLO,
  useDeleteSLO,
  type SloDefinition,
  type CreateSloInput,
} from '@/lib/hooks/useSLOs';

// ── SLO Templates ────────────────────────────────────────────────────
const SLO_TEMPLATES = [
  { name: 'API Availability', description: '99.9% availability target', objective_pct: 99.9, window_days: 30, query_good: 'sum(rate(http_requests_total{code!~"5.."}[5m]))', query_total: 'sum(rate(http_requests_total[5m]))' },
  { name: 'API Latency P99', description: 'P99 latency under 500ms', objective_pct: 99.0, window_days: 30, query_good: 'sum(rate(http_request_duration_seconds_bucket{le="0.5"}[5m]))', query_total: 'sum(rate(http_request_duration_seconds_bucket{le="+Inf"}[5m]))' },
  { name: 'Error Rate', description: 'Less than 0.1% error rate', objective_pct: 99.9, window_days: 30, query_good: 'sum(rate(http_requests_total{code!~"5.."}[5m]))', query_total: 'sum(rate(http_requests_total[5m]))' },
  { name: 'Uptime', description: '99.95% uptime target', objective_pct: 99.95, window_days: 30, query_good: 'sum(up)', query_total: 'count(up)' },
  { name: 'Interface Availability', description: '99.9% link uptime for network interfaces', objective_pct: 99.9, window_days: 30, query_good: 'sum(last_over_time(snmp_interface_oper_status[5m]) == 1)', query_total: 'count(last_over_time(snmp_interface_oper_status[5m]))' },
  { name: 'Interface Error Rate', description: 'Less than 0.01% interface error ratio', objective_pct: 99.99, window_days: 30, query_good: 'sum(rate(snmp_interface_hc_out_octets[5m])) - sum(rate(snmp_interface_out_errors[5m]))', query_total: 'sum(rate(snmp_interface_hc_out_octets[5m]))' },
  { name: 'BGP Peer Stability', description: '99.9% BGP peer uptime', objective_pct: 99.9, window_days: 30, query_good: 'sum(last_over_time(snmp_bgp_peer_state[5m]) == 6)', query_total: 'count(last_over_time(snmp_bgp_peer_state[5m]))' },
] as const;

type SloTemplate = typeof SLO_TEMPLATES[number];

const STATUS_STYLES: Record<string, { text: string; label: string }> = {
  breaching: { text: 'text-[#DC2626]', label: 'BREACHING' },
  burning: { text: 'text-[#A16207]', label: 'BURNING' },
  on_track: { text: 'text-[#16A34A]', label: 'ON TRACK' },
};

function getSloStatus(slo: SloDefinition) {
  if (slo.error_budget_remaining_pct !== null && slo.error_budget_remaining_pct <= 0) return 'breaching';
  if (slo.burn_rate !== null && slo.burn_rate > 2) return 'burning';
  return 'on_track';
}

// ── Trend colors for multi-line chart ────────────────────────────────
const TREND_COLORS = [
  '#16A34A', '#3B82F6', '#A855F7', '#F97316', '#EC4899',
  '#14B8A6', '#EAB308', '#6366F1', '#F43F5E', '#06B6D4',
];

// ── Generate 30-day trend data — only show data from created_at onward ──
function generate30DayTrend(slos: SloDefinition[]) {
  const now = new Date();
  const days: Record<string, unknown>[] = [];

  for (let d = 29; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    const point: Record<string, unknown> = { date: label };

    slos.forEach((slo) => {
      const createdAt = new Date(slo.created_at);
      // Only show data for days after the SLO was created
      if (date >= createdAt && slo.current_sli_pct !== null) {
        point[slo.name] = slo.current_sli_pct;
      }
      // Otherwise leave undefined (gap in chart)
    });

    days.push(point);
  }

  return days;
}

function formatMonitoringSince(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h of data`;
  if (diffHours > 0) return `${diffHours}h of data`;
  return 'Less than 1h of data';
}

// ── Generate 7-day sparkline — flat line from current value for days with data ──
function generate7DaySparkline(slo: SloDefinition): number[] {
  const base = slo.current_sli_pct ?? slo.objective_pct;
  const created = new Date(slo.created_at);
  const now = new Date();
  const points: number[] = [];

  for (let d = 6; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    if (date >= created && slo.current_sli_pct !== null) {
      points.push(base);
    } else {
      points.push(0); // No data before monitoring started
    }
  }
  return points;
}

// ── Sparkline SVG component ──────────────────────────────────────────
function Sparkline({ data, color, width = 80, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="shrink-0">
      <defs>
        <linearGradient id={`spark-fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <path
        d={`M${points.split(' ').map((p, i) => (i === 0 ? p : ` L${p}`)).join('')}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2)}
        cy={height - padding - ((data[data.length - 1] - min) / range) * (height - padding * 2)}
        r={2}
        fill={color}
      />
    </svg>
  );
}

// ── 30-Day Compliance Trend Chart ────────────────────────────────────
function ComplianceTrendChart({ slos }: { slos: SloDefinition[] }) {
  const trendData = useMemo(() => generate30DayTrend(slos), [slos]);

  // Compute Y-axis domain: slightly below lowest value, up to 100
  const allValues = slos.flatMap(slo =>
    trendData.map(d => (d[slo.name] as number) ?? 0)
  );
  const minVal = Math.min(...allValues);
  const yMin = Math.max(0, Math.floor(minVal * 10 - 2) / 10); // Round down with some padding

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">30-Day Compliance Trend</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Daily SLI compliance percentage per SLO</p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {slos.map((slo, idx) => (
              <div key={slo.id} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: TREND_COLORS[idx % TREND_COLORS.length] }}
                />
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{slo.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                {slos.map((slo, idx) => (
                  <linearGradient key={slo.id} id={`trend-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TREND_COLORS[idx % TREND_COLORS.length]} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={TREND_COLORS[idx % TREND_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                domain={[yMin, 100]}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}%`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
                formatter={(value: number) => [`${value.toFixed(3)}%`]}
              />
              {slos.map((slo, idx) => (
                <Area
                  key={slo.id}
                  type="monotone"
                  dataKey={slo.name}
                  stroke={TREND_COLORS[idx % TREND_COLORS.length]}
                  strokeWidth={2}
                  fill={`url(#trend-grad-${idx})`}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Compute error budget remaining in minutes ────────────────────────
function errorBudgetMinutes(slo: SloDefinition): string | null {
  if (slo.error_budget_remaining_pct === null) return null;
  const totalMinutes = slo.window_days * 24 * 60;
  const allowedDowntimePct = 100 - slo.objective_pct; // e.g. 0.1% for 99.9% SLO
  const totalBudgetMinutes = (allowedDowntimePct / 100) * totalMinutes;
  const remainingMinutes = (slo.error_budget_remaining_pct / 100) * totalBudgetMinutes;
  if (remainingMinutes <= 0) return '0m';
  if (remainingMinutes < 60) return `${Math.round(remainingMinutes)}m`;
  if (remainingMinutes < 1440) return `${Math.floor(remainingMinutes / 60)}h ${Math.round(remainingMinutes % 60)}m`;
  return `${Math.floor(remainingMinutes / 1440)}d ${Math.floor((remainingMinutes % 1440) / 60)}h`;
}

// SVG health ring component
function HealthRing({ pct, color, size = 86 }: { pct: number; color: string; size?: number }) {
  const r = 35;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox="0 0 86 86" className="shrink-0">
      <circle cx="43" cy="43" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-border/30" />
      <circle
        cx="43"
        cy="43"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 43 43)"
        className="transition-all duration-700"
      />
      <text x="43" y="40" textAnchor="middle" className="fill-foreground text-[14px] font-bold" fontFamily="monospace">
        {pct.toFixed(pct < 99 ? 1 : 2)}%
      </text>
      <text x="43" y="54" textAnchor="middle" className="fill-muted-foreground text-[8px]" fontFamily="sans-serif">
        current
      </text>
    </svg>
  );
}

export default function SLODashboard() {
  const [showCreate, setShowCreate] = useState(false);
  const [templateToUse, setTemplateToUse] = useState<SloTemplate | null>(null);
  const { data, isLoading, error } = useSLOs();
  const slos = data?.data ?? [];
  const deleteSLO = useDeleteSLO();

  const breachingCount = slos.filter(s => getSloStatus(s) === 'breaching').length;
  const burningCount = slos.filter(s => getSloStatus(s) === 'burning').length;
  const onTrackCount = slos.filter(s => getSloStatus(s) === 'on_track').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SLO Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {slos.length} SLO{slos.length !== 1 ? 's' : ''}
            {breachingCount > 0 && ` \u00B7 ${breachingCount} breaching`}
            {burningCount > 0 && ` \u00B7 ${burningCount} burning fast`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New SLO
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-[#DC2626] shrink-0" />
          <span className="text-[12px] text-[#DC2626]">{(error as Error).message}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && slos.length === 0 && !error && (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Target className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No SLOs defined yet</h3>
            <p className="text-[12px] text-muted-foreground mb-4 max-w-sm">
              Define Service Level Objectives to track reliability targets. SLOs monitor good/total request
              ratios and alert when error budgets are burning too fast.
            </p>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create First SLO
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      {slos.length > 0 && (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-[#16A34A]">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">ON TRACK</div>
            <div className="text-2xl font-bold text-[#16A34A] font-mono mt-1">{onTrackCount}</div>
            <div className="text-xs text-muted-foreground">of {slos.length} SLOs healthy</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-[#DC2626]">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">BREACHING</div>
            <div className="text-2xl font-bold text-[#DC2626] font-mono mt-1">{breachingCount}</div>
            <div className="text-xs text-muted-foreground">error budget exhausted</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-[#A16207]">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">BURNING FAST</div>
            <div className="text-2xl font-bold text-[#A16207] font-mono mt-1">{burningCount}</div>
            <div className="text-xs text-muted-foreground">elevated burn rate</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 border-l-[3px] border-l-[#2563EB]">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AVG COMPLIANCE</div>
            <div className="text-2xl font-bold text-[#2563EB] font-mono mt-1">
              {slos.filter(s => s.current_sli_pct !== null).length > 0
                ? `${(slos.reduce((sum, s) => sum + (s.current_sli_pct || 0), 0) / slos.filter(s => s.current_sli_pct !== null).length).toFixed(2)}%`
                : '-'}
            </div>
            <div className="text-xs text-muted-foreground">{slos[0]?.window_days || 30}d across all</div>
          </div>
        </div>
      )}

      {/* SLO Templates */}
      {slos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Quick Start Templates</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SLO_TEMPLATES.map((tpl) => (
              <div
                key={tpl.name}
                className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="text-sm font-semibold text-foreground">{tpl.name}</div>
                  <span className="shrink-0 rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-[#2563EB] font-mono">
                    {tpl.objective_pct}%
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{tpl.description}</p>
                <div className="mt-auto pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-[11px]"
                    onClick={() => { setTemplateToUse(tpl); setShowCreate(true); }}
                  >
                    Use Template
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 30-Day Compliance Trend Chart */}
      {slos.length > 0 && <ComplianceTrendChart slos={slos} />}

      {/* SLO Cards */}
      {slos.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {slos.map((slo, sloIdx) => {
            const status = getSloStatus(slo);
            const style = STATUS_STYLES[status];
            const ringColor = status === 'breaching' ? '#DC2626' : status === 'burning' ? '#EAB308' : '#16A34A';
            const currentPct = slo.current_sli_pct ?? 0;
            const budgetPct = slo.error_budget_remaining_pct ?? 100;
            const sparklineData = generate7DaySparkline(slo);
            const sparkColor = TREND_COLORS[sloIdx % TREND_COLORS.length];
            const budgetMins = errorBudgetMinutes(slo);

            return (
              <Card key={slo.id} className={cn('border', status === 'breaching' ? 'border-red-500/20' : status === 'burning' ? 'border-yellow-500/20' : 'border-border')}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-foreground">{slo.name}</div>
                        <button
                          className="p-1 rounded text-[#DC2626] hover:text-red-300 hover:bg-red-500/10 transition-colors"
                          title="Delete SLO"
                          onClick={() => {
                            if (confirm('Delete this SLO?')) {
                              deleteSLO.mutate(slo.id, { onSuccess: () => toast.success('SLO deleted') });
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Target: {slo.objective_pct}% &middot; {slo.window_days}d window
                        <span className="text-muted-foreground/50 ml-1">&middot; {formatMonitoringSince(slo.created_at)}</span>
                      </div>
                      {slo.description && (
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">{slo.description}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={cn('text-[13px] font-bold font-mono', style.text)}>
                          {currentPct.toFixed(2)}%
                        </span>
                        <span className={cn('text-[10px] font-bold', style.text)}>
                          &mdash; {style.label}
                        </span>
                      </div>
                      {/* 7-day sparkline */}
                      <div className="flex items-center gap-2 mt-2">
                        <Sparkline data={sparklineData} color={sparkColor} width={80} height={20} />
                        <span className="text-[9px] text-muted-foreground/60">7d trend</span>
                      </div>
                    </div>
                    <HealthRing pct={currentPct} color={ringColor} />
                  </div>

                  {/* Error budget bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">ERROR BUDGET</span>
                      <span className={cn(
                        'text-[10px] font-bold',
                        budgetPct <= 0 ? 'text-[#DC2626]' : budgetPct < 30 ? 'text-[#A16207]' : 'text-[#16A34A]',
                      )}>
                        {budgetPct <= 0 ? 'EXHAUSTED' : `${budgetPct.toFixed(0)}% left${budgetMins ? ` (${budgetMins})` : ''}`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-border/30 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-700',
                          budgetPct <= 0 ? 'bg-red-500' : budgetPct < 30 ? 'bg-yellow-500' : 'bg-emerald-500',
                        )}
                        style={{ width: `${Math.max(budgetPct <= 0 ? 100 : budgetPct, 0)}%` }}
                      />
                    </div>
                    {slo.burn_rate !== null && (
                      <div className="text-[10px] text-muted-foreground mt-1.5">
                        Burn rate: {slo.burn_rate.toFixed(1)}x
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && <CreateSLOForm template={templateToUse} onClose={() => { setShowCreate(false); setTemplateToUse(null); }} />}
    </div>
  );
}

function CreateSLOForm({ onClose, template }: { onClose: () => void; template?: SloTemplate | null }) {
  const createSLO = useCreateSLO();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [objectivePct, setObjectivePct] = useState(String(template?.objective_pct ?? '99.9'));
  const [windowDays, setWindowDays] = useState(String(template?.window_days ?? '30'));
  const [queryGood, setQueryGood] = useState(template?.query_good ?? '');
  const [queryTotal, setQueryTotal] = useState(template?.query_total ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: CreateSloInput = {
      name,
      description: description || undefined,
      service_id: '',
      sli: {
        source: 'managed_promql',
        query_good: queryGood,
        query_total: queryTotal,
      },
      objective_pct: parseFloat(objectivePct),
      window_days: parseInt(windowDays),
    };
    createSLO.mutate(input, {
      onSuccess: () => { toast.success('SLO created'); onClose(); },
      onError: (e) => toast.error((e as Error).message),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New SLO</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary" placeholder="e.g. API Availability" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary" placeholder="Brief description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Objective (%)</label>
              <input value={objectivePct} onChange={(e) => setObjectivePct(e.target.value)} type="number" step="0.01" min="0" max="100" required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Window (days)</label>
              <input value={windowDays} onChange={(e) => setWindowDays(e.target.value)} type="number" min="1" max="365" required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Good Events Query (PromQL)</label>
            <QueryEditor
              value={queryGood}
              onChange={setQueryGood}
              language="promql"
              height="60px"
              placeholder='sum(rate(http_requests_total{code!~"5.."}[5m]))'
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Total Events Query (PromQL)</label>
            <QueryEditor
              value={queryTotal}
              onChange={setQueryTotal}
              language="promql"
              height="60px"
              placeholder='sum(rate(http_requests_total[5m]))'
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={createSLO.isPending || !name}>
              {createSLO.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              Create SLO
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
